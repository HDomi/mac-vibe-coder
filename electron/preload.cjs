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
  // Native macOS notification; a click brings the window back and reports the session id.
  notify: (payload) => ipcRenderer.send('notify', payload),
  onNotificationClick: (cb) => { ipcRenderer.on('notify-click', (_e, sessionId) => cb(sessionId)); },
  // Browser panel: a native Chromium view laid over the panel (see electron/browserView.cts).
  browser: {
    show: (bounds) => ipcRenderer.invoke('browser:show', bounds),
    setBounds: (bounds) => ipcRenderer.invoke('browser:bounds', bounds),
    hide: () => ipcRenderer.invoke('browser:hide'),
    state: () => ipcRenderer.invoke('browser:state'),
    navigate: (url) => ipcRenderer.invoke('browser:navigate', url),
    back: () => ipcRenderer.invoke('browser:back'),
    forward: () => ipcRenderer.invoke('browser:forward'),
    reload: () => ipcRenderer.invoke('browser:reload'),
    stop: () => ipcRenderer.invoke('browser:stop'),
    focus: () => ipcRenderer.invoke('browser:focus'),
    devtools: () => ipcRenderer.invoke('browser:devtools'),
    zoom: (factor) => ipcRenderer.invoke('browser:zoom', factor),
    capture: () => ipcRenderer.invoke('browser:capture'),
    onState: (cb) => { const h = (_e, s) => cb(s); ipcRenderer.on('browser:state', h); return () => ipcRenderer.removeListener('browser:state', h); },
    onShortcut: (cb) => { const h = (_e, k) => cb(k); ipcRenderer.on('browser:shortcut', h); return () => ipcRenderer.removeListener('browser:shortcut', h); },
  },
});
