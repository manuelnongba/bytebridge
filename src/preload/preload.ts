import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  copyToClipboard: async (text: string) =>
    await ipcRenderer.invoke('clipboard:copy', text),

  onCreateRoom: (callback: () => void) =>
    ipcRenderer.on('menu:create-room', callback),

  onDeepLink: (callback: (url: string) => void) =>
    ipcRenderer.on('deeplink', (_, url) => callback(url)),
});
