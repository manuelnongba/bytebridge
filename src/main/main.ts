import { LocalTerminal } from './terminal.js';
import type { TerminalStart } from '../shared/terminal.js';
import { app, BrowserWindow, clipboard, ipcMain, Menu, dialog } from 'electron';
import path from 'path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import { writeFile, readFile, realpath } from 'node:fs/promises';
import { invitationFrom } from './invitations.js';
import { mkdirSync } from 'node:fs';
import { profileFrom, profileDirectory } from './profiles.js';
import { LocalProject } from './project-files.js';
import { projectAccess } from './project-access.js';
import type { ProjectManifest } from '../shared/contracts.js';

let win: BrowserWindow | null = null;
let rendererReady = false;
let pendingInvitation: string | null = invitationFrom(process.argv);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.name = 'ByteBridge';

const profile = profileFrom(process.argv);
const userData = profileDirectory(app.getPath('userData'), profile);

mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
app.setPath('sessionData', app.getPath('userData'));

function createWindow() {
  rendererReady = false;
  win = new BrowserWindow({
    title: profile ? `ByteBridge — ${profile}` : 'ByteBridge',
    icon: path.join(__dirname, '../renderer/assets/icon.png'),
    width: 1200,
    height: 800,
    webPreferences: { preload: path.join(__dirname, '../preload/preload.js') },
  });

  if (profile) win.on('page-title-updated', (event) => event.preventDefault());

  win.webContents.on('did-start-loading', () => {
    rendererReady = false;
  });
  void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.on('closed', () => {
    win = null;
    rendererReady = false;
  });
}

function receiveInvitation(url: string) {
  const valid = invitationFrom([url]);

  if (!valid) return;

  if (win && rendererReady) win.webContents.send('deeplink', valid);
  else pendingInvitation = valid;

  if (app.isReady() && !win) createWindow();

  if (win) {
    if (win.isMinimized()) win.restore();

    win.show();
    win.focus();
  }
}

ipcMain.handle('renderer:ready', (event) => {
  if (event.sender !== win?.webContents) return null;

  rendererReady = true;

  const invitation = pendingInvitation;

  pendingInvitation = null;

  return invitation;
});
ipcMain.handle('clipboard:copy', (_event, text: string) => {
  if (typeof text !== 'string') throw new Error('Expected clipboard text');

  clipboard.writeText(text);

  return true;
});

