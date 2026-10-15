import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { APP_CONFIG } from '../dist/typescript/renderer/app-config.js';
import {
  LEGACY_FILE,
  workspaceFiles,
  validPath,
  shareProject,
  removeProject,
  loadProjectFile,
  snapshotWorkspace,
  checkpointFiles,
} from '../dist/typescript/renderer/workspace/data.js';
import { createEvent } from '../dist/typescript/renderer/investigation/events.js';
import { exportResolution } from '../dist/typescript/renderer/resolution/data.js';

const config = APP_CONFIG.workspace;

const manifest = () => ({
  id: crypto.randomUUID(),
  name: 'project',
  files: ['src/a.js', 'src/b.js'].map((path) => ({
    id: crypto.randomUUID(),
    path,
  })),
});

test('catalog shares no contents; lazy buffers isolate files and converge across clients', () => {
  const a = new Y.Doc(),
    b = new Y.Doc(),
    scope = manifest();

  a.getText('monaco').insert(0, 'legacy');
  shareProject(a, scope, config);
  assert.equal(snapshotWorkspace(a).length, 1);
  assert.equal(workspaceFiles(a).length, 3);
  assert.equal(workspaceFiles(a)[1].text, null);
  loadProjectFile(a, scope.id, scope.files[0], 'first', config);
  loadProjectFile(a, scope.id, scope.files[1], 'second', config);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  workspaceFiles(a)[1].text.insert(0, 'a');
  workspaceFiles(b)[2].text.insert(0, 'b');
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  assert.deepEqual(snapshotWorkspace(a), snapshotWorkspace(b));
  assert.equal(a.getText('monaco').toString(), 'legacy');
  loadProjectFile(
    a,
    scope.id,
    scope.files[0],
    'must not replace edits',
    config,
  );
  assert.equal(workspaceFiles(a)[1].text.toString(), 'afirst');
  a.destroy();
  b.destroy();
});
test('invalid scope, mismatched metadata and budgets fail without partial writes', () => {
  const doc = new Y.Doc(),
    scope = manifest();

  for (const path of [
    '../secret',
    '/root',
    'src/../a',
    'C:\\a',
    'a//b',
    'a\n.js',
  ])
    assert.equal(validPath(path), false);

  assert.throws(
    () => shareProject(doc, scope, { ...config, maxFiles: 1 }),
    /limit/,
  );
  assert.equal(doc.getMap('workspace-files').size, 0);
  shareProject(doc, scope, config);
  assert.throws(
    () => loadProjectFile(doc, 'wrong', scope.files[0], 'x', config),
    /scope/,
  );
  assert.throws(
    () =>
      loadProjectFile(doc, scope.id, scope.files[0], 'xx', {
        ...config,
        maxFileBytes: 1,
      }),
    /limit/,
  );
  assert.throws(
    () =>
      loadProjectFile(doc, scope.id, scope.files[0], 'xx', {
        ...config,
        maxTotalBytes: 1,
      }),
    /budget/,
  );
  assert.equal(snapshotWorkspace(doc).length, 1);
  shareProject(doc, manifest(), config);
  assert.equal(workspaceFiles(doc).length, 5);
  doc.destroy();
});
test('checkpoints freeze loaded buffers only and export named files with legacy compatibility', () => {
  const doc = new Y.Doc(),
    scope = manifest();

  shareProject(doc, scope, config);
  loadProjectFile(doc, scope.id, scope.files[0], 'before', config);

  const input = {
    type: 'checkpoint',
    title: 'Workspace',
    notes: '',
    output: '',
    parentId: '',
  };
  const metadata = {
    author: 'Alice',
    code: '',
    language: 'javascript',
    issue: 'test',
    files: snapshotWorkspace(doc),
  };
  const before = createEvent(input, [], APP_CONFIG.timeline, metadata);

  assert.equal(before.files.length, 2);
  assert.ok(!before.files.some((file) => file.path === 'src/b.js'));

  const text = workspaceFiles(doc)[1].text;

  text.delete(0, text.length);
  text.insert(0, 'after');

  const after = createEvent(input, [before], APP_CONFIG.timeline, {
    ...metadata,
    files: snapshotWorkspace(doc),
  });

  assert.equal(before.files[1].code, 'before');
  assert.equal(checkpointFiles({ code: 'old' })[0].id, LEGACY_FILE);
  assert.throws(
    () =>
      createEvent(
        input,
        [],
        { ...APP_CONFIG.timeline, maxWorkspaceSnapshotBytes: 1 },
        metadata,
      ),
    /too large/,
  );

  const markdown = exportResolution({
    title: 'Multi-file',
    context: {},
    events: [before, after],
    records: [
      {
        id: 'r',
        type: 'resolution',
        author: 'Alice',
        createdAt: Date.now(),
        cause: 'cause',
        fix: 'fix',
        tags: [],
        evidenceIds: [],
        beforeId: before.id,
        afterId: after.id,
      },
    ],
  });

  for (const value of ['src/a.js', '-before', '+after'])
    assert.ok(markdown.includes(value));

  doc.destroy();
});

test('resharing reuses buffers and removing one project preserves others and checkpoint snapshots', () => {
  const doc = new Y.Doc();
  const first = manifest(),
    second = manifest();
  shareProject(doc, first, config);
  loadProjectFile(doc, first.id, first.files[0], 'unsaved room text', config);
  const snapshot = snapshotWorkspace(doc);
  shareProject(doc, first, config);
  assert.equal(workspaceFiles(doc).length, 3);
  assert.equal(
    workspaceFiles(doc)
      .find((file) => file.id === first.files[0].id)
      .text.toString(),
    'unsaved room text',
  );
  assert.throws(
    () => shareProject(doc, { ...first, id: 'different-project' }, config),
    /duplicate/,
  );
  shareProject(doc, second, config);
  removeProject(doc, first.id);
  assert.equal(workspaceFiles(doc).length, 3);
  assert.ok(workspaceFiles(doc).some((file) => file.projectId === second.id));
  assert.ok(snapshot.some((file) => file.code === 'unsaved room text'));
  doc.destroy();
});
