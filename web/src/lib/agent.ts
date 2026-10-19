/** Shared types mirrored from server/agents/types.ts (kept in sync by hand). */
export type AgentId = 'claude' | 'codex';
export type PermissionModeId = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
export interface Attachment { path: string; name: string; kind: 'image' | 'file'; mime?: string }
export interface QuestionOption { label: string; description?: string; preview?: string }
export interface Question { question: string; header: string; options: QuestionOption[]; multiSelect: boolean }
export type AssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

export type AgentEvent =
  | { kind: 'session.init'; sessionId: string; agent: AgentId; cwd: string; model?: string; permissionMode?: string; agentSessionId?: string; tools?: string[]; commands?: string[] }
  | { kind: 'user'; text: string; attachments: Attachment[] }
  | { kind: 'text.delta'; text: string; parent: string | null }
  | { kind: 'thinking.delta'; text: string; parent: string | null }
  | { kind: 'assistant.message'; id: string; parent: string | null; blocks: AssistantBlock[] }
  | { kind: 'tool.start'; toolUseId: string; name: string; input: unknown; parent: string | null }
  | { kind: 'tool.result'; toolUseId: string; content: string; isError: boolean; parent: string | null }
  | { kind: 'tool.output'; toolUseId: string; chunk: string }
  | { kind: 'tool.progress'; toolUseId: string; name: string; elapsed: number }
  | { kind: 'approval.request'; requestId: string; toolUseId: string | null; toolName: string; input: unknown; canAlwaysAllow: boolean }
  | { kind: 'approval.resolved'; requestId: string; decision: 'allow' | 'allow_always' | 'deny' | 'cancelled' }
  | { kind: 'question.request'; requestId: string; questions: Question[] }
  | { kind: 'question.resolved'; requestId: string }
  | { kind: 'status'; status: 'running' | 'idle' | 'compacting' | 'closed'; permissionMode?: string }
  | { kind: 'result'; ok: boolean; text: string; costUsd: number; numTurns: number; durationMs: number; agentSessionId?: string }
  | { kind: 'error'; message: string }
  | { kind: 'log'; text: string };

export type ServerMessage =
  | { sessionId: string; seq: number; ts: number; event: AgentEvent }
  | { type: 'session.started'; sessionId: string; requestCwd: string; agent: AgentId }
  | { type: 'session.missing'; sessionId: string };

export type ClientCommand =
  | { type: 'session.start'; agent: AgentId; cwd: string; resume?: string; permissionMode?: PermissionModeId; model?: string }
  | { type: 'session.attach'; sessionId: string; after?: number }
  | { type: 'session.send'; sessionId: string; text: string; attachments?: Attachment[] }
  | { type: 'session.approve'; sessionId: string; requestId: string; decision: 'allow' | 'allow_always' | 'deny'; message?: string }
  | { type: 'session.answer'; sessionId: string; requestId: string; answers: Record<string, string>; response?: string }
  | { type: 'session.interrupt'; sessionId: string }
  | { type: 'session.mode'; sessionId: string; mode: PermissionModeId }
  | { type: 'session.model'; sessionId: string; model: string | null }
  | { type: 'session.close'; sessionId: string };

type Listener = (m: ServerMessage) => void;

/** Reconnecting WebSocket client for the agent protocol. */
export class AgentClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private queue: string[] = [];
  private retry = 0;
  private closed = false;
  readonly ready: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    this.ready = new Promise((r) => { this.resolveReady = r; });
    this.connect();
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      for (const q of this.queue.splice(0)) ws.send(q);
      this.resolveReady();
    };
    ws.onmessage = (ev) => {
      let m: ServerMessage;
      try { m = JSON.parse(ev.data); } catch { return; }
      for (const l of this.listeners) l(m);
    };
    ws.onclose = () => {
      if (this.closed) return;
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  send(cmd: ClientCommand) {
    const s = JSON.stringify(cmd);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(s);
    else this.queue.push(s);
  }

  on(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  close() { this.closed = true; this.ws?.close(); }
}

export const agentClient = new AgentClient();
