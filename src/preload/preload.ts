import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  ready: () => ipcRenderer.invoke('renderer:ready'),
  saveMarkdown: (content: string) =>
    ipcRenderer.invoke('export:markdown', content),
  copyToClipboard: async (text: string) =>
    await ipcRenderer.invoke('clipboard:copy', text),

  onCreateRoom: (callback: () => void) =>
    ipcRenderer.on('menu:create-room', callback),

  onDeepLink: (callback: (url: string) => void) =>
    ipcRenderer.on('deeplink', (_, url) => callback(url)),
});
