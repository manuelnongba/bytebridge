export function resolutionState(records) {
  return {
    resolved: records.at(-1)?.type === 'resolution',
    latest: records.at(-1) || null,
    resolution:
      records.findLast((record) => record.type === 'resolution') || null,
  };
}
export function createResolution(input, events, config, author) {
  for (const field of config.fields) {
    if (
      typeof input[field.key] !== 'string' ||
      input[field.key].length > field.maxLength ||
      (field.required && !input[field.key].trim())
    )
      throw new Error(`Check ${field.label}.`);
  }
  const tags = [
    ...new Set(
      input.tags
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (tags.length > config.maxTags)
    throw new Error(`Use at most ${config.maxTags} tags.`);
  for (const id of input.evidenceIds)
    if (!events.some((event) => event.id === id && event.output?.trim()))
      throw new Error('Choose existing entries containing supplied output.');
  if (Boolean(input.beforeId) !== Boolean(input.afterId))
    throw new Error('Choose both checkpoints, or leave both empty.');
  if (input.beforeId) {
    if (input.beforeId === input.afterId)
      throw new Error('Choose two different checkpoints.');
    for (const id of [input.beforeId, input.afterId])
      if (
        !events.some((event) => event.id === id && event.type === 'checkpoint')
      )
        throw new Error('A selected checkpoint is unavailable.');
  }
  return {
    id: crypto.randomUUID(),
    type: 'resolution',
    author,
    createdAt: Date.now(),
    cause: input.cause.trim(),
    fix: input.fix.trim(),
    evidence: input.evidence,
    uncertainty: input.uncertainty,
    tags,
    evidenceIds: [...input.evidenceIds],
    beforeId: input.beforeId || null,
    afterId: input.afterId || null,
  };
}
export function validateResolutionAppend(records, record, config) {
  if (
    records.length >= config.maxEntries ||
    new TextEncoder().encode(JSON.stringify([...records, record])).byteLength >
      config.maxBytes
  )
    throw new Error('Resolution history limit reached.');
  if (records.some((item) => item.id === record.id))
    throw new Error('Already shared.');
}
export function resolutionText(record, events = []) {
  if (record.type === 'reopen')
    return `${record.author} reopened the investigation\n${record.reason}`;
  record = {
    ...record,
    beforeId: record.beforeId
      ? events.find((event) => event.id === record.beforeId)?.title ||
        'Earlier checkpoint'
      : null,
    afterId: record.afterId
      ? events.find((event) => event.id === record.afterId)?.title ||
        'Later checkpoint'
      : null,
  };
  return `Participant-reported resolution — ${record.author}\n\nRoot cause\n${record.cause}\n\nFix\n${record.fix}\n\nSupporting explanation\n${record.evidence || 'Not provided'}\n\nRemaining uncertainty\n${record.uncertainty || 'Not provided'}\n\nTags: ${record.tags.join(', ') || 'none'}\nEvidence entries attached: ${record.evidenceIds.length}. Attachments are supplied by participants, not independently verified.\nCheckpoint comparison: ${record.beforeId && record.afterId ? `${record.beforeId} → ${record.afterId}` : 'Not linked'}`;
}
// Fence all user-supplied text, including titles, so pasted Markdown cannot inject links/HTML.
export function fenced(value, language = '') {
  const text = String(value || 'Not provided');
  const size = Math.max(
    3,
    ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1),
  );
  const fence = '`'.repeat(size);
  return `${fence}${language}\n${text}\n${fence}`;
}
export function exportResolution({ title, context, events, records }) {
  const state = resolutionState(records);
  const resolution = state.resolution;
  if (!resolution) throw new Error('Record a resolution before exporting.');
  const parts = [
    '# ByteBridge investigation summary',
    fenced(title),
    `Status: ${state.resolved ? 'Resolved (participant-reported)' : 'Reopened'}`,
    'Evidence below is manually supplied; ByteBridge has not independently verified this result.',
    '## Problem',
    fenced(context.problem),
    '## Expected behavior',
    fenced(context.expected),
    '## Actual behavior / error',
    fenced(context.actual),
    '## Reproduction steps',
    fenced(context.steps),
    '## Resolution',
    fenced(resolutionText(resolution, events)),
    '## Investigation history',
  ];
  for (const [index, event] of events.entries()) {
    parts.push(
      `### Entry ${index + 1}`,
      fenced(
        `${event.type}: ${event.title}\n${event.author} · ${new Date(event.createdAt).toISOString()}\n${event.notes || ''}${event.outcome ? `\nReported outcome: ${event.outcome}` : ''}`,
      ),
    );
  }
  parts.push('## Linked verification evidence');
  if (!resolution.evidenceIds.length)
    parts.push(
      'No verification output is attached. This resolution is based on participant claims only.',
    );
  for (const id of resolution.evidenceIds) {
    const event = events.find((item) => item.id === id);
    parts.push(
      fenced(
        event
          ? `${event.title}\n\n${event.output}`
          : `Evidence unavailable: ${id}`,
      ),
    );
  }
  for (const [label, id] of [
    ['Before checkpoint', resolution.beforeId],
    ['After checkpoint', resolution.afterId],
  ]) {
    if (!id) continue;
    const event = events.find((item) => item.id === id);
    parts.push(
      `## ${label}`,
      fenced(
        event
          ? `${event.title} (${event.language})\n\n${event.code}`
          : 'Checkpoint unavailable',
      ),
    );
  }
  if (resolution.beforeId && resolution.afterId) {
    const before = events.find((item) => item.id === resolution.beforeId),
      after = events.find((item) => item.id === resolution.afterId);
    if (before && after)
      parts.push(
        '## Code comparison',
        'Full before/after line comparison (- removed, + added); not a minimal patch.',
        fenced(
          [
            ...before.code.split('\n').map((line) => `-${line}`),
            ...after.code.split('\n').map((line) => `+${line}`),
          ].join('\n'),
          'diff',
        ),
      );
  }
  parts.push(
    '## Resolution / reopening history',
    ...records.map((record) =>
      fenced(
        `${new Date(record.createdAt).toISOString()}\n${resolutionText(record, events)}`,
      ),
    ),
  );
  return parts.join('\n\n') + '\n';
}

export function searchSessions(rooms, query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rooms
    .map((room, index) => ({ room, index }))
    .filter(({ room }) => {
      const text = [
        room.title,
        room.id,
        room.search?.errorText,
        ...(room.search?.tags || []),
      ]
        .join(' ')
        .toLowerCase();
      return terms.every((term) => text.includes(term));
    });
}
