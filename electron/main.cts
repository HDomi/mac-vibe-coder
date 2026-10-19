import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

/*
 * Electron shell. The Node server (dist/server/index.js) runs as a child process.
 * Runtime resolution order: bundled runtime/node (installer download) → system node
 * from the user's interactive shell → Electron's own embedded Node (ELECTRON_RUN_AS_NODE).
 * The last option always exists, so the app never depends on a user-installed Node.
 * node-pty is N-API, so it loads under either ABI. macOS TCC attributes the child's
 * file access to this app, so folder permission prompts show the app name.
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
let respawnDelay = 1500;

function loginShellLookup(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    // -i so ~/.zshrc (where nvm lives) is sourced; -l for Homebrew paths from ~/.zprofile.
    execFile('/bin/zsh', ['-lic', `command -v ${cmd}`], { timeout: 8000 }, (err, stdout) => {
      const p = stdout?.trim().split('\n').pop() ?? '';
      resolve(!err && p.startsWith('/') ? p : null);
    });
  });
}

/** Pick the Node runtime for the server; returns the executable and extra env. */
async function resolveNode(): Promise<{ exe: string; env: NodeJS.ProcessEnv; label: string }> {
  const bundled = path.join(REPO_ROOT, 'runtime', 'node', 'bin', 'node');
  if (fs.existsSync(bundled)) return { exe: bundled, env: {}, label: 'bundled' };
  const system = await loginShellLookup('node');
  if (system) {
    const major = await new Promise<number>((resolve) => execFile(system, ['-p', 'process.versions.node.split(".")[0]'], { timeout: 5000 }, (err, out) => resolve(err ? 0 : Number(out.trim()))));
    if (major >= 20) return { exe: system, env: {}, label: `system ${system}` };
  }
  return { exe: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' }, label: 'electron' };
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
  const runtime = await resolveNode();
  const entry = path.join(REPO_ROOT, 'dist', 'server', 'index.js');
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, runtime.env);
  console.log(`[mac-vibe-coder] server runtime: ${runtime.label}`);
  server = spawn(runtime.exe, [entry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'inherit', 'inherit'] });
  server.on('exit', (code) => {
    server = null;
    if (quitting) return;
    if (code === RESTART_EXIT_CODE) {
      // Self-update finished: relaunch the whole app so new Electron/main code is picked up too.
      app.relaunch();
      app.exit(0);
      return;
    }
    // Crash: respawn with exponential backoff (1.5s → 30s) so a persistent failure does not spin.
    const delay = respawnDelay;
    respawnDelay = Math.min(30000, respawnDelay * 2);
    console.log(`[mac-vibe-coder] server exited (${code}); restarting in ${delay}ms`);
    setTimeout(() => { void startServer(); }, delay);
  });
  if (await waitHealthy(15000)) respawnDelay = 1500; // healthy start resets the backoff
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
