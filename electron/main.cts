import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, powerMonitor, powerSaveBlocker, shell } from 'electron';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { registerBrowserIpc, stopOldHeadlessChrome } from './browserView.cjs';
import { blocksQuit, initLockScreen, isLocked, isLockShortcut, lockNow, openLockSettings, rememberLockForRelaunch } from './lockScreen.cjs';

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
const EXPECTED_BUILD = (() => { try { return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'dist/build-info.json'), 'utf8')); } catch { return null; } })();

// Name used by dialogs, the app menu title and notifications. The menu bar / Dock label of the
// unpackaged Electron.app comes from its Info.plist, which scripts/brand-electron.sh patches.
app.setName(APP_NAME);

let server: ChildProcess | null = null;
let quitting = false;
let respawnDelay = 1500;
let healthTimer: NodeJS.Timeout | null = null;
let respawnTimer: NodeJS.Timeout | null = null;

const APP_ORIGIN = new URL(DEV ? URL_DEV : URL_PROD).origin;
/** Schemes handed to the OS. Anything else (file:, smb:, custom app schemes) could launch local programs. */
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

function openExternalSafe(url: string) {
  try {
    if (EXTERNAL_SCHEMES.has(new URL(url).protocol)) void shell.openExternal(url).catch(() => {});
  } catch { /* malformed URL: ignore */ }
}

/** IPC is only accepted from the app's own page, never from a frame that navigated elsewhere. */
function fromApp(e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  try { return e.senderFrame === e.sender.mainFrame && new URL(e.senderFrame?.url ?? '').origin === APP_ORIGIN; } catch { return false; }
}

// One instance only: a second launch (login item + LaunchAgent, double click) focuses the first.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) {
  app.quit();
} else {
  stopOldHeadlessChrome();
  app.on('second-instance', () => {
    if (isLocked()) return; // the lock cover keeps focus; never surface the app window under it
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
}

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
    const req = http.get(`${URL_PROD}/api/health`, { timeout: 1000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += String(chunk); if (data.length > 8192) req.destroy(); });
      res.on('end', () => { try {
        const info = JSON.parse(data);
        resolve(res.statusCode === 200 && info.repo === REPO_ROOT && (!EXPECTED_BUILD || info.version === EXPECTED_BUILD.version && info.commit === EXPECTED_BUILD.commit));
      } catch { resolve(false); } });
    });
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
  respawnTimer = null;
  if (quitting) return;
  if (await healthy()) return; // already running (e.g. `npm run serve`)
  const runtime = await resolveNode();
  const entry = path.join(REPO_ROOT, 'dist', 'server', 'index.js');
  if (quitting) return;
  const env: NodeJS.ProcessEnv = { ...process.env, MVC_DEV: DEV ? '1' : '0', MVC_ELECTRON_EXEC_PATH: process.execPath, MVC_ELECTRON_VERSION: process.versions.electron };
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, runtime.env);
  console.log(`[mac-vibe-coder] server runtime: ${runtime.label}`);
  server = spawn(runtime.exe, [entry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'inherit', 'inherit'] });
  server.on('error', (err) => console.error('[mac-vibe-coder] server spawn failed', err.message));
  server.on('close', (code) => {
    server = null;
    if (quitting) return;
    if (code === RESTART_EXIT_CODE) {
      // Self-update finished: relaunch the whole app so new Electron/main code is picked up too.
      rememberLockForRelaunch();
      app.relaunch();
      app.exit(0);
      return;
    }
    // Crash: respawn with exponential backoff (1.5s → 30s) so a persistent failure does not spin.
    const delay = respawnDelay;
    respawnDelay = Math.min(30000, respawnDelay * 2);
    console.log(`[mac-vibe-coder] server exited (${code}); restarting in ${delay}ms`);
    respawnTimer = setTimeout(() => { void startServer().catch(console.error); }, delay);
  });
  if (await waitHealthy(15000)) respawnDelay = 1500;
  else throw new Error(`Server did not start on port ${PORT}. Close any other Mac Vibe Coder checkout using this port and try again.`); // healthy start resets the backoff
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 16 }, // centered in the 45px title bar (UsageBar)
    backgroundColor: '#0b0d12',
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  // The window itself never leaves the app origin (a link or <form> in rendered markdown would
  // otherwise load a foreign page that still receives the preload bridge).
  const keepInApp = (e: Electron.Event, url: string) => {
    let origin = '';
    try { origin = new URL(url).origin; } catch { /* invalid */ }
    if (origin === APP_ORIGIN && new URL(url).pathname === '/') return;
    e.preventDefault();
    openExternalSafe(url);
  };
  // Option+L locks the screen (see lockScreen.cts). Handled here rather than as a menu accelerator so it
  // fires from any focused field; the menu item only displays it.
  win.webContents.on('before-input-event', (e, input) => { if (isLockShortcut(input)) { e.preventDefault(); lockNow(); } });
  win.webContents.on('will-navigate', keepInApp);
  win.webContents.on('will-redirect', keepInApp);
  await win.loadURL(DEV ? URL_DEV : URL_PROD);
}

