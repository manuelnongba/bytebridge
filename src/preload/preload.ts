import { contextBridge, ipcRenderer } from 'electron';
import type { TerminalEvent } from '../shared/terminal.js';
import type { MenuCommand, NativeAPI } from '../shared/contracts.js';

const api: NativeAPI = {
  startTerminal: (input) => ipcRenderer.invoke('terminal:start', input),
  stopTerminal: (id) => ipcRenderer.invoke('terminal:stop', id),
  writeTerminal: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
  resizeTerminal: (id, cols, rows) =>
    ipcRenderer.invoke('terminal:resize', id, cols, rows),
  acknowledgeTerminal: (id, size) =>
    ipcRenderer.invoke('terminal:ack', id, size),
  onTerminalEvent: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: TerminalEvent,
    ) => callback(value);
    ipcRenderer.on('terminal:event', listener);
    return () => ipcRenderer.removeListener('terminal:event', listener);
  },
  ready: () => ipcRenderer.invoke('renderer:ready'),
  openProject: (expectedProjectId, scope) =>
    ipcRenderer.invoke('project:open', expectedProjectId, scope),
  rememberProject: (scope, projectId) =>
    ipcRenderer.invoke('project:remember', scope, projectId),
  forgetProject: (scope, projectId) =>
    ipcRenderer.invoke('project:forget', scope, projectId),
  restoreProjects: (scope, projectIds) =>
    ipcRenderer.invoke('project:restore', scope, projectIds),
  readProjectFile: (projectId: string, fileId: string) =>
    ipcRenderer.invoke('project:read', projectId, fileId),
  checkProjectFile: (projectId, fileId) =>
    ipcRenderer.invoke('project:check', projectId, fileId),
  inspectProjectFile: (projectId, fileId) =>
    ipcRenderer.invoke('project:inspect', projectId, fileId),
  acceptProjectFile: (projectId, fileId, token) =>
    ipcRenderer.invoke('project:accept', projectId, fileId, token),
  saveProjectFile: (projectId: string, fileId: string, content: string) =>
    ipcRenderer.invoke('project:save', projectId, fileId, content),
  closeProject: (projectId: string) =>
    ipcRenderer.invoke('project:close', projectId),
  saveWorkspaceFile: (name: string, content: string) =>
    ipcRenderer.invoke('workspace:save-file', { name, content }),
  saveMarkdown: (content: string) =>
    ipcRenderer.invoke('export:markdown', content),
  copyToClipboard: async (text: string) =>
    await ipcRenderer.invoke('clipboard:copy', text),

  onCreateRoom: (callback: () => void) =>
    ipcRenderer.on('menu:create-room', callback),

  onMenuCommand: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      command: MenuCommand,
    ) => callback(command);

    ipcRenderer.on('menu:command', listener);
    return () => ipcRenderer.removeListener('menu:command', listener);
  },

  onDeepLink: (callback: (url: string) => void) =>
    ipcRenderer.on('deeplink', (_, url) => callback(url)),
};

contextBridge.exposeInMainWorld('api', api);
