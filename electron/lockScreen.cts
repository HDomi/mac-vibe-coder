import { app, BrowserWindow, ipcMain, powerMonitor, powerSaveBlocker, screen, type Display } from 'electron';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/*
 * Lock screen: a cover window on every display while agent sessions keep running underneath.
 * It is not a macOS login lock. Kiosk presentation options block Cmd+Tab, force quit, the Apple menu and
 * hiding the app; the cover sits at screen-saver level on every Space; the app's own windows are hidden.
 * Spotlight, Mission Control gestures, hot corners and a hard power-off are not blocked.
 * While locked on AC power the display is kept awake so macOS does not sleep-lock the screen.
 * Ctrl+Cmd+Q (macOS Lock Screen) still works: the system handles it, or, when kiosk mode disables the
 * Apple menu shortcut, the cover window catches it and asks loginwindow to lock.
 */

export interface LockSettings { mainDisplay: string | null; mainBg: string; subBg: string; heartbeat: boolean }
interface Stored extends LockSettings { salt?: string; hash?: string; relaunchLockedAt?: number }
export interface LockSessionSummary { agent: string; total: number; running: number; waiting: number }

const DEFAULTS: LockSettings = { mainDisplay: null, mainBg: '#0b0d11', subBg: '#0b0d11', heartbeat: true };
const MIN_PASSWORD = 4;
/** A relaunch (self-update) within this window comes back locked. Older flags are ignored so a reboot never traps the user. */
const RELAUNCH_GRACE_MS = 2 * 60 * 1000;
const COLOR = /^#[0-9a-f]{6}$/i;
// loginwindow's own "lock now" entry point; same as the Lock Screen menu item. Symbol presence checked on macOS 26.
const MAC_LOCK_JXA = 'ObjC.import("Foundation");$.NSBundle.bundleWithPath("/System/Library/PrivateFrameworks/login.framework").load;ObjC.bindFunction("SACLockScreenImmediate",["int",[]]);$.SACLockScreenImmediate();';

let file = '';
let stored: Stored = { ...DEFAULTS };
let appUrl = '';
let preload = '';
let locked = false;
let unlocking = false;
let covers: { win: BrowserWindow; role: 'main' | 'sub'; display: Display }[] = [];
let hiddenWins: BrowserWindow[] = [];
let displayBlocker: number | null = null;
let macLocked = false;
let sessions: LockSessionSummary[] = [];
let failures = 0;
let retryAt = 0;
let rebuildTimer: NodeJS.Timeout | null = null;
let systemShutdown = false;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Stored>;
    stored = { ...DEFAULTS, ...sanitize(raw), salt: typeof raw.salt === 'string' ? raw.salt : undefined, hash: typeof raw.hash === 'string' ? raw.hash : undefined, relaunchLockedAt: typeof raw.relaunchLockedAt === 'number' ? raw.relaunchLockedAt : undefined };
  } catch { stored = { ...DEFAULTS }; }
}
function save() {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 });
  } catch (err) { console.error('[lock] save failed', (err as Error).message); }
}
function sanitize(raw: Partial<LockSettings>): Partial<LockSettings> {
  const out: Partial<LockSettings> = {};
  if (raw.mainDisplay === null || (typeof raw.mainDisplay === 'string' && raw.mainDisplay.length < 200)) out.mainDisplay = raw.mainDisplay;
  if (typeof raw.mainBg === 'string' && COLOR.test(raw.mainBg)) out.mainBg = raw.mainBg;
  if (typeof raw.subBg === 'string' && COLOR.test(raw.subBg)) out.subBg = raw.subBg;
  if (typeof raw.heartbeat === 'boolean') out.heartbeat = raw.heartbeat;
  return out;
}
const settings = (): LockSettings => ({ mainDisplay: stored.mainDisplay, mainBg: stored.mainBg, subBg: stored.subBg, heartbeat: stored.heartbeat });
const hasPassword = () => !!(stored.salt && stored.hash);

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => err ? reject(err) : resolve(key)));
}
async function verify(password: string): Promise<boolean> {
  if (!stored.salt || !stored.hash || typeof password !== 'string' || password.length > 1024) return false;
  const want = Buffer.from(stored.hash, 'hex');
  const got = await scrypt(password, Buffer.from(stored.salt, 'hex'));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
/** 5 free tries, then a wait that doubles per miss (30s → 10min). Shared by unlock and password change. */
function noteFailure() {
  failures++;
  if (failures >= 5) retryAt = Date.now() + Math.min(600000, 30000 * 2 ** (failures - 5));
}
const retryIn = () => Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));

