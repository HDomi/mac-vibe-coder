/**
 * Built-in Browser panel.
 *
 * In the Electron app the panel is a native Chromium view (electron/browserView.cts) reachable over
 * Electron's CDP port (9323); the renderer reports that view's target to `reportNative`. This module
 * then only serves /api/browser/target. When the app runs in an ordinary browser tab there is no
 * native view, and the fallback below drives a headless Chrome over CDP instead:
 *
 * the fallback has its own Chrome, separate from the `debugweb` helper (9222): CDP port
 * MVC_BROWSER_FALLBACK_PORT (9324) and profile MVC_BROWSER_PROFILE (~/.mac-vibe-coder/chrome-profile).
 * Two Chrome processes cannot share a profile, and the user's debugweb windows stay untouched.
 * When nothing listens on that port the server starts Chrome itself, headless, and the panel shows
 * it through Page.startScreencast; mouse and keyboard input are sent back with Input.dispatch*.
 *
 * Agent sessions started by this app learn which page the panel shows from GET /api/browser/target
 * (see `browserAgentHint`), so "check it in the browser" acts on the page the user is looking at.
 * Sessions outside the app never see that hint.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket, { type WebSocketServer } from 'ws';
import { ATTACH_DIR } from './attachments.js';
import { CONFIG_DIR } from './config.js';

/** Fallback (browser-mode) Chrome. Not debugweb's 9222, and not 9323 where the Electron app's own CDP listens. */
export const CDP_PORT = Number(process.env.MVC_BROWSER_FALLBACK_PORT) || 9324;
/** Outside /tmp so logins survive a reboot. */
export const CHROME_PROFILE = process.env.MVC_BROWSER_PROFILE || path.join(CONFIG_DIR, 'chrome-profile');
const CHROME = process.env.MVC_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CALL_TIMEOUT_MS = 15000;
/** MVC_BROWSER_DEBUG=1 logs screencast decisions and frame flow (troubleshooting a blank panel). */
const DEBUG = process.env.MVC_BROWSER_DEBUG === '1';
const debug = (...a: unknown[]) => { if (DEBUG) console.log('[browser]', ...a); };

type Json = Record<string, unknown>;
interface PageTarget { targetId: string; url: string; title: string }
interface Viewport { width: number; height: number; dpr: number }

export interface BrowserState {
  type: 'state';
  status: 'idle' | 'connecting' | 'ready' | 'error';
  error?: string;
  port: number;
  /** Chrome was started headless by this app (no window of its own); otherwise something else already used the port. */
  headless: boolean;
  targets: PageTarget[];
  current: string | null;
  url: string;
  title: string;
  canBack: boolean;
  canForward: boolean;
  loading: boolean;
}

interface Client { send: (msg: object) => void; visible: boolean; viewport: Viewport | null }

/** Page URLs that belong to the user, not Chrome's own UI or DevTools. */
export function isUserPage(t: { type?: string; url?: string }) {
  return t.type === 'page' && !/^(devtools|chrome|chrome-extension|chrome-untrusted|chrome-search):/.test(t.url ?? '');
}

/** What the address bar typed means: a URL as-is, host[:port][/path] gets http(s)://, anything else is a search. */
export function normalizeUrl(input: string): string {
  const s = input.trim();
  if (!s) return 'about:blank';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^(localhost|[\w.-]+):\d+/i.test(s)) return s;
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(s) || /^\d+\.\d+\.\d+\.\d+(:\d+)?(\/|$)/.test(s)) return `http://${s}`;
  if (/^:\d+(\/|$)/.test(s)) return `http://localhost${s}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

async function cdpVersion(): Promise<{ Browser: string; 'User-Agent'?: string; webSocketDebuggerUrl: string } | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? (await r.json()) as { Browser: string; 'User-Agent'?: string; webSocketDebuggerUrl: string } : null;
  } catch { return null; }
}

/** Start Chrome headless on the app's CDP port and profile; detached so it survives server restarts (updates). */
async function launchChrome() {
  if (!existsSync(CHROME)) throw new Error(`Google Chrome not found: ${CHROME}`);
  const child = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${CHROME_PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', 'about:blank',
  ], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  for (let i = 0; i < 30; i++) {
    const v = await cdpVersion();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Chrome did not open CDP port ${CDP_PORT}. Is another Chrome using ${CHROME_PROFILE} without that port?`);
}

