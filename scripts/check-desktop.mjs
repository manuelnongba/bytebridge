import { app, BrowserWindow, dialog } from 'electron';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WebSocket from 'ws';
import { checkWorkspace } from './check-workspace.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = await mkdtemp(path.join(tmpdir(), 'bytebridge-phase1-'));
const results = [];

const report = (name, detail) => {
  results.push({ name, detail });
  console.log(name, JSON.stringify(detail));
};

let server,
  origin,
  port = 0;

async function startServer() {
  server = spawn(process.execPath, [path.join(root, 'scripts/server.mjs')], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HOST: '127.0.0.1',
      PORT: String(port),
      ROOM_CREATION_KEY: 'desktop-test-key',
      YPERSISTENCE: path.join(output, 'rooms'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Server start timeout')),
      8000,
    );

    server.stdout.on('data', (data) => {
      const match = String(data).match(/port (\d+)/);

      if (match) {
        port = Number(match[1]);
        origin = `http://127.0.0.1:${port}`;
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on('data', (data) => {
      clearTimeout(timer);
      reject(new Error(String(data)));
    });
    server.once('error', reject);
  });
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;

  await new Promise((resolve) => {
    server.once('exit', resolve);
    server.kill('SIGTERM');
  });
}

await startServer();

const create = async () => {
  const response = await fetch(`${origin}/rooms`, {
    method: 'POST',
    headers: { 'X-Creation-Key': 'desktop-test-key' },
  });

  return { ...(await response.json()), server: origin };
};

const fixture = await create();

async function invite(room) {
  const response = await fetch(`${origin}/rooms/${room.id}/invites`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${room.token}` },
  });
  const invitation = await response.json();

  return {
    ...invitation,
    url: `myapp://join?${new URLSearchParams({ room: room.id, server: origin, token: invitation.token })}`,
  };
}

const launchInvite = await invite(fixture);
const setPath = app.setPath.bind(app);

app.setPath = (name, value) =>
  setPath(name, name === 'userData' ? output : value);
app.setPath('userData', output);
app.setAsDefaultProtocolClient = () => false;

const loadFile = BrowserWindow.prototype.loadFile;
let loaded;
const hostLoaded = new Promise((resolve) => {
  loaded = resolve;
});

BrowserWindow.prototype.loadFile = async function (file, options = {}) {
  // Assertions inspect rendered Monaco text in windows behind the active client.
  this.webContents.setBackgroundThrottling(false);
  await this.loadURL('about:blank');
  this.webContents.on('console-message', (event) => {
    if (event.level === 'error') report('renderer-error', event.message);
  });

  const result = await loadFile.call(this, file, options);

  loaded();

  return result;
};
await import('../dist/main/main.js');

const cold = process.argv.includes('--cold-invite');

if (cold) app.emit('open-url', { preventDefault() {} }, launchInvite.url);

const js = (win, code) => win.webContents.executeJavaScript(code, true);

async function until(win, code, label) {
  for (let i = 0; i < 120; i++) {
    if (await js(win, code)) return;

    await delay(100);
  }

  throw new Error(`Timed out: ${label}`);
}

async function fill(win, id, value) {
  await js(
    win,
    `document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(value)}`,
  );
}

async function join(win, name) {
  await fill(win, 'name-input', name);
  await js(win, "document.getElementById('join-button').click()");
  await until(
    win,
    "document.getElementById('name-modal').style.display === 'none' && document.getElementById('connection-status').textContent === 'Connected'",
    'join',
  );
  assert.equal(
    await js(
      win,
      "document.getElementById('room-overview').hidden && !document.getElementById('files-panel').hidden && document.querySelectorAll('#editor .monaco-editor').length === 1",
    ),
    true,
  );
  assert.equal(
    await js(
      win,
      "document.getElementById('open-resolution') === null && document.getElementById('open-timeline') === null",
    ),
    true,
  );
}

async function problem(win) {
  await js(
    win,
    "if(document.getElementById('debug-context').hidden) document.getElementById('open-context').click()",
  );
}

async function timelineEntry(win) {
  await problem(win);
  await js(
    win,
    "document.getElementById('problem-history').open = true; document.getElementById('save-checkpoint').click()",
  );
  await until(
    win,
    "document.getElementById('problem-history-status').textContent.includes('Checkpoint saved')",
    'checkpoint saved',
  );
}

async function type(win, value) {
  win.show();
  win.focus();
  await until(
    win,
    `(() => {
    const lines = document.querySelector('.view-lines');
    if (!lines) return false;
    const r = lines.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !!document.elementFromPoint(r.x + 10, r.y + 10)?.closest('#editor');
  })()`,
    'editor laid out and ready for native input',
  );

  const point = await js(
    win,
    `(() => {
       const r = document.querySelector('.view-lines').getBoundingClientRect();
       return { x: Math.round(r.x + 10), y: Math.round(r.y + 10) };
     })()`,
  );

  win.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    clickCount: 1,
    ...point,
  });
  win.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    ...point,
  });

  for (const keyCode of value)
    win.webContents.sendInputEvent({ type: 'char', keyCode });

  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
  await delay(350);
}

