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

/** Each WebSocket connection on /pty owns one shell. Query: cwd, cols, rows, cmd (optional initial command). */
export function attachPty(wss: WebSocketServer) {
  wss.on('connection', async (ws: WebSocket, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const cwd = resolvePath(url.searchParams.get('cwd') ?? homedir());
    const cols = Number(url.searchParams.get('cols') ?? 80) || 80;
    const rows = Number(url.searchParams.get('rows') ?? 24) || 24;
    const initial = url.searchParams.get('cmd');
    const shell = process.env.SHELL || '/bin/zsh';
    let term: import('node-pty').IPty;
    try {
      const pty = await loadPty();
      term = pty.spawn(shell, ['-l'], {
        name: 'xterm-256color', cols, rows, cwd,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: process.env.LANG || 'ko_KR.UTF-8' } as Record<string, string>,
      });
    } catch (err) {
      ws.send(`\r\n[pty failed to start] ${(err as Error).message}\r\n`);
      ws.close();
      return;
    }
    term.onData((d) => { if (ws.readyState === ws.OPEN) ws.send(d); });
    term.onExit(({ exitCode }) => { if (ws.readyState === ws.OPEN) { ws.send(`\r\n[process exited ${exitCode}]\r\n`); ws.close(); } });
    if (initial) setTimeout(() => term.write(initial + '\r'), 300);
    ws.on('message', (raw) => {
      let m: ClientMsg;
      try { m = JSON.parse(String(raw)); } catch { term.write(String(raw)); return; }
      if (m.type === 'input') term.write(m.data);
      else if (m.type === 'resize') term.resize(Math.max(2, m.cols), Math.max(1, m.rows));
    });
    ws.on('close', () => term.kill());
  });
}
