import { app, BrowserWindow, ipcMain, session, WebContentsView } from 'electron';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * Browser panel, Electron build: a real Chromium view (WebContentsView) laid over the panel's
 * placeholder in the window. Rendering, cursor, IME, <select> and dialogs behave like a normal
 * browser. Agents reach the same page over Electron's own CDP endpoint (remote-debugging-port);
 * the renderer reports this view's CDP target id to the server, which hands it to in-app sessions.
 */

export const BROWSER_CDP_PORT = Number(process.env.MVC_BROWSER_CDP_PORT) || 9323;
const PARTITION = 'persist:mvc-browser';
const ATTACH_DIR = path.join(os.homedir(), '.mac-vibe-coder', 'attachments');

export interface BrowserViewState {
  url: string; title: string; loading: boolean; canBack: boolean; canForward: boolean;
  targetId: string | null; cdpPort: number;
  /** Page zoom. Below 1 the page gets a wider CSS viewport than the panel, so desktop layouts fit. */
  zoom: number;
}

export const ZOOM_STEPS = [0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];
function stepZoom(current: number, dir: 1 | -1) {
  const i = ZOOM_STEPS.findIndex((z) => Math.abs(z - current) < 0.01);
  const at = i >= 0 ? i : ZOOM_STEPS.findIndex((z) => z > current) - (dir > 0 ? 1 : 0);
  return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, at + dir))];
}
interface Bounds { x: number; y: number; width: number; height: number }

/**
 * v0.3.40-41 ran a headless Chrome on this port. It would keep the port and Electron's DevTools
 * server would silently fail to bind, so stop it first. Only headless Chrome on exactly this
 * port is touched; any other process is left alone.
 */
function listeners(port: number): string[] {
  try { return execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8', timeout: 3000 }).split('\n').filter(Boolean); } catch { return []; }
}
function freeStaleHeadless(port: number) {
  let killed = false;
  for (const pid of listeners(port)) {
    try {
      const cmd = execFileSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8', timeout: 3000 });
      if (cmd.includes('--headless') && cmd.includes(`--remote-debugging-port=${port}`)) { process.kill(Number(pid), 'SIGTERM'); killed = true; }
    } catch { /* already gone */ }
  }
  // Chromium binds the DevTools port during startup; wait (up to 3s) until the old one let go.
  for (let i = 0; killed && i < 15 && listeners(port).length; i++) execFileSync('sleep', ['0.2']);
}

/** Must run before the app is ready: Chromium reads the switch at startup. */
export function enableBrowserCdp() {
  freeStaleHeadless(BROWSER_CDP_PORT);
  app.commandLine.appendSwitch('remote-debugging-port', String(BROWSER_CDP_PORT));
}

/** Chrome's own user agent without the Electron and app tokens, so sites serve their normal desktop pages. */
/** The panel is for web pages: no file:, javascript: or custom app schemes (agents can navigate it too). */
export function allowedPanelUrl(url: string) {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:' || url === 'about:blank'; } catch { return false; }
}

function chromeUserAgent(ua: string) {
  return ua.replace(/\s(?:mac-vibe-coder|Mac Vibe Coder)\/\S+/gi, '').replace(/\sElectron\/\S+/, '');
}

let view: WebContentsView | null = null;
let owner: BrowserWindow | null = null;
let targetId: string | null = null;
let shown = false;

function state(): BrowserViewState {
  const wc = view?.webContents;
  const live = wc && !wc.isDestroyed();
  return {
    url: live ? wc.getURL() : '', title: live ? wc.getTitle() : '', loading: live ? wc.isLoading() : false,
    canBack: live ? wc.navigationHistory.canGoBack() : false, canForward: live ? wc.navigationHistory.canGoForward() : false,
    targetId, cdpPort: BROWSER_CDP_PORT, zoom: live ? wc.getZoomFactor() : 1,
  };
}
function publish() { if (owner && !owner.isDestroyed()) owner.webContents.send('browser:state', state()); }

/** CDP target id of the view, read through its own debugger (Target.getTargetInfo without an id). */
async function readTargetId(wc: Electron.WebContents) {
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    const r = await wc.debugger.sendCommand('Target.getTargetInfo') as { targetInfo: { targetId: string } };
    targetId = r.targetInfo.targetId;
  } catch { targetId = null; }
  try { if (wc.debugger.isAttached()) wc.debugger.detach(); } catch { /* already detached */ }
  publish();
}

