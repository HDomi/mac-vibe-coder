import type { WebSocket, WebSocketServer } from 'ws';
import type { AgentEvent, AgentSession, ClientCommand, ServerMessage } from './agents/types.js';
import { ClaudeSession } from './agents/claude.js';
import { CodexSession } from './agents/codex.js';
import { which } from './shell.js';

const BUFFER_LIMIT = 5000;
const BUFFER_BYTES = 16 * 1024 * 1024;
/** Sessions nobody is watching and that have been idle this long are closed to free their CLI process. */
const ORPHAN_TTL_MS = 6 * 60 * 60 * 1000;
const REAP_EVERY_MS = 10 * 60 * 1000;

interface Entry {
  session: AgentSession;
  buffer: ServerMessage[];
  seq: number;
  subscribers: Set<WebSocket>;
  createdAt: number;
  lastActivity: number;
  running: boolean;
  closed: boolean;
  bufferBytes: number;
}

export class SessionRegistry {
  private entries = new Map<string, Entry>();
  private closing = false;
  private reaper: NodeJS.Timeout = setInterval(() => void this.reap(), REAP_EVERY_MS);

  constructor() { this.reaper.unref(); }

  /** Close sessions with no subscribers that have been idle for ORPHAN_TTL_MS. */
  async reap(now = Date.now()) {
    for (const [id, e] of this.entries) {
      if (e.closed && now - e.lastActivity > REAP_EVERY_MS || e.subscribers.size === 0 && !e.running && now - e.lastActivity > ORPHAN_TTL_MS) {
        console.log(`[mac-vibe-coder] reaping idle session ${id} (${e.session.agent})`);
        await this.close(id).catch(() => {});
      }
    }
  }

  list() {
    return [...this.entries.values()].filter((e) => !e.closed).map((e) => ({
      id: e.session.id, agent: e.session.agent, cwd: e.session.cwd, createdAt: e.createdAt,
      agentSessionId: (e.session as ClaudeSession | CodexSession).agentSessionId,
    }));
  }

  get(id: string) { return this.entries.get(id)?.session; }

  /** Sessions in the middle of a turn; restarting now would cut that turn off. */
  runningCount() { return [...this.entries.values()].filter((e) => !e.closed && e.running).length; }

  async start(cmd: Extract<ClientCommand, { type: 'session.start' }>, ws: WebSocket): Promise<AgentSession> {
    if (this.closing) throw new Error('Server is shutting down');
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
    if (this.closing || ws.readyState !== ws.OPEN) throw new Error('Connection closed before session started');
    const entry: Entry = { session, buffer: [], seq: 0, subscribers: new Set([ws]), createdAt: Date.now(), lastActivity: Date.now(), running: false, closed: false, bufferBytes: 0 };
    this.entries.set(session.id, entry);
    session.onEvent((event) => this.broadcast(entry, event));
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
    this.closing = true;
    clearInterval(this.reaper);
    await Promise.allSettled([...this.entries.keys()].map((id) => this.close(id)));
  }

  async close(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    this.entries.delete(id);
    await e.session.close();
  }

  private broadcast(e: Entry, event: AgentEvent) {
    const msg: ServerMessage = { sessionId: e.session.id, seq: ++e.seq, ts: Date.now(), event };
    e.lastActivity = msg.ts;
    if (event.kind === 'status') e.running = event.status === 'running' || event.status === 'compacting';
    if (event.kind === 'status' && event.status === 'closed') e.closed = true;
    // Shutdown (update, restart) closes every session; clients must keep them remembered so they
    // can be resumed against the new server instead of dropping them as finished.
    if (this.closing && event.kind === 'status' && event.status === 'closed') return;
    if (event.kind !== 'log') {
      e.buffer.push(msg);
      e.bufferBytes += Buffer.byteLength(JSON.stringify(msg));
      while (e.buffer.length > 1 && (e.buffer.length > BUFFER_LIMIT || e.bufferBytes > BUFFER_BYTES)) e.bufferBytes -= Buffer.byteLength(JSON.stringify(e.buffer.shift()!));
    }
    for (const ws of e.subscribers) safeSend(ws, msg);
  }
}

