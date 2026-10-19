import type { AgentEvent, AgentId, Attachment, PermissionModeId, Question } from './agent';

export type ChatItem =
  | { kind: 'user'; id: string; text: string; attachments: Attachment[] }
  | { kind: 'assistant'; id: string; text: string; thinking: string; parent: string | null; streaming: boolean }
  | { kind: 'tool'; id: string; name: string; input: unknown; output: string | null; isError: boolean; parent: string | null; elapsed: number; done: boolean }
  | { kind: 'approval'; id: string; toolName: string; input: unknown; canAlwaysAllow: boolean; decision: string | null }
  | { kind: 'question'; id: string; questions: Question[]; resolved: boolean }
  | { kind: 'result'; id: string; ok: boolean; text: string; costUsd: number; numTurns: number; durationMs: number }
  | { kind: 'error'; id: string; message: string }
  | { kind: 'system'; id: string; text: string };

export interface ChatSession {
  id: string;
  agent: AgentId;
  cwd: string;
  model?: string;
  permissionMode: PermissionModeId;
  agentSessionId?: string;
  commands?: string[];
  /** When the current turn started (ms); undefined while idle. */
  turnStartedAt?: number;
  status: 'starting' | 'running' | 'idle' | 'compacting' | 'closed';
  items: ChatItem[];
  totalCostUsd: number;
  lastSeq: number;
}

let counter = 0;
const uid = () => `c${Date.now().toString(36)}${(counter++).toString(36)}`;

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic)$/i;
const ATTACH_BLOCK = /\n\n(?:Attached file paths|첨부 파일 경로):\n((?:- .+(?:\n|$))+)$/;

/** Split the "Attached file paths:" block the adapters append for the model back into attachments. */
export function splitAttachments(text: string): { text: string; attachments: Attachment[] } {
  const m = text.match(ATTACH_BLOCK);
  if (!m) return { text, attachments: [] };
  const attachments: Attachment[] = m[1].split('\n').filter((l) => l.startsWith('- ')).map((l) => {
    const path = l.slice(2).trim();
    const name = path.split('/').pop() ?? path;
    return { path, name, kind: IMAGE_RE.test(name) ? 'image' as const : 'file' as const };
  });
  return { text: text.slice(0, m.index).trimEnd(), attachments };
}

