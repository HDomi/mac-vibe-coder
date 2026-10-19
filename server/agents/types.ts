/** Unified event schema shared by every agent adapter (Claude, Codex, ...). */

export type AgentId = 'claude' | 'codex';
export type PermissionModeId = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'auto';

export interface Attachment {
  path: string;
  name: string;
  kind: 'image' | 'file';
  mime?: string;
}

export interface QuestionOption { label: string; description?: string; preview?: string }
export interface Question { question: string; header: string; options: QuestionOption[]; multiSelect: boolean }

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

export type AssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

export type ServerMessage = { sessionId: string; seq: number; ts: number; event: AgentEvent };

export type ClientCommand =
  | { type: 'session.start'; agent: AgentId; cwd: string; resume?: string; permissionMode?: PermissionModeId; model?: string }
  | { type: 'ping' }
  | { type: 'session.attach'; sessionId: string; after?: number }
  | { type: 'session.send'; sessionId: string; text: string; attachments?: Attachment[] }
  | { type: 'session.approve'; sessionId: string; requestId: string; decision: 'allow' | 'allow_always' | 'deny'; message?: string }
  | { type: 'session.answer'; sessionId: string; requestId: string; answers: Record<string, string>; response?: string }
  | { type: 'session.interrupt'; sessionId: string }
  | { type: 'session.mode'; sessionId: string; mode: PermissionModeId }
  | { type: 'session.model'; sessionId: string; model: string | null }
  | { type: 'session.close'; sessionId: string };

export interface AgentSession {
  readonly id: string;
  readonly agent: AgentId;
  readonly cwd: string;
  onEvent(listener: (e: AgentEvent) => void): () => void;
  send(text: string, attachments: Attachment[]): Promise<void>;
  approve(requestId: string, decision: 'allow' | 'allow_always' | 'deny', message?: string): void;
  answer(requestId: string, answers: Record<string, string>, response?: string): void;
  interrupt(): Promise<void>;
  setPermissionMode(mode: PermissionModeId): Promise<void>;
  setModel(model: string | null): Promise<void>;
  close(): Promise<void>;
}
