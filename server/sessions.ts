import type { WebSocket, WebSocketServer } from 'ws';
import type { AgentEvent, AgentSession, ClientCommand, ServerMessage } from './agents/types.js';
import { ClaudeSession } from './agents/claude.js';
import { CodexSession } from './agents/codex.js';
import { which } from './shell.js';

const BUFFER_LIMIT = 5000;

interface Entry {
  session: AgentSession;
  buffer: ServerMessage[];
  seq: number;
  subscribers: Set<WebSocket>;
  createdAt: number;
}

export class SessionRegistry {
  private entries = new Map<string, Entry>();

  list() {
    return [...this.entries.values()].map((e) => ({
      id: e.session.id, agent: e.session.agent, cwd: e.session.cwd, createdAt: e.createdAt,
      agentSessionId: (e.session as ClaudeSession | CodexSession).agentSessionId,
    }));
  }

  get(id: string) { return this.entries.get(id)?.session; }

  async start(cmd: Extract<ClientCommand, { type: 'session.start' }>, ws: WebSocket): Promise<AgentSession> {
    let session: ClaudeSession | CodexSession;
    if (cmd.agent === 'claude') {
      const claudePath = await which('claude');
      if (!claudePath) throw new Error('claude CLI not found. Install it from Settings.');
      session = new ClaudeSession({ cwd: cmd.cwd, claudePath, resume: cmd.resume, permissionMode: cmd.permissionMode, model: cmd.model });
    } else if (cmd.agent === 'codex') {
      const codexPath = await which('codex');
      if (!codexPath) throw new Error('codex CLI not found. Install it from Settings.');
      session = new CodexSession({ cwd: cmd.cwd, codexPath, resume: cmd.resume, permissionMode: cmd.permissionMode, model: cmd.model });
    } else {
      throw new Error(`Unknown agent: ${cmd.agent}`);
    }
    const entry: Entry = { session, buffer: [], seq: 0, subscribers: new Set([ws]), createdAt: Date.now() };
    this.entries.set(session.id, entry);
    session.onEvent((event) => this.broadcast(entry, event));
    session.start();
    return session;
  }

  attach(id: string, ws: WebSocket, after = 0) {
    const e = this.entries.get(id);
    if (!e) return false;
    e.subscribers.add(ws);
    for (const m of e.buffer) if (m.seq > after) safeSend(ws, m);
    return true;
  }

  detachAll(ws: WebSocket) {
    for (const e of this.entries.values()) e.subscribers.delete(ws);
  }

  /** Close every session so child agent processes (claude, codex app-server) do not outlive the server. */
  async closeAll() {
    await Promise.allSettled([...this.entries.keys()].map((id) => this.close(id)));
  }

  async close(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    await e.session.close();
    this.entries.delete(id);
  }

  private broadcast(e: Entry, event: AgentEvent) {
    const msg: ServerMessage = { sessionId: e.session.id, seq: ++e.seq, ts: Date.now(), event };
    if (event.kind !== 'log') {
      e.buffer.push(msg);
      if (e.buffer.length > BUFFER_LIMIT) e.buffer.splice(0, e.buffer.length - BUFFER_LIMIT);
    }
    for (const ws of e.subscribers) safeSend(ws, msg);
  }
}

function safeSend(ws: WebSocket, msg: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

export function attachWebSocket(wss: WebSocketServer, registry: SessionRegistry) {
  wss.on('connection', (ws) => {
    ws.on('message', async (raw) => {
      let cmd: ClientCommand;
      try { cmd = JSON.parse(String(raw)); } catch { return; }
      try {
        await handle(cmd, ws, registry);
      } catch (err) {
        safeSend(ws, { sessionId: 'sessionId' in cmd ? cmd.sessionId : '', seq: 0, ts: Date.now(), event: { kind: 'error', message: (err as Error).message } });
      }
    });
    ws.on('close', () => registry.detachAll(ws));
  });
}

async function handle(cmd: ClientCommand, ws: WebSocket, registry: SessionRegistry) {
  switch (cmd.type) {
    case 'session.start': {
      const s = await registry.start(cmd, ws);
      safeSend(ws, { type: 'session.started', sessionId: s.id, requestCwd: cmd.cwd, agent: cmd.agent });
      return;
    }
    case 'session.attach':
      if (!registry.attach(cmd.sessionId, ws, cmd.after)) safeSend(ws, { type: 'session.missing', sessionId: cmd.sessionId });
      return;
    case 'session.send':
      await must(registry, cmd.sessionId).send(cmd.text, cmd.attachments ?? []);
      return;
    case 'session.approve':
      must(registry, cmd.sessionId).approve(cmd.requestId, cmd.decision, cmd.message);
      return;
    case 'session.answer':
      must(registry, cmd.sessionId).answer(cmd.requestId, cmd.answers, cmd.response);
      return;
    case 'session.interrupt':
      await must(registry, cmd.sessionId).interrupt();
      return;
    case 'session.mode':
      await must(registry, cmd.sessionId).setPermissionMode(cmd.mode);
      return;
    case 'session.model':
      await must(registry, cmd.sessionId).setModel(cmd.model);
      return;
    case 'session.close':
      await registry.close(cmd.sessionId);
      return;
  }
}

function must(registry: SessionRegistry, id: string): AgentSession {
  const s = registry.get(id);
  if (!s) throw new Error('Unknown session');
  return s;
}
