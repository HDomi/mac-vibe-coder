import { serve, type ServerType } from '@hono/node-server';
import { createApp } from './app.js';
import { HOST, PORT } from './config.js';
import { syncLoginShellPath } from './shell.js';
import { WebSocketServer } from 'ws';
import { attachWebSocket, SessionRegistry } from './sessions.js';
import { attachPty, killAllPtys } from './pty.js';

export function startServer(port = PORT): Promise<ServerType> {
  return new Promise(async (resolve, reject) => {
    await syncLoginShellPath();
    const registry = new SessionRegistry();
    const app = createApp(registry);
    const server = serve({ fetch: app.fetch, hostname: HOST, port }, (info) => {
      console.log(`[mac-vibe-coder] http://${info.address}:${info.port}`);
      resolve(server);
    });
    const http = server as import('node:http').Server;
    const wss = new WebSocketServer({ noServer: true });
    const ptyWss = new WebSocketServer({ noServer: true });
    attachWebSocket(wss, registry);
    attachPty(ptyWss);
    let shuttingDown = false;
    const shutdown = (signal: NodeJS.Signals) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[mac-vibe-coder] ${signal}: closing sessions`);
      const timer = setTimeout(() => process.exit(0), 4000);
      killAllPtys();
      registry.closeAll().finally(() => { clearTimeout(timer); process.exit(0); });
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    http.on('upgrade', (req, socket, head) => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      const target = pathname === '/ws' ? wss : pathname === '/pty' ? ptyWss : null;
      if (!target) { socket.destroy(); return; }
      target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
    });
    server.on('error', reject);
  });
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
