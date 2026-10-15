import test from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyScore } from '../dist/typescript/renderer/ui/navigation.js';
import {
  workspaceKey,
  readWorkspace,
  saveWorkspace,
} from '../dist/typescript/renderer/workspace/preferences.js';

test('file search matches sparse paths case insensitively and favors contiguous matches', () => {
  assert.ok(fuzzyScore('srcpnl', 'src/workspace/panel.ts') > 0);
  assert.equal(fuzzyScore('XYZ', 'src/panel.ts'), -1);
  assert.equal(
    fuzzyScore('PANEL', 'src/panel.ts'),
    fuzzyScore('panel', 'src/panel.ts'),
  );
  assert.ok(
    fuzzyScore('panel', 'panel.ts') >
      fuzzyScore('panel', 'path/another/new/editor/list.ts'),
  );
  assert.ok(fuzzyScore('', 'anything') >= 0);
});

test('workspace preferences separate servers and rooms and tolerate corrupt or blocked storage', () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    const a = workspaceKey('https://a', 'room');
    const b = workspaceKey('https://b', 'room');
    saveWorkspace(a, ['shared', 'file-a'], 'file-a');
    assert.deepEqual(readWorkspace(a), {
      opened: ['shared', 'file-a'],
      active: 'file-a',
    });
    assert.deepEqual(readWorkspace(b), { opened: [], active: '' });
    values.set(a, '{invalid');
    assert.deepEqual(readWorkspace(a), { opened: [], active: '' });
    globalThis.localStorage = {
      getItem() {
        throw Error('blocked');
      },
      setItem() {
        throw Error('blocked');
      },
    };
    assert.doesNotThrow(() => saveWorkspace(a, [], ''));
    assert.deepEqual(readWorkspace(a), { opened: [], active: '' });
  } finally {
    delete globalThis.localStorage;
  }
});
