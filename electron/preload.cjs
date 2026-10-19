const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('vibe', {
  isElectron: true,
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  // Absolute path of a File dropped from Finder (browser mode cannot read this).
  getPathForFile: (file) => webUtils.getPathForFile(file),
  // Read or set "open at login". Pass null to only read.
  loginItem: (enable) => ipcRenderer.invoke('login-item', enable),
  // UI language sync with the macOS menu bar.
  setLanguage: (lang) => ipcRenderer.send('language', lang),
  onLanguage: (cb) => { ipcRenderer.on('language', (_e, lang) => cb(lang)); },
});
