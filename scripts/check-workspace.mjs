// Real Electron clients with native dialogs stubbed only for temporary fixtures.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { dialog } from 'electron';

export async function checkWorkspace({
  host,
  peer,
  output,
  js,
  until,
  type,
  timelineEntry,
  snapshot,
}) {
  const directory = path.join(output, 'project-fixture');

  await mkdir(path.join(directory, 'src'), { recursive: true });
  await mkdir(path.join(directory, 'docs'), { recursive: true });

  for (const [name, content] of Object.entries({
    '.gitignore': 'ignored.txt\n',
    'ignored.txt': 'not shared',
    '.env.secret': 'SECRET=not-shared',
    'src/a.js': 'export const a = 1;',
    'src/b.js': 'export const b = 2;',
    'docs/readme.md': 'Instructions',
  }))
    await writeFile(path.join(directory, name), content);

  const originalOpen = dialog.showOpenDialog,
    originalSave = dialog.showSaveDialog,
    originalConfirm = dialog.showMessageBox;

  const showFiles = (win) =>
    js(
      win,
      `if (document.getElementById('files-panel').hidden) document.getElementById('open-files').click(); document.querySelectorAll('#file-tree details').forEach(folder => folder.open = true);`,
    );

  const clickFile = async (win, name) => {
    await showFiles(win);
    await js(
      win,
      `[...document.querySelectorAll('.workspace-file')].find(row => row.dataset.path === ${JSON.stringify(name)}).querySelector('button').click()`,
    );
  };

  const openFile = async (win, name) => {
    await clickFile(win, name);
    await until(
      win,
      `document.getElementById('active-file-label').textContent.startsWith(${JSON.stringify(name)})`,
      `open ${name}`,
    );
  };

  try {
    await showFiles(host);
    await showFiles(peer);
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    await js(host, `document.getElementById('open-project').click()`);
    await until(
      host,
      `!document.getElementById('open-project').disabled`,
      'picker canceled',
    );
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [directory],
    });
    dialog.showMessageBox = async () => ({ response: 0 });
    await js(host, `document.getElementById('open-project').click()`);
    await until(
      host,
      `!document.getElementById('open-project').disabled`,
      'scope canceled',
    );
    assert.equal(
      await js(peer, `document.querySelectorAll('.workspace-file').length`),
      1,
    );
    dialog.showMessageBox = async () => ({ response: 1 });
    await js(host, `document.getElementById('open-project').click()`);
    await until(
      peer,
      `document.querySelectorAll('.workspace-file').length === 5`,
      'catalog sync',
    );
    assert.equal(
      await js(
        peer,
        `document.querySelectorAll('.workspace-file[data-loaded="false"]').length`,
      ),
      4,
    );
    assert.equal(
      await js(
        peer,
        `document.getElementById('file-tree').textContent.includes('.env.secret')`,
      ),
      false,
    );
    await openFile(host, 'src/a.js');
    await openFile(peer, 'src/b.js');
    await until(
      host,
      `document.getElementById('file-tree').textContent.includes('Helper viewing')`,
      'file presence',
    );
    await type(host, '// alice ');
    assert.equal(
      await js(
        peer,
        `document.querySelector('#editor .view-lines').textContent.includes('alice')`,
      ),
      false,
    );
    await openFile(peer, 'src/a.js');
    await until(
      peer,
      `document.querySelector('#editor .view-lines').textContent.includes('alice')`,
      'host edits sync',
    );
    await type(peer, '// helper ');
    await until(
      host,
      `document.querySelector('#editor .view-lines').textContent.includes('helper')`,
      'peer edits sync',
    );
    assert.equal(
      await readFile(path.join(directory, 'src/a.js'), 'utf8'),
      'export const a = 1;',
    );
    assert.equal(
      await js(peer, `document.getElementById('save-project-file').hidden`),
      true,
    );

    const nativeIds = await js(
      host,
      `({projectId: document.querySelector('#file-tree details').dataset.path, fileId: document.querySelector('.workspace-file[data-path="src/a.js"]').dataset.fileId})`,
    );

    assert.match(
      await js(
        peer,
        `window.api.saveProjectFile(${JSON.stringify(nativeIds.projectId)}, ${JSON.stringify(nativeIds.fileId)}, 'bad').then(() => 'unexpected', error => error.message)`,
      ),
      /does not host/,
    );
    await js(host, `document.getElementById('save-project-file').click()`);
    await until(
      host,
      `document.getElementById('files-status').textContent.includes('original project file')`,
      'explicit save',
    );
    assert.ok(
      (await readFile(path.join(directory, 'src/a.js'), 'utf8')).includes(
        'helper',
      ),
    );
    await timelineEntry(host, 'checkpoint', 'Workspace before change');
    await openFile(peer, 'src/b.js');
    await js(
      peer,
      `document.querySelector('[aria-label="Close tab src/b.js"]').click()`,
    );
    await openFile(peer, 'src/a.js');
    await type(peer, '// later ');
    await until(
      host,
      `document.querySelector('#editor .view-lines').textContent.includes('later')`,
      'later edits sync',
    );
    await timelineEntry(host, 'checkpoint', 'Workspace after change');
    await js(host, `document.getElementById('compare-checkpoints').click()`);
    await until(
      host,
      `document.querySelector('#checkpoint-diff .checkpoint-file-picker')?.options.length === 3`,
      'loaded-only checkpoints',
    );
    await js(
      host,
      `const select = document.querySelector('#checkpoint-diff .checkpoint-file-picker'); select.value = [...select.options].find(option => option.textContent.startsWith('src/a.js')).value; select.dispatchEvent(new Event('change'));`,
    );
    await snapshot(host, 'workspace-checkpoint-diff');
    await showFiles(host);
    await writeFile(path.join(directory, 'src/a.js'), 'external editor change');
    await js(host, `document.getElementById('save-project-file').click()`);
    await until(
      host,
      `document.getElementById('files-status').textContent.includes('changed outside')`,
      'external conflict blocked',
    );
    assert.equal(
      await readFile(path.join(directory, 'src/a.js'), 'utf8'),
      'external editor change',
    );
    dialog.showSaveDialog = async () => ({ canceled: true });
    await js(host, `document.getElementById('save-workspace-file').click()`);
    await until(
      host,
      `document.getElementById('files-status').textContent === 'Save canceled.'`,
      'copy canceled',
    );
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: path.join(output, 'saved-a.js'),
    });
    await js(host, `document.getElementById('save-workspace-file').click()`);
    await until(
      host,
      `document.getElementById('files-status').textContent.includes('snapshot saved')`,
      'copy saved',
    );
    assert.ok(
      (await readFile(path.join(output, 'saved-a.js'), 'utf8')).includes(
        'later',
      ),
    );
    await snapshot(host, 'workspace-files-desktop');
    host.setSize(780, 760);
    await snapshot(host, 'workspace-files-narrow');
    assert.equal(
      await js(
        host,
        `document.documentElement.scrollWidth <= window.innerWidth`,
      ),
      true,
    );
    host.setSize(1100, 780);
    await js(host, `document.getElementById('stop-hosting').click()`);
    await until(
      peer,
      `document.getElementById('file-tree').textContent.includes('host offline')`,
      'host stopped',
    );
    await clickFile(peer, 'docs/readme.md');
    await until(
      peer,
      `document.getElementById('files-status').textContent.includes('Host offline')`,
      'unloaded unavailable',
    );
    await openFile(peer, 'src/b.js');
    await openFile(host, 'Shared code');
    await openFile(peer, 'Shared code');
  } finally {
    dialog.showOpenDialog = originalOpen;
    dialog.showSaveDialog = originalSave;
    dialog.showMessageBox = originalConfirm;
  }
}
