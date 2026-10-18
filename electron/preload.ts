import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../shared/desktop';

const bridge: DesktopBridge = {
  isDesktop: true,
  listIntegrations: () => ipcRenderer.invoke('integrations:list'),
  energySettings: { read: () => ipcRenderer.invoke('energy:settings'), save: settings => ipcRenderer.invoke('energy:save-settings', settings) },
  lg: {
    snapshot: () => ipcRenderer.invoke('lg:snapshot'),
    energy: id => ipcRenderer.invoke('lg:energy', id),
    connect: token => ipcRenderer.invoke('lg:connect', token),
    disconnect: () => ipcRenderer.invoke('lg:disconnect'),
    select: id => ipcRenderer.invoke('lg:select', id),
    refresh: () => ipcRenderer.invoke('lg:refresh'),
    command: (id, command) => ipcRenderer.invoke('lg:command', id, command),
    openTokenPage: () => ipcRenderer.invoke('lg:token-page'),
    subscribe: listener => {
      const handler = (_event: Electron.IpcRendererEvent, snapshot: import('../shared/lg').LGSnapshot) => listener(snapshot);
      ipcRenderer.on('lg:changed', handler);
      return () => ipcRenderer.removeListener('lg:changed', handler);
    },
  },
  elgin: {
    snapshot: () => ipcRenderer.invoke('elgin:snapshot'),
    energy: id => ipcRenderer.invoke('elgin:energy', id),
    connect: project => ipcRenderer.invoke('elgin:connect', project),
    disconnect: () => ipcRenderer.invoke('elgin:disconnect'),
    select: id => ipcRenderer.invoke('elgin:select', id),
    refresh: () => ipcRenderer.invoke('elgin:refresh'),
    command: (id, command) => ipcRenderer.invoke('elgin:command', id, command),
    openConsolePage: () => ipcRenderer.invoke('elgin:console-page'),
    subscribe: listener => {
      const handler = (_event: Electron.IpcRendererEvent, snapshot: import('../shared/elgin').ElginSnapshot) => listener(snapshot);
      ipcRenderer.on('elgin:changed', handler);
      return () => ipcRenderer.removeListener('elgin:changed', handler);
    },
  },
};
contextBridge.exposeInMainWorld('glacialpoint', Object.freeze(bridge));