export class BrowserBridge {
  private ws: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private nextId = 1;
  private calls = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private targets = new Map<string, PageTarget>();
  private current: { targetId: string; sessionId: string } | null = null;
  private clients = new Set<Client>();
  private headless = false;
  private status: BrowserState['status'] = 'idle';
  private error: string | undefined;
  private nav = { url: '', title: '', canBack: false, canForward: false, loading: false };
  private screencast = false;
  /** Frame waiting for a client to draw it; Chrome sends the next one only after the ack. */
  private unacked: number | null = null;
  private applied: Viewport | null = null;

  /* ── Clients (Browser panels) ─────────────────────────────────────── */

  addClient(c: Client) {
    this.clients.add(c);
    c.send(this.state());
    return () => { this.clients.delete(c); void this.syncScreencast(); };
  }

  state(): BrowserState {
    return {
      type: 'state', status: this.status, error: this.error, port: CDP_PORT, headless: this.headless,
      targets: [...this.targets.values()], current: this.current?.targetId ?? null, ...this.nav,
    };
  }

  private broadcast(msg: object) { for (const c of this.clients) c.send(msg); }
  private publish() { this.broadcast(this.state()); }

  /** The Electron panel's native view, as last reported by the app window. */
  private native: { targetId: string; url: string; title: string; cdpPort: number } | null = null;
  reportNative(v: unknown) {
    const r = v as { targetId?: unknown; url?: unknown; title?: unknown; cdpPort?: unknown } | null;
    this.native = r && typeof r.targetId === 'string' && /^[0-9A-F]{16,64}$/i.test(r.targetId) && Number.isInteger(r.cdpPort)
      ? { targetId: r.targetId, url: String(r.url ?? ''), title: String(r.title ?? ''), cdpPort: Number(r.cdpPort) }
      : null;
  }

  /** What in-app agents should drive: the page on the panel. Null when the panel has none. */
  info() {
    if (this.native) {
      const n = this.native;
      return {
        cdpPort: n.cdpPort, targetId: n.targetId, url: n.url, title: n.title, headless: false, kind: 'electron-view',
        webSocketDebuggerUrl: `ws://127.0.0.1:${n.cdpPort}/devtools/page/${n.targetId}`, browserUrl: `http://127.0.0.1:${n.cdpPort}`,
      };
    }
    if (!this.current || this.status !== 'ready') return null;
    const t = this.targets.get(this.current.targetId);
    return {
      cdpPort: CDP_PORT, targetId: this.current.targetId, url: t?.url ?? this.nav.url, title: t?.title ?? this.nav.title, headless: this.headless,
      webSocketDebuggerUrl: `ws://127.0.0.1:${CDP_PORT}/devtools/page/${this.current.targetId}`,
      browserUrl: `http://127.0.0.1:${CDP_PORT}`,
    };
  }

  /* ── CDP connection ───────────────────────────────────────────────── */

