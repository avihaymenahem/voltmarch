import { contextBridge, ipcRenderer } from 'electron';
ipcRenderer.on('poc:port', (event) => {
  window.postMessage({ type: 'poc:port' }, 'app://vm-poc', event.ports);
});
contextBridge.exposeInMainWorld('poc', {
  config: () => ipcRenderer.invoke('poc:config'),
  startUtility: () => ipcRenderer.invoke('poc:utility'),
  memory: () => ipcRenderer.invoke('poc:memory'),
  screenshot: (name) => ipcRenderer.invoke('poc:screenshot', name),
  complete: (result) => ipcRenderer.invoke('poc:complete', result),
});