/** Stable id for a display across reboots (Electron's numeric id can change): built-in panel, or the monitor name. */
export function displayKey(d: Display): string { return d.internal ? 'internal' : `ext:${d.label || `${d.size.width}x${d.size.height}`}`; }
function mainDisplay(all: Display[]): Display {
  return all.find((d) => stored.mainDisplay && displayKey(d) === stored.mainDisplay) ?? screen.getPrimaryDisplay();
}
function layout() {
  const all = screen.getAllDisplays();
  const main = mainDisplay(all);
  return all.map((d) => ({ key: displayKey(d), label: d.label, internal: d.internal, primary: d.id === screen.getPrimaryDisplay().id, main: d.id === main.id, bounds: d.bounds }));
}

/** Option+L, the lock shortcut. Matched on the physical key so the Korean IME and the "¬" character do not matter. */
export function isLockShortcut(input: Electron.Input): boolean {
  return input.type === 'keyDown' && input.alt && !input.meta && !input.control && !input.shift && input.code === 'KeyL';
}
export const isLocked = () => locked;
/** Quit is refused while locked, except for a system shutdown/logout. */
export const blocksQuit = () => locked && !systemShutdown;

function appWindows() { return BrowserWindow.getAllWindows().filter((w) => !covers.some((c) => c.win === w)); }
function sendToApp(channel: string, ...args: unknown[]) {
  for (const w of appWindows()) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
}
function sendToCovers(channel: string, payload: unknown) {
  for (const c of covers) if (!c.win.isDestroyed()) c.win.webContents.send(channel, payload);
}

/** Bring the lock settings up in the app window (menu item, or Option+L with no password yet). */
export function openLockSettings() {
  const w = appWindows().find((x) => x.isVisible()) ?? appWindows()[0];
  if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
  sendToApp('lock:open-settings');
}

export function lockNow() {
  if (locked) return;
  if (!hasPassword()) { openLockSettings(); return; }
  locked = true;
  unlocking = false;
  hiddenWins = appWindows().filter((w) => w.isVisible());
  buildCovers();
  for (const w of hiddenWins) w.hide();
  focusMainCover(); // hiding the app's key window can leave no key window at all
  updateBlocker();
}

function buildCovers() {
  const all = screen.getAllDisplays();
  const main = mainDisplay(all);
  const old = covers;
  covers = [];
  // Subs first so the main cover is created last and keeps keyboard focus.
  for (const d of [...all.filter((x) => x.id !== main.id), main]) {
    const role = d.id === main.id ? 'main' as const : 'sub' as const;
    const win = new BrowserWindow({
      ...d.bounds,
      show: false,
      frame: false,
      // A borderless (non-titled) window makes kiosk mode apply its presentation options without entering
      // a native full-screen Space, so every display stays covered in place.
      roundedCorners: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      enableLargerThanScreen: true,
      hiddenInMissionControl: true,
      focusable: role === 'main',
      backgroundColor: role === 'main' ? stored.mainBg : stored.subBg,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false, backgroundThrottling: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.setBounds(d.bounds);
    guardCover(win, role);
    covers.push({ win, role, display: d });
    let failedLoads = 0;
    win.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3: aborted by a newer load
      // The page comes from the local server. If it stays unreachable the cover would be a blank wall
      // the password cannot be typed into, so give up and unlock rather than trap the user.
      if (++failedLoads > 20) { console.error('[lock] cover page unreachable; unlocking'); finishUnlock(); return; }
      setTimeout(() => { if (!win.isDestroyed()) void win.loadURL(`${appUrl}/?lock=${role}`).catch(() => {}); }, 1000);
    });
    win.webContents.on('render-process-gone', () => { if (!win.isDestroyed() && locked) win.reload(); });
    void win.loadURL(`${appUrl}/?lock=${role}`).catch(() => {});
    if (role === 'main') {
      win.show();
      win.setKiosk(true);
      focusMainCover(win);
      win.webContents.once('did-finish-load', () => focusMainCover(win));
    } else {
      win.showInactive();
    }
  }
  for (const c of old) destroyCover(c.win);
}

