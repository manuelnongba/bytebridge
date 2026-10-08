import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { APP_CONFIG } from '../src/renderer/app-config.js';
import {
  createEvent,
  validateAppend,
  catchUp,
} from '../src/renderer/investigation/events.js';

const config = APP_CONFIG.timeline;
const input = {
  type: 'hypothesis',
  title: 'Formatted price causes NaN',
  notes: 'Investigate numeric conversion',
  output: '',
  parentId: '',
  outcome: 'pending',
};
const snapshot = {
  author: 'Alice',
  code: 'const price = "1,200.00";',
  language: 'javascript',
  issue: 'Order preview is NaN',
};

test('checkpoint freezes code, author, language, and timestamp with a stable ID', () => {
  const event = createEvent(
    { ...input, type: 'checkpoint' },
    [],
    config,
    snapshot,
    12345,
  );
  assert.equal(event.code, snapshot.code);
  assert.equal(event.author, 'Alice');
  assert.equal(event.createdAt, 12345);
  assert.equal(event.language, 'javascript');
  assert.ok(event.id);
  assert.throws(() => validateAppend([event], event, config), /already/);
});

test('outcomes require a valid investigation and enforce configured choices and budgets', () => {
  const experiment = createEvent(
    { ...input, type: 'experiment' },
    [],
    config,
    snapshot,
  );
  assert.throws(
    () => createEvent({ ...input, type: 'outcome' }, [], config, snapshot),
    /Link/,
  );
  assert.throws(
    () =>
      createEvent(
        {
          ...input,
          type: 'outcome',
          parentId: experiment.id,
          outcome: 'verified',
        },
        [experiment],
        config,
        snapshot,
      ),
    /outcome/,
  );
  assert.throws(
    () => createEvent(input, [], { ...config, maxEvents: 0 }, snapshot),
    /limit/,
  );
  assert.throws(
    () => createEvent(input, [], { ...config, maxBytes: 1 }, snapshot),
    /too large/,
  );
  assert.throws(
    () =>
      createEvent(
        { ...input, type: 'checkpoint' },
        [],
        { ...config, maxSnapshotLength: 1 },
        snapshot,
      ),
    /too large/,
  );
});

test('catch-up separates open questions from reported results and preserves original issue', () => {
  const question = createEvent(input, [], config, snapshot);
  const experiment = createEvent(
    { ...input, type: 'experiment', title: 'Run price test' },
    [question],
    config,
    snapshot,
  );
  const result = createEvent(
    {
      ...input,
      type: 'outcome',
      title: 'Observed failure',
      parentId: experiment.id,
      outcome: 'failed',
      notes: 'Expected rejection, got NaN',
      output: 'not ok: rejects formatted prices',
    },
    [question, experiment],
    config,
    snapshot,
  );
  const text = catchUp([question, experiment, result], 'Changed issue');
  assert.match(text, /Order preview is NaN/);
  assert.match(text, /Run price test: failed/);
  assert.match(
    text,
    /Open hypotheses \/ experiments\nFormatted price causes NaN/,
  );
});

test('concurrent entries merge and checkpoint history does not overwrite live code', () => {
  const a = new Y.Doc(),
    b = new Y.Doc();
  try {
    a.getText('monaco').insert(0, 'live code');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const checkpoint = createEvent(
      { ...input, type: 'checkpoint' },
      [],
      config,
      snapshot,
    );
    a.getArray('investigation-events').push([checkpoint]);
    b.getArray('investigation-events').push([
      createEvent(input, [], config, snapshot),
    ]);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    assert.deepEqual(
      a.getArray('investigation-events').toArray(),
      b.getArray('investigation-events').toArray(),
    );
    assert.equal(a.getArray('investigation-events').length, 2);
    assert.equal(b.getText('monaco').toString(), 'live code');
    const late = new Y.Doc();
    Y.applyUpdate(late, Y.encodeStateAsUpdate(a));
    assert.equal(
      late
        .getArray('investigation-events')
        .toArray()
        .find((event) => event.id === checkpoint.id).code,
      snapshot.code,
    );
    late.destroy();
  } finally {
    a.destroy();
    b.destroy();
  }
});
