const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('yilaiDesktop', {
  discoverDlna: () => ipcRenderer.invoke('dlna:discover'),
  playDlna: (media) => ipcRenderer.invoke('dlna:play', media),
})