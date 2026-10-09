import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

if (process.versions.electron) {
  const { app, BrowserWindow } = await import('electron');

  app.setPath('userData', process.env.BYTEBRIDGE_PROFILE_TEST_ROOT);
  process.stdin.on('data', () => app.quit());
  await import('../dist/main/main.js');
  app
    .whenReady()
    .then(async () => {
      const win = BrowserWindow.getAllWindows()[0];

      if (win.webContents.isLoading())
        await new Promise((resolve) =>
          win.webContents.once('did-finish-load', resolve),
        );

      const profile = path.basename(app.getPath('userData'));
      const previous = await win.webContents.executeJavaScript(
        `localStorage.getItem('__profile-test')`,
      );

      await win.webContents.executeJavaScript(
        `localStorage.setItem('__profile-test', ${JSON.stringify(profile)})`,
      );
      console.log(
        'PROFILE_READY ' +
          JSON.stringify({
            profile,
            previous,
            directory: app.getPath('userData'),
          }),
      );
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
} else {
  const { default: electron } = await import('electron');
  const directory = await mkdtemp(path.join(tmpdir(), 'bytebridge-profiles-'));
  const children = [];

  function launch(profile) {
    const child = spawn(
      electron,
      [fileURLToPath(import.meta.url), `--profile=${profile}`],
      {
        env: { ...process.env, BYTEBRIDGE_PROFILE_TEST_ROOT: directory },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    children.push(child);
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));

    const exited = new Promise((resolve, reject) => {
      child.once('exit', (code) => resolve(code));
      child.once('error', reject);
    });
    const ready = new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(
        () => reject(new Error(`Timed out opening ${profile}`)),
        20000,
      );

      child.stdout.on('data', (chunk) => {
        buffer += chunk;

        const match = buffer.match(/PROFILE_READY (.+)\n/);

        if (match) {
          clearTimeout(timer);
          resolve(JSON.parse(match[1]));
        }
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        resolve({ exited: code });
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    return { child, ready, exited };
  }

  try {
    const alice = launch('alice');
    const first = await alice.ready;
    const bob = launch('bob');
    const second = await bob.ready;

    assert.equal(first.profile, 'alice');
    assert.equal(second.profile, 'bob');
    assert.equal(first.previous, null);
    assert.equal(second.previous, null);
    assert.notEqual(first.directory, second.directory);
    assert.equal(alice.child.exitCode, null);

    const duplicate = launch('alice');

    assert.deepEqual(await duplicate.ready, { exited: 0 });
    alice.child.stdin.write('quit');
    await alice.exited;

    const resumed = launch('alice');

    assert.equal((await resumed.ready).previous, 'alice');
    console.log(
      'PASS: two Electron processes, isolated storage, same-profile lock, and profile persistence',
    );
  } finally {
    for (const child of children)
      if (child.exitCode === null) child.kill('SIGTERM');

    console.log('PROFILE_TEST_DIRECTORY', directory);
  }
}
