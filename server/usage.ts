import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';

const execFileP = promisify(execFile);
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface UsageWindow { usedPct: number; resetsAt: number | null }
export interface ClaudeUsage { fiveHour: UsageWindow | null; weekly: UsageWindow | null; model: (UsageWindow & { name: string }) | null; plan: string | null }
export interface CodexUsage { fiveHour: UsageWindow | null; weekly: UsageWindow | null; plan: string | null }
export interface UsageSnapshot { fetchedAt: number; claude: ClaudeUsage | null; codex: CodexUsage | null; errors: string[] }

let cache: UsageSnapshot | null = null;
let inflight: Promise<UsageSnapshot> | null = null;

const toTs = (iso: unknown) => (typeof iso === 'string' ? Math.floor(Date.parse(iso) / 1000) : null);

async function readClaudeToken(): Promise<string | null> {
  try {
    const { stdout } = await execFileP('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 4000 });
    const o = JSON.parse(stdout.trim())?.claudeAiOauth;
    if (o?.accessToken) return o.accessToken;
  } catch { /* fall back */ }
  try {
    const raw = await fs.readFile(path.join(homedir(), '.claude', '.credentials.json'), 'utf8');
    return JSON.parse(raw)?.claudeAiOauth?.accessToken ?? null;
  } catch { return null; }
}

async function fetchClaude(): Promise<ClaudeUsage | null> {
  const token = await readClaudeToken();
  if (!token) return null;
  const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`claude usage HTTP ${res.status}`);
  const d = await res.json() as Record<string, unknown>;
  const win = (o: unknown): UsageWindow | null => {
    if (!o || typeof o !== 'object') return null;
    const w = o as { utilization?: number; resets_at?: string };
    return { usedPct: Math.round(w.utilization ?? 0), resetsAt: toTs(w.resets_at) };
  };
  let model: ClaudeUsage['model'] = null;
  for (const l of (d.limits as Array<Record<string, unknown>> | undefined) ?? []) {
    const name = (l.scope as { model?: { display_name?: string } } | undefined)?.model?.display_name;
    if (l.group === 'weekly' && name) { model = { name, usedPct: Math.round(Number(l.percent ?? 0)), resetsAt: toTs(l.resets_at) }; break; }
  }
  return { fiveHour: win(d.five_hour), weekly: win(d.seven_day), model, plan: null };
}

const CODEX_AUTH = path.join(homedir(), '.codex', 'auth.json');
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

async function readCodexAuth() {
  const d = JSON.parse(await fs.readFile(CODEX_AUTH, 'utf8'));
  const accessToken = d?.tokens?.access_token ?? d?.access_token ?? null;
  return accessToken ? { accessToken: accessToken as string, accountId: (d?.tokens?.account_id ?? d?.account_id ?? null) as string | null, raw: d } : null;
}

async function refreshCodexAuth(raw: Record<string, unknown>) {
  const tokens = raw.tokens as Record<string, string> | undefined;
  if (!tokens?.refresh_token) return null;
  const res = await fetch('https://auth.openai.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID, grant_type: 'refresh_token', refresh_token: tokens.refresh_token, scope: 'openid profile email' }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const r = await res.json() as Record<string, string>;
  if (!r.access_token) return null;
  tokens.access_token = r.access_token;
  if (r.id_token) tokens.id_token = r.id_token;
  if (r.refresh_token) tokens.refresh_token = r.refresh_token;
  raw.last_refresh = new Date().toISOString();
  await fs.writeFile(CODEX_AUTH, JSON.stringify(raw, null, 2));
  return { accessToken: r.access_token, accountId: tokens.account_id ?? null };
}

async function fetchCodex(): Promise<CodexUsage | null> {
  const auth = await readCodexAuth().catch(() => null);
  if (!auth) return null;
  const request = async (a: { accessToken: string; accountId: string | null }) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${a.accessToken}`, 'User-Agent': 'mac-vibe-coder', Accept: 'application/json' };
    if (a.accountId) headers['ChatGPT-Account-Id'] = a.accountId;
    return fetch('https://chatgpt.com/backend-api/wham/usage', { headers, signal: AbortSignal.timeout(7000) });
  };
  let res = await request(auth);
  if (res.status === 401) {
    const refreshed = await refreshCodexAuth(auth.raw);
    if (!refreshed) throw new Error('codex token refresh failed');
    res = await request(refreshed);
  }
  if (!res.ok) throw new Error(`codex usage HTTP ${res.status}`);
  const d = await res.json() as Record<string, unknown>;
  const win = (o: unknown): UsageWindow | null => {
    if (!o || typeof o !== 'object') return null;
    const w = o as Record<string, unknown>;
    const pct = Number(w.used_percent ?? w.usedPercent);
    if (!Number.isFinite(pct)) return null;
    let resetsAt: number | null = null;
    const r = w.resets_at ?? w.resetsAt ?? w.reset_at;
    if (typeof r === 'number') resetsAt = r > 1e12 ? Math.floor(r / 1000) : Math.floor(r);
    else if (typeof r === 'string') resetsAt = toTs(r);
    else if (w.reset_after_seconds != null) resetsAt = Math.floor(Date.now() / 1000) + Number(w.reset_after_seconds);
    return { usedPct: Math.round(pct), resetsAt };
  };
  const rl = (d.rate_limit ?? d.rateLimit) as Record<string, unknown> | undefined;
  if (rl?.primary_window || rl?.secondary_window) {
    return { fiveHour: win(rl.primary_window), weekly: win(rl.secondary_window), plan: (d.plan_type ?? d.planType ?? rl.plan_type ?? null) as string | null };
  }
  const limits = (d.rateLimits ?? d.rate_limits ?? (d.rateLimitsByLimitId as Record<string, unknown> | undefined)?.codex) as Record<string, unknown> | undefined;
  if (limits?.primary || limits?.secondary) {
    return { fiveHour: win(limits.primary), weekly: win(limits.secondary), plan: (limits.planType ?? d.planType ?? null) as string | null };
  }
  return null;
}

export function getUsage(force = false): Promise<UsageSnapshot> {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = (async () => {
    const errors: string[] = [];
    const [claude, codex] = await Promise.all([
      fetchClaude().catch((e) => { errors.push(`claude: ${e.message}`); return cache?.claude ?? null; }),
      fetchCodex().catch((e) => { errors.push(`codex: ${e.message}`); return cache?.codex ?? null; }),
    ]);
    cache = { fetchedAt: Date.now(), claude, codex, errors };
    return cache;
  })().finally(() => { inflight = null; });
  return inflight;
}