function safeSend(ws: WebSocket, msg: unknown) {
  try { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); } catch { /* socket closed between check and send */ }
}

export function attachWebSocket(wss: WebSocketServer, registry: SessionRegistry) {
  wss.on('connection', (ws) => {
    ws.on('message', async (raw) => {
      let cmd: ClientCommand;
      try { cmd = JSON.parse(String(raw)); } catch { return; }
      // Non-object frames ("null", 1, "x") would throw inside handle(); an unhandled rejection kills the server.
      if (!cmd || typeof cmd !== 'object' || typeof (cmd as { type?: unknown }).type !== 'string') return;
      try {
        await handle(cmd, ws, registry);
      } catch (err) {
        if (cmd.type === 'session.start') {
          safeSend(ws, { type: 'session.startFailed', requestId: cmd.requestId, requestCwd: cmd.cwd, message: (err as Error)?.message ?? String(err) });
          return;
        }
        const sessionId = typeof (cmd as { sessionId?: unknown }).sessionId === 'string' ? (cmd as { sessionId: string }).sessionId : '';
        safeSend(ws, { sessionId, seq: 0, ts: Date.now(), event: { kind: 'error', command: cmd.type, message: (err as Error)?.message ?? String(err) } });
      }
    });
    ws.on('close', () => registry.detachAll(ws));
  });
}

async function handle(cmd: ClientCommand, ws: WebSocket, registry: SessionRegistry) {
  switch (cmd.type) {
    case 'ping':
      safeSend(ws, { type: 'pong' });
      return;
    case 'session.start': {
      const s = await registry.start(cmd, ws);
      safeSend(ws, { type: 'session.started', sessionId: s.id, requestCwd: cmd.cwd, requestId: cmd.requestId, agent: cmd.agent });
      try { s.start(); } catch (err) {
        safeSend(ws, { sessionId: s.id, seq: 0, ts: Date.now(), event: { kind: 'error', message: (err as Error).message } });
        await registry.close(s.id);
        safeSend(ws, { type: 'session.missing', sessionId: s.id });
      }
      return;
    }
    case 'session.attach':
      if (!registry.get(cmd.sessionId)) { safeSend(ws, { type: 'session.missing', sessionId: cmd.sessionId }); return; }
      // Acknowledge before the replay: a quiet session (nothing after `after`) would otherwise send nothing at all.
      safeSend(ws, { type: 'session.attached', sessionId: cmd.sessionId });
      if (!registry.attach(cmd.sessionId, ws, cmd.after)) safeSend(ws, { type: 'session.missing', sessionId: cmd.sessionId });
      return;
    case 'session.send':
      await must(registry, cmd.sessionId).send(cmd.text, cmd.attachments ?? [], cmd.messageId);
      return;
    case 'session.rewind': {
      const s = must(registry, cmd.sessionId);
      const result = s.rewindFiles
        ? await s.rewindFiles(cmd.messageId, !!cmd.dryRun).catch((err) => ({ canRewind: false, error: (err as Error).message ?? String(err) }))
        : { canRewind: false, error: 'This agent cannot undo file changes.' };
      safeSend(ws, { type: 'session.rewindResult', sessionId: cmd.sessionId, requestId: cmd.requestId, result });
      return;
    }
    case 'session.approve':
      must(registry, cmd.sessionId).approve(cmd.requestId, cmd.decision, cmd.message);
      return;
    case 'session.answer':
      must(registry, cmd.sessionId).answer(cmd.requestId, cmd.answers, cmd.response);
      return;
    case 'session.interrupt':
      await must(registry, cmd.sessionId).interrupt();
      return;
    case 'session.stopTask': {
      const s = must(registry, cmd.sessionId);
      if (!s.stopTask) throw new Error('This agent cannot stop tasks.');
      await s.stopTask(cmd.taskId);
      return;
    }
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