function focusMainCover(win = covers.find((c) => c.role === 'main')?.win) {
  if (!locked || macLocked || !win || win.isDestroyed()) return;
  app.focus({ steal: true });
  win.focus();
}

function destroyCover(win: BrowserWindow) {
  if (win.isDestroyed()) return;
  if (win.isKiosk()) win.setKiosk(false);
  win.destroy();
}

function guardCover(win: BrowserWindow, role: 'main' | 'sub') {
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.on('will-redirect', (e) => e.preventDefault());
  win.on('close', (e) => { if (locked && !unlocking) e.preventDefault(); });
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.control && input.meta && input.code === 'KeyQ') { e.preventDefault(); lockMac(); return; }
    // Editing keys for the password field pass; every other Cmd shortcut (quit, close, hide, reload,
    // devtools, new session…) is swallowed before the app menu sees it.
    if (input.meta && !input.control && !input.alt && ['KeyA', 'KeyC', 'KeyV', 'KeyX', 'KeyZ'].includes(input.code)) return;
    if (input.meta || isLockShortcut(input)) e.preventDefault();
  });
  if (role === 'main') {
    // Something took focus (Spotlight, a dialog from another app): take it back so typing stays on the cover.
    win.on('blur', () => setTimeout(() => { if (!win.isDestroyed() && !win.isFocused()) focusMainCover(win); }, 150));
  }
}

function lockMac() {
  execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_LOCK_JXA], { timeout: 5000 }, (err) => {
    if (err) execFile('/usr/bin/pmset', ['displaysleepnow'], () => {});
  });
}

function finishUnlock() {
  if (!locked) return;
  unlocking = true;
  locked = false;
  failures = 0;
  retryAt = 0;
  const wins = hiddenWins;
  hiddenWins = [];
  const old = covers;
  covers = [];
  for (const c of old) destroyCover(c.win);
  unlocking = false;
  for (const w of wins) if (!w.isDestroyed()) w.show();
  wins.find((w) => !w.isDestroyed())?.focus();
  updateBlocker();
}

/** Keep the display (and so the Mac) awake while locked on AC power; on battery macOS may sleep and lock as usual. */
function updateBlocker() {
  const want = locked && !powerMonitor.isOnBatteryPower();
  if (want && displayBlocker === null) displayBlocker = powerSaveBlocker.start('prevent-display-sleep');
  else if (!want && displayBlocker !== null) { powerSaveBlocker.stop(displayBlocker); displayBlocker = null; }
}

/** Arrangement only: kiosk mode hiding the menu bar and Dock changes each display's work area, which must not count. */
function arrangement(list: Display[], mainId: number) {
  return list.map((d) => `${d.id}:${d.bounds.x},${d.bounds.y},${d.bounds.width},${d.bounds.height}:${d.rotation}:${d.id === mainId ? 'm' : ''}`).sort().join('|');
}
function rebuildSoon(force = false) {
  if (!locked) return;
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    if (!locked) return;
    const all = screen.getAllDisplays();
    const now = arrangement(all, mainDisplay(all).id);
    const covered = arrangement(covers.map((c) => c.display), covers.find((c) => c.role === 'main')?.display.id ?? -1);
    if (force || now !== covered) buildCovers();
  }, 600);
}

/** Called right before a self-update relaunch so the new process comes back locked. */
export function rememberLockForRelaunch() {
  if (!locked) return;
  stored.relaunchLockedAt = Date.now();
  save();
}

type FromApp = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => boolean;

