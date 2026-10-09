import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as Y from 'yjs';
import { createHosting } from '../dist/typescript/renderer/workspace/hosting.js';
import { workspaceFiles } from '../dist/typescript/renderer/workspace/data.js';
import { APP_CONFIG } from '../dist/typescript/renderer/app-config.js';

test('ephemeral requests load only approved files; only local host can save; stopping preserves buffers', async () => {
  const states = new Map(),
    peers = [];

  class Awareness extends EventEmitter {
    constructor(clientID) {
      super();
      this.clientID = clientID;
      states.set(clientID, {});
      peers.push(this);
    }

    getStates() {
      return states;
    }

    setLocalStateField(key, value) {
      states.get(this.clientID)[key] = value;

      for (const peer of peers) peer.emit('change');
    }
  }

  const a = new Y.Doc(),
    b = new Y.Doc();

  a.on('update', (update) => Y.applyUpdate(b, update));
  b.on('update', (update) => Y.applyUpdate(a, update));

  let reads = 0,
    saves = 0,
    closes = 0;
  const scope = {
    id: 'project',
    name: 'fixture',
    files: [
      { id: 'a', path: 'a.js' },
      { id: 'b', path: 'b.js' },
    ],
  };
  const api = {
    readProjectFile: async () => {
      reads++;

      return { content: 'original' };
    },
    saveProjectFile: async () => {
      saves++;
    },
    closeProject: async () => {
      closes++;
    },
  };
  const host = createHosting(
    a,
    { awareness: new Awareness(1), wsconnected: true },
    APP_CONFIG.workspace,
    api,
    () => {},
  );
  const peer = createHosting(
    b,
    { awareness: new Awareness(2), wsconnected: true },
    APP_CONFIG.workspace,
    {
      ...api,
      readProjectFile() {
        throw new Error('Peer must never read native files');
      },
    },
    () => {},
  );

  try {
    await host.add(scope);
    assert.equal(reads, 0);

    const entry = () => workspaceFiles(b).find((file) => file.id === 'a');

    await peer.load(entry());
    assert.equal(reads, 1);
    assert.equal(entry().text.toString(), 'original');
    await peer.load(entry());
    assert.equal(reads, 1);
    entry().text.insert(0, 'shared edit ');

    const hosted = workspaceFiles(a).find((file) => file.id === 'a');

    assert.equal(host.isDirty(hosted), true);
    await assert.rejects(peer.save(entry(), 'bad'), /scope/);
    assert.equal(saves, 0);
    await host.save(hosted, hosted.text.toString());
    assert.equal(saves, 1);
    assert.equal(host.isDirty(hosted), false);
    await assert.rejects(
      peer.load({ id: 'unapproved', projectId: scope.id }),
      /no longer sharing/,
    );
    assert.equal(reads, 1);
    await host.stop();
    assert.equal(closes, 1);
    await assert.rejects(
      peer.load(workspaceFiles(b).find((file) => file.id === 'b')),
      /Host offline/,
    );
    assert.ok(entry().text.toString().includes('shared edit'));
  } finally {
    peer.dispose();
    host.dispose();
    a.destroy();
    b.destroy();
  }
});
