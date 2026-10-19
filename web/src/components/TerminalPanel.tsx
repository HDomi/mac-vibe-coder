import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

interface Props {
  cwd: string | null;
  /** The panel stays mounted while hidden so the shell survives tab switches. */
  visible: boolean;
}

interface Tab { id: number; title: string; cwd: string; cmd?: string }

let nextId = 1;

function TermView({ tab, visible, onExit }: { tab: Tab; visible: boolean; onExit: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');

  useEffect(() => {
    const el = host.current; if (!el) return;
    const term = new Terminal({
      fontFamily: 'Menlo, "SF Mono", Monaco, monospace', fontSize: 13, lineHeight: 1.2, cursorBlink: true,
      theme: { background: '#0b0d12', foreground: '#e6e8ee', cursor: '#e6e8ee', selectionBackground: '#3b4252' },
      allowProposedApi: true, scrollback: 5000, macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit); term.loadAddon(new WebLinksAddon());
    term.open(el);
    fit.fit();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = new URLSearchParams({ cwd: tab.cwd, cols: String(term.cols), rows: String(term.rows) });
    if (tab.cmd) q.set('cmd', tab.cmd);
    const ws = new WebSocket(`${proto}://${location.host}/pty?${q}`);
    ws.onopen = () => { setStatus('open'); term.focus(); };
    ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data));
    ws.onclose = () => { setStatus('closed'); onExit(); };
    const dataSub = term.onData((d) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: d })); });
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === 0) return;
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    });
    ro.observe(el);
    return () => { ro.disconnect(); dataSub.dispose(); ws.close(); term.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  useEffect(() => { if (visible) host.current?.querySelector('textarea')?.focus(); }, [visible]);

  return (
    <div className={`absolute inset-0 ${visible ? '' : 'invisible'}`}>
      <div ref={host} className="absolute inset-0 p-2" />
      {status !== 'open' && <div className="absolute top-2 right-3 text-[11px] text-zinc-500">{status === 'connecting' ? 'connecting…' : 'exited'}</div>}
    </div>
  );
}

export default function TerminalPanel({ cwd, visible }: Props) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<number | null>(null);

  const open = (cmd?: string, title?: string) => {
    const dir = cwd ?? '~';
    const t: Tab = { id: nextId++, title: title ?? (cmd ? cmd.split(' ')[0] : dir.split('/').pop() || 'shell'), cwd: dir, cmd };
    setTabs((l) => [...l, t]); setActive(t.id);
  };
  const close = (id: number) => {
    setTabs((l) => { const n = l.filter((t) => t.id !== id); if (active === id) setActive(n[n.length - 1]?.id ?? null); return n; });
  };
  useEffect(() => { if (visible && tabs.length === 0) open(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [visible]);

  return (
    <div className="h-full flex flex-col">
      <div className="h-9 shrink-0 flex items-center gap-1 px-2 border-b border-white/10 text-xs overflow-x-auto">
        {tabs.map((t) => (
          <div key={t.id} className={`flex items-center gap-1 rounded-md px-2 py-1 cursor-pointer ${active === t.id ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5'}`} onClick={() => setActive(t.id)}>
            <span className="truncate max-w-[120px]">{t.title}</span>
            <button className="text-zinc-500 hover:text-red-300" onClick={(e) => { e.stopPropagation(); close(t.id); }}>✕</button>
          </div>
        ))}
        <button className="px-2 py-1 text-zinc-400 hover:text-white" onClick={() => open()} title="New shell">＋</button>
        <div className="flex-1" />
        <button className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-zinc-300" onClick={() => open('claude', 'claude')} title="Claude Code TUI">claude</button>
        <button className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-zinc-300" onClick={() => open('codex', 'codex')} title="Codex TUI">codex</button>
      </div>
      <div className="flex-1 relative bg-[#0b0d12]">
        {tabs.map((t) => <TermView key={t.id} tab={t} visible={visible && active === t.id} onExit={() => { /* keep tab to show exit message */ }} />)}
        {tabs.length === 0 && <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-sm">Press ＋ to open a shell</div>}
      </div>
    </div>
  );
}
