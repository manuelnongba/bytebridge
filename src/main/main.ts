import { app, BrowserWindow, clipboard, ipcMain, Menu, dialog } from 'electron';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { writeFile } from 'node:fs/promises';
import { invitationFrom } from './invitations.js';
import { mkdirSync } from 'node:fs';
import { profileFrom, profileDirectory } from './profiles.js';

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