// Subscribe before ready, then deliver only after the renderer subscribes.
ipcMain.handle('export:markdown', async (event, content: unknown) => {
  const trustedURL = pathToFileURL(
    path.join(__dirname, '../renderer/index.html'),
  ).href;

  if (
    event.senderFrame !== event.sender.mainFrame ||
    event.sender.getURL() !== trustedURL
  )
    throw new Error('Export is available only from the application.');

  if (
    typeof content !== 'string' ||
    Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024
  )
    throw new Error(
      'Export is too large. Redact or shorten the preview first.',
    );

  const result = await dialog.showSaveDialog({
    title: 'Export investigation as Markdown',
    defaultPath: 'bytebridge-investigation.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });

  if (result.canceled || !result.filePath) return { canceled: true };

  await writeFile(result.filePath, content, 'utf8');

  return { canceled: false };
});

let importingFolder = false;
const terminals = new Map<number, LocalTerminal>();

const projects = new Map<number, Map<string, LocalProject>>();

function trustedProjectSender(event: Electron.IpcMainInvokeEvent) {
  if (
    event.senderFrame !== event.sender.mainFrame ||
    event.sender.getURL() !==
      pathToFileURL(path.join(__dirname, '../renderer/index.html')).href
  )
    throw new Error('Projects are available only from the application.');

  let owned = projects.get(event.sender.id);

  if (!owned) {
    owned = new Map();
    projects.set(event.sender.id, owned);

    const cleanup = () => {
      terminals.get(event.sender.id)?.stop();
      terminals.delete(event.sender.id);

      for (const project of owned!.values()) project.close();

      owned!.clear();
    };

    event.sender.on(
      'did-start-navigation',
      (_event, _url, _inPlace, mainFrame) => {
        if (mainFrame) cleanup();
      },
    );
    event.sender.once('destroyed', () => {
      cleanup();
      projects.delete(event.sender.id);
    });
  }

  return owned;
}

ipcMain.handle('workspace:save-file', async (event, input: unknown) => {
  const trustedURL = pathToFileURL(
    path.join(__dirname, '../renderer/index.html'),
  ).href;

  if (
    event.senderFrame !== event.sender.mainFrame ||
    event.sender.getURL() !== trustedURL
  )
    throw new Error('File export is available only from the application.');

  const value = input as { name?: unknown; content?: unknown } | null;

  if (
    !value ||
    typeof value.name !== 'string' ||
    typeof value.content !== 'string' ||
    Buffer.byteLength(value.content, 'utf8') > 2 * 1024 * 1024
  )
    throw new Error('Invalid or oversized file export.');

  const name =
    value.name
      .split(/[\\/]/)
      .pop()
      ?.replace(/[\x00-\x1f<>:"|?*]/g, '_')
      .slice(0, 120) || 'shared-file.txt';
  const result = await dialog.showSaveDialog({
    title: 'Save a room-owned file copy',
    defaultPath: name === '.' || name === '..' ? 'shared-file.txt' : name,
  });

  if (result.canceled || !result.filePath) return { canceled: true };

  const destination = path.join(
    await realpath(path.dirname(result.filePath)),
    path.basename(result.filePath),
  );
  const owned = trustedProjectSender(event);
  for (const project of owned.values()) {
    const relative = path.relative(project.root, destination);
    if (
      relative === '' ||
      (!relative.startsWith('..' + path.sep) &&
        relative !== '..' &&
        !path.isAbsolute(relative))
    )
      throw new Error(
        'Save recovery copies outside hosted project folders to preserve the original disk files.',
      );
  }
  // Exclusive creation prevents symlink/hard-link aliases and accidental replacement.
  try {
    await writeFile(destination, value.content, {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error(
        'Choose a new filename for the recovery copy; existing files are preserved.',
      );
    throw error;
  }

  return { canceled: false };
});

async function projectIdentityKey() {
  const location = path.join(userData, 'project-identity-key');
  try {
    await writeFile(location, randomBytes(32), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const key = await readFile(location);
  if (key.length !== 32) throw new Error('Project identity key is invalid.');
  return key;
}

let access: ReturnType<typeof projectAccess> | undefined;

function savedAccess(scope: string) {
  if (
    typeof scope !== 'string' ||
    !scope.startsWith('bytebridge-workspace:') ||
    scope.length > 4096
  )
    throw new Error('Invalid room scope.');

  return (access ||= projectAccess(userData));
}

ipcMain.handle('project:remember', (event, scope: string, id: string) => {
  const project = trustedProjectSender(event).get(id);

  if (!project) throw new Error('Project hosting stopped.');

  savedAccess(scope).remember(scope, id, project.root);
});

ipcMain.handle('project:forget', (event, scope: string, id?: string) => {
  trustedProjectSender(event);
  savedAccess(scope).forget(scope, id);
});

ipcMain.handle(
  'project:restore',
  async (event, scope: string, ids: string[]) => {
    const owned = trustedProjectSender(event);
    const approvals = savedAccess(scope);
    const manifests: ProjectManifest[] = [];
    const failed: string[] = [];

    if (
      !Array.isArray(ids) ||
      ids.length > 2000 ||
      ids.some((id) => typeof id !== 'string')
    )
      throw new Error('Invalid project list.');

    approvals.retain(scope, ids);

    for (const id of new Set(ids)) {
      const root = approvals.get(scope, id);

      if (!root || owned.has(id)) continue;

      if (owned.size >= 4) {
        failed.push(id);
        continue;
      }

      try {
        const { project, manifest } = await LocalProject.select(
          root,
          await projectIdentityKey(),
          id,
        );

        if (
          event.sender.isDestroyed() ||
          event.senderFrame !== event.sender.mainFrame ||
          approvals.get(scope, id) !== root
        ) {
          project.close();
          continue;
        }

        owned.set(id, project);
        manifests.push(manifest);
      } catch {
        // Keep filesystem paths and OS errors on this device.
        failed.push(id);
      }
    }

    return { manifests, failed };
  },
);

ipcMain.handle(
  'project:open',
  async (event, expectedProjectId?: string, scope?: string) => {
    const owned = trustedProjectSender(event);

    if (
      expectedProjectId !== undefined &&
      (typeof expectedProjectId !== 'string' ||
        !/^[a-f0-9]{64}$/.test(expectedProjectId))
    )
      throw new Error('Invalid project identity.');

    if (owned.size >= 4)
      throw new Error('Stop hosting before opening more than four projects.');

    if (importingFolder) throw new Error('A project picker is already open.');

    importingFolder = true;

    try {
      const result = await dialog.showOpenDialog({
        title: expectedProjectId
          ? 'Reconnect: choose the shared folder'
          : 'Choose the project or subfolder to share',
        properties: ['openDirectory'],
      });

      if (result.canceled || !result.filePaths[0]) return null;

      const root = await realpath(result.filePaths[0]);
      if ([...owned.values()].some((project) => project.root === root))
        throw new Error('This project is already shared from this window.');
      const { project, manifest } = await LocalProject.select(
        root,
        await projectIdentityKey(),
        expectedProjectId &&
          scope &&
          savedAccess(scope).get(scope, expectedProjectId)
          ? expectedProjectId
          : undefined,
      );

      if (expectedProjectId && manifest.id !== expectedProjectId) {
        project.close();

        throw new Error(
          'This folder does not match the shared project. Choose its original folder using the same ByteBridge profile that shared it.',
        );
      }

      const confirmation = await dialog.showMessageBox({
        type: 'warning',
        title: expectedProjectId
          ? 'Reconnect project scope?'
          : 'Share project scope?',
        message: `Share ${manifest.files.length} file names from ${manifest.name}?`,
        detail: `${project.root}\n\n${manifest.skippedCount} files/folders excluded using .gitignore and built-in safety rules.${manifest.truncated ? ' The scan limit was reached; only this partial file list will be shared.' : ''}\n\nRoom participants can request any listed file while you host. Contents load on demand and remain in room storage/history. Exclusions are not a secret detector: choose a narrower subfolder or use a snippet for sensitive projects. Only you can explicitly save shared edits to these originals. This profile will remember the folder for this room and reconnect it when you return. Stop hosting or remove the project to forget access.`,
        buttons: ['Cancel', 'Share project'],
        defaultId: 0,
        cancelId: 0,
      });

      if (confirmation.response !== 1 || event.sender.isDestroyed()) {
        project.close();

        return null;
      }

      trustedProjectSender(event);
      owned.set(project.id, project);

      return manifest;
    } finally {
      importingFolder = false;
    }
  },
);

for (const operation of [
  'read',
  'save',
  'close',
  'inspect',
  'check',
  'accept',
] as const) {
  ipcMain.handle(
    `project:${operation}`,
    async (event, projectId: string, fileId: string, content: string) => {
      const owned = trustedProjectSender(event);
      const project = owned.get(projectId);

      if (!project) throw new Error('This window does not host that project.');

      if (operation === 'close') {
        if (terminals.get(event.sender.id)?.projectId === projectId) {
          terminals.get(event.sender.id)?.stop();
          terminals.delete(event.sender.id);
        }

        project.close();
        owned.delete(projectId);

        return;
      }

      try {
        if (operation === 'check') return await project.check(fileId);
        if (operation === 'inspect') return await project.inspect(fileId);
        if (operation === 'accept')
          return await project.accept(fileId, content);
        return operation === 'read'
          ? await project.read(fileId)
          : await project.save(fileId, content);
      } catch (error) {
        // Never forward OS errors containing local absolute paths to another participant.
        if ((error as NodeJS.ErrnoException).code)
          throw new Error(
            'Project file is unavailable or could not be accessed safely.',
          );

        throw error;
      }
    },
  );
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  receiveInvitation(url);
});
app.on('second-instance', (_event, argv) => {
  const invitation = invitationFrom(argv);

  if (invitation) receiveInvitation(invitation);
  else if (win) {
    if (win.isMinimized()) win.restore();

    win.focus();
  }
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('ready', () => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === 'darwin'
          ? [{ role: 'appMenu' as const }]
          : []),
        {
          label: 'File',
          submenu: [
            {
              label: 'Create Room',
              accelerator: 'CmdOrCtrl+N',
              click: () => win?.webContents.send('menu:create-room'),
            },
            { role: 'close' },
          ],
        },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ]),
    );
    createWindow();

    if (app.isPackaged && !profile) app.setAsDefaultProtocolClient('myapp');
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (!win) createWindow();
});

function terminalSize(cols: number, rows: number) {
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols >= 2 &&
    cols <= 500 &&
    rows >= 1 &&
    rows <= 300
  );
}

ipcMain.handle('terminal:start', (event, input: TerminalStart) => {
  const owned = trustedProjectSender(event);

  if (
    !input ||
    typeof input.id !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(input.id) ||
    !terminalSize(input.cols, input.rows)
  )
    throw new Error('Invalid terminal request.');

  const project = owned.get(input.projectId);

  if (!project) throw new Error('Choose a project you host.');

  terminals.get(event.sender.id)?.stop();
  terminals.delete(event.sender.id);

  try {
    const terminal = new LocalTerminal(input, project.root, (message) => {
      if (!event.sender.isDestroyed())
        event.sender.send('terminal:event', message);
    });
    terminals.set(event.sender.id, terminal);
  } catch {
    throw new Error(
      'The terminal could not start. Restart ByteBridge and try again.',
    );
  }
});

ipcMain.handle('terminal:stop', (event, id: string) => {
  trustedProjectSender(event);
  const terminal = terminals.get(event.sender.id);

  if (terminal?.id !== id) return;

  terminal.stop();
  terminals.delete(event.sender.id);
});

ipcMain.handle('terminal:write', (event, id: string, data: string) => {
  const owned = trustedProjectSender(event);
  const terminal = terminals.get(event.sender.id);

  if (terminal?.id !== id || !owned.has(terminal.projectId)) return;
  if (typeof data !== 'string' || data.length > 65536)
    throw new Error('Terminal input is too large.');

  terminal.write(data);
});

ipcMain.handle(
  'terminal:resize',
  (event, id: string, cols: number, rows: number) => {
    trustedProjectSender(event);
    const terminal = terminals.get(event.sender.id);

    if (terminal?.id === id && terminalSize(cols, rows))
      terminal.resize(cols, rows);
  },
);

ipcMain.handle('terminal:ack', (event, id: string, size: number) => {
  trustedProjectSender(event);
  const terminal = terminals.get(event.sender.id);

  if (
    terminal?.id === id &&
    Number.isInteger(size) &&
    size > 0 &&
    size <= 8 * 1024 * 1024
  )
    terminal.acknowledge(size);
});

app.on('before-quit', () => {
  for (const terminal of terminals.values()) terminal.stop();
  terminals.clear();
});
