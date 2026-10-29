import { serve, type ServerType } from '@hono/node-server';
import { createApp } from './app.js';
import { HOST, PORT } from './config.js';
import { syncLoginShellPath } from './shell.js';
import { WebSocketServer } from 'ws';
import { attachWebSocket, SessionRegistry } from './sessions.js';
import { attachPty, killAllPtys } from './pty.js';
import { rejectReason } from './guard.js';
import { setShutdownHandler } from './lifecycle.js';
import { attachBrowser, browser } from './browser.js';
import { RESTART_EXIT_CODE } from './updater.js';
import { stopAllRuns } from './runner.js';
import { Scheduler } from './scheduler.js';

export async function startServer(port = PORT): Promise<ServerType> {
  await syncLoginShellPath();
  return new Promise((resolve, reject) => {
    const registry = new SessionRegistry();
    const scheduler = new Scheduler(registry);
    const app = createApp(registry, port, scheduler);
    const server = serve({ fetch: app.fetch, hostname: HOST, port }, (info) => {
      console.log(`[mac-vibe-coder] http://${info.address}:${info.port}`);
      void scheduler.start().catch((err) => console.warn(`[mac-vibe-coder] scheduler failed to start: ${(err as Error).message}`));
      resolve(server);
    });
    const http = server as import('node:http').Server;
    const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
    const ptyWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
    const browserWss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
    attachBrowser(browserWss);
    attachWebSocket(wss, registry);
    attachPty(ptyWss);
    let shuttingDown = false;
    // Single exit path: signals, update restart and /api/restart all close sessions and shells first.
    const shutdown = (reason: string, code = 0) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[mac-vibe-coder] ${reason}: closing sessions`);
      // Stop accepting connections right away so a new app instance does not attach to a dying server.
      http.close();
      const timer = setTimeout(() => process.exit(code), 4000);
      scheduler.stop();
      killAllPtys();
      stopAllRuns();
      // Quitting closes the headless Chrome we started; an update restart keeps it (and its logins) for the new server.
      void browser.shutdown(code !== RESTART_EXIT_CODE);
      registry.closeAll().finally(() => { clearTimeout(timer); process.exit(code); });
    };
    setShutdownHandler(shutdown);
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    http.on('upgrade', (req, socket, head) => {
      let pathname: string;
      try { pathname = new URL(req.url ?? '/', 'http://localhost').pathname; } catch { socket.destroy(); return; }
      const target = pathname === '/ws' ? wss : pathname === '/pty' ? ptyWss : pathname === '/browser' ? browserWss : null;
      if (!target) { socket.destroy(); return; }
      // WebSockets are not covered by CORS: without this any web page could open a shell on /pty.
      const reason = rejectReason({ host: req.headers.host, origin: req.headers.origin, secFetchSite: req.headers['sec-fetch-site'] as string | undefined }, port);
      if (reason || shuttingDown) {
        socket.write(`HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n`);
        socket.destroy();
        return;
      }
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