export function initLockScreen(opts: { appUrl: string; preload: string; fromApp: FromApp }) {
  file = path.join(app.getPath('userData'), 'lock-screen.json');
  appUrl = opts.appUrl;
  preload = opts.preload;
  load();
  const { fromApp } = opts;
  const isCover = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => covers.some((c) => c.win.webContents === e.sender);
  const fromAppWindow = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => fromApp(e) && !isCover(e);

  ipcMain.handle('lock:get', (e) => fromAppWindow(e) ? { settings: settings(), hasPassword: hasPassword(), displays: layout() } : null);
  ipcMain.handle('lock:set', (e, patch: unknown) => {
    if (!fromAppWindow(e) || !patch || typeof patch !== 'object') return null;
    Object.assign(stored, sanitize(patch as Partial<LockSettings>));
    save();
    if (locked) { sendToCovers('lock:update', { settings: settings() }); if ('mainDisplay' in (patch as object)) rebuildSoon(true); }
    return settings();
  });
  ipcMain.handle('lock:password', async (e, req: unknown) => {
    if (!fromAppWindow(e) || !req || typeof req !== 'object') return { ok: false, error: 'invalid' };
    const { current, next } = req as { current?: unknown; next?: unknown };
    if (typeof next !== 'string' || (next !== '' && next.length < MIN_PASSWORD) || next.length > 1024) return { ok: false, error: 'short' };
    if (hasPassword()) {
      if (retryIn() > 0) return { ok: false, error: 'wait', retryIn: retryIn() };
      if (!(await verify(typeof current === 'string' ? current : ''))) { noteFailure(); return { ok: false, error: 'wrong', retryIn: retryIn() }; }
      failures = 0;
    }
    if (next === '') { delete stored.salt; delete stored.hash; }
    else {
      const salt = crypto.randomBytes(16);
      stored.salt = salt.toString('hex');
      stored.hash = (await scrypt(next, salt)).toString('hex');
    }
    save();
    return { ok: true, hasPassword: hasPassword() };
  });
  ipcMain.on('lock:now', (e) => { if (fromAppWindow(e)) lockNow(); });
  // The app window reports per-agent session counts; the covers show them without titles.
  ipcMain.on('lock:sessions', (e, list: unknown) => {
    if (!fromAppWindow(e) || !Array.isArray(list)) return;
    sessions = list.filter((s): s is LockSessionSummary => !!s && typeof s === 'object' && typeof s.agent === 'string'
      && [s.total, s.running, s.waiting].every((n) => Number.isInteger(n) && n >= 0)).slice(0, 8)
      .map((s) => ({ agent: s.agent.slice(0, 20), total: s.total, running: s.running, waiting: s.waiting }));
    sendToCovers('lock:update', { sessions });
  });

  ipcMain.handle('lock:init', (e) => {
    const c = covers.find((x) => x.win.webContents === e.sender);
    if (!c || !fromApp(e)) return null;
    return { role: c.role, self: c.display.bounds, displays: layout(), settings: settings(), sessions, retryIn: retryIn() };
  });
  ipcMain.handle('lock:unlock', async (e, password: unknown) => {
    if (!isCover(e) || !fromApp(e) || !locked) return { ok: false };
    if (retryIn() > 0) return { ok: false, retryIn: retryIn() };
    // Reply before the covers are destroyed, or the cover's pending invoke never settles.
    if (await verify(typeof password === 'string' ? password : '')) { setTimeout(finishUnlock, 30); return { ok: true }; }
    noteFailure();
    return { ok: false, retryIn: retryIn() };
  });

  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed'] as const) screen.on(ev as 'display-added', () => { rebuildSoon(); sendToApp('lock:displays'); });
  powerMonitor.on('on-ac', updateBlocker);
  powerMonitor.on('on-battery', updateBlocker);
  powerMonitor.on('lock-screen', () => { macLocked = true; });
  powerMonitor.on('unlock-screen', () => {
    macLocked = false;
    focusMainCover();
  });
  powerMonitor.on('shutdown', () => { systemShutdown = true; });

  // Came back from a self-update relaunch that happened while locked.
  const relaunchAt = stored.relaunchLockedAt;
  if (relaunchAt !== undefined) { delete stored.relaunchLockedAt; save(); }
  return { resumeLocked: !!relaunchAt && Date.now() - relaunchAt < RELAUNCH_GRACE_MS && hasPassword() };
}
