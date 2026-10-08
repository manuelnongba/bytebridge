// One participant in a two-host test. Receives credentials as JSON on stdin.
import { hostname, platform } from 'node:os';
import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WebSocket from 'ws';
import { serverAddress } from '../src/renderer/collaboration/access.js';

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 16384) throw new Error('Configuration too large');
}

const config = JSON.parse(input);
const { room, token, run, client, networkLabel, allowLocal = false } = config;
const server = serverAddress(config.server);

if (
  !['A', 'B'].includes(client) ||
  !/^[\w-]{1,100}$/.test(run || '') ||
  !/^[\w-]{1,128}$/.test(room || '') ||
  !/^[\w-]{43}$/.test(token || '')
)
  throw new Error('Invalid test configuration');
if (
  !allowLocal &&
  (new URL(server).protocol !== 'https:' ||
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(server).hostname))
)
  throw new Error(
    'A public HTTPS server is required; allowLocal is only for harness validation.',
  );

const startedAt = new Date().toISOString();
const events = [];
const record = (event) => events.push({ event, at: new Date().toISOString() });
let provider;
let doc;
let publicIp = null;
const deadline = Date.now() + 90000;

async function until(predicate, label) {
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await delay(50);
  }
}

try {
  if (!allowLocal) {
    // Records egress identity, not credentials or code. No private metadata services are queried.
    const response = await fetch('https://checkip.amazonaws.com', {
      signal: AbortSignal.timeout(8000),
    });
    publicIp = (await response.text()).trim();
    if (!response.ok || !isIP(publicIp))
      throw new Error('Could not verify host public IP');
  }
  doc = new Y.Doc();
  provider = new WebsocketProvider(server.replace(/^http/, 'ws'), room, doc, {
    WebSocketPolyfill: WebSocket,
    params: { token },
    disableBc: true,
  });
  const state = doc.getMap(`network-test-${run}`);
  const text = doc.getText('monaco');
  await until(() => provider.synced, 'authorized room synchronization');
  record('connected');
  state.set(`ready-${client}`, true);
  await until(
    () => state.get('ready-A') && state.get('ready-B'),
    'both hosts ready',
  );
  const marker = `[${run}:${client}:initial]`;
  text.insert(text.length, marker);
  await until(
    () =>
      ['A', 'B'].every((id) =>
        text.toString().includes(`[${run}:${id}:initial]`),
      ),
    'bidirectional edits',
  );
  record('bidirectional-edits-received');

  if (client === 'A') {
    state.set('prepare-disconnect', true);
    await until(
      () => state.get('B-ready-for-disconnect'),
      'peer ready for outage',
    );
    provider.disconnect();
    record('disconnected');
    text.insert(text.length, `[${run}:A:offline]`);
    await delay(2500);
    provider.connect();
    await until(() => provider.synced, 'reconnection');
    record('reconnected');
  } else {
    await until(() => state.get('prepare-disconnect'), 'disconnect phase');
    state.set('B-ready-for-disconnect', true);
    await delay(1200);
    text.insert(text.length, `[${run}:B:during-outage]`);
    record('edited-during-peer-outage');
  }

  await until(
    () =>
      text.toString().includes(`[${run}:A:offline]`) &&
      text.toString().includes(`[${run}:B:during-outage]`),
    'offline edits converge',
  );

  record('offline-edits-converged');
  state.set(`complete-${client}`, text.toString());
  await until(
    () =>
      state.get('complete-A') &&
      state.get('complete-A') === state.get('complete-B'),
    'both hosts agree on final text',
  );

  console.log(
    JSON.stringify({
      result: 'PASS',
      mode: allowLocal ? 'local-harness-validation' : 'remote',
      client,
      run,
      hostname: hostname(),
      platform: platform(),
      networkLabel,
      publicIp,
      server,
      room,
      startedAt,
      events,
      finalText: text.toString(),
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      result: 'FAIL',
      mode: allowLocal ? 'local-harness-validation' : 'remote',
      client,
      run,
      hostname: hostname(),
      publicIp,
      startedAt,
      events,
      error: error.message,
    }),
  );
  process.exitCode = 1;
} finally {
  provider?.destroy();
  doc?.destroy();
}
