import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_CONFIG } from '../src/renderer/app-config.js';
import {
  createResolution,
  validateResolutionAppend,
  resolutionState,
  exportResolution,
  searchSessions,
  fenced,
} from '../src/renderer/resolution/data.js';
const config = APP_CONFIG.resolutions;
const events = [
  {
    id: 'a',
    type: 'checkpoint',
    title: 'Before',
    code: 'bad()',
    language: 'javascript',
    createdAt: 1,
    author: 'A',
  },
  {
    id: 'b',
    type: 'checkpoint',
    title: 'After',
    code: 'fixed()',
    language: 'javascript',
    createdAt: 2,
    author: 'A',
  },
  {
    id: 'c',
    type: 'outcome',
    title: 'Test run',
    output: '4 passed',
    createdAt: 3,
    author: 'A',
    outcome: 'successful',
  },
];
const input = {
  cause: 'Missing validation',
  fix: 'Validate decimal strings',
  evidence: 'Contract tests passed',
  uncertainty: 'Not production currency math',
  tags: 'prices, validation, Prices',
  evidenceIds: ['c'],
  beforeId: 'a',
  afterId: 'b',
};
test('resolution validates evidence and checkpoints and normalizes tags', () => {
  const record = createResolution(input, events, config, 'Alice');
  assert.deepEqual(record.tags, ['prices', 'validation']);
  assert.throws(
    () => createResolution({ ...input, cause: '' }, events, config, 'A'),
    /Root cause/,
  );
  assert.throws(
    () =>
      createResolution({ ...input, evidenceIds: ['a'] }, events, config, 'A'),
    /output/,
  );
  assert.throws(
    () => createResolution({ ...input, afterId: '' }, events, config, 'A'),
    /both/,
  );
  assert.throws(
    () => createResolution({ ...input, afterId: 'a' }, events, config, 'A'),
    /different/,
  );
  assert.throws(
    () => validateResolutionAppend([], record, { ...config, maxEntries: 0 }),
    /limit/,
  );
});
test('reopening retains prior resolutions', () => {
  const record = createResolution(input, events, config, 'Alice');
  const state = resolutionState([
    record,
    {
      id: 'reopen',
      type: 'reopen',
      reason: 'Regression',
      author: 'Bob',
      createdAt: 4,
    },
  ]);
  assert.equal(state.resolved, false);
  assert.equal(state.resolution.id, record.id);
});
test('export includes evidence and comparisons without room credentials', () => {
  const record = createResolution(input, events, config, 'Alice');
  const md = exportResolution({
    title: 'Price bug',
    token: 'PRIVATE_TOKEN',
    context: { problem: 'NaN', actual: 'NaN' },
    events,
    records: [record],
  });
  for (const value of [
    'Missing validation',
    '4 passed',
    '-bad()',
    '+fixed()',
    'not independently verified',
  ])
    assert.ok(md.includes(value), value);
  assert.ok(!md.includes('PRIVATE_TOKEN'));
  const noEvidence = exportResolution({
    title: 'Bug',
    context: {},
    events: [],
    records: [{ ...record, evidenceIds: [], beforeId: null, afterId: null }],
  });
  assert.match(noEvidence, /participant claims only/);
  assert.ok(fenced('```\n<script>hi</script>').startsWith('````\n'));
});
test('session search matches titles, errors, and tags while retaining original indexes', () => {
  const rooms = [
    {
      id: 'a',
      title: 'Price bug',
      search: { errorText: 'NaN', tags: ['validation'] },
    },
    { id: 'b', title: 'Login issue' },
  ];
  assert.deepEqual(
    searchSessions(rooms, 'nan validation').map((item) => item.index),
    [0],
  );
  assert.deepEqual(
    searchSessions(rooms, 'login').map((item) => item.index),
    [1],
  );
  assert.equal(searchSessions(rooms, 'missing').length, 0);
});
