import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { query, type Options, type PermissionResult, type PermissionUpdate, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, AgentSession, AssistantBlock, Attachment, PermissionModeId, Question } from './types.js';
import { mimeOf } from '../mime.js';

const IMAGE_LIMIT = 5 * 1024 * 1024;

interface Pending {
  kind: 'approval' | 'question';
  resolve: (r: PermissionResult) => void;
  input: Record<string, unknown>;
  suggestions: PermissionUpdate[];
}

/** Async queue used as the SDK's streaming-input prompt. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiters: ((v: IteratorResult<SDKUserMessage>) => void)[] = [];
  private closed = false;

  push(m: SDKUserMessage) {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: m, done: false });
    else this.items.push(m);
  }
  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

export interface ClaudeSessionOptions {
  cwd: string;
  claudePath: string;
  resume?: string;
  permissionMode?: PermissionModeId;
  model?: string;
}

export class ClaudeSession implements AgentSession {
  readonly id = randomUUID();
  readonly agent = 'claude' as const;
  readonly cwd: string;
  agentSessionId: string | undefined;

  private listeners = new Set<(e: AgentEvent) => void>();
  private input = new InputQueue();
  private q: Query | null = null;
  private pending = new Map<string, Pending>();
  private abort = new AbortController();
  private closed = false;
  private running = false;
  /** Incremented on every (re)launch so a superseded pump does not report 'closed'. */
  private generation = 0;

  constructor(private opts: ClaudeSessionOptions) {
    this.cwd = opts.cwd;
    this.agentSessionId = opts.resume;
  }

  onEvent(listener: (e: AgentEvent) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(e: AgentEvent) {
    for (const l of this.listeners) l(e);
  }

  start() { this.launch(); }

  private launch() {
    const gen = ++this.generation;
    const options: Options = {
      cwd: this.opts.cwd,
      pathToClaudeCodeExecutable: this.opts.claudePath,
      resume: this.opts.resume,
      permissionMode: this.opts.permissionMode ?? 'default',
      // Required for switching to bypassPermissions mid-session via setPermissionMode(); the user picks it explicitly in the UI.
      allowDangerouslySkipPermissions: true,
      // Match `claude` CLI behaviour: the SDK's default system prompt is a minimal tool-calling
      // prompt, not Claude Code's. The preset restores the full prompt (coding guidance, safety rules).
      // settingSources is left at its default, which loads user/project/local settings and CLAUDE.md.
      systemPrompt: { type: 'preset', preset: 'claude_code', snapshot: true },
      model: this.opts.model,
      includePartialMessages: true,
      // Stream subagent text/thinking too, so the UI can show what a subagent is doing.
      forwardSubagentText: true,
      abortController: this.abort,
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'mac-vibe-coder/0.1.0' },
      stderr: (data) => this.emit({ kind: 'log', text: data }),
      canUseTool: (toolName, input, { suggestions, signal }) => this.handlePermission(toolName, input, suggestions ?? [], signal),
    };
    this.q = query({ prompt: this.input, options });
    this.emit({ kind: 'session.init', sessionId: this.id, agent: 'claude', cwd: this.cwd, permissionMode: options.permissionMode, agentSessionId: this.agentSessionId });
    void this.pump(this.q, gen);
    // The system/init message (and its slash_commands) only arrives with the first turn.
    // Ask over the control channel so "/" autocomplete works before anything is sent.
    void this.q.supportedCommands()
      .then((cmds) => {
        if (this.closed || !cmds.length) return;
        this.emit({ kind: 'session.init', sessionId: this.id, agent: 'claude', cwd: this.cwd, agentSessionId: this.agentSessionId, commands: cmds.map((c) => `/${c.name}`) });
      })
      .catch((err) => this.emit({ kind: 'log', text: `supportedCommands failed: ${(err as Error).message}` }));
  }

  private async pump(q: Query, gen: number) {
    try {
      for await (const m of q) { if (gen !== this.generation) break; this.handleMessage(m); }
    } catch (err) {
      if (!this.closed && gen === this.generation) this.emit({ kind: 'error', message: (err as Error).message ?? String(err) });
    } finally {
      if (gen !== this.generation) return; // superseded by a relaunch; the new pump owns the session
      this.closed = true;
      for (const [id, p] of this.pending) {
        p.resolve({ behavior: 'deny', message: 'Session closed' });
        this.emit({ kind: 'approval.resolved', requestId: id, decision: 'cancelled' });
      }
      this.pending.clear();
      this.emit({ kind: 'status', status: 'closed' });
    }
  }

  /**
   * Restart the CLI process with a different launch-time permission mode, resuming the same
   * conversation. Needed for bypassPermissions, which the CLI only accepts at launch.
   */
  private async relaunch(mode: PermissionModeId) {
    const old = this.q;
    this.generation++; // detach the old pump before tearing the process down
    this.input.close();
    for (const [id, p] of this.pending) {
      p.resolve({ behavior: 'deny', message: 'Permission mode changed; please retry' });
      this.emit({ kind: 'approval.resolved', requestId: id, decision: 'cancelled' });
    }
    this.pending.clear();
    try { await old?.interrupt(); } catch { /* ignore */ }
    this.abort.abort();
    try { old?.close(); } catch { /* ignore */ }
    this.input = new InputQueue();
    this.abort = new AbortController();
    this.opts = { ...this.opts, permissionMode: mode, resume: this.agentSessionId };
    this.running = false;
    this.closed = false;
    this.launch();
    this.emit({ kind: 'status', status: 'idle', permissionMode: mode });
  }

  private handleMessage(m: SDKMessage) {
    switch (m.type) {
      case 'system': {
        if (m.subtype === 'init') {
          this.agentSessionId = m.session_id;
          this.emit({ kind: 'session.init', sessionId: this.id, agent: 'claude', cwd: m.cwd, model: m.model, permissionMode: m.permissionMode, agentSessionId: m.session_id, tools: m.tools, commands: (m.slash_commands ?? []).map((c) => `/${c}`) });
        } else if (m.subtype === 'status') {
          // SDKStatus is 'compacting' | 'requesting' | null; null just clears a transient status
          // (e.g. after a permission-mode change) and must not look like a running turn.
          const s = (m as { status?: string | null }).status;
          const status = s === 'compacting' ? 'compacting' : s === 'requesting' ? 'running' : this.running ? 'running' : 'idle';
          this.emit({ kind: 'status', status, permissionMode: (m as { permissionMode?: string }).permissionMode });
        }
        return;
      }
      case 'stream_event': {
        const ev = m.event as { type: string; delta?: { type: string; text?: string; thinking?: string } };
        if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'text_delta' && ev.delta.text) this.emit({ kind: 'text.delta', text: ev.delta.text, parent: m.parent_tool_use_id });
          else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) this.emit({ kind: 'thinking.delta', text: ev.delta.thinking, parent: m.parent_tool_use_id });
        }
        return;
      }
      case 'assistant': {
        const blocks: AssistantBlock[] = [];
        for (const b of m.message.content as unknown as Array<Record<string, unknown>>) {
          if (b.type === 'text') blocks.push({ type: 'text', text: String(b.text ?? '') });
          else if (b.type === 'thinking') blocks.push({ type: 'thinking', text: String(b.thinking ?? '') });
          else if (b.type === 'tool_use') {
            blocks.push({ type: 'tool_use', id: String(b.id), name: String(b.name), input: b.input });
            this.emit({ kind: 'tool.start', toolUseId: String(b.id), name: String(b.name), input: b.input, parent: m.parent_tool_use_id });
          }
        }
        this.emit({ kind: 'assistant.message', id: m.uuid, parent: m.parent_tool_use_id, blocks });
        return;
      }
      case 'user': {
        const content = (m.message as { content?: unknown }).content;
        if (!Array.isArray(content)) return;
        for (const b of content as Array<Record<string, unknown>>) {
          if (b.type !== 'tool_result') continue;
          const c = b.content;
          const text = typeof c === 'string' ? c
            : Array.isArray(c) ? c.map((x) => (x as { type?: string; text?: string }).type === 'text' ? (x as { text: string }).text : `[${(x as { type?: string }).type}]`).join('\n')
            : '';
          this.emit({ kind: 'tool.result', toolUseId: String(b.tool_use_id), content: text, isError: Boolean(b.is_error), parent: m.parent_tool_use_id });
        }
        return;
      }
      case 'tool_progress':
        this.emit({ kind: 'tool.progress', toolUseId: m.tool_use_id, name: m.tool_name, elapsed: m.elapsed_time_seconds });
        return;
      case 'result': {
        this.agentSessionId = m.session_id;
        const ok = m.subtype === 'success';
        this.emit({
          kind: 'result', ok,
          text: ok ? (m as { result: string }).result : (m as { errors?: string[] }).errors?.join('\n') ?? m.subtype,
          costUsd: m.total_cost_usd, numTurns: m.num_turns, durationMs: m.duration_ms, agentSessionId: m.session_id,
        });
        this.running = false;
        this.emit({ kind: 'status', status: 'idle' });
        return;
      }
      default:
        return;
    }
  }

  private handlePermission(toolName: string, input: Record<string, unknown>, suggestions: PermissionUpdate[], signal: AbortSignal): Promise<PermissionResult> {
    const requestId = randomUUID();
    return new Promise<PermissionResult>((resolve) => {
      const kind = toolName === 'AskUserQuestion' ? 'question' : 'approval';
      this.pending.set(requestId, { kind, resolve, input, suggestions });
      signal.addEventListener('abort', () => {
        if (!this.pending.has(requestId)) return;
        this.pending.delete(requestId);
        resolve({ behavior: 'deny', message: 'Cancelled' });
        this.emit(kind === 'question' ? { kind: 'question.resolved', requestId } : { kind: 'approval.resolved', requestId, decision: 'cancelled' });
      });
      if (kind === 'question') {
        this.emit({ kind: 'question.request', requestId, questions: (input.questions as Question[] | undefined) ?? [] });
      } else {
        this.emit({ kind: 'approval.request', requestId, toolUseId: null, toolName, input, canAlwaysAllow: suggestions.length > 0 });
      }
    });
  }

  approve(requestId: string, decision: 'allow' | 'allow_always' | 'deny', message?: string) {
    const p = this.pending.get(requestId);
    if (!p || p.kind !== 'approval') return;
    this.pending.delete(requestId);
    if (decision === 'deny') p.resolve({ behavior: 'deny', message: message || 'User denied this action' });
    else if (decision === 'allow_always') p.resolve({ behavior: 'allow', updatedInput: p.input, updatedPermissions: p.suggestions });
    else p.resolve({ behavior: 'allow', updatedInput: p.input });
    this.emit({ kind: 'approval.resolved', requestId, decision });
  }

  answer(requestId: string, answers: Record<string, string>, response?: string) {
    const p = this.pending.get(requestId);
    if (!p || p.kind !== 'question') return;
    this.pending.delete(requestId);
    const updatedInput: Record<string, unknown> = { questions: p.input.questions, answers };
    if (response) updatedInput.response = response;
    p.resolve({ behavior: 'allow', updatedInput });
    this.emit({ kind: 'question.resolved', requestId });
  }

  async send(text: string, attachments: Attachment[]) {
    if (this.closed) throw new Error('Session closed');
    const content: Array<Record<string, unknown>> = [];
    const mentions: string[] = [];
    for (const a of attachments) {
      if (a.kind === 'image') {
        try {
          const st = await fs.stat(a.path);
          if (st.size <= IMAGE_LIMIT) {
            const data = await fs.readFile(a.path);
            content.push({ type: 'image', source: { type: 'base64', media_type: a.mime ?? mimeOf(path.extname(a.path)), data: data.toString('base64') } });
          }
        } catch { /* fall through to path mention */ }
      }
      mentions.push(a.path);
    }
    let body = text;
    if (mentions.length) body += `\n\nAttached file paths:\n${mentions.map((p) => `- ${p}`).join('\n')}`;
    content.push({ type: 'text', text: body });
    this.emit({ kind: 'user', text, attachments });
    this.running = true;
    this.emit({ kind: 'status', status: 'running' });
    this.input.push({ type: 'user', message: { role: 'user', content: content as never }, parent_tool_use_id: null });
  }

  async interrupt() {
    try { await this.q?.interrupt(); } catch (err) { this.emit({ kind: 'log', text: `interrupt failed: ${(err as Error).message}` }); }
  }

  async setModel(model: string | null) {
    await this.q?.setModel(model ?? undefined);
    this.emit({ kind: 'session.init', sessionId: this.id, agent: 'claude', cwd: this.cwd, model: model ?? undefined, agentSessionId: this.agentSessionId });
  }

  async setPermissionMode(mode: PermissionModeId) {
    try {
      await this.q?.setPermissionMode(mode);
      this.emit({ kind: 'status', status: this.running ? 'running' : 'idle', permissionMode: mode });
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      // The CLI only accepts bypassPermissions as a launch-time flag: relaunch and resume.
      if (/dangerously-skip-permissions/i.test(msg) || mode === 'bypassPermissions') { await this.relaunch(mode); return; }
      this.emit({ kind: 'error', message: `Could not change permission mode: ${msg}` });
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.input.close();
    try { await this.q?.interrupt(); } catch { /* ignore */ }
    this.abort.abort();
  }
}

let modelCache: { at: number; list: { id: string; name: string; description?: string }[] } | null = null;

/** Model list as the CLI reports it (cached 10 min so the list does not spawn a CLI per page load). */
export async function listClaudeModels(claudePath: string): Promise<{ id: string; name: string; description?: string }[]> {
  if (modelCache && Date.now() - modelCache.at < 10 * 60 * 1000) return modelCache.list;
  const list = await fetchClaudeModels(claudePath);
  modelCache = { at: Date.now(), list };
  return list;
}

async function fetchClaudeModels(claudePath: string): Promise<{ id: string; name: string; description?: string }[]> {
  const q = query({ prompt: (async function* () { /* never yields */ })(), options: { pathToClaudeCodeExecutable: claudePath, cwd: process.env.HOME, env: process.env as Record<string, string>, persistSession: false } });
  try {
    const models = await Promise.race([
      q.supportedModels(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
    ]);
    return models.map((m) => ({ id: m.value, name: m.displayName, description: (m as { description?: string }).description }));
  } finally {
    try { q.close(); } catch { /* ignore */ }
  }
}
