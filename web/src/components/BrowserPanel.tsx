import { useCallback, useEffect, useRef, useState } from 'react';
import type { Attachment } from '../lib/agent';
import { t, useLang } from '../lib/i18n';
import { keyEventFor, mouseButton, mouseModifiers, normalizeAddress } from '../lib/browserInput';
import type { NativeBrowser, NativeBrowserState, PickedElement } from '../lib/vibe';
import { fencedTerminalText } from '../lib/textSearch';
import Icon from './Icon';

interface Props {
  visible: boolean;
  /** Screenshot of the page, ready to attach to the chat. */
  onCapture: (a: Attachment) => void;
}

interface PageTarget { targetId: string; url: string; title: string }
interface State {
  status: 'idle' | 'connecting' | 'ready' | 'error'; error?: string; port: number; headless: boolean;
  targets: PageTarget[]; current: string | null; url: string; title: string; canBack: boolean; canForward: boolean; loading: boolean;
}
interface FrameMeta { deviceWidth: number; deviceHeight: number }

/**
 * Browser tab: shows a Chrome page over CDP (screencast frames from the server) and sends mouse and
 * keyboard input back. Keys go through a hidden textarea so IME (Korean) composition works: composed
 * text is inserted with Input.insertText when the composition ends.
 */
/** Electron: native Chromium view over the panel. Plain browser tab: CDP screencast of a headless Chrome. */
export default function BrowserPanel(props: Props) {
  return window.vibe?.browser ? <NativeBrowserPanel {...props} native={window.vibe.browser} /> : <ScreencastBrowserPanel {...props} />;
}

