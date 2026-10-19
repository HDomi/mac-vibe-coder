import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useSyncExternalStore } from 'react';

/**
 * Terminal tabs live outside React so a shell survives any re-render or unmount of the panel
 * (right-pane tab switch, IDE/agent view switch, project change). A shell ends only when the
 * user closes its tab, the process exits, or the page itself goes away.
 */
export interface TerminalTab {
  id: number;
  title: string;
  cwd: string;
  cmd?: string;
  status: 'connecting' | 'open' | 'closed';
  /** Detached DOM node that xterm renders into; TermView parents it wherever the panel currently is. */
  host: HTMLDivElement;
  term?: Terminal;
  fit?: FitAddon;
  ws?: WebSocket;
}

export interface TerminalState { tabs: TerminalTab[]; active: number | null }

let state: TerminalState = { tabs: [], active: null };
let nextId = 1;
const listeners = new Set<() => void>();

function publish(next: Partial<TerminalState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}
function patch(id: number, changes: Partial<TerminalTab>) {
  publish({ tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...changes } : t)) });
}

export function useTerminals(): TerminalState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}

export function openTerminal(cwd: string, cmd?: string, title?: string): TerminalTab {
  const host = document.createElement('div');
  host.className = 'absolute inset-0 p-2';
  const tab: TerminalTab = { id: nextId++, title: title ?? (cmd ? cmd.split(' ')[0] : cwd.split('/').pop() || 'shell'), cwd, cmd, status: 'connecting', host };
  publish({ tabs: [...state.tabs, tab], active: tab.id });
  return tab;
}

export function activateTerminal(id: number) { publish({ active: id }); }

export function closeTerminal(id: number) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  try { tab.ws?.close(); } catch { /* already closed */ }
  tab.term?.dispose();
  tab.host.remove();
  const tabs = state.tabs.filter((t) => t.id !== id);
  publish({ tabs, active: state.active === id ? tabs[tabs.length - 1]?.id ?? null : state.active });
}

/** First time the host is in the document: create xterm and connect the shell. Later mounts reuse both. */
export function ensureStarted(id: number) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab || tab.term) return;
  const term = new Terminal({
    fontFamily: 'Menlo, "SF Mono", Monaco, monospace', fontSize: 13, lineHeight: 1.2, cursorBlink: true,
    theme: { background: '#0b0d12', foreground: '#e6e8ee', cursor: '#e6e8ee', selectionBackground: '#3b4252' },
    allowProposedApi: true, scrollback: 5000, macOptionIsMeta: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit); term.loadAddon(new WebLinksAddon());
  term.open(tab.host);
  fit.fit();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const q = new URLSearchParams({ cwd: tab.cwd, cols: String(term.cols), rows: String(term.rows) });
  if (tab.cmd) q.set('cmd', tab.cmd);
  const ws = new WebSocket(`${proto}://${location.host}/pty?${q}`);
  ws.onopen = () => { patch(id, { status: 'open' }); term.focus(); };
  ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data));
  ws.onclose = () => patch(id, { status: 'closed' });
  term.onData((d) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: d })); });
  patch(id, { term, fit, ws });
}

/** Refit to the current host size and tell the shell. Safe to call while hidden (zero size is skipped). */
export function fitTerminal(id: number) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab?.term || !tab.fit || tab.host.clientWidth === 0 || tab.host.clientHeight === 0) return;
  tab.fit.fit();
  if (tab.ws?.readyState === WebSocket.OPEN) tab.ws.send(JSON.stringify({ type: 'resize', cols: tab.term.cols, rows: tab.term.rows }));
}