registerBrowserIpc(fromApp);

ipcMain.handle('pick-folder', async (e) => {
  if (!fromApp(e)) return null;
  const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});

// Native "Save As" sheet; resolves to the chosen path or null. The renderer writes through the server.
ipcMain.handle('save-dialog', async (e, opts: { defaultPath?: string; ext?: string; label?: string } | undefined) => {
  if (!fromApp(e)) return null;
  const win = BrowserWindow.fromWebContents(e.sender);
  const ext = typeof opts?.ext === 'string' ? opts.ext.replace(/^\./, '') : '';
  const options: Electron.SaveDialogOptions = {
    defaultPath: typeof opts?.defaultPath === 'string' ? opts.defaultPath : undefined,
    filters: ext ? [{ name: typeof opts?.label === 'string' ? opts.label : ext.toUpperCase(), extensions: [ext] }] : undefined,
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  };
  const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  return res.canceled || !res.filePath ? null : res.filePath;
});

ipcMain.handle('login-item', (e, enable: boolean | null) => {
  if (!fromApp(e)) return false;
  if (typeof enable === 'boolean') app.setLoginItemSettings({ openAtLogin: enable });
  return app.getLoginItemSettings().openAtLogin;
});

// Native notifications (task finished, approval needed) so the user is reached while in another app.
// Approval notifications carry buttons (macOS shows the first, the rest under its chevron) that answer the
// request without bringing the window forward; the renderer closes them once the request is settled.
type ApprovalDecision = 'allow' | 'allow_always' | 'deny';
const approvalNotes = new Map<string, Notification>();
ipcMain.on('notify', (e, payload: { title?: unknown; body?: unknown; sessionId?: unknown; approval?: unknown }) => {
  // While locked nothing is shown: banners would leak session names and their buttons could approve tool use.
  if (!fromApp(e) || isLocked() || !Notification.isSupported() || !payload || typeof payload !== 'object') return;
  const title = String(payload.title ?? '').slice(0, 200);
  const body = String(payload.body ?? '').slice(0, 500);
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
  if (!title) return;
  const sender = e.sender;
  const raw = payload.approval && typeof payload.approval === 'object' ? payload.approval as { requestId?: unknown; canAlwaysAllow?: unknown; labels?: unknown } : null;
  const requestId = raw && typeof raw.requestId === 'string' ? raw.requestId : '';
  const labels = raw && Array.isArray(raw.labels) && raw.labels.length === 3 && raw.labels.every((l) => typeof l === 'string') ? raw.labels as string[] : null;
  const choices: { decision: ApprovalDecision; text: string }[] = requestId && labels
    ? [{ decision: 'allow', text: labels[0] }, ...(raw!.canAlwaysAllow === true ? [{ decision: 'allow_always' as const, text: labels[1] }] : []), { decision: 'deny', text: labels[2] }]
    : [];
  const n = new Notification({ title, body, silent: false, actions: choices.map((c) => ({ type: 'button', text: c.text })) });
  n.on('click', () => {
    if (isLocked()) return;
    const win = BrowserWindow.fromWebContents(sender);
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    app.focus({ steal: true });
    if (sessionId && !sender.isDestroyed()) sender.send('notify-click', sessionId);
  });
  if (choices.length) {
    approvalNotes.get(requestId)?.close();
    approvalNotes.set(requestId, n);
    n.on('action', (_ev, index) => {
      if (isLocked()) return;
      const choice = choices[index];
      if (choice && !sender.isDestroyed()) sender.send('notify-approval', { sessionId, requestId, decision: choice.decision });
    });
    n.on('close', () => { if (approvalNotes.get(requestId) === n) approvalNotes.delete(requestId); });
  }
  n.show();
});
// Keep the Mac from idle-sleeping while an agent turn or a busy shell would otherwise be frozen mid-way.
// The renderer reports busy/idle transitions; the assertion is dropped as soon as nothing is running.
let awakeBlocker: number | null = null;
ipcMain.on('keep-awake', (e, busy: unknown) => {
  if (!fromApp(e)) return;
  if (busy === true && awakeBlocker === null) awakeBlocker = powerSaveBlocker.start('prevent-app-suspension');
  else if (busy !== true && awakeBlocker !== null) { powerSaveBlocker.stop(awakeBlocker); awakeBlocker = null; }
});
// macOS remembers the first style it registered for the app, so the "alert" default in Info.plist only helps fresh
// installs; existing users switch to alerts in System Settings, which this opens straight at the app's page.
ipcMain.on('open-notification-settings', (e) => {
  if (!fromApp(e)) return;
  void shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=com.hdomi.mac-vibe-coder');
});
ipcMain.on('notify-close', (e, requestId: unknown) => {
  if (!fromApp(e) || typeof requestId !== 'string') return;
  approvalNotes.get(requestId)?.close();
  approvalNotes.delete(requestId);
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
  const ko = language === 'ko';
  const lockMenu: Electron.MenuItemConstructorOptions = {
    label: ko ? '잠금화면' : 'Lock Screen',
    submenu: [
      // registerAccelerator false: Option+L is caught in before-input-event (works inside text fields and the browser panel).
      { label: ko ? '지금 잠그기' : 'Lock Now', accelerator: 'Alt+L', registerAccelerator: false, click: () => lockNow() },
      { type: 'separator' },
      { label: ko ? '잠금화면 설정…' : 'Lock Screen Settings…', click: () => openLockSettings() },
    ],
  };
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    languageMenu,
    lockMenu,
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Repository', click: () => { void shell.openExternal('https://github.com/HDomi/mac-vibe-coder'); } }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// The renderer reports its persisted language on load so the menu checkmark matches.
ipcMain.on('language', (e, lang: Lang) => { if (fromApp(e) && (lang === 'en' || lang === 'ko') && lang !== language) setLanguage(lang); });

app.whenReady().then(async () => {
  if (!primaryInstance || quitting) return;
  app.dock?.setIcon(APP_ICON);
  buildMenu();
  const lock = initLockScreen({ appUrl: DEV ? URL_DEV : URL_PROD, preload: path.join(__dirname, 'preload.cjs'), fromApp });
  if (!DEV) {
    await startServer();
    let checking = false;
    healthTimer = setInterval(() => {
      if (server || respawnTimer || checking || quitting) return;
      checking = true;
      void startServer().catch(console.error).finally(() => { checking = false; });
    }, 5000);
  }
  await createWindow();
  if (lock.resumeLocked) lockNow();
  // After sleep the renderer's sockets may be half-open; tell it to reconnect now rather than wait for the heartbeat.
  powerMonitor.on('resume', () => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('power-resume'); });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch((err) => { dialog.showErrorBox(APP_NAME, (err as Error).message); app.quit(); });

app.on('before-quit', (e) => {
  // Cmd+Q is already swallowed on the cover; this also refuses Dock / AppleScript quits while locked.
  if (blocksQuit()) { e.preventDefault(); return; }
  quitting = true;
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
  if (respawnTimer) { clearTimeout(respawnTimer); respawnTimer = null; }
  server?.kill();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