function ScreencastBrowserPanel({ visible, onCapture }: Props) {
  useLang();
  const [state, setState] = useState<State | null>(null);
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [composing, setComposing] = useState('');
  const [hasFrame, setHasFrame] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const keys = useRef<HTMLTextAreaElement>(null);
  const meta = useRef<FrameMeta | null>(null);
  const visibleRef = useRef(visible);
  const started = useRef(false);
  const pending = useRef(new Map<string, (m: Record<string, unknown>) => void>());

  const send = useCallback((msg: Record<string, unknown>) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
  }, []);
  useEffect(() => {
    const h = (ev: Event) => { const url = (ev as CustomEvent<{ url: string }>).detail?.url; if (url) setTimeout(() => send({ type: 'navigate', url }), 600); };
    window.addEventListener('vibe:browser-open', h);
    return () => window.removeEventListener('vibe:browser-open', h);
  }, [send]);
  const request = useCallback((msg: Record<string, unknown>) => new Promise<Record<string, unknown>>((resolve) => {
    const requestId = crypto.randomUUID();
    pending.current.set(requestId, resolve);
    send({ ...msg, requestId });
    setTimeout(() => { if (pending.current.delete(requestId)) resolve({ type: 'error', message: t('browser.timeout') }); }, 20000);
  }), [send]);

  const viewport = () => {
    const el = area.current;
    return el ? { width: Math.max(200, Math.round(el.clientWidth)), height: Math.max(150, Math.round(el.clientHeight)), dpr: window.devicePixelRatio || 1 } : null;
  };

  // Connect on first show; keep the socket while hidden (screencast pauses) so the page and logins stay.
  useEffect(() => {
    visibleRef.current = visible;
    if (!visible && !started.current) return;
    started.current = true;
    if (ws.current) { send({ type: 'visible', visible }); return; }
    let closed = false; let retry = 0; let timer: number | undefined;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const sock = new WebSocket(`${proto}://${location.host}/browser`);
      ws.current = sock;
      sock.onopen = () => { retry = 0; sock.send(JSON.stringify({ type: 'hello', visible: visibleRef.current, viewport: viewport() })); };
      sock.onmessage = (ev) => {
        let m: Record<string, unknown>;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.requestId && pending.current.has(String(m.requestId))) { pending.current.get(String(m.requestId))!(m); pending.current.delete(String(m.requestId)); return; }
        if (m.type === 'state') setState(m as unknown as State);
        else if (m.type === 'frame') {
          const css = m.css as { width: number; height: number } | null;
          meta.current = css ? { deviceWidth: css.width, deviceHeight: css.height } : m.metadata as FrameMeta;
          const el = img.current;
          if (el) { el.onload = () => send({ type: 'ack' }); el.src = `data:image/jpeg;base64,${m.data}`; setHasFrame(true); } else send({ type: 'ack' });
        } else if (m.type === 'error') setNote(String(m.message));
      };
      sock.onclose = () => {
        if (ws.current === sock) ws.current = null;
        if (closed) return;
        timer = window.setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
      };
    };
    connect();
    return () => { closed = true; if (timer) clearTimeout(timer); ws.current?.close(); ws.current = null; started.current = false; };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // The headless page is sized to this panel, so frames map 1:1 to the view.
  useEffect(() => {
    const el = area.current; if (!el) return;
    let timer: number | undefined;
    const ro = new ResizeObserver(() => { clearTimeout(timer); timer = window.setTimeout(() => send({ type: 'viewport', viewport: viewport() }), 150); });
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(timer); };
  }, [send]);

  useEffect(() => { if (!editing) setAddress(state?.url === 'about:blank' ? '' : state?.url ?? ''); }, [state?.url, editing]);
  useEffect(() => { if (!note) return; const timer = setTimeout(() => setNote(null), 3500); return () => clearTimeout(timer); }, [note]);
  useEffect(() => { setHasFrame(false); }, [state?.current]);

  /** Client point -> page CSS pixel, accounting for letterboxing when the frame does not fill the view. */
  const toPage = (clientX: number, clientY: number) => {
    const el = img.current, m = meta.current;
    if (!el || !m) return null;
    const r = el.getBoundingClientRect();
    const scale = Math.min(r.width / m.deviceWidth, r.height / m.deviceHeight);
    const w = m.deviceWidth * scale, h = m.deviceHeight * scale;
    const x = (clientX - r.left - (r.width - w) / 2) / scale, y = (clientY - r.top - (r.height - h) / 2) / scale;
    if (x < 0 || y < 0 || x > m.deviceWidth || y > m.deviceHeight) return null;
    return { x, y };
  };
  const moveFrame = useRef<number | null>(null);
  const mouse = (type: 'mousePressed' | 'mouseReleased' | 'mouseMoved', e: React.MouseEvent) => {
    const p = toPage(e.clientX, e.clientY);
    if (!p) return;
    const event = { type, x: p.x, y: p.y, modifiers: mouseModifiers(e), button: type === 'mouseMoved' ? (e.buttons & 1 ? 'left' : 'none') : mouseButton(e.button), buttons: e.buttons, clickCount: type === 'mouseMoved' ? 0 : Math.max(1, e.detail) };
    if (type !== 'mouseMoved') { send({ type: 'mouse', event }); return; }
    // Coalesce moves to one per frame.
    if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current);
    moveFrame.current = requestAnimationFrame(() => { moveFrame.current = null; send({ type: 'mouse', event }); });
  };
  useEffect(() => {
    const el = area.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const p = toPage(e.clientX, e.clientY);
      if (!p) return;
      e.preventDefault();
      send({ type: 'mouse', event: { type: 'mouseWheel', x: p.x, y: p.y, deltaX: e.deltaX, deltaY: e.deltaY, modifiers: mouseModifiers(e) } });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [send]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.key === 'Process' || e.keyCode === 229) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod) {
      const k = e.key.toLowerCase();
      if (e.metaKey && k === 'v') return; // paste event below inserts the text
      if (e.metaKey && k === 'c') { e.preventDefault(); void request({ type: 'copy' }).then((r) => { if (typeof r.text === 'string' && r.text) void navigator.clipboard.writeText(r.text); }); return; }
      if (e.metaKey && k === 'r') { e.preventDefault(); send({ type: 'reload', hard: e.shiftKey }); return; }
      if (e.metaKey && k === 'l') { e.preventDefault(); document.getElementById('browser-address')?.focus(); return; }
      if (e.metaKey && (k === '[' || k === ']')) { e.preventDefault(); send({ type: k === '[' ? 'back' : 'forward' }); return; }
      const command = e.metaKey ? ({ a: 'selectAll', z: e.shiftKey ? 'redo' : 'undo', x: 'cut' } as Record<string, string>)[k] : undefined;
      if (!command) return; // let app shortcuts (⌘K, ⌘J, …) through
      e.preventDefault();
      if (command === 'cut') void request({ type: 'copy' }).then((r) => { if (typeof r.text === 'string' && r.text) void navigator.clipboard.writeText(r.text); });
      send({ type: 'key', event: { ...keyEventFor(e.nativeEvent, 'keyDown'), commands: [command] } });
      send({ type: 'key', event: keyEventFor(e.nativeEvent, 'keyUp') });
      return;
    }
    e.preventDefault();
    send({ type: 'key', event: keyEventFor(e.nativeEvent, 'keyDown') });
  };
  const onKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.key === 'Process' || e.metaKey || e.ctrlKey) return;
    send({ type: 'key', event: keyEventFor(e.nativeEvent, 'keyUp') });
  };

  const capture = async () => {
    const r = await request({ type: 'capture' });
    if (r.type !== 'captured') { setNote(String(r.message ?? t('browser.captureFailed'))); return; }
    onCapture({ path: String(r.path), name: String(r.name), kind: 'image' });
    setNote(t('browser.captured'));
  };

  const ready = state?.status === 'ready';
  const tabs = state?.targets ?? [];
  const btn = 'w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/10 text-zinc-300 disabled:opacity-30 disabled:hover:bg-transparent';

  return (
    <div className="h-full flex flex-col" data-own-find>
      <div data-companion-floor="browser-toolbar" data-companion-edge="bottom" className="h-10 shrink-0 flex items-center gap-1 px-2 border-b border-white/10 text-xs">
        <button className={btn} disabled={!state?.canBack} onClick={() => send({ type: 'back' })} title={t('browser.back')}><Icon name="back" /></button>
        <button className={btn} disabled={!state?.canForward} onClick={() => send({ type: 'forward' })} title={t('browser.forward')}><Icon name="forward" /></button>
        <button className={btn} disabled={!ready} onClick={() => send({ type: state?.loading ? 'stop' : 'reload' })} title={state?.loading ? t('browser.stop') : t('browser.reload')}><Icon name={state?.loading ? 'close' : 'reload'} /></button>
        <form className="flex-1 min-w-0" onSubmit={(e) => { e.preventDefault(); send({ type: 'navigate', url: address }); setEditing(false); keys.current?.focus(); }}>
          <input id="browser-address" value={address} onChange={(e) => { setAddress(e.target.value); setEditing(true); }} onFocus={(e) => { setEditing(true); e.target.select(); }} onBlur={() => setEditing(false)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setEditing(false); (e.target as HTMLInputElement).blur(); } }}
            placeholder={t('browser.addressPlaceholder')} aria-label={t('browser.addressPlaceholder')} spellCheck={false}
            className="w-full rounded-md bg-white/5 border border-white/10 focus:border-sky-400/40 px-2.5 py-1.5 text-[12px] font-mono outline-none" />
        </form>
        {tabs.length > 1 && (
          <select value={state?.current ?? ''} onChange={(e) => send({ type: 'select', targetId: e.target.value })} title={t('browser.tabs')}
            className="max-w-28 bg-white/5 rounded-md px-1 py-1 outline-none text-[11px]">
            {tabs.map((p) => <option key={p.targetId} value={p.targetId}>{p.title || p.url || 'about:blank'}</option>)}
          </select>
        )}
        <button className={btn} disabled={!ready} onClick={() => send({ type: 'newTab' })} title={t('browser.newTab')}><Icon name="plus" /></button>
        <button className="h-7 px-2 flex items-center gap-1.5 rounded-md bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 disabled:opacity-40 whitespace-nowrap" disabled={!ready} onClick={() => void capture()} title={t('browser.captureHint')}><Icon name="camera" size={14} />{t('browser.capture')}</button>
      </div>
      <div ref={area} className="relative flex-1 min-h-0 bg-white overflow-hidden"
        onMouseDown={(e) => { e.preventDefault(); keys.current?.focus(); mouse('mousePressed', e); }}
        onMouseUp={(e) => mouse('mouseReleased', e)} onMouseMove={(e) => mouse('mouseMoved', e)} onContextMenu={(e) => e.preventDefault()}>
        <img ref={img} alt="" draggable={false} className={`absolute inset-0 w-full h-full object-contain select-none ${hasFrame ? '' : 'invisible'}`} />
        <textarea ref={keys} aria-label={t('browser.keyboard')} className="absolute left-0 bottom-0 w-px h-px opacity-0 resize-none" tabIndex={-1}
          onKeyDown={onKeyDown} onKeyUp={onKeyUp}
          onCompositionUpdate={(e) => setComposing(e.data)}
          onCompositionEnd={(e) => { setComposing(''); if (e.data) send({ type: 'insertText', text: e.data }); (e.target as HTMLTextAreaElement).value = ''; }}
          onInput={(e) => { const el = e.target as HTMLTextAreaElement; if (!(e.nativeEvent as InputEvent).isComposing && !composing) el.value = ''; }}
          onPaste={(e) => { e.preventDefault(); const text = e.clipboardData.getData('text/plain'); if (text) send({ type: 'insertText', text }); }} />
        {composing && <div className="absolute left-3 bottom-3 rounded-md bg-black/80 px-2 py-1 text-xs text-white pointer-events-none">{composing}</div>}
        {!hasFrame && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0b0d12] text-sm text-zinc-500 text-center px-6">
            {state?.status === 'error' ? <>
              <div className="text-red-300">{state.error}</div>
              <button className="rounded bg-white/10 hover:bg-white/15 px-3 py-1.5 text-xs text-zinc-200" onMouseDown={(e) => e.stopPropagation()} onClick={() => send({ type: 'retry' })}>{t('browser.retry')}</button>
            </> : <div className="animate-pulse">{state?.status === 'ready' ? t('browser.waitingFrame') : t('browser.connecting', { port: state?.port ?? 9324 })}</div>}
          </div>
        )}
      </div>
      <div className="h-6 shrink-0 flex items-center gap-2 px-3 text-[10px] text-zinc-600 border-t border-white/5">
        <span className={`w-1.5 h-1.5 rounded-full ${ready ? 'bg-emerald-400' : state?.status === 'error' ? 'bg-red-400' : 'bg-zinc-600'}`} />
        <span>CDP :{state?.port ?? 9324} · {state?.headless ? t('browser.headless') : t('browser.external')}</span>
        {note && <span className="ml-auto text-amber-300 truncate" title={note}>{note}</span>}
      </div>
    </div>
  );
}

