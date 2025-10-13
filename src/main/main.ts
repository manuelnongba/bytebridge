import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  MenuItem,
} from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

let win: BrowserWindow | null = null;
let deeplinkingUrl: string | null = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.name = path.basename(process.cwd());
app.setPath('userData', path.join(app.getPath('userData'), app.name));

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
    },
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  win.on('closed', () => {
    win = null;
  });

  const currentMenu = Menu.getApplicationMenu();

  if (currentMenu) {
    const fileMenu = currentMenu.items.find((item) => item.label === 'File');

    if (fileMenu && fileMenu.submenu) {
      fileMenu.submenu.insert(
        0,
        new MenuItem({
          label: 'Create Room',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            win?.webContents.send('menu:create-room');
          },
        })
      );

      Menu.setApplicationMenu(currentMenu);
    }
  }
}

ipcMain.handle('clipboard:copy', async (_event, text: string) => {
  clipboard.writeText(text);
  return true;
});

app.on('ready', () => {
  createWindow();

  if (process.env.NODE_ENV !== 'development')
    app.setAsDefaultProtocolClient('myapp-dev');

  if (deeplinkingUrl) {
    win?.webContents.send('deeplink', deeplinkingUrl);
  }
});

// macOS
if (process.env.NODE_ENV !== 'development') {
  app.on('open-url', (event, url) => {
    console.log('open-url', url);

    deeplinkingUrl = url;
    win?.webContents.send('deeplink', url);
  });

  // Windows/Linux
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on('second-instance', (event, argv) => {
      // argv includes the deep link as last param
      const deeplink = argv.find((arg) => arg.startsWith('myapp://'));
      if (deeplink) {
        deeplinkingUrl = deeplink;
        win?.webContents.send('deeplink', deeplink);
      }
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    });
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (win === null) createWindow();
});
