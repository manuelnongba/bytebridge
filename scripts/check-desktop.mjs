import { app, BrowserWindow, Menu, clipboard, dialog } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

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
async function join(win, name, enter = true) {
  await fill(win, 'name-input', name);
  await js(win, `document.getElementById('join-button').click()`);
  await until(
    win,
    `document.getElementById('name-modal').style.display === 'none' && document.getElementById('connection-status').textContent === 'Connected'`,
    'join',
  );
  assert.equal(
    await js(
      win,
      `!document.getElementById('room-overview').hidden &&
       !document.getElementById('debug-context').hidden &&
       document.querySelectorAll('.monaco-editor').length === 0`,
    ),
    true,
  );
  if (!enter) return;
  await js(win, `document.getElementById('enter-editor').click()`);
  assert.equal(
    await js(win, `document.querySelectorAll('.monaco-editor').length`),
    1,
  );
}
async function timelineEntry(win, type, title, options = {}) {
  await js(
    win,
    `if (document.getElementById('investigation-panel').hidden) {
       document.getElementById('open-timeline').click();
     }
     document.getElementById('add-timeline').click();`,
  );
  await fill(win, 'timeline-type', type);
  await js(
    win,
    `document.getElementById('timeline-type').dispatchEvent(new Event('change'))`,
  );
  await fill(win, 'timeline-title', title);
  await fill(win, 'timeline-notes', options.notes || 'Investigation notes');
  if (options.parentId) await fill(win, 'timeline-parent', options.parentId);
  if (options.output) await fill(win, 'timeline-output', options.output);
  if (options.outcome) await fill(win, 'timeline-outcome', options.outcome);
  await js(win, `document.getElementById('review-timeline').click()`);
  assert.equal(
    await js(win, `!document.getElementById('timeline-preview').hidden`),
    true,
  );
  await js(win, `document.getElementById('share-timeline').click()`);
  assert.equal(
    await js(win, `document.getElementById('timeline-form').hidden`),
    true,
  );
  return js(
    win,
    `document.querySelector('#timeline-events li:last-child').dataset.eventId`,
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
let clipboardFormats;
app.whenReady().then(async () => {
  try {
    await hostLoaded;
    const host = BrowserWindow.getAllWindows()[0];
    await delay(500);
    await snapshot(host, 'welcome');
    if (cold) {
      await join(host, 'Cold guest');
      assert.match(
        await js(host, `document.getElementById('room-label').title`),
        new RegExp(fixture.id),
      );
      report('cold-invitation', 'PASS: authenticated intended room');
      return;
    }
    for (const dismiss of [
      `document.getElementById('close-join').click()`,
      `document.getElementById('name-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
      `document.getElementById('name-modal').click()`,
      `document.getElementById('cancel-join').click()`,
    ]) {
      await js(host, dismiss);
      assert.equal(
        await js(
          host,
          `document.getElementById('name-modal').style.display === 'none' &&
           !document.getElementById('workspace').inert &&
           !document.getElementById('empty-workspace').hidden`,
        ),
        true,
      );
      await js(host, `document.getElementById('create-room').click()`);
    }
    // Hold a real creation response until after dismissal; it must not navigate.
    await fill(host, 'server-input', origin);
    await fill(host, 'creation-key', 'desktop-test-key');
    await fill(host, 'name-input', 'Cancelled owner');
    await js(
      host,
      `window.originalFetch = window.fetch; window.fetch = async (...args) => {
      const response = await window.originalFetch(...args);
      if (args[1]?.method === 'POST') {
        await new Promise(resolve => {
          window.releaseCreation = resolve;
        });
      }
      return response;
    }; document.getElementById('join-button').click()`,
    );
    await until(
      host,
      `typeof window.releaseCreation === 'function'`,
      'held creation response',
    );
    await js(
      host,
      `document.getElementById('close-join').click();
       document.getElementById('open-join').click();
       window.fetch = window.originalFetch;
       window.releaseCreation();`,
    );
    await until(
      host,
      `JSON.parse(localStorage.getItem('bytebridge-rooms') || '[]').length === 1`,
      'cancelled owner credential retained',
    );
    assert.equal(
      await js(
        host,
        `document.getElementById('name-modal').style.display === 'flex' &&
         document.getElementById('room-mode').value === 'join' &&
         document.querySelectorAll('.monaco-editor').length === 0 &&
         !document.getElementById('join-button').disabled`,
      ),
      true,
    );
    await js(
      host,
      `document.getElementById('cancel-join').click(); document.getElementById('create-room').click()`,
    );
    assert.equal(
      await js(host, `document.getElementById('join-title').textContent`),
      'Create a shared space',
    );
    report(
      'dialog-dismissal',
      'PASS: first-launch close, Escape, backdrop, cancel, and stale creation response',
    );
    await fill(host, 'server-input', origin);
    await fill(host, 'creation-key', 'desktop-test-key');
    await fill(host, 'room-title', 'Phase 1 workspace');
    await join(host, 'Owner');
    await type(host, 'shared code');
    await js(
      host,
      `document.getElementById('open-join').focus();
       document.getElementById('open-join').click();
       document.getElementById('close-join').click();`,
    );
    assert.equal(
      await js(
        host,
        `document.querySelectorAll('.monaco-editor').length === 1 &&
         document.querySelector('.view-lines').textContent.includes('shared') &&
         document.activeElement.id === 'open-join' &&
         !document.getElementById('workspace').inert`,
      ),
      true,
    );
    report(
      'dialog-active-room',
      'PASS: dismissal preserves editor and restores focus',
    );
    clipboardFormats = clipboard
      .availableFormats()
      .map((format) => [format, clipboard.readBuffer(format)]);
    await js(host, `document.getElementById('copy-invite').click()`);
    await until(
      host,
      `document.getElementById('room-notice').textContent.startsWith('Invitation copied')`,
      'copy invite',
    );
    const invitation = clipboard.readText();
    const guest = await guestWindow('phase1-guest');
    await js(
      guest,
      `document.getElementById('room-mode').value = 'join'; document.getElementById('room-mode').dispatchEvent(new Event('change'))`,
    );
    await fill(guest, 'invite-input', invitation);
    await join(guest, 'Collaborator');
    await until(
      guest,
      `document.querySelector('.view-lines').textContent.includes('shared')`,
      'shared content',
    );
    await type(guest, 'guest ');
    await until(
      host,
      `document.getElementById('remote-cursor-name').textContent === 'Collaborator is typing…'`,
      'typing indicator',
    );
    assert.equal(
      await js(
        guest,
        `document.getElementById('remote-cursor-name').textContent`,
      ),
      '',
    );
    await until(
      host,
      `document.getElementById('remote-cursor-name').textContent === ''`,
      'typing idle timeout',
    );
    guest.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    guest.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
    await delay(200);
    assert.equal(
      await js(
        host,
        `document.getElementById('remote-cursor-name').textContent`,
      ),
      '',
    );
    report(
      'typing-presence',
      'PASS: local edits notify peers, not self; idle timeout and navigation filtering',
    );
    await until(
      host,
      `document.querySelector('.view-lines').textContent.includes('guest')`,
      'guest edits',
    );
    assert.equal(
      await js(guest, `document.getElementById('copy-invite').disabled`),
      true,
    );
    report(
      'owner-and-editor',
      'PASS: invitation join, two-way editing, owner-only controls',
    );
    await snapshot(host, 'workspace');

    await js(
      host,
      `document.getElementById('open-context').click(); document.getElementById('edit-context').click()`,
    );
    assert.equal(
      await js(host, `document.getElementById('context-overview').hidden`),
      true,
    );
    await js(host, `document.getElementById('discard-context').click()`);
    assert.equal(
      await js(
        host,
        `!document.getElementById('context-overview').hidden && document.getElementById('context-overview').innerText.includes('Not provided yet')`,
      ),
      true,
    );
    await js(host, `document.getElementById('edit-context').click()`);
    assert.equal(
      await js(host, `document.getElementById('context-overview').hidden`),
      true,
    );
    await fill(host, 'context-problem', 'Order preview shows NaN');
    await fill(host, 'context-expected', 'Reject formatted prices clearly');
    await fill(host, 'context-attempts', 'Refreshing the preview did not help');
    const detectedLanguages = await js(
      host,
      `(() => {
      document.getElementById('add-attachments').click();
      const row = document.querySelector('[data-collection="attachments"] .context-entry');
      const filename = row.querySelector('[data-field="filename"]');
      const language = row.querySelector('[data-field="language"]');
      filename.value = 'main.RS';
      filename.dispatchEvent(new Event('input', { bubbles: true }));
      const automatic = language.value;
      language.value = 'python';
      language.dispatchEvent(new Event('change', { bubbles: true }));
      filename.value = 'main.go';
      filename.dispatchEvent(new Event('input', { bubbles: true }));
      const manual = language.value;
      row.querySelector('button').click();
      return [automatic, manual];
    })()`,
    );
    assert.deepEqual(detectedLanguages, ['rust', 'python']);
    report(
      'attachment-languages',
      'PASS: filename detection and manual override',
    );
    const demoCode = await readFile(
      path.join(root, 'examples/debugging-handover/order-total.mjs'),
      'utf8',
    );
    const demoRun = spawnSync(
      process.execPath,
      [
        '--test',
        path.join(root, 'examples/debugging-handover/order-total.test.mjs'),
      ],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' },
    );
    assert.equal(demoRun.status, 1, 'demo remains intentionally failing');
    await fill(
      host,
      'context-actual',
      'Display-formatted price 1,200.00 produces NaN',
    );
    await fill(
      host,
      'context-steps',
      'Run node --test examples/debugging-handover/order-total.test.mjs',
    );
    await fill(host, 'context-logs', demoRun.stdout);
    await js(
      host,
      `(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([${JSON.stringify(demoCode)}], 'order-total.mjs', {type: 'text/javascript'}));
      const input = document.getElementById('context-file');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
    );
    await until(
      host,
      `document.querySelector('[data-collection="attachments"] [data-field="filename"]')?.value === 'order-total.mjs'`,
      'selected file loaded into private draft',
    );
    await js(
      host,
      `document.getElementById('add-attemptEntries').click();
      document.querySelector('[data-field="action"]').value = 'Refresh preview';
      document.querySelector('[data-field="outcome"]').value = 'no-change';
      document.querySelector('[data-field="notes"]').value = 'Still NaN after refreshing';`,
    );
    await js(guest, `document.getElementById('open-context').click()`);
    assert.equal(
      await js(
        guest,
        `document.getElementById('debug-context').textContent.includes('Order preview shows NaN')`,
      ),
      false,
    );
    await js(host, `document.getElementById('review-context').click()`);
    assert.equal(
      await js(
        host,
        `document.getElementById('context-preview').textContent.includes('Order preview shows NaN')`,
      ),
      true,
    );
    await js(host, `document.getElementById('share-context').click()`);
    await until(
      guest,
      `document.getElementById('debug-context').textContent.includes('Order preview shows NaN')`,
      'shared debugging context',
    );
    await js(host, `document.getElementById('open-context').click()`);
    await js(guest, `document.getElementById('open-context').click()`);
    const hypothesis = await timelineEntry(
      host,
      'hypothesis',
      'Formatted price conversion causes NaN',
    );
    const experiment = await timelineEntry(
      host,
      'experiment',
      'Run price contract test',
      { parentId: hypothesis, output: demoRun.stdout },
    );
    await timelineEntry(host, 'checkpoint', 'Before investigation edit', {
      parentId: experiment,
    });
    await js(host, `document.getElementById('close-timeline').click()`);
    await type(guest, 'checkpoint change ');
    await until(
      host,
      `document.querySelector('#editor .view-lines').textContent.includes('checkpoint')`,
      'checkpoint edit synchronized',
    );
    await timelineEntry(host, 'checkpoint', 'After investigation edit', {
      parentId: experiment,
    });
    await timelineEntry(host, 'outcome', 'Price test failed', {
      parentId: experiment,
      outcome: 'failed',
      notes: 'Expected rejection, got NaN',
      output: demoRun.stdout,
    });
    await until(
      guest,
      `document.querySelectorAll('#timeline-events li').length === 5`,
      'timeline sync',
    );
    await js(host, `document.getElementById('close-timeline').click()`);
    await until(
      host,
      `document.querySelector('#editor .view-lines').textContent.includes('checkpoint')`,
      'live editor before diff',
    );
    const liveBeforeDiff = await js(
      host,
      `document.querySelector('#editor .view-lines').textContent`,
    );
    await js(
      host,
      `document.getElementById('open-timeline').click(); document.getElementById('compare-checkpoints').click()`,
    );
    await until(
      host,
      `!!document.querySelector('#checkpoint-diff .monaco-diff-editor')`,
      'read-only historical diff',
    );
    await js(
      host,
      `document.getElementById('checkpoint-diff').scrollIntoView({block:'center'})`,
    );
    await snapshot(host, 'timeline-diff');
    await js(host, `document.getElementById('close-timeline').click()`);
    await until(
      host,
      `document.querySelector('#editor .view-lines').textContent.includes('checkpoint')`,
      'live editor after diff',
    );
    assert.equal(
      await js(
        host,
        `document.querySelector('#editor .view-lines').textContent`,
      ),
      liveBeforeDiff,
    );
    await js(host, `document.getElementById('open-context').click()`);
    assert.equal(
      await js(host, `document.querySelectorAll('.monaco-editor').length`),
      1,
    );
    await js(guest, `document.getElementById('open-context').click()`);
    report(
      'timeline-and-diff',
      'PASS: linked events sync; comparing frozen checkpoints leaves live document unchanged and disposes history editors',
    );
    const helper = await guestWindow('phase2-helper');
    assert.equal(
      await js(host, `!document.getElementById('context-overview').hidden`),
      true,
    );
    report(
      'context-edit-view',
      'PASS: overview hidden during editing and restored after discard/share',
    );
    await js(
      helper,
      `document.getElementById('room-mode').value = 'join'; document.getElementById('room-mode').dispatchEvent(new Event('change'))`,
    );
    await fill(helper, 'invite-input', invitation);
    await join(helper, 'Handover helper', false);
    await until(
      helper,
      `document.querySelectorAll('#timeline-events li').length === 5`,
      'late helper timeline',
    );
    const catchupText = await js(
      helper,
      `document.getElementById('timeline-catchup').textContent`,
    );
    assert.match(catchupText, /Run price contract test: failed/);
    assert.match(catchupText, /Formatted price conversion causes NaN/);
    assert.match(catchupText, /Order preview shows NaN/);
    report(
      'timeline-catchup',
      'PASS: late helper sees original issue, reported results, and open hypothesis',
    );
    await until(
      helper,
      `document.getElementById('debug-context').textContent.includes('order-total.mjs')`,
      'handover overview',
    );
    const overviewText = await js(
      helper,
      `document.getElementById('debug-context').textContent`,
    );
    for (const evidence of [
      'Order preview shows NaN',
      'Reject formatted prices clearly',
      'item.price * item.quantity',
      'javascript',
      'Refresh preview',
      'no-change',
      'Still NaN after refreshing',
      'not ok',
    ])
      assert.ok(overviewText.includes(evidence), evidence);
    await snapshot(helper, 'phase2-handover-overview');
    await js(helper, `document.getElementById('enter-editor').click()`);
    assert.equal(
      await js(helper, `document.querySelectorAll('.monaco-editor').length`),
      1,
    );
    report(
      'phase2-handover',
      'PASS: late helper sees demo code, metadata, actual failing output, reproduction, and structured attempts before editor entry',
    );
    await js(
      host,
      `document.getElementById('edit-context').click();
      document.getElementById('add-attachments').click();
      (() => { const row = document.querySelector('[data-collection="attachments"] .context-entry:last-child');
      row.querySelector('[data-field="filename"]').value = 'private.txt';
      row.querySelector('[data-field="content"]').value = 'private-only-marker';
      })();
      document.getElementById('review-context').click()`,
    );
    assert.equal(
      await js(
        host,
        `!document.getElementById('share-context').hidden && document.getElementById('context-preview').textContent.includes('private-only-marker')`,
      ),
      true,
    );
    await js(
      host,
      `document.querySelector('[data-collection="attachments"] .context-entry:last-child button').click()`,
    );
    assert.equal(
      await js(host, `document.getElementById('share-context').hidden`),
      true,
    );
    await js(host, `document.getElementById('review-context').click()`);
    assert.equal(
      await js(
        host,
        `document.getElementById('context-preview').textContent.includes('private-only-marker')`,
      ),
      false,
    );
    await js(host, `document.getElementById('share-context').click()`);
    assert.equal(
      await js(
        guest,
        `document.getElementById('debug-context').textContent.includes('private-only-marker')`,
      ),
      false,
    );
    report(
      'attachment-review',
      'PASS: removing a draft attachment invalidates review and excludes it from sharing',
    );
    await js(host, `document.getElementById('open-context').click()`);
    await js(guest, `document.getElementById('open-context').click()`);
    report(
      'debug-context',
      'PASS: draft stays local; reviewed context syncs to teammate',
    );

    await js(
      host,
      `document.getElementById('open-resolution').click(); document.getElementById('edit-resolution').click()`,
    );
    await fill(
      host,
      'resolution-cause',
      'Implicit conversion accepts display-formatted prices',
    );
    await fill(
      host,
      'resolution-fix',
      'Validate finite nonnegative decimal prices before multiplication',
    );
    await fill(
      host,
      'resolution-evidence',
      'Linked test output documents the failure. The fix is participant-reported.',
    );
    await fill(
      host,
      'resolution-uncertainty',
      'Independent verification of the fix is still needed',
    );
    await fill(host, 'resolution-tags', 'prices, validation');
    await js(
      host,
      `document.getElementById('resolution-before').selectedIndex = 1;
       document.getElementById('resolution-after').selectedIndex = 2;
       document.getElementById('resolution-evidence-ids').options[0].selected = true;
       document.getElementById('review-resolution').click();`,
    );
    assert.equal(
      await js(
        guest,
        `document.getElementById('resolution-badge').textContent`,
      ),
      'Open',
    );
    await js(host, `document.getElementById('share-resolution').click()`);
    await until(
      guest,
      `document.getElementById('resolution-badge').textContent.includes('Resolved')`,
      'resolution shared',
    );
    assert.equal(
      await js(
        host,
        `document.getElementById('editor').getBoundingClientRect().height > 180 &&
         document.getElementById('editor').getBoundingClientRect().width > 250 &&
         document.querySelectorAll('#inspector > :not([hidden])').length === 1`,
      ),
      true,
    );
    await snapshot(host, 'phase4-resolution-desktop');
    const initialWidth = await js(
      host,
      `document.getElementById('inspector').getBoundingClientRect().width`,
    );
    const divider = await js(
      host,
      `(() => {
         const r = document.getElementById('panel-resizer').getBoundingClientRect();
         return {
           x: Math.round(r.x + r.width / 2),
           y: Math.round(r.y + r.height / 2),
         };
       })()`,
    );
    host.focus();
    host.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'left',
      clickCount: 1,
      ...divider,
    });
    host.webContents.sendInputEvent({
      type: 'mouseMove',
      x: divider.x + 90,
      y: divider.y,
    });
    host.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      clickCount: 1,
      x: divider.x + 90,
      y: divider.y,
    });
    await until(
      host,
      `document.getElementById('inspector').getBoundingClientRect().width > ${initialWidth + 50}`,
      'drag panel width',
    );
    const resizedWidth = await js(
      host,
      `document.getElementById('inspector').getBoundingClientRect().width`,
    );
    await js(
      host,
      `document.getElementById('panel-resizer').dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true}))`,
    );
    assert.equal(
      await js(
        host,
        `document.getElementById('editor-panel').getBoundingClientRect().width >= 299`,
      ),
      true,
    );
    await js(
      host,
      `document.getElementById('panel-resizer').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))`,
    );
    await until(
      host,
      `Math.abs(document.getElementById('inspector').getBoundingClientRect().width - ${initialWidth}) < 2`,
      'reset panel width',
    );
    assert.ok(resizedWidth > initialWidth);
    await js(host, `document.getElementById('compare-resolution').click()`);
    await until(
      host,
      `!document.getElementById('resolution-diff').hidden && document.getElementById('resolution-diff').querySelector('.monaco-diff-editor') !== null`,
      'linked resolution diff',
    );
    await js(
      host,
      `document.getElementById('close-resolution').click(); document.getElementById('open-resolution').click()`,
    );
    assert.equal(
      await js(host, `document.getElementById('resolution-diff').hidden`),
      true,
    );
    host.setSize(780, 760);
    await delay(250);
    assert.equal(
      await js(
        host,
        `document.documentElement.scrollWidth <= window.innerWidth && document.getElementById('editor').getBoundingClientRect().height > 80`,
      ),
      true,
    );
    await snapshot(host, 'phase4-resolution-narrow');
    assert.equal(
      await js(
        host,
        `document.getElementById('panel-resizer').getAttribute('aria-orientation')`,
      ),
      'horizontal',
    );
    const initialHeight = await js(
      host,
      `document.getElementById('inspector').getBoundingClientRect().height`,
    );
    await js(
      host,
      `document.getElementById('panel-resizer').dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}))`,
    );
    assert.ok(
      await js(
        host,
        `document.getElementById('inspector').getBoundingClientRect().height > ${initialHeight}`,
      ),
    );
    assert.ok(
      await js(
        host,
        `JSON.parse(localStorage.getItem('bytebridge-panel-sizes')).height > 0`,
      ),
    );
    await js(host, `document.getElementById('close-resolution').click()`);
    await until(
      host,
      `document.getElementById('panel-resizer').hidden`,
      'divider hidden without a panel',
    );
    await js(host, `document.getElementById('open-resolution').click()`);
    await until(
      host,
      `!document.getElementById('panel-resizer').hidden`,
      'divider returns with panel',
    );
    report(
      'resizable-panels',
      'PASS: pointer drag, keyboard bounds, reset, saved size, narrow height and closed-panel layout',
    );
    host.setSize(1200, 800);
    await js(host, `document.getElementById('export-resolution').click()`);
    const exportedPreview = await js(
      host,
      `document.getElementById('resolution-markdown').value`,
    );
    for (const phrase of [
      'Implicit conversion',
      'Independent verification',
      'not independently verified',
      'Code comparison',
    ])
      assert.ok(exportedPreview.includes(phrase), phrase);
    assert.ok(!exportedPreview.includes(invitation));
    const originalSave = dialog.showSaveDialog;
    try {
      dialog.showSaveDialog = async () => ({ canceled: true });
      await js(host, `document.getElementById('save-resolution').click()`);
      await until(
        host,
        `document.getElementById('resolution-status').textContent === 'Export canceled.'`,
        'export cancellation',
      );
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: path.join(output, 'investigation.md'),
      });
      await js(host, `document.getElementById('save-resolution').click()`);
      await until(
        host,
        `document.getElementById('resolution-status').textContent === 'Markdown saved.'`,
        'save Markdown',
      );
      assert.equal(
        await readFile(path.join(output, 'investigation.md'), 'utf8'),
        exportedPreview,
      );
    } finally {
      dialog.showSaveDialog = originalSave;
    }
    await js(
      host,
      `document.getElementById('open-join').click();
       document.getElementById('room-mode').value = 'resume';
       document.getElementById('room-mode').dispatchEvent(new Event('change'));`,
    );
    await fill(host, 'session-search', 'NaN validation');
    await js(
      host,
      `document.getElementById('session-search').dispatchEvent(new Event('input'))`,
    );
    assert.equal(
      await js(host, `document.getElementById('saved-room').options.length`),
      1,
    );
    await fill(host, 'session-search', 'not-a-real-session');
    await js(
      host,
      `document.getElementById('session-search').dispatchEvent(new Event('input'))`,
    );
    assert.equal(
      await js(host, `document.getElementById('saved-room').options.length`),
      0,
    );
    await js(host, `document.getElementById('cancel-join').click()`);
    await js(guest, `document.getElementById('open-resolution').click()`);
    await fill(guest, 'reopen-reason', 'Follow-up verification is needed');
    await js(guest, `document.getElementById('reopen-resolution').click()`);
    await until(
      host,
      `document.getElementById('resolution-badge').textContent === 'Open'`,
      'resolution reopened',
    );
    assert.equal(
      await js(
        host,
        `document.getElementById('resolution-current').textContent.includes('Implicit conversion') &&
         document.querySelectorAll('#timeline-events li').length === 5`,
      ),
      true,
    );
    await js(host, `document.getElementById('close-resolution').click()`);
    await js(guest, `document.getElementById('close-resolution').click()`);
    report(
      'phase4-resolution',
      'PASS: reviewed resolution, evidence/checkpoint links, isolated draft, safe Markdown save/cancel, local session search, reopening with history, desktop/narrow layout',
    );
    await stopServer();
    await delay(700);
    await type(host, 'offline ');
    await startServer();
    await until(
      guest,
      `document.querySelector('.view-lines').textContent.includes('offline')`,
      'reconnect',
    );
    report('reconnect', 'PASS: offline edits converge');

    await js(host, `document.getElementById('manage-invites').click()`);
    await until(
      host,
      `!!document.querySelector('.invite-row button')`,
      'manage invitations',
    );
    await snapshot(host, 'access');
    await js(host, `document.getElementById('close-access').click()`);
    assert.equal(
      await js(host, `document.getElementById('access-panel').hidden`),
      true,
    );
    await js(host, `document.getElementById('manage-invites').click()`);
    await until(
      host,
      `!!document.querySelector('.invite-row button')`,
      'reopen invitations',
    );
    await js(host, `document.querySelector('.invite-row button').click()`);
    await until(
      guest,
      `document.getElementById('connection-status').textContent.includes('revoked')`,
      'revocation',
    );
    report('revocation', 'PASS: active collaborator loses access');

    app.emit('open-url', { preventDefault() {} }, launchInvite.url);
    await delay(200);
    await join(host, 'Invited');
    assert.match(
      await js(host, `document.getElementById('room-label').title`),
      new RegExp(fixture.id),
    );
    report('warm-invitation', 'PASS: one editor in intended room');

    const createMenu = Menu.getApplicationMenu()
      .items.find((item) => item.label === 'File')
      .submenu.items.find((item) => item.label === 'Create Room');
    createMenu.click();
    await delay(100);
    await fill(host, 'server-input', origin);
    await fill(host, 'creation-key', 'desktop-test-key');
    await join(host, 'Owner');
    await type(host, 'persist after restart');
    await until(
      host,
      `document.querySelector('.view-lines').textContent.includes('persist')`,
      'persistence fixture typed before restart',
    );
    await js(
      host,
      `document.getElementById('open-context').click(); document.getElementById('edit-context').click()`,
    );
    await fill(host, 'context-problem', 'Persistent investigation');
    await js(
      host,
      `document.getElementById('add-attachments').click();
      document.querySelector('[data-field="filename"]').value = 'persist.js';
      document.querySelector('[data-field="content"]').value = 'const retained = true;';
      document.getElementById('add-attemptEntries').click();
      document.querySelector('[data-field="action"]').value = 'Restart application';
      document.querySelector('[data-field="notes"]').value = 'Issue remains';`,
    );
    await js(
      host,
      `document.getElementById('review-context').click(); document.getElementById('share-context').click()`,
    );
    await timelineEntry(host, 'checkpoint', 'Persistent checkpoint');
    await js(host, `document.getElementById('close-timeline').click()`);
    await js(
      host,
      `document.getElementById('open-resolution').click(); document.getElementById('edit-resolution').click()`,
    );
    await fill(host, 'resolution-cause', 'Persistent root cause');
    await fill(host, 'resolution-fix', 'Persistent fix');
    await fill(host, 'resolution-tags', 'persistence');
    await js(
      host,
      `document.getElementById('review-resolution').click();
       document.getElementById('share-resolution').click();
       document.getElementById('close-resolution').click();`,
    );
    const stored = await js(
      host,
      `JSON.parse(localStorage.getItem('bytebridge-rooms')).at(-1)`,
    );
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    await stopServer();
    await startServer();
    const fresh = await guestWindow('phase1-fresh');
    await js(
      fresh,
      `localStorage.setItem('bytebridge-rooms', ${JSON.stringify(JSON.stringify([stored]))})`,
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
      `document.querySelector('.view-lines').textContent.includes('persist')`,
      'persistent content',
    );
    report('persistence', 'PASS: room metadata and content survive restart');
    await until(
      fresh,
      `document.getElementById('debug-context').textContent.includes('Persistent investigation')`,
      'debug context persistence',
    );
    report(
      'context-persistence',
      'PASS: reviewed context survives server restart',
    );
    await until(
      fresh,
      `document.getElementById('timeline-events').textContent.includes('Persistent checkpoint')`,
      'timeline persistence',
    );
    assert.equal(
      await js(
        fresh,
        `document.getElementById('timeline-events').textContent.includes('persist after restart')`,
      ),
      true,
    );
    report(
      'timeline-persistence',
      'PASS: checkpoint code and metadata survive restart',
    );
    assert.equal(
      await js(
        fresh,
        `document.getElementById('debug-context').textContent.includes('persist.js') &&
         document.getElementById('debug-context').textContent.includes('Restart application')`,
      ),
      true,
    );
    report('regressions', 'PASS');
    assert.equal(
      await js(
        fresh,
        `document.getElementById('resolution-badge').textContent.includes('Resolved') &&
         document.getElementById('resolution-current').textContent.includes('Persistent root cause')`,
      ),
      true,
    );
    report(
      'resolution-persistence',
      'PASS: resolved state and resolution survive restart',
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
        `document.getElementById('resolution-badge').textContent.includes('Resolved')`,
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
      `document.getElementById('name-modal').style.display === 'none' && !document.getElementById('resolution-panel').hidden`,
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
    if (clipboardFormats) {
      clipboard.clear();
      for (const [format, data] of clipboardFormats)
        clipboard.writeBuffer(format, data);
    }
    await writeFile(
      path.join(output, 'results.json'),
      JSON.stringify(results, null, 2),
    );
    console.log('EVIDENCE_DIRECTORY', output);
    await stopServer();
    app.exit(process.exitCode || 0);
  }
});
