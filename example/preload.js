const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('restorableAPI', {
  setState: (data) => ipcRenderer.invoke('set-state', data),
  getState: () => ipcRenderer.invoke('get-state'),
  getIdentifier: () => ipcRenderer.invoke('get-identifier'),
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (_event, data) => callback(data));
  },
});