/** Text for the composer about a picked element: where it is in the page and in the code, and how it looks. */
function describeElement({ info }: PickedElement): string {
  const styles = Object.entries(info.styles).map(([k, v]) => `${k}: ${v}`).join('; ');
  const lines = [
    t('browser.pickedIntro', { url: info.url }),
    `- selector: \`${info.selector}\``,
    info.source ? `- ${t('browser.pickedSource')}: ${info.source}` : null,
    `- ${t('browser.pickedSize')}: ${Math.round(info.rect.width)}×${Math.round(info.rect.height)}${info.text ? ` · "${info.text.replace(/\s+/g, ' ').slice(0, 80)}"` : ''}`,
    styles ? `- ${t('browser.pickedStyles')}: ${styles}` : null,
  ].filter(Boolean).join('\n');
  return `${lines}\n${fencedTerminalText(info.html)}\n`;
}

const ZOOMS = [0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];
const nearestZoom = (z: number) => ZOOMS.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a), 1);

/**
 * The native view is a separate layer painted above the page, so this component only keeps it
 * glued to the placeholder: it follows the placeholder's rect, and hides the view whenever the
 * panel is hidden or something of the app (menu, dialog, lightbox) covers the panel.
 */
function NativeBrowserPanel({ visible, onCapture, native }: Props & { native: NativeBrowser }) {
  useLang();
  const [state, setState] = useState<NativeBrowserState | null>(null);
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const place = useRef<HTMLDivElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const shownRef = useRef(false);
  const lastRect = useRef('');

  useEffect(() => native.onState(setState), [native]);
  // Run panel "open URL": the app switches to this tab first; navigate once the view is placed.
  useEffect(() => {
    const h = (ev: Event) => { const url = (ev as CustomEvent<{ url: string }>).detail?.url; if (url) setTimeout(() => void native.navigate(url), 250); };
    window.addEventListener('vibe:browser-open', h);
    return () => window.removeEventListener('vibe:browser-open', h);
  }, [native]);
  useEffect(() => native.onShortcut((k) => {
    if (k.key === 'l') { addressInput.current?.focus(); addressInput.current?.select(); return; }
    // App shortcuts typed while the page has focus: replay them on the app window.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k.key, metaKey: true, shiftKey: k.shift, altKey: k.alt, bubbles: true }));
  }), [native]);
  useEffect(() => { if (!editing) setAddress(state?.url === 'about:blank' ? '' : state?.url ?? ''); }, [state?.url, editing]);
  useEffect(() => { if (!note) return; const timer = setTimeout(() => setNote(null), 3500); return () => clearTimeout(timer); }, [note]);

  useEffect(() => {
    const el = place.current;
    if (!el) return;
    const sync = () => {
      const r = el.getBoundingClientRect();
      const covered = (() => {
        if (r.width < 2 || r.height < 2) return true;
        for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.05, 0.5, 0.95]) {
          const hit = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
          if (!hit || !el.contains(hit)) return true;
        }
        return false;
      })();
      const want = visible && !covered;
      const bounds = { x: r.left, y: r.top, width: r.width, height: r.height };
      const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
      if (want && !shownRef.current) { shownRef.current = true; lastRect.current = key; void native.show(bounds).then(setState); }
      else if (!want && shownRef.current) { shownRef.current = false; void native.hide(); }
      else if (want && key !== lastRect.current) { lastRect.current = key; void native.setBounds(bounds); }
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener('resize', sync);
    // Position changes (panel animations, overlays opening) do not always resize the placeholder.
    // A hidden panel has nothing to track, so it skips the 150ms layout probe.
    const timer = visible ? setInterval(sync, 150) : undefined;
    return () => { ro.disconnect(); window.removeEventListener('resize', sync); clearInterval(timer); shownRef.current = false; void native.hide(); };
  }, [visible, native]);

  const [picking, setPicking] = useState(false);
  // Pick an element: its cropped screenshot is attached and a description goes into the message box.
  const pick = async () => {
    if (!native.pick || picking) return;
    setPicking(true); setNote(t('browser.pickHint'));
    try {
      const r = await native.pick();
      if (!r) { setNote(null); return; }
      if (r.shot) onCapture({ path: r.shot.path, name: r.shot.name, kind: 'image' });
      const detail = { text: describeElement(r), handled: false };
      window.dispatchEvent(new CustomEvent('vibe:insert-composer', { detail }));
      setNote(detail.handled ? t('browser.picked') : t('browser.pickedNoComposer'));
    } catch (e) { setNote((e as Error).message); } finally { setPicking(false); }
  };
  const capture = async () => {
    try { const r = await native.capture(); onCapture({ path: r.path, name: r.name, kind: 'image' }); setNote(t('browser.captured')); }
    catch (e) { setNote((e as Error).message || t('browser.captureFailed')); }
  };
  const btn = 'w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/10 text-zinc-300 disabled:opacity-30 disabled:hover:bg-transparent';

  return (
    <div className="h-full flex flex-col" data-own-find>
      <div data-companion-floor="browser-toolbar" data-companion-edge="bottom" className="h-10 shrink-0 flex items-center gap-1 px-2 border-b border-white/10 text-xs">
        <button className={btn} disabled={!state?.canBack} onClick={() => void native.back()} title={t('browser.back')}><Icon name="back" /></button>
        <button className={btn} disabled={!state?.canForward} onClick={() => void native.forward()} title={t('browser.forward')}><Icon name="forward" /></button>
        <button className={btn} onClick={() => void (state?.loading ? native.stop() : native.reload())} title={state?.loading ? t('browser.stop') : t('browser.reload')}><Icon name={state?.loading ? 'close' : 'reload'} /></button>
        <form className="flex-1 min-w-0" onSubmit={(e) => { e.preventDefault(); void native.navigate(normalizeAddress(address)); setEditing(false); addressInput.current?.blur(); void native.focus(); }}>
          <input ref={addressInput} id="browser-address" value={address} onChange={(e) => { setAddress(e.target.value); setEditing(true); }} onFocus={(e) => { setEditing(true); e.target.select(); }} onBlur={() => setEditing(false)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setEditing(false); (e.target as HTMLInputElement).blur(); } }}
            placeholder={t('browser.addressPlaceholder')} aria-label={t('browser.addressPlaceholder')} spellCheck={false}
            className="w-full rounded-md bg-white/5 border border-white/10 focus:border-sky-400/40 px-2.5 py-1.5 text-[12px] font-mono outline-none" />
        </form>
        <select value={String(nearestZoom(state?.zoom ?? 1))} onChange={(e) => void native.zoom(Number(e.target.value))}
          title={t('browser.zoomHint', { width: Math.round((place.current?.clientWidth ?? 0) / (state?.zoom ?? 1)) })}
          className="bg-white/5 rounded-md px-1 py-1 outline-none text-[11px] tabular-nums">
          {ZOOMS.map((z) => <option key={z} value={String(z)}>{Math.round(z * 100)}%</option>)}
        </select>
        <button className={btn} onClick={() => void native.devtools()} title={t('browser.devtools')}><Icon name="devtools" /></button>
        {native.pick && <button className={`${btn} ${picking ? 'bg-sky-500/25 text-sky-200' : ''}`} onClick={() => void pick()} title={t('browser.pick')}><Icon name="target" /></button>}
        <button className="h-7 px-2 flex items-center gap-1.5 rounded-md bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 whitespace-nowrap" onClick={() => void capture()} title={t('browser.captureHint')}><Icon name="camera" size={14} />{t('browser.capture')}</button>
      </div>
      {/* The native view is laid over this box; the box itself only shows while the view is hidden. */}
      <div ref={place} className="relative flex-1 min-h-0 bg-white" />
      <div className="h-6 shrink-0 flex items-center gap-2 px-3 text-[10px] text-zinc-600 border-t border-white/5">
        <span className={`w-1.5 h-1.5 rounded-full ${state ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
        <span>{t('browser.native')}</span>
        {note && <span className="ml-auto text-amber-300 truncate" title={note}>{note}</span>}
      </div>
    </div>
  );
}