function ensureView(win: BrowserWindow): WebContentsView {
  if (view && !view.webContents.isDestroyed()) return view;
  owner = win;
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(chromeUserAgent(ses.getUserAgent()));
  view = new WebContentsView({ webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  view.setBackgroundColor('#ffffff');
  const wc = view.webContents;
  for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated'] as const) wc.on(ev as 'did-stop-loading', publish);
  wc.on('render-process-gone', () => { void readTargetId(wc); });
  wc.on('zoom-changed', (_e, dir) => { wc.setZoomFactor(stepZoom(wc.getZoomFactor(), dir === 'in' ? 1 : -1)); publish(); });
  wc.on('will-navigate', (e, url) => { if (!allowedPanelUrl(url)) e.preventDefault(); });
  wc.on('will-redirect', (e, url) => { if (!allowedPanelUrl(url)) e.preventDefault(); });
  // OAuth and other window.open popups need a real window with an opener; plain new-tab links stay in the panel.
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (disposition === 'new-window') {
      return { action: 'allow', overrideBrowserWindowOptions: { parent: win, width: 520, height: 720, webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true } } };
    }
    if (allowedPanelUrl(url)) void wc.loadURL(url);
    return { action: 'deny' };
  });
  // Shortcuts pressed inside the page: page-level ones here, app-level ones forwarded to the app UI.
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !input.meta) return;
    const k = input.key.toLowerCase();
    if (k === 'r') { e.preventDefault(); if (input.shift) wc.reloadIgnoringCache(); else wc.reload(); return; }
    if (k === '[') { e.preventDefault(); wc.navigationHistory.goBack(); return; }
    if (k === ']') { e.preventDefault(); wc.navigationHistory.goForward(); return; }
    if (k === 'i' && input.alt) { e.preventDefault(); wc.toggleDevTools(); return; }
    if (k === '=' || k === '+' || k === '-' || k === '0') {
      e.preventDefault();
      wc.setZoomFactor(k === '0' ? 1 : stepZoom(wc.getZoomFactor(), k === '-' ? -1 : 1));
      publish();
      return;
    }
    if (['l', 'k', 'j', 'b', 'n', 'w', 'p', '/', '1', '2', '3', '4', '5', 'f'].includes(k)) {
      e.preventDefault();
      win.webContents.send('browser:shortcut', { key: k, shift: input.shift, alt: input.alt });
    }
  });
  void wc.loadURL('about:blank').then(() => readTargetId(wc));
  return view;
}

function show(win: BrowserWindow, b: Bounds) {
  const v = ensureView(win);
  if (!win.contentView.children.includes(v)) win.contentView.addChildView(v);
  v.setBounds(round(b));
  v.setVisible(true);
  shown = true;
  publish();
}
function hide() { if (view && shown) { view.setVisible(false); shown = false; } }
const round = (b: Bounds) => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.max(1, Math.round(b.width)), height: Math.max(1, Math.round(b.height)) });

/** Register IPC. `fromApp` limits callers to the app's own page. */
export function registerBrowserIpc(fromApp: (e: Electron.IpcMainInvokeEvent) => boolean) {
  const win = (e: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender);
  const wc = () => (view && !view.webContents.isDestroyed() ? view.webContents : null);
  const handle = (channel: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: never[]) => unknown) =>
    ipcMain.handle(channel, (e, ...args) => (fromApp(e) ? fn(e, ...(args as never[])) : undefined));

  handle('browser:show', (e, b: Bounds) => { const w = win(e); if (w) show(w, b); return state(); });
  handle('browser:bounds', (_e, b: Bounds) => { if (view && shown) view.setBounds(round(b)); });
  handle('browser:hide', () => hide());
  handle('browser:state', () => state());
  handle('browser:navigate', (_e, url: string) => { if (allowedPanelUrl(String(url))) void wc()?.loadURL(String(url)).catch(() => {}); });
  handle('browser:back', () => wc()?.navigationHistory.goBack());
  handle('browser:forward', () => wc()?.navigationHistory.goForward());
  handle('browser:reload', () => wc()?.reload());
  handle('browser:stop', () => wc()?.stop());
  handle('browser:focus', () => wc()?.focus());
  handle('browser:devtools', () => wc()?.toggleDevTools());
  handle('browser:zoom', (_e, factor: number) => {
    const c = wc();
    const f = Number(factor);
    if (c && Number.isFinite(f)) { c.setZoomFactor(Math.max(0.25, Math.min(3, f))); publish(); }
  });
  handle('browser:capture', async () => {
    const c = wc();
    if (!c) throw new Error('Browser is not open');
    const img = await c.capturePage();
    fs.mkdirSync(ATTACH_DIR, { recursive: true });
    let host = 'page';
    try { host = new URL(c.getURL()).host.replace(/[^\w.-]+/g, '_') || 'page'; } catch { /* about:blank */ }
    const name = `browser-${host}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
    const file = path.join(ATTACH_DIR, `${randomUUID()}-${name}`);
    fs.writeFileSync(file, img.toPNG());
    return { path: file, name };
  });
}
