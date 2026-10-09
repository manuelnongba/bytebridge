// Runs an unsigned local .app through macOS URL delivery with a temporary profile.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const exec = promisify(execFile);
const appPath = process.argv[2];

if (!appPath?.endsWith('/ByteBridge.app'))
  throw new Error('Pass the absolute path to the packaged ByteBridge.app');

const directory = await mkdtemp(path.join(tmpdir(), 'bytebridge-packaged-'));
const reservation = net.createServer();

await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));

const debugPort = reservation.address().port;

await new Promise((resolve) => reservation.close(resolve));

const server = spawn(process.execPath, ['scripts/server.mjs'], {
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '0',
    YPERSISTENCE: path.join(directory, 'data'),
    ROOM_CREATION_KEY: 'packaged-test-key',
    TLS_CERT: '',
    TLS_KEY: '',
    TRUST_TLS_PROXY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
let page;
let origin;
const results = [];

const record = (name, result) => {
  results.push({ name, result });
  console.log(name, result);
};

async function connect(url) {
  const socket = new WebSocket(url);

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let next = 0;
  const pending = new Map();

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (!message.id || !pending.has(message.id)) return;

    const { resolve, reject, timer } = pending.get(message.id);

    clearTimeout(timer);
    pending.delete(message.id);
    message.error
      ? reject(new Error(message.error.message))
      : resolve(message.result);
  });

  return {
    socket,
    call(method, params = {}) {
      const id = ++next;

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out: ${method}`));
        }, 8000);

        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function evaluate(code) {
  const result = await page.call('Runtime.evaluate', {
    expression: code,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });

  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);

  return result.result.value;
}

async function until(code, label) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(code)) return;

    await delay(100);
  }

  throw new Error(`Timed out: ${label}`);
}

async function invitation() {
  const created = await fetch(`${origin}/rooms`, {
    method: 'POST',
    headers: { 'X-Creation-Key': 'packaged-test-key' },
  });
  const room = await created.json();
  const response = await fetch(`${origin}/rooms/${room.id}/invites`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${room.token}` },
  });
  const invite = await response.json();

  return {
    id: room.id,
    url: `myapp://join?${new URLSearchParams({ room: room.id, server: origin, token: invite.token })}`,
  };
}

try {
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Server startup timeout')),
      8000,
    );

    server.stdout.on('data', (data) => {
      const match = String(data).match(/port (\d+)/);

      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    server.stderr.on('data', (data) => {
      clearTimeout(timeout);
      reject(new Error(String(data)));
    });
  });

  origin = `http://127.0.0.1:${port}`;

  const cold = await invitation();

  await exec('/usr/bin/open', [
    '-n',
    '-a',
    appPath,
    cold.url,
    '--args',
    `--user-data-dir=${path.join(directory, 'profile')}`,
    `--remote-debugging-port=${debugPort}`,
  ]);

  let targets;

  for (let i = 0; i < 150; i++) {
    try {
      targets = await (
        await fetch(`http://127.0.0.1:${debugPort}/json`)
      ).json();

      if (targets.some((target) => target.type === 'page')) break;
    } catch {}

    await delay(100);
  }

  if (!targets?.some((target) => target.type === 'page'))
    throw new Error('Packaged app debugging endpoint unavailable');

  const version = await (
    await fetch(`http://127.0.0.1:${debugPort}/json/version`)
  ).json();

  browser = await connect(version.webSocketDebuggerUrl);
  page = await connect(
    targets.find((target) => target.type === 'page').webSocketDebuggerUrl,
  );
  await until(
    `document.getElementById('invite-input')?.value.startsWith('myapp://')`,
    'cold OS invitation',
  );
  await evaluate(
    `document.getElementById('name-input').value='Packaged guest'; document.getElementById('join-button').click()`,
  );
  await until(
    `document.getElementById('connection-status').textContent === 'Connected'`,
    'cold join',
  );
  assert.ok(
    (await evaluate(`document.getElementById('room-label').title`)).includes(
      cold.id,
    ),
  );
  record('macOS cold URL launch', 'PASS');
  await evaluate(`document.getElementById('enter-editor')?.click()`);

  const warm = await invitation();

  await exec('/usr/bin/open', ['-a', appPath, warm.url]);
  await until(
    `document.getElementById('name-modal').style.display === 'flex'`,
    'warm OS invitation',
  );
  await evaluate(`document.getElementById('join-button').click()`);
  await until(
    `document.getElementById('name-modal').style.display === 'none' && document.getElementById('connection-status').textContent === 'Connected'`,
    'warm join',
  );
  await evaluate(`document.getElementById('enter-editor')?.click()`);
  assert.ok(
    (await evaluate(`document.getElementById('room-label').title`)).includes(
      warm.id,
    ),
  );
  assert.equal(
    await evaluate(`document.querySelectorAll('.monaco-editor').length`),
    1,
  );
  record('macOS warm URL launch', 'PASS: intended room, one editor');

  const capture = await page.call('Page.captureScreenshot');

  await writeFile(
    path.join(directory, 'packaged-app.png'),
    Buffer.from(capture.data, 'base64'),
  );
} catch (error) {
  record('failure', error.message);
  process.exitCode = 1;
} finally {
  if (browser) {
    try {
      await browser.call('Browser.close');
    } catch {}

    browser.socket.close();
  }

  page?.socket.close();

  if (server.exitCode === null)
    await new Promise((resolve) => {
      server.once('exit', resolve);
      server.kill('SIGTERM');
    });

  await writeFile(
    path.join(directory, 'results.json'),
    JSON.stringify(results, null, 2),
  );
  console.log('EVIDENCE_DIRECTORY', directory);
}