/** Apply one event to a session, returning a new session object (immutable update). */
export function reduceEvent(s: ChatSession, e: AgentEvent, seq: number): ChatSession {
  const items = s.items.slice();
  const next: ChatSession = { ...s, items, lastSeq: Math.max(s.lastSeq, seq) };

  const lastAssistant = (parent: string | null) => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === 'assistant' && it.parent === parent && it.streaming) return i;
      if (it.kind === 'user') break;
    }
    return -1;
  };

  switch (e.kind) {
    case 'session.init':
      next.agentSessionId = e.agentSessionId ?? s.agentSessionId;
      next.model = e.model ?? s.model;
      if (e.commands?.length) next.commands = e.commands;
      if (e.permissionMode) next.permissionMode = e.permissionMode as PermissionModeId;
      if (s.status === 'starting') next.status = 'idle';
      return next;
    case 'user': {
      // Live events carry clean text; replayed ones (Codex resume) may still include the appended path block.
      const split = e.attachments.length ? { text: e.text, attachments: e.attachments } : splitAttachments(e.text);
      items.push({ kind: 'user', id: uid(), text: split.text, attachments: split.attachments });
      next.turnStartedAt = next.turnStartedAt ?? Date.now();
      return next;
    }
    case 'text.delta':
    case 'thinking.delta': {
      let i = lastAssistant(e.parent);
      if (i < 0) { items.push({ kind: 'assistant', id: uid(), text: '', thinking: '', parent: e.parent, streaming: true }); i = items.length - 1; }
      const a = items[i] as Extract<ChatItem, { kind: 'assistant' }>;
      items[i] = e.kind === 'text.delta' ? { ...a, text: a.text + e.text } : { ...a, thinking: a.thinking + e.text };
      return next;
    }
    case 'assistant.message': {
      const text = e.blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
      const thinking = e.blocks.filter((b) => b.type === 'thinking').map((b) => (b as { text: string }).text).join('');
      const i = lastAssistant(e.parent);
      if (i >= 0) {
        const a = items[i] as Extract<ChatItem, { kind: 'assistant' }>;
        items[i] = { ...a, text: text || a.text, thinking: thinking || a.thinking, streaming: false };
      } else if (text || thinking) {
        items.push({ kind: 'assistant', id: e.id, text, thinking, parent: e.parent, streaming: false });
      }
      return next;
    }
    case 'tool.start':
      items.push({ kind: 'tool', id: e.toolUseId, name: e.name, input: e.input, output: null, isError: false, parent: e.parent, elapsed: 0, done: false });
      return next;
    case 'tool.result': {
      const i = items.findIndex((it) => it.kind === 'tool' && it.id === e.toolUseId);
      if (i >= 0) items[i] = { ...(items[i] as Extract<ChatItem, { kind: 'tool' }>), output: e.content, isError: e.isError, done: true };
      return next;
    }
    case 'tool.output': {
      const i = items.findIndex((it) => it.kind === 'tool' && it.id === e.toolUseId);
      if (i >= 0) { const t = items[i] as Extract<ChatItem, { kind: 'tool' }>; items[i] = { ...t, output: (t.output ?? '') + e.chunk }; }
      return next;
    }
    case 'tool.progress': {
      const i = items.findIndex((it) => it.kind === 'tool' && it.id === e.toolUseId);
      if (i >= 0) items[i] = { ...(items[i] as Extract<ChatItem, { kind: 'tool' }>), elapsed: e.elapsed };
      return next;
    }
    case 'approval.request':
      items.push({ kind: 'approval', id: e.requestId, toolName: e.toolName, input: e.input, canAlwaysAllow: e.canAlwaysAllow, decision: null });
      return next;
    case 'approval.resolved': {
      const i = items.findIndex((it) => it.kind === 'approval' && it.id === e.requestId);
      if (i >= 0) items[i] = { ...(items[i] as Extract<ChatItem, { kind: 'approval' }>), decision: e.decision };
      return next;
    }
    case 'question.request':
      items.push({ kind: 'question', id: e.requestId, questions: e.questions, resolved: false });
      return next;
    case 'question.resolved': {
      const i = items.findIndex((it) => it.kind === 'question' && it.id === e.requestId);
      if (i >= 0) items[i] = { ...(items[i] as Extract<ChatItem, { kind: 'question' }>), resolved: true };
      return next;
    }
    case 'status':
      next.status = e.status;
      if (e.status === 'running' && !next.turnStartedAt) next.turnStartedAt = Date.now();
      if (e.status === 'idle' || e.status === 'closed') next.turnStartedAt = undefined;
      if (e.permissionMode) next.permissionMode = e.permissionMode as PermissionModeId;
      return next;
    case 'result':
      for (let i = 0; i < items.length; i++) { const it = items[i]; if (it.kind === 'assistant' && it.streaming) items[i] = { ...it, streaming: false }; }
      items.push({ kind: 'result', id: uid(), ok: e.ok, text: e.text, costUsd: e.costUsd, numTurns: e.numTurns, durationMs: e.durationMs });
      next.totalCostUsd = e.costUsd;
      next.agentSessionId = e.agentSessionId ?? s.agentSessionId;
      next.status = 'idle';
      next.turnStartedAt = undefined;
      return next;
    case 'error':
      items.push({ kind: 'error', id: uid(), message: e.message });
      return next;
    case 'log':
      return s;
  }
}

/** Convert a stored Claude Code transcript into chat items for display when resuming. */
export function itemsFromHistory(messages: Array<{ type: string; uuid: string; message: unknown; parent_tool_use_id: string | null }>): ChatItem[] {
  const out: ChatItem[] = [];
  for (const m of messages) {
    const msg = m.message as { role?: string; content?: unknown } | undefined;
    const content = msg?.content;
    if (m.type === 'user') {
      if (typeof content === 'string') { const s = splitAttachments(content); out.push({ kind: 'user', id: m.uuid, text: s.text, attachments: s.attachments }); continue; }
      if (!Array.isArray(content)) continue;
      const texts: string[] = [];
      for (const b of content as Array<Record<string, unknown>>) {
        if (b.type === 'text') texts.push(String(b.text));
        else if (b.type === 'tool_result') {
          const i = out.findIndex((it) => it.kind === 'tool' && it.id === b.tool_use_id);
          const c = b.content;
          const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x as { text?: string }).text ?? '').join('\n') : '';
          if (i >= 0) out[i] = { ...(out[i] as Extract<ChatItem, { kind: 'tool' }>), output: text, isError: Boolean(b.is_error), done: true };
        }
      }
      if (texts.length && !m.parent_tool_use_id) { const s = splitAttachments(texts.join('\n')); out.push({ kind: 'user', id: m.uuid, text: s.text, attachments: s.attachments }); }
    } else if (m.type === 'assistant' && Array.isArray(content)) {
      let text = ''; let thinking = '';
      for (const b of content as Array<Record<string, unknown>>) {
        if (b.type === 'text') text += String(b.text);
        else if (b.type === 'thinking') thinking += String(b.thinking ?? '');
        else if (b.type === 'tool_use') out.push({ kind: 'tool', id: String(b.id), name: String(b.name), input: b.input, output: null, isError: false, parent: m.parent_tool_use_id, elapsed: 0, done: true });
      }
      if (text || thinking) out.push({ kind: 'assistant', id: m.uuid, text, thinking, parent: m.parent_tool_use_id, streaming: false });
    }
  }
  return out;
}
