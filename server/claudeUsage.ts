import { homedir } from 'node:os';
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { which } from './shell.js';
import type { ClaudeUsage, UsageWindow } from './usage.js';

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;

function window(value: unknown, field = 'utilization'): UsageWindow | null {
  const data = object(value);
  const percent = data?.[field];
  // A missing/null reading is unknown, never zero consumption.
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0) return null;
  const reset = data?.resets_at;
  const timestamp = typeof reset === 'number' ? (reset > 1e12 ? reset / 1000 : reset) : typeof reset === 'string' ? Date.parse(reset) / 1000 : NaN;
  return { usedPct: Math.round(percent), resetsAt: Number.isFinite(timestamp) ? Math.floor(timestamp) : null };
}

/** Accept both current server-defined meter rows and older structured SDK windows. */
export function normalizeClaudeUsage(value: unknown): ClaudeUsage | null {
  const data = object(value);
  if (!data) throw new Error('Invalid Claude usage response');
  if (data.rate_limits_available === false) return null;
  const limits = object(data.rate_limits);
  if (!limits) throw new Error('Claude CLI could not read subscription usage. Try again later.');
  const rows = Array.isArray(limits.limits) ? limits.limits.map(object).filter((row): row is RecordValue => row !== null) : [];
  const find = (kind: string) => rows.find((row) => row.kind === kind && window(row, 'percent'));
  const fiveHour = window(find('session'), 'percent') ?? window(limits.five_hour);
  const weekly = window(find('weekly_all'), 'percent') ?? window(limits.seven_day);
  let model: ClaudeUsage['model'] = null;
  for (const row of rows) {
    const name = object(object(row.scope)?.model)?.display_name;
    const reading = window(row, 'percent');
    if (row.kind === 'weekly_scoped' && typeof name === 'string' && reading) { model = { ...reading, name }; break; }
  }
  if (!model && Array.isArray(limits.model_scoped)) {
    for (const value of limits.model_scoped) {
      const entry = object(value), reading = window(entry);
      if (typeof entry?.display_name === 'string' && reading) { model = { ...reading, name: entry.display_name }; break; }
    }
  }
  if (!model) {
    for (const [key, name] of [['seven_day_opus', 'Opus'], ['seven_day_sonnet', 'Sonnet']]) {
      const reading = window(limits[key]);
      if (reading) { model = { ...reading, name }; break; }
    }
  }
  if (!fiveHour && !weekly && !model) throw new Error('Claude CLI returned no subscription usage readings. Try again later.');
  return { fiveHour, weekly, model, plan: typeof data.subscription_type === 'string' ? data.subscription_type : null };
}

export interface UsageQuery extends AsyncIterable<unknown> {
  // Experimental SDK surface: guard it rather than silently showing fabricated zeroes on older CLIs.
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: (options: { skipBehaviors: boolean }) => Promise<unknown>;
  close(): void;
}

/** Control requests only: no prompt, model response, hooks, tools or persisted chat session. */
export async function queryClaudeUsage(create: (abort: AbortController) => UsageQuery, timeoutMs = 15000): Promise<ClaudeUsage | null> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let q: UsageQuery | undefined;
  try {
    q = create(abort);
    const usage = q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
    if (typeof usage !== 'function') throw new Error('Update Claude Code to enable structured usage reporting.');
    // Drain initialization/control events without sending a user message.
    void (async () => { try { for await (const _message of q!) { /* no model turns */ } } catch { /* reported by the control request */ } })();
    const result = await Promise.race([
      usage.call(q, { skipBehaviors: true }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Claude usage lookup timed out')), timeoutMs); }),
    ]);
    return normalizeClaudeUsage(result);
  } finally {
    if (timer) clearTimeout(timer);
    abort.abort();
    try { q?.close(); } catch { /* already exited */ }
  }
}

export async function fetchClaudeUsage(): Promise<ClaudeUsage | null> {
  const claudePath = await which('claude');
  if (!claudePath) return null;
  return queryClaudeUsage((abort) => {
    async function* input(): AsyncGenerator<SDKUserMessage> {
      if (!abort.signal.aborted) await new Promise<void>((resolve) => abort.signal.addEventListener('abort', () => resolve(), { once: true }));
    }
    return query({ prompt: input(), options: {
      cwd: homedir(), pathToClaudeCodeExecutable: claudePath, persistSession: false,
      settingSources: [], settings: { disableAllHooks: true }, tools: [],
      permissionMode: 'default', abortController: abort,
    } });
  });
}
