import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';

const exec = promisify(execFile);
const image = process.argv[2] || 'bytebridge-server:phase1';
const name = `bytebridge-check-${randomUUID()}`;
const key = randomBytes(32).toString('hex');
const clients = [];
let created = false;
let origin;
async function until(predicate, label) {
  for (let i = 0; i < 120; i++) {
    try {
      if (await predicate()) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
async function api(route, method = 'GET', token) {
  const response = await fetch(origin + route, {
    method,
    headers: {
      'X-Creation-Key': key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`API status ${response.status}`);
  return response.json();
}
function client(id, token) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(
    origin.replace('http', 'ws'),
    id,
    doc,
    { WebSocketPolyfill: WebSocket, params: { token }, disableBc: true },
  );
  const client = { doc, provider, text: doc.getText('monaco') };
  clients.push(client);
  return client;
}
function closeClients() {
  for (const client of clients) {
    client.provider.destroy();
    client.doc.destroy();
  }
  clients.length = 0;
}
try {
  await exec('docker', [
    'run',
    '-d',
    '--name',
    name,
    '-p',
    '127.0.0.1::1234',
    '-e',
    'TRUST_TLS_PROXY=1',
    '-e',
    `ROOM_CREATION_KEY=${key}`,
    image,
  ]);
  created = true;
  const { stdout } = await exec('docker', ['port', name, '1234/tcp']);
  origin = `http://${stdout.trim()}`;
  await until(
    async () => (await fetch(origin + '/health')).ok,
    'container healthy',
  );
  const rejected = await fetch(origin + '/rooms', { method: 'POST' });
  assert.equal(rejected.status, 403);
  const room = await api('/rooms', 'POST');
  const invite = await api(`/rooms/${room.id}/invites`, 'POST', room.token);
  const owner = client(room.id, room.token),
    guest = client(room.id, invite.token);
  await until(
    () => owner.provider.synced && guest.provider.synced,
    'clients sync',
  );
  owner.text.insert(0, 'container persistent collaboration');
  await until(
    () => guest.text.toString() === owner.text.toString(),
    'shared text',
  );
  console.log('PASS: container API authorization and two-client collaboration');
  closeClients();
  await exec('docker', ['restart', name]);
  // Docker may assign a different ephemeral host port on restart.
  origin = `http://${(await exec('docker', ['port', name, '1234/tcp'])).stdout.trim()}`;
  await until(
    async () => (await fetch(origin + '/health')).ok,
    'container restart',
  );
  const fresh = client(room.id, room.token);
  await until(
    () =>
      fresh.provider.synced &&
      fresh.text.toString() === 'container persistent collaboration',
    'persistent room',
  );
  console.log('PASS: room credentials and content survive container restart');
} catch (error) {
  if (created) {
    const logs = await exec('docker', ['logs', '--tail', '30', name]);
    console.error(logs.stdout, logs.stderr);
  }
  throw error;
} finally {
  closeClients();
  if (created) {
    // Only this uniquely named test container and its anonymous test volume.
    await exec('docker', ['rm', '-f', '-v', name]);
    console.log(
      'Cleaned up the disposable test container and its test volume.',
    );
  }
}
