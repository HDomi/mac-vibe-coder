import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import http from 'node:http';

/*
 * Electron shell. The Node server (dist/server/index.js) runs as a child process
 * under the system Node so native modules (node-pty) use the Node ABI and the
 * server behaves identically in browser-only mode. macOS TCC attributes the
 * child's file access to this app, so folder permission prompts show the app name.
 */

const PORT = 11398;
const DEV = process.env.VITE_DEV === '1';
const URL_DEV = 'http://localhost:5173';
const URL_PROD = `http://127.0.0.1:${PORT}`;
const RESTART_EXIT_CODE = 75;
const REPO_ROOT = path.resolve(__dirname, '../..');
const APP_ICON = path.join(REPO_ROOT, 'web', 'public', 'icon.png');
const APP_NAME = 'Mac Vibe Coder';

// Name used by dialogs, the app menu title and notifications. The menu bar / Dock label of the
// unpackaged Electron.app comes from its Info.plist, which scripts/brand-electron.sh patches.
app.setName(APP_NAME);

let server: ChildProcess | null = null;
let quitting = false;

function loginShellLookup(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('/bin/zsh', ['-lc', `command -v ${cmd}`], { timeout: 8000 }, (err, stdout) => {
      const p = stdout?.trim().split('\n').pop() ?? '';
      resolve(!err && p.startsWith('/') ? p : null);
    });
  });
}

function healthy(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${URL_PROD}/api/health`, { timeout: 1000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitHealthy(ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await healthy()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function startServer(): Promise<void> {
  if (await healthy()) return; // already running (e.g. `npm run serve`)
  const node = await loginShellLookup('node');
  if (!node) {
    dialog.showErrorBox('Node.js 를 찾을 수 없음', 'node 가 PATH 에 없어 서버를 시작할 수 없어. nvm 또는 Homebrew 로 Node 24 를 설치해.');
    app.quit();
    return;
  }
  const entry = path.join(REPO_ROOT, 'dist', 'server', 'index.js');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  server = spawn(node, [entry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'inherit', 'inherit'] });
  server.on('exit', (code) => {
    server = null;
    if (quitting) return;
    if (code === RESTART_EXIT_CODE) {
      // Self-update finished: relaunch the whole app so new Electron/main code is picked up too.
      app.relaunch();
      app.exit(0);
      return;
    }
    // Crash: respawn after a short delay.
    setTimeout(() => { void startServer(); }, 1500);
  });
  await waitHealthy(15000);
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#0b0d12',
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  await win.loadURL(DEV ? URL_DEV : URL_PROD);
}

ipcMain.handle('pick-folder', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('login-item', (_e, enable: boolean | null) => {
  if (typeof enable === 'boolean') app.setLoginItemSettings({ openAtLogin: enable });
  return app.getLoginItemSettings().openAtLogin;
});

type Lang = 'en' | 'ko';
let language: Lang = 'en';
const LANGS: { id: Lang; label: string }[] = [{ id: 'en', label: 'English' }, { id: 'ko', label: '한국어' }];

function setLanguage(lang: Lang) {
  if (lang !== 'en' && lang !== 'ko') return;
  language = lang;
  buildMenu();
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('language', lang);
}

function buildMenu() {
  // An explicit menu gives the renderer the standard Edit shortcuts (Cmd+C/V/X/A) and
  // avoids the macOS "representedObject is not a WeakPtrToElectronMenuModelAsNSObject" noise.
  const languageMenu: Electron.MenuItemConstructorOptions = {
    label: language === 'ko' ? '언어' : 'Language',
    submenu: LANGS.map((l) => ({ label: l.label, type: 'radio' as const, checked: language === l.id, click: () => setLanguage(l.id) })),
  };
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    languageMenu,
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Repository', click: () => { void shell.openExternal('https://github.com/HDomi/mac-vibe-coder'); } }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// The renderer reports its persisted language on load so the menu checkmark matches.
ipcMain.on('language', (_e, lang: Lang) => { if (lang !== language) setLanguage(lang); });

app.whenReady().then(async () => {
  app.dock?.setIcon(APP_ICON);
  buildMenu();
  if (!DEV) await startServer();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('before-quit', () => {
  quitting = true;
  server?.kill();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
