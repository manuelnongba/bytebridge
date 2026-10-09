import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { APP_CONFIG } from '../dist/typescript/renderer/app-config.js';
import {
  readContext,
  validateContext,
  contextChanges,
  contextSummary,
  readAttachment,
  entrySummary,
} from '../dist/typescript/renderer/debugging/data.js';

const config = APP_CONFIG.debugging;

test('snippet display starts code on a new line without a content label', () => {
  const snippet = {
    filename: 'example.js',
    language: 'javascript',
    content: 'const x = 1;\nconsole.log(x);',
  };

  assert.equal(
    entrySummary(snippet, config.collections[0]),
    'Filename: example.js\nLanguage: javascript\n\nconst x = 1;\nconsole.log(x);',
  );

  const summary = contextSummary(
    { ...readContext(new Map(), config), attachments: [snippet] },
    config,
  );

  assert.ok(summary.includes('Language: javascript\n\nconst x = 1;'));
  assert.ok(!summary.includes('Content:'));
  assert.ok(!summary.includes('remove sensitive text'));
});

const blank = () => readContext(new Map(), config);

const attachment = {
  filename: 'order-total.mjs',
  language: 'javascript',
  content: 'return price * quantity;',
};
const attempt = {
  action: 'Refresh preview',
  outcome: 'no-change',
  notes: 'Still NaN',
};

const file = (bytes, name = 'example.js') => ({
  name,
  size: bytes.byteLength,
  arrayBuffer: async () =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});

test('selected UTF-8 files preserve text and metadata; reject binary and large inputs', async () => {
  assert.deepEqual(
    await readAttachment(
      file(new TextEncoder().encode('const x = 1;'), '/private/example.js'),
      config,
    ),
    { filename: 'example.js', language: 'javascript', content: 'const x = 1;' },
  );
  await assert.rejects(
    readAttachment(file(Uint8Array.from([0, 1])), config),
    /Binary/,
  );
  await assert.rejects(
    readAttachment(file(Uint8Array.from([255, 254])), config),
    /UTF-8/,
  );
  await assert.rejects(
    readAttachment({ size: config.maxFileBytes + 1 }, config),
    /limit/,
  );
  await assert.rejects(
    readAttachment(file(new TextEncoder().encode('a'.repeat(32001))), config),
    /too long/,
  );
});

test('review validation enforces metadata, outcomes, URLs, counts and total byte budget', () => {
  const draft = {
    ...blank(),
    attachments: [attachment],
    attemptEntries: [attempt],
  };

  assert.equal(validateContext(draft, config), draft);
  assert.throws(
    () =>
      validateContext(
        { ...draft, attachments: [{ ...attachment, filename: '' }] },
        config,
      ),
    /Filename/,
  );
  assert.throws(
    () =>
      validateContext(
        { ...draft, attemptEntries: [{ ...attempt, outcome: 'made-up' }] },
        config,
      ),
    /Outcome/,
  );
  assert.throws(
    () => validateContext({ ...draft, issue: 'javascript:alert(1)' }, config),
    /HTTP/,
  );
  assert.throws(
    () =>
      validateContext(
        { ...draft, attachments: Array(9).fill(attachment) },
        config,
      ),
    /maximum/,
  );
  assert.throws(
    () => validateContext(draft, { ...config, maxContextBytes: 10 }),
    /too large/,
  );
});

test('reviewed changes retain unrelated updates and reject conflicting list replacements', () => {
  const base = blank();
  const draft = { ...base, attachments: [attachment] };

  assert.deepEqual(
    contextChanges(base, draft, { ...base, problem: 'Remote note' }),
    ['attachments'],
  );
  assert.throws(
    () =>
      contextChanges(base, draft, {
        ...base,
        attachments: [{ ...attachment, content: 'remote' }],
      }),
    /teammate/,
  );
  assert.deepEqual(contextChanges(base, base, base), []);
});

test('attachments, attempts and legacy notes round-trip through Yjs for late joiners', () => {
  const owner = new Y.Doc();
  const helper = new Y.Doc();

  try {
    const snapshot = {
      ...blank(),
      attempts: 'Existing notes',
      attachments: [attachment],
      attemptEntries: [attempt],
    };

    owner.transact(() => {
      for (const [key, value] of Object.entries(snapshot))
        owner.getMap('debug-context').set(key, value);
    });
    Y.applyUpdate(helper, Y.encodeStateAsUpdate(owner));
    assert.deepEqual(
      readContext(helper.getMap('debug-context'), config),
      snapshot,
    );
    assert.match(contextSummary(snapshot, config), /order-total.mjs/);
    assert.match(contextSummary(snapshot, config), /Still NaN/);
  } finally {
    owner.destroy();
    helper.destroy();
  }
});