async function snapshot(win, name) {
  await js(
    win,
    `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
  );
  await writeFile(
    path.join(output, `${name}.png`),
    (await win.webContents.capturePage()).toPNG(),
  );
}

async function guestWindow(partition) {
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    webPreferences: {
      partition,
      preload: path.join(root, 'dist/preload/preload.js'),
    },
  });

  await win.loadFile(path.join(root, 'dist/renderer/index.html'));
  await delay(200);

  return win;
}

app.whenReady().then(async () => {
  try {
    await hostLoaded;

    const host = BrowserWindow.getAllWindows()[0];

    await delay(400);

    if (cold) {
      await join(host, 'Cold guest');
      assert.match(
        await js(host, "document.getElementById('room-label').title"),
        new RegExp(fixture.id),
      );
      report(
        'cold-invitation',
        'PASS: intended room opens directly in the editor',
      );

      return;
    }

    for (const dismiss of [
      "document.getElementById('close-join').click()",
      "document.getElementById('name-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))",
      "document.getElementById('name-modal').click()",
      "document.getElementById('cancel-join').click()",
    ]) {
      await js(host, dismiss);
      assert.equal(
        await js(
          host,
          "document.getElementById('name-modal').style.display === 'none' && !document.getElementById('workspace').inert",
        ),
        true,
      );
      await js(host, "document.getElementById('create-room').click()");
    }

    await fill(host, 'server-input', origin);
    await fill(host, 'creation-key', 'desktop-test-key');
    await fill(host, 'room-title', 'Simple workspace');
    await join(host, 'Owner');

    const room = await js(
      host,
      "JSON.parse(localStorage.getItem('bytebridge-rooms')).at(-1)",
    );
    const invitation = await invite(room);
    const peer = await guestWindow('simplified-peer');

    await js(peer, "document.getElementById('open-join').click()");
    await fill(peer, 'invite-input', invitation.url);
    await join(peer, 'Helper');
    assert.equal(
      await js(host, "document.getElementById('open-project').disabled"),
      false,
    );
    assert.equal(
      await js(peer, "document.getElementById('manage-invites').hidden"),
      true,
    );
    await type(host, '// owner ');
    await until(
      peer,
      "document.querySelector('#editor .view-lines').textContent.includes('owner')",
      'owner edit',
    );
    await type(peer, '// helper ');
    await until(
      host,
      "document.querySelector('#editor .view-lines').textContent.includes('helper')",
      'peer edit',
    );
    report(
      'entry-and-collaboration',
      'PASS: Files immediately available to owner/editor; two-way editing',
    );
    await problem(host);
    await js(host, "document.getElementById('edit-context').click()");
    assert.equal(
      await js(host, "document.getElementById('context-overview').hidden"),
      true,
    );
    assert.equal(
      await js(host, "document.getElementById('context-problem').value"),
      '',
    );
    assert.equal(
      await js(
        host,
        "document.getElementById('context-steps').closest('details').open",
      ),
      false,
    );
    await fill(host, 'context-problem', 'Checkout fails');
    await fill(host, 'context-expected', 'An order is created');
    await problem(peer);
    assert.equal(
      await js(
        peer,
        "document.getElementById('context-overview').textContent.includes('Checkout fails')",
      ),
      false,
    );
    await js(host, "document.getElementById('review-context').click()");
    await until(
      peer,
      "document.getElementById('context-overview').textContent.includes('Checkout fails')",
      'one-action problem sharing',
    );
    await js(host, "document.getElementById('edit-context').click()");
    await fill(host, 'context-problem', 'discarded private draft');
    await js(host, "document.getElementById('discard-context').click()");
    assert.equal(
      await js(
        host,
        "document.getElementById('context-overview').textContent.includes('discarded private draft')",
      ),
      false,
    );
    // Concurrent edits to the same field must not overwrite the other person's update.
    await js(host, "document.getElementById('edit-context').click()");
    await js(peer, "document.getElementById('edit-context').click()");
    await fill(peer, 'context-problem', 'Helper updated problem');
    await js(peer, "document.getElementById('review-context').click()");
    await until(
      host,
      "document.getElementById('context-overview').textContent.includes('Helper updated problem')",
      'concurrent context update',
    );
    await fill(host, 'context-problem', 'stale owner draft');
    await js(host, "document.getElementById('review-context').click()");
    await until(
      host,
      "document.getElementById('context-status').textContent.includes('teammate changed')",
      'conflict surfaced',
    );
    await js(
      host,
      "document.getElementById('discard-context').click(); document.getElementById('edit-context').click(); document.getElementById('context-steps').closest('details').open = true; document.getElementById('add-attachments').click()",
    );
    await js(
      host,
      "const row=document.querySelector('[data-collection=attachments] .context-entry'); row.querySelector('[data-field=filename]').value='bug.py'; row.querySelector('[data-field=filename]').dispatchEvent(new Event('input')); row.querySelector('[data-field=content]').value='print(42)';",
    );
    assert.equal(
      await js(host, "document.querySelector('[data-field=language]').value"),
      'python',
    );
    await js(host, "document.getElementById('review-context').click()");
    await until(
      peer,
      "document.getElementById('context-overview').textContent.includes('bug.py')",
      'snippet shared',
    );
    report(
      'simple-problem',
      'PASS: two primary fields, optional details, private drafts, discard, one-action share, conflicts and language detection',
    );

    // Seed genuine legacy records through the existing protocol, not renderer globals.
    const legacyDoc = new Y.Doc();
    const seed = new WebsocketProvider(
      origin.replace(/^http/, 'ws'),
      room.id,
      legacyDoc,
      {
        WebSocketPolyfill: WebSocket,
        disableBc: true,
        params: { token: room.token },
      },
    );

    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Legacy seed timeout')),
          8000,
        );

        seed.on('sync', (synced) => {
          if (synced) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      legacyDoc.getArray('investigation-events').push([
        {
          id: 'legacy-experiment',
          type: 'experiment',
          title: 'Legacy experiment',
          notes: 'Prior reasoning',
          output: 'Legacy failing output',
          author: 'Earlier teammate',
          createdAt: 1,
          parentId: null,
        },
      ]);
      legacyDoc.getArray('resolution-events').push([
        {
          id: 'legacy-resolution',
          type: 'resolution',
          cause: 'Legacy root cause',
          fix: 'Legacy fix',
          evidence: 'Previous evidence',
          uncertainty: '',
          tags: ['legacy'],
          evidenceIds: ['legacy-experiment'],
          beforeId: null,
          afterId: null,
          author: 'Earlier teammate',
          createdAt: 2,
        },
        {
          id: 'legacy-reopen',
          type: 'reopen',
          reason: 'Needs another look',
          author: 'Earlier teammate',
          createdAt: 3,
        },
      ]);
      legacyDoc
        .getMap('debug-context')
        .set('attemptEntries', [
          { action: 'Legacy attempt', outcome: 'failed', notes: 'Preserved' },
        ]);
      await until(
        host,
        "document.getElementById('problem-history-list').textContent.includes('Legacy root cause') && document.getElementById('problem-history-list').textContent.includes('Legacy failing output')",
        'legacy history retained',
      );
    } finally {
      seed.destroy();
      legacyDoc.destroy();
    }

    await timelineEntry(host);
    await type(peer, '// after checkpoint ');
    await until(
      host,
      "document.querySelector('#editor .view-lines').textContent.includes('after')",
      'checkpoint edit',
    );
    await timelineEntry(host);
    await js(
      host,
      "document.getElementById('checkpoint-before').selectedIndex=1; document.getElementById('checkpoint-after').selectedIndex=2; document.getElementById('compare-checkpoints').click()",
    );
    await until(
      host,
      "document.querySelector('#checkpoint-diff .monaco-diff-editor') !== null",
      'checkpoint diff',
    );
    await js(host, "document.getElementById('open-context').click()");
    assert.equal(
      await js(
        host,
        "document.querySelector('#checkpoint-diff .monaco-diff-editor') === null",
      ),
      true,
    );
    await problem(host);
    await js(host, "document.getElementById('mark-solved').click()");
    await fill(host, 'solved-note', 'Corrected the checkout condition');
    assert.equal(
      await js(
        peer,
        "document.getElementById('problem-fix').textContent.includes('Corrected')",
      ),
      false,
    );
    await js(host, "document.getElementById('confirm-solved').click()");
    await until(
      peer,
      "document.getElementById('resolution-badge').textContent.includes('Solved') && document.getElementById('problem-fix').textContent.includes('Corrected')",
      'solved status sync',
    );
    await js(peer, "document.getElementById('reopen-problem').click()");
    await until(
      host,
      "document.getElementById('resolution-badge').textContent === 'Open'",
      'reopened',
    );
    assert.ok(
      await js(
        host,
        "document.getElementById('problem-history-list').textContent.includes('Corrected')",
      ),
    );
    await js(
      host,
      "document.getElementById('mark-solved').click(); document.getElementById('confirm-solved').click()",
    );
    await until(
      peer,
      "document.getElementById('resolution-badge').textContent.includes('Solved')",
      'optional empty fix note',
    );
    report(
      'history-and-status',
      'PASS: legacy records retained, frozen checkpoints/diff, optional fix note, solved and reopened status',
    );

    const originalSave = dialog.showSaveDialog;

    try {
      await js(
        host,
        "document.getElementById('problem-history').open=true; document.getElementById('export-history').click()",
      );
      assert.ok(
        await js(
          host,
          "document.getElementById('history-export').value.includes('Legacy root cause')",
        ),
      );
      dialog.showSaveDialog = async () => ({ canceled: true });
      await js(host, "document.getElementById('save-history-export').click()");
      await until(
        host,
        "document.getElementById('problem-history-status').textContent === 'Export canceled.'",
        'export cancellation',
      );
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: path.join(output, 'history.md'),
      });
      await js(host, "document.getElementById('save-history-export').click()");
      await until(
        host,
        "document.getElementById('problem-history-status').textContent === 'Markdown saved.'",
        'export save',
      );
      assert.ok(
        (await readFile(path.join(output, 'history.md'), 'utf8')).includes(
          'Legacy failing output',
        ),
      );
    } finally {
      dialog.showSaveDialog = originalSave;
    }

    await snapshot(host, 'simplified-problem');
    await js(
      host,
      "document.getElementById('panel-resizer').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))",
    );
    assert.ok(
      await js(
        host,
        "Number(document.getElementById('panel-resizer').getAttribute('aria-valuenow')) > 0",
      ),
    );
    host.setSize(780, 760);
    await snapshot(host, 'simplified-narrow');
    assert.equal(
      await js(host, 'document.documentElement.scrollWidth <= innerWidth'),
      true,
    );
    host.setSize(1100, 780);
    await stopServer();
    await until(
      host,
      "document.getElementById('connection-status').dataset.state === 'offline'",
      'offline status',
    );
    await type(host, '// offline ');
    await startServer();
    await until(
      peer,
      "document.querySelector('#editor .view-lines').textContent.includes('offline')",
      'offline edits converge',
    );
    await fetch(origin + '/rooms/' + room.id + '/invites/' + invitation.id, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + room.token },
    });
    await until(
      peer,
      "document.getElementById('connection-status').textContent.includes('revoked')",
      'revocation',
    );
    assert.equal(
      await js(peer, "document.getElementById('review-context').disabled"),
      true,
    );
    report(
      'export-network-access',
      'PASS: export review/save/cancel, narrow layout, resize, reconnect and access revocation',
    );

    const stored = await js(
      host,
      "JSON.parse(localStorage.getItem('bytebridge-rooms')).at(-1)",
    );

    for (const win of BrowserWindow.getAllWindows()) win.destroy();

    await stopServer();
    await startServer();

    const fresh = await guestWindow('simplified-returned');

    await js(
      fresh,
      "localStorage.setItem('bytebridge-rooms', " +
        JSON.stringify(JSON.stringify([stored])) +
        ')',
    );

    const reloaded = new Promise((resolve) =>
      fresh.webContents.once('did-finish-load', resolve),
    );

    fresh.webContents.reload();
    await reloaded;
    await delay(200);
    await join(fresh, 'Returned');
    await until(
      fresh,
      "document.getElementById('problem-history-list').textContent.includes('Legacy root cause') && document.getElementById('resolution-badge').textContent.includes('Solved')",
      'history persisted',
    );
    report(
      'history-persistence',
      'PASS: problem, legacy records, checkpoints and solved status survive restart',
    );

    const library = async (win) =>
      js(
        win,
        `document.getElementById('open-join').click();
         document.getElementById('room-mode').value = 'resume';
         document.getElementById('room-mode').dispatchEvent(new Event('change'));
         document.querySelector('#session-management details').open = true;`,
      );

    await library(fresh);
    await js(fresh, `document.getElementById('rename-session').click()`);
    await fill(fresh, 'session-confirm-input', 'Managed investigation');
    await js(
      fresh,
      `document.getElementById('confirm-rename-session').click()`,
    );
    await until(
      fresh,
      `document.getElementById('room-label').textContent.includes('Managed investigation')`,
      'room renamed',
    );
    assert.equal(
      await js(
        fresh,
        `document.getElementById('resolution-badge').textContent.includes('Solved')`,
      ),
      true,
    );
    await js(fresh, `document.getElementById('archive-session').click()`);
    await until(
      fresh,
      `document.getElementById('saved-room').options.length === 0`,
      'archived hidden',
    );
    await js(
      fresh,
      `document.getElementById('session-filter').value = 'archived'; document.getElementById('session-filter').dispatchEvent(new Event('change'))`,
    );
    assert.equal(
      await js(fresh, `document.getElementById('saved-room').options.length`),
      1,
    );
    await js(fresh, `document.getElementById('archive-session').click()`);
    await until(
      fresh,
      `document.getElementById('saved-room').options.length === 0`,
      'unarchived hidden from archive',
    );
    await js(
      fresh,
      `document.getElementById('session-filter').value = 'active';
       document.getElementById('session-filter').dispatchEvent(new Event('change'));
       document.getElementById('forget-session').click();
       document.getElementById('cancel-session-action').click();`,
    );
    assert.equal(
      await js(
        fresh,
        `JSON.parse(localStorage.getItem('bytebridge-rooms')).length`,
      ),
      1,
    );
    await js(
      fresh,
      `document.querySelector('#session-management details').open = true; document.getElementById('delete-session').click()`,
    );
    assert.equal(
      await js(
        fresh,
        `document.getElementById('confirm-delete-session').disabled`,
      ),
      true,
    );
    await snapshot(fresh, 'room-management-confirmation');
    await js(fresh, `document.getElementById('export-before-delete').click()`);
    await until(
      fresh,
      `document.getElementById('name-modal').style.display === 'none' && !document.getElementById('debug-context').hidden`,
      'export offered without deletion',
    );
    await library(fresh);
    await js(fresh, `document.getElementById('delete-session').click()`);
    await fill(fresh, 'session-confirm-input', 'Managed investigation');
    await js(
      fresh,
      `document.getElementById('session-confirm-input').dispatchEvent(new Event('input')); document.getElementById('confirm-delete-session').click()`,
    );
    await until(
      fresh,
      `JSON.parse(localStorage.getItem('bytebridge-rooms')).length === 0 && !document.getElementById('empty-workspace').hidden`,
      'deleted and closed active room',
    );
    await js(fresh, `document.getElementById('cancel-join').click()`);
    assert.equal(
      await js(fresh, `document.getElementById('name-modal').style.display`),
      'none',
    );
    report(
      'room-management',
      'PASS: owner rename, archive/unarchive filters, forget cancellation, typed deletion, export-first path, active-room cleanup, closable dialog',
    );

    const forgetFixture = await create();
    const forgetInvite = await invite(forgetFixture);

    await js(fresh, `document.getElementById('open-join').click()`);
    await fill(fresh, 'invite-input', forgetInvite.url);
    await join(fresh, 'Editor');

    const workspacePeer = await guestWindow('workspace-helper');

    await js(
      workspacePeer,
      `document.getElementById('room-mode').value = 'join'; document.getElementById('room-mode').dispatchEvent(new Event('change'))`,
    );
    await fill(workspacePeer, 'invite-input', forgetInvite.url);
    await join(workspacePeer, 'Helper');
    await checkWorkspace({
      host: fresh,
      peer: workspacePeer,
      output,
      js,
      fill,
      until,
      type,
      timelineEntry,
      snapshot,
    });
    workspacePeer.destroy();
    report(
      'multi-file-workspace',
      'PASS: project scope consent, metadata-only catalog, lazy host reads, independent tabs, two-way collaboration/presence, loaded-file checkpoints, host-only explicit save, external-change conflict, copy fallback and host offline',
    );
    await library(fresh);
    assert.equal(
      await js(
        fresh,
        `document.getElementById('rename-session') === null && document.getElementById('delete-session') === null`,
      ),
      true,
    );
    await js(
      fresh,
      `document.getElementById('forget-session').click(); document.getElementById('confirm-forget-session').click()`,
    );
    await until(
      fresh,
      `JSON.parse(localStorage.getItem('bytebridge-rooms')).length === 0 && document.getElementById('saved-room').options.length === 0`,
      'editor forgets active room',
    );

    const survivingRoom = await fetch(`${origin}/rooms/${forgetFixture.id}`, {
      headers: { Authorization: `Bearer ${forgetFixture.token}` },
    });

    assert.equal(survivingRoom.status, 200);
    report(
      'room-forget',
      'PASS: editor cannot rename/delete; confirmed forget closes locally without deleting server room',
    );
    await stopServer();
    await startServer();
    await js(fresh, `document.getElementById('open-join').click()`);
    await fill(fresh, 'invite-input', forgetInvite.url);
    await join(fresh, 'Returned workspace');
    await until(
      fresh,
      `document.querySelectorAll('.workspace-file').length === 5`,
      'multi-file persistence',
    );
    await js(
      fresh,
      `
      if(document.getElementById('files-panel').hidden) document.getElementById('open-files').click();
      [...document.querySelectorAll('.workspace-file')]
        .find(row => row.dataset.path === 'src/a.js').querySelector('button').click();
    `,
    );
    await until(
      fresh,
      `document.querySelector('#editor .view-lines').textContent.includes('later')`,
      'named file content persisted',
    );
    assert.ok(
      await js(
        fresh,
        `document.getElementById('problem-history-list').textContent.includes('Checkpoint')`,
      ),
    );
    report(
      'workspace-persistence',
      'PASS: project catalog, loaded shared buffers and workspace checkpoints survive server restart',
    );
  } catch (error) {
    report('failure', error.stack);

    for (const win of BrowserWindow.getAllWindows()) {
      await snapshot(win, `failure-window-${win.id}`);
      report(
        `failure-state-${win.id}`,
        await js(
          win,
          `({
             status: document.getElementById('connection-status')?.textContent,
             notice: document.getElementById('room-notice')?.textContent,
             joinError: document.getElementById('join-error')?.textContent,
             action: document.getElementById('session-action-status')?.textContent,
             code: document.querySelector('#editor .view-lines')?.textContent,
           })`,
        ),
      );
    }

    process.exitCode = 1;
  } finally {
    await writeFile(
      path.join(output, 'results.json'),
      JSON.stringify(results, null, 2),
    );
    console.log('EVIDENCE_DIRECTORY', output);
    await stopServer();
    app.exit(process.exitCode || 0);
  }
});
