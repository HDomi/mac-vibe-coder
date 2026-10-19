import type { WebSocket, WebSocketServer } from 'ws';
import { homedir } from 'node:os';
import { resolvePath } from './fs.js';

type PtyModule = typeof import('node-pty');
let ptyMod: PtyModule | null = null;
async function loadPty(): Promise<PtyModule> {
  if (!ptyMod) ptyMod = await import('node-pty');
  return ptyMod;
}

type ClientMsg = { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number };

const live = new Set<import('node-pty').IPty>();
let shutdownGeneration = 0;
/** Kill every shell we spawned (server shutdown). */
export function killAllPtys() { shutdownGeneration++; for (const t of live) { try { t.kill(); } catch { /* ignore */ } } live.clear(); }

/** Each WebSocket connection on /pty owns one shell. Query: cwd, cols, rows, cmd (optional initial command). */
export function attachPty(wss: WebSocketServer) {
  wss.on('connection', async (ws: WebSocket, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const cwd = resolvePath(url.searchParams.get('cwd') ?? homedir());
    const dimension = (value: string | null, fallback: number, max: number) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(2, Math.floor(n))) : fallback; };
    const cols = dimension(url.searchParams.get('cols'), 80, 1000);
    const rows = dimension(url.searchParams.get('rows'), 24, 500);
    const initial = url.searchParams.get('cmd');
    const shell = process.env.SHELL || '/bin/zsh';
    // Track a close that happens while node-pty is still loading, so the shell is not orphaned.
    let closedEarly = false;
    const onEarlyClose = () => { closedEarly = true; };
    ws.once('close', onEarlyClose);
    const generation = shutdownGeneration;
    const earlyMessages: string[] = [];
    const onEarlyMessage = (raw: unknown) => { if (earlyMessages.length < 32) earlyMessages.push(String(raw)); };
    ws.on('message', onEarlyMessage);
    let term: import('node-pty').IPty;
    try {
      const pty = await loadPty();
      if (closedEarly || generation !== shutdownGeneration) { ws.close(); return; }
      term = pty.spawn(shell, ['-l'], {
        name: 'xterm-256color', cols, rows, cwd,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: process.env.LANG || 'ko_KR.UTF-8' } as Record<string, string>,
      });
    } catch (err) {
      if (ws.readyState === ws.OPEN) ws.send(`\r\n[pty failed to start] ${(err as Error).message}\r\n`);
      ws.close();
      return;
    }
    ws.off('close', onEarlyClose);
    ws.off('message', onEarlyMessage);
    if (closedEarly || ws.readyState !== ws.OPEN) { try { term.kill(); } catch { /* ignore */ } return; }
    live.add(term);
    term.onData((d) => { if (ws.readyState === ws.OPEN) ws.send(d); });
    term.onExit(({ exitCode }) => { live.delete(term); if (ws.readyState === ws.OPEN) { ws.send(`\r\n[process exited ${exitCode}]\r\n`); ws.close(); } });
    const initialTimer = initial ? setTimeout(() => { if (live.has(term) && ws.readyState === ws.OPEN) { try { term.write(initial + '\r'); } catch { /* shell exited */ } } }, 300) : null;
    const onMessage = (raw: unknown) => {
      // A throw here would crash the whole server, so every malformed frame is ignored.
      try {
        let m: ClientMsg | null = null;
        try { m = JSON.parse(String(raw)); } catch { /* raw keystrokes */ }
        if (!m || typeof m !== 'object') { term.write(String(raw)); return; }
        if (m.type === 'input' && typeof m.data === 'string') term.write(m.data);
        else if (m.type === 'resize') {
          const c = Number(m.cols), r = Number(m.rows);
          if (Number.isFinite(c) && Number.isFinite(r)) term.resize(Math.min(1000, Math.max(2, Math.floor(c))), Math.min(500, Math.max(1, Math.floor(r))));
        }
      } catch (err) {
        console.error('[pty] bad message', (err as Error).message);
      }
    };
    ws.on('message', onMessage);
    for (const message of earlyMessages) onMessage(message);
    ws.on('close', () => { if (initialTimer) clearTimeout(initialTimer); live.delete(term); try { term.kill(); } catch { /* already gone */ } });
  });
}