  ensure(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN && this.current) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = this.connect().catch((err) => {
      this.status = 'error'; this.error = (err as Error).message; this.publish();
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private async connect() {
    this.status = 'connecting'; this.error = undefined; this.publish();
    const v = (await cdpVersion()) ?? (await launchChrome());
    // New headless mode reports a normal "Chrome/x" product; only the user agent still says HeadlessChrome.
    this.headless = /Headless/i.test(`${v.Browser} ${v['User-Agent'] ?? ''}`);
    if (this.ws?.readyState !== WebSocket.OPEN) {
      const ws = new WebSocket(v.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
      await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });
      ws.on('message', (raw) => this.onMessage(String(raw)));
      ws.on('close', () => this.onClose(ws));
      ws.on('error', () => {});
      this.ws = ws;
      await this.call('Target.setDiscoverTargets', { discover: true });
      const { targetInfos } = await this.call('Target.getTargets') as { targetInfos: Array<Json & PageTarget & { type: string }> };
      this.targets.clear();
      for (const t of targetInfos) if (isUserPage(t)) this.targets.set(t.targetId, { targetId: t.targetId, url: t.url, title: t.title });
    }
    if (!this.current || !this.targets.has(this.current.targetId)) {
      const last = [...this.targets.keys()].pop();
      await this.attach(last ?? await this.createTarget('about:blank'));
    }
    this.status = 'ready'; this.publish();
  }

  private onClose(ws: WebSocket) {
    if (this.ws !== ws) return;
    this.ws = null; this.current = null; this.targets.clear(); this.screencast = false; this.unacked = null; this.applied = null;
    for (const [, c] of this.calls) { clearTimeout(c.timer); c.reject(new Error('Chrome connection closed')); }
    this.calls.clear();
    this.status = 'idle'; this.error = 'Chrome closed'; this.publish();
  }

  private call(method: string, params: Json = {}, sessionId?: string): Promise<Json> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Chrome is not connected'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.calls.delete(id); reject(new Error(`${method} timed out`)); }, CALL_TIMEOUT_MS);
      this.calls.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  private page(method: string, params: Json = {}) {
    if (!this.current) return Promise.reject(new Error('No page open'));
    return this.call(method, params, this.current.sessionId);
  }

  private onMessage(raw: string) {
    let m: { id?: number; result?: Json; error?: { message: string }; method?: string; params?: Json; sessionId?: string };
    try { m = JSON.parse(raw); } catch { return; }
    if (m.id !== undefined) {
      const c = this.calls.get(m.id);
      if (!c) return;
      this.calls.delete(m.id); clearTimeout(c.timer);
      if (m.error) c.reject(new Error(m.error.message)); else c.resolve(m.result ?? {});
      return;
    }
    const p = m.params ?? {};
    const onPage = !!this.current && m.sessionId === this.current.sessionId;
    switch (m.method) {
      case 'Target.targetCreated':
      case 'Target.targetInfoChanged': {
        const t = p.targetInfo as Json & PageTarget & { type: string };
        if (isUserPage(t)) this.targets.set(t.targetId, { targetId: t.targetId, url: t.url, title: t.title });
        else this.targets.delete(t.targetId);
        if (t.targetId === this.current?.targetId) { this.nav.url = t.url; this.nav.title = t.title; }
        this.publish();
        return;
      }
      case 'Target.targetDestroyed':
      case 'Target.detachedFromTarget': {
        const id = String(p.targetId ?? '');
        if (m.method === 'Target.targetDestroyed') this.targets.delete(id);
        const lost = m.method === 'Target.targetDestroyed' ? id === this.current?.targetId : p.sessionId === this.current?.sessionId;
        if (lost) {
          this.current = null; this.screencast = false; this.unacked = null; this.applied = null;
          // Keep the panel on some page: another open tab, or a fresh blank one.
          const next = [...this.targets.keys()].pop();
          (next ? this.attach(next) : this.createTarget('about:blank').then((tid) => this.attach(tid))).catch(() => {}).finally(() => this.publish());
        }
        this.publish();
        return;
      }
      case 'Page.screencastFrame':
        if (!onPage) return;
        this.unacked = Number(p.sessionId);
        debug('frame', p.sessionId, JSON.stringify(p.metadata), 'clients', this.clients.size, 'visible', [...this.clients].filter((c) => c.visible).length);
        if (![...this.clients].some((c) => c.visible)) { this.ack(); return; }
        // Frame metadata is in CSS pixels on some frames and device pixels on others (after a renderer
        // swap). For a headless page we set the CSS viewport ourselves, so give the client that size.
        this.broadcast({ type: 'frame', data: p.data, metadata: p.metadata, css: this.headless && this.applied ? { width: this.applied.width, height: this.applied.height } : null });
        return;
      case 'Page.frameStartedLoading': if (onPage) { this.nav.loading = true; this.publish(); } return;
      case 'Page.loadEventFired': case 'Page.frameStoppedLoading': if (onPage) { this.nav.loading = false; void this.refreshNav(); this.resize(); } return;
      case 'Page.frameNavigated': if (onPage && !(p.frame as Json)?.parentId) { void this.refreshNav(); this.resize(); } return;
      case 'Page.navigatedWithinDocument': if (onPage) void this.refreshNav(); return;
    }
  }

  /**
   * A cross-site navigation swaps the renderer, and the first frames come at the window size
   * instead of the panel size; a static page then never repaints. Re-apply the size and restart
   * the screencast so the panel gets a correct frame (and clicks map to the right spot).
   */
  private resize() {
    if (!this.headless) return;
    this.applied = null;
    void this.syncScreencast();
  }

  private ack() {
    if (this.unacked === null || !this.current) return;
    const sessionId = this.unacked; this.unacked = null;
    this.page('Page.screencastFrameAck', { sessionId }).catch(() => {});
  }

  private async createTarget(url: string): Promise<string> {
    const { targetId } = await this.call('Target.createTarget', { url }) as { targetId: string };
    return targetId;
  }

  private async attach(targetId: string) {
    if (this.current?.targetId === targetId) return;
    const prev = this.current;
    this.current = null; this.screencast = false; this.unacked = null; this.applied = null;
    if (prev) await this.call('Target.detachFromTarget', { sessionId: prev.sessionId }).catch(() => {});
    const { sessionId } = await this.call('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string };
    this.current = { targetId, sessionId };
    await this.page('Page.enable');
    // Bring it to the front so a headful (debugweb) Chrome paints it and the screencast has frames.
    await this.page('Page.bringToFront').catch(() => {});
    await this.refreshNav();
    await this.syncScreencast();
  }

  private async refreshNav() {
    try {
      const h = await this.page('Page.getNavigationHistory') as { currentIndex: number; entries: Array<{ url: string; title: string }> };
      const e = h.entries[h.currentIndex];
      this.nav = { ...this.nav, url: e?.url ?? '', title: e?.title ?? '', canBack: h.currentIndex > 0, canForward: h.currentIndex < h.entries.length - 1 };
    } catch { /* page went away */ }
    this.publish();
  }

  private syncing: Promise<void> = Promise.resolve();
  /**
   * Screencast only while a panel is visible; headless pages are sized to the panel.
   * Serialized: hello, resize and attach all call this, and an interleaved stop after a start
   * would leave the panel without frames.
   */
  private syncScreencast(): Promise<void> {
    const run = this.syncing.then(() => this.doSyncScreencast());
    this.syncing = run.catch(() => {});
    return run;
  }

  private async doSyncScreencast() {
    if (!this.current) return;
    const visible = [...this.clients].filter((c) => c.visible);
    const vp = visible.find((c) => c.viewport)?.viewport ?? null;
    debug('sync', { visible: visible.length, vp, applied: this.applied, screencast: this.screencast, headless: this.headless });
    try {
      if (!visible.length) {
        if (this.screencast) { this.screencast = false; await this.page('Page.stopScreencast'); }
        return;
      }
      if (vp && this.headless && (this.applied?.width !== vp.width || this.applied?.height !== vp.height || this.applied?.dpr !== vp.dpr)) {
        await this.page('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: false });
        this.applied = vp;
        if (this.screencast) { this.screencast = false; await this.page('Page.stopScreencast'); }
      }
      if (!this.screencast) {
        this.screencast = true;
        const scale = vp?.dpr ?? 2;
        await this.page('Page.startScreencast', { format: 'jpeg', quality: 75, maxWidth: Math.round((vp?.width ?? 1280) * scale), maxHeight: Math.round((vp?.height ?? 800) * scale), everyNthFrame: 1 });
      }
    } catch (err) { debug('sync failed', (err as Error).message); this.screencast = false; }
  }

  /* ── Panel commands ───────────────────────────────────────────────── */

  async command(c: Client, msg: Json): Promise<object | void> {
    switch (msg.type) {
      case 'hello':
        c.visible = !!msg.visible; c.viewport = (msg.viewport as Viewport) ?? null;
        if (c.visible) { await this.ensure(); await this.syncScreencast(); }
        return this.state();
      case 'visible':
        c.visible = !!msg.visible;
        if (c.visible) await this.ensure();
        await this.syncScreencast();
        return;
      case 'viewport': c.viewport = msg.viewport as Viewport; await this.syncScreencast(); return;
      case 'ack': this.ack(); return;
      case 'retry': await this.ensure(); await this.syncScreencast(); return this.state();
    }
    await this.ensure();
    switch (msg.type) {
      case 'navigate': await this.page('Page.navigate', { url: normalizeUrl(String(msg.url ?? '')) }); return;
      case 'reload': await this.page('Page.reload', { ignoreCache: !!msg.hard }); return;
      case 'stop': await this.page('Page.stopLoading'); return;
      case 'back': case 'forward': {
        const h = await this.page('Page.getNavigationHistory') as { currentIndex: number; entries: Array<{ id: number }> };
        const e = h.entries[h.currentIndex + (msg.type === 'back' ? -1 : 1)];
        if (e) await this.page('Page.navigateToHistoryEntry', { entryId: e.id });
        return;
      }
      case 'select': await this.attach(String(msg.targetId)); this.publish(); return;
      case 'newTab': await this.attach(await this.createTarget(msg.url ? normalizeUrl(String(msg.url)) : 'about:blank')); this.publish(); return;
      case 'closeTab': await this.call('Target.closeTarget', { targetId: String(msg.targetId ?? this.current?.targetId) }); return;
      case 'mouse': await this.page('Input.dispatchMouseEvent', msg.event as Json); return;
      case 'key': await this.page('Input.dispatchKeyEvent', msg.event as Json); return;
      case 'insertText': await this.page('Input.insertText', { text: String(msg.text ?? '') }); return;
      case 'copy': {
        const r = await this.page('Runtime.evaluate', { expression: 'String(getSelection?.() ?? "")', returnByValue: true }) as { result?: { value?: string } };
        return { type: 'copied', text: r.result?.value ?? '' };
      }
      case 'capture': return { type: 'captured', ...(await this.capture()) };
    }
  }

  /** PNG of what the panel shows, saved with the chat attachments. */
  async capture() {
    const { data } = await this.page('Page.captureScreenshot', { format: 'png' }) as { data: string };
    await fs.mkdir(ATTACH_DIR, { recursive: true });
    let host = 'page';
    try { host = new URL(this.nav.url).host.replace(/[^\w.-]+/g, '_') || 'page'; } catch { /* about:blank */ }
    const name = `browser-${host}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
    const file = path.join(ATTACH_DIR, `${randomUUID()}-${name}`);
    await fs.writeFile(file, Buffer.from(data, 'base64'));
    return { path: file, name };
  }

  /** On app quit: close the Chrome we started (headless); a visible Chrome someone else put on the port is left alone. */
  async shutdown(quit: boolean) {
    try { if (quit && this.headless && this.ws?.readyState === WebSocket.OPEN) await this.call('Browser.close'); } catch { /* already gone */ }
    this.ws?.close();
  }
}

export const browser = new BrowserBridge();

export function attachBrowser(wss: WebSocketServer) {
  wss.on('connection', (ws) => {
    const client: Client = {
      send: (msg) => { try { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); } catch { /* closed */ } },
      visible: false, viewport: null,
    };
    const off = browser.addClient(client);
    ws.on('message', async (raw) => {
      let msg: Json;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
      try {
        const reply = await browser.command(client, msg);
        if (reply) client.send({ ...reply, requestId: msg.requestId });
      } catch (err) {
        client.send({ type: 'error', requestId: msg.requestId, command: msg.type, message: (err as Error).message ?? String(err) });
      }
    });
    ws.on('close', off);
  });
}

/** Appended to in-app agent sessions only, so browser checks target the panel instead of a new window. */
export function browserAgentHint(appPort: number) {
  const info = `http://127.0.0.1:${appPort}/api/browser/target`;
  return [
    '# Mac Vibe Coder browser panel',
    'This session runs inside Mac Vibe Coder, which has a built-in Browser panel (Chrome over the Chrome DevTools Protocol). The user watches that page live in the app.',
    'The panel has its own CDP port (the cdpPort field below, 9323 in the desktop app). It is not the usual 9222 debugweb Chrome: do not use port 9222 or run debugweb for checks the user asks for in this app.',
    `When the user asks you to check, measure or verify something in the browser (for example "실측", "CDP 검토", "브라우저에서 확인"), work on the panel's page instead of starting a browser or opening a new window: run \`curl -s ${info}\` to get {targetId, url, webSocketDebuggerUrl, browserUrl, cdpPort}, then connect to webSocketDebuggerUrl (or attach to targetId through the browser endpoint at browserUrl/json/version) and act on that page. Navigating that page changes what the user sees, which is intended. The panel has its own Chrome profile, so the user may need to log in there once.`,
    'That CDP port also lists the Mac Vibe Coder window itself; never attach to or act on any target other than targetId. Do not close that page and do not kill the browser. If the endpoint answers 404, ask the user to open the Browser tab in the right panel. Only drive the browser when the user asks for a browser check.',
  ].join('\n');
}
