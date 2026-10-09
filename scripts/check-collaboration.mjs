import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

// Uses the same provider and document key as the app, but does not test its UI.
const origin = process.env.BYTEBRIDGE_SERVER || 'http://localhost:1234';

async function createRoom() {
  const response = await fetch(`${origin}/rooms`, {
    method: 'POST',
    headers: { 'X-Creation-Key': process.env.ROOM_CREATION_KEY || '' },
  });

  if (!response.ok)
    throw new Error(`Room creation failed (${response.status})`);

  return response.json();
}

const room = await createRoom();
const separateRoom = await createRoom();
const clients = [];

function client(roomAccess = room) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(
    origin.replace(/^http/, 'ws'),
    roomAccess.id,
    doc,
    {
      params: { token: roomAccess.token },
      WebSocketPolyfill: WebSocket,
      disableBc: true,
    },
  );
  const result = { doc, provider, text: doc.getText('monaco') };

  clients.push(result);

  return result;
}

async function until(predicate, label) {
  const deadline = Date.now() + 8000;

  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);

    await delay(25);
  }
}

try {
  const a = client();
  const b = client();
  const other = client(separateRoom);

  await until(() => clients.every((c) => c.provider.synced), 'initial sync');
  a.text.insert(0, 'hello');
  await until(() => b.text.toString() === 'hello', 'A → B edit');
  b.text.insert(b.text.length, ' world');
  await until(() => a.text.toString() === 'hello world', 'B → A edit');
  assert.equal(other.text.toString(), '');
  console.log('PASS: bidirectional edits and separate room documents');

  a.provider.awareness.setLocalStateField('user', { name: 'Phase 0 A' });
  await until(
    () =>
      [...b.provider.awareness.getStates().values()].some(
        (state) => state.user?.name === 'Phase 0 A',
      ),
    'presence',
  );
  console.log('PASS: participant awareness propagation');

  b.provider.disconnect();
  a.text.insert(a.text.length, ' online');
  b.text.insert(b.text.length, ' offline');
  b.provider.connect();
  await until(
    () =>
      b.provider.synced &&
      a.text.toString() === b.text.toString() &&
      a.text.toString().includes('online') &&
      a.text.toString().includes('offline'),
    'reconnect convergence',
  );
  console.log('PASS: disconnected edits converge on reconnect');

  const late = client();

  await until(
    () => late.provider.synced && late.text.toString() === a.text.toString(),
    'late join',
  );
  console.log('PASS: late join retrieves active room content');
} finally {
  for (const { provider, doc } of clients) {
    provider.destroy();
    doc.destroy();
  }
}
