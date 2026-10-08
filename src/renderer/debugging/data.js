import { detectLanguage } from './languages.js';

export function readContext(shared, config) {
  return Object.fromEntries([
    ...config.fields.map(({ key }) => [
      key,
      typeof shared.get(key) === 'string' ? shared.get(key) : '',
    ]),
    ...config.collections.map(({ key }) => [
      key,
      Array.isArray(shared.get(key)) ? structuredClone(shared.get(key)) : [],
    ]),
  ]);
}

export function validateContext(snapshot, config) {
  for (const field of config.fields) {
    if (
      typeof snapshot[field.key] !== 'string' ||
      snapshot[field.key].length > config.maxFieldLength
    )
      throw new Error(`${field.label} is too long.`);
  }
  if (snapshot.issue) {
    let url;
    try {
      url = new URL(snapshot.issue);
    } catch {
      throw new Error('Enter a complete HTTP(S) issue URL or leave it empty.');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error(
        'Issue URLs must use HTTP(S) without embedded credentials.',
      );
  }
  for (const collection of config.collections) {
    const entries = snapshot[collection.key];
    if (!Array.isArray(entries) || entries.length > collection.maxItems)
      throw new Error(
        `${collection.label}: maximum ${collection.maxItems} entries.`,
      );
    for (const entry of entries) {
      for (const field of collection.fields) {
        const value = entry?.[field.key];
        if (
          typeof value !== 'string' ||
          (!value.trim() && field.key !== 'notes') ||
          value.length > (field.maxLength || 100) ||
          (field.options && !field.options.includes(value))
        )
          throw new Error(
            `Check ${collection.label}: ${field.label} is missing or invalid.`,
          );
      }
    }
  }
  if (
    new TextEncoder().encode(JSON.stringify(snapshot)).byteLength >
    config.maxContextBytes
  )
    throw new Error(
      'Context is too large. Remove or shorten attachments and logs.',
    );
  return snapshot;
}

// Compare only edited fields/collections so unrelated teammate updates are retained.
export function contextChanges(base, draft, current) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const keys = Object.keys(draft).filter((key) => !same(base[key], draft[key]));
  if (keys.some((key) => !same(base[key], current[key])))
    throw new Error(
      'A teammate changed one of these fields or lists. Copy your draft if needed, discard it, and edit the latest context.',
    );
  return keys;
}

export function entrySummary(entry, collection) {
  return collection.fields
    .map((field) => {
      const value = String(entry?.[field.key] || '');
      return field.displayLabel === false
        ? `\n${value}`
        : `${field.label}: ${value}`;
    })
    .join('\n');
}

export function contextSummary(snapshot, config) {
  return [
    ...config.fields.map(
      ({ key, label }) => `${label}\n${snapshot[key] || '(empty)'}`,
    ),
    ...config.collections.map(
      (collection) =>
        `${collection.label}\n${snapshot[collection.key].map((entry, index) => `${index + 1}. ${entrySummary(entry, collection)}`).join('\n\n') || '(none)'}`,
    ),
  ].join('\n\n');
}

export async function readAttachment(file, config) {
  if (file.size > config.maxFileBytes)
    throw new Error(
      `File exceeds the ${config.maxFileBytes}-byte limit. Select a smaller text file or paste a snippet.`,
    );
  const bytes = await file.arrayBuffer();
  let content;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Select a UTF-8 text file, not a binary file.');
  }
  if (content.includes('\0'))
    throw new Error('Binary files are not supported.');
  const filename = file.name.split(/[\\/]/).pop();
  const language = detectLanguage(filename, config.languages);
  const schema = config.collections.find((item) => item.fileImport);
  if (
    content.length >
    schema.fields.find((field) => field.key === 'content').maxLength
  )
    throw new Error('File text is too long. Paste only the relevant snippet.');
  return { filename, language, content };
}
