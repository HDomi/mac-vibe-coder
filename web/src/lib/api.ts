export type PreviewKind = 'markdown' | 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'binary';

export interface Entry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
  ext: string;
  hidden: boolean;
  kind: PreviewKind;
}

export interface TextFile { content: string; truncated: boolean; size: number; mtime: number; binary: boolean; lossy: boolean; bom: boolean }

export interface Listing { path: string; parent: string | null; entries: Entry[] }
export interface Favorite { path: string; name: string; group?: string }
export interface FavoriteGroup { id: string; name: string; collapsed?: boolean }
export interface Favorites { favorites: Favorite[]; groups: FavoriteGroup[] }
export interface HomeInfo { home: string; volumes: string[]; shortcuts: { name: string; path: string }[] }

export interface ToolStatus {
  id: 'claude' | 'codex';
  name: string;
  installed: boolean;
  path: string | null;
  version: string | null;
  loggedIn: boolean | null;
  authInfo: string | null;
}
export interface ToolsInfo { tools: ToolStatus[]; installers: { brew: string | null; npm: string | null; node: string | null } }

export interface UsageWindow { usedPct: number; resetsAt: number | null }
export interface UsageSnapshot {
  fetchedAt: number;
  claude: { fiveHour: UsageWindow | null; weekly: UsageWindow | null; model: (UsageWindow & { name: string }) | null; plan: string | null } | null;
  codex: { fiveHour: UsageWindow | null; weekly: UsageWindow | null; plan: string | null } | null;
  errors: string[];
}
export interface HistorySession { agent: 'claude' | 'codex'; sessionId: string; summary: string; lastModified: number; customTitle?: string; firstPrompt?: string; gitBranch?: string; cwd?: string; pinned?: boolean }
export interface HistoryMessage { type: string; uuid: string; message: unknown; parent_tool_use_id: string | null }

export interface BuildInfo { version: string; commit: string; builtAt: string | null }
export interface ReleaseSummary { version: string; tag: string; name: string; publishedAt: string | null; notes: string }
export interface UpdateStatus { source: 'release' | 'git'; repo: string; branch: string | null; installed: BuildInfo; remote: BuildInfo | null; available: boolean; commits: { hash: string; subject: string }[]; checkedAt: number; error: string | null; releases?: ReleaseSummary[] }

export interface GitFile { path: string; index: string; worktree: string; staged: boolean; untracked: boolean }
export interface GitCommit { hash: string; parents: string[]; refs: string[]; subject: string; author: string; date: string }
export interface SavedPrompt { id: string; name: string; text: string }
export interface GitCommitFile { path: string; status: string; oldPath?: string }
export interface GitBranch { name: string; current: boolean; remote: boolean; upstream: string | null }
export interface GitStatus { repo: boolean; root: string | null; branch: string | null; ahead: number; behind: number; files: GitFile[] }

export interface RecentSession { agent: 'claude' | 'codex'; sessionId: string; title: string; cwd: string | null; lastModified: number; pinned?: boolean }
export interface ModelInfo { id: string; name: string; description?: string; isDefault?: boolean }

export interface ProxyRequest { method: string; url: string; headers?: [string, string][]; body?: string; bodyBase64?: string; timeoutMs?: number; followRedirects?: boolean; insecure?: boolean }
export type ProxyResult =
  | { ok: true; status: number; statusText: string; httpVersion: string; url: string; headers: [string, string][]; body: string; encoding: 'utf8' | 'base64'; size: number; wireSize: number; truncated: boolean; timing: { ttfb: number; total: number }; redirects: { status: number; url: string }[] }
  | { ok: false; error: string; code?: string; timing: { total: number } };
export interface NetInfo { hostname: string; lan: string | null; interfaces: { name: string; address: string; family: 'IPv4' | 'IPv6'; internal: boolean; mac: string; cidr: string | null }[] }
export interface ListeningPort { pid: number; command: string; user: string; address: string; port: number; cwd: string | null; self: boolean }

export interface RunScript { name: string; command: string }
export interface RunInfo { id: string; cwd: string; name: string; command: string; status: 'running' | 'exited'; exitCode: number | null; startedAt: number; endedAt?: number; url: string | null }

/** A session's own git worktree; `origin` is the project folder it was started from. */
export interface WorktreeInfo { path: string; branch: string; root: string; baseBranch: string | null; origin?: string; /** A review / handoff session working in another session's worktree: no merge or discard from here. */ shared?: boolean }
export interface WorktreeStatus { exists: boolean; dirty: string[]; ahead: number; branch: string | null }

export interface BacklogItem { id: string; text: string; status: 'todo' | 'running' | 'done' | 'failed' | 'stopped'; sessionId?: string; createdAt: number; startedAt?: number; endedAt?: number }
export interface Backlog { items: BacklogItem[]; auto: boolean; agent: 'claude' | 'codex'; mode: string; worktree: boolean }

export interface ContextDoc { scope: 'project' | 'user'; agent: 'claude' | 'codex'; path: string; exists: boolean; content: string; mtime: number | null }
export interface AgentContext {
  docs: ContextDoc[];
  skills: { scope: 'project' | 'user'; agent: 'claude' | 'codex'; name: string; description: string; path: string }[];
  hooks: { scope: 'project' | 'user'; file: string; event: string; matcher: string; command: string }[];
  mcp: { scope: 'project' | 'user'; agent: 'claude' | 'codex'; name: string; command: string; file: string }[];
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let body: { error?: string; code?: string } = {};
    try { body = await res.json(); } catch { /* ignore */ }
    throw new ApiError(body.code ?? 'HTTP', body.error ?? res.statusText, res.status);
  }
  return res.json() as Promise<T>;
}

const q = (p: string) => encodeURIComponent(p);
const post = <T,>(url: string, body: unknown) => req<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  home: () => req<HomeInfo>('/api/home'),
  list: (path: string) => req<Listing>(`/api/fs/list?path=${q(path)}`),
  stat: (path: string) => req<Entry>(`/api/fs/stat?path=${q(path)}`),
  text: (path: string) => req<TextFile>(`/api/fs/text?path=${q(path)}`),
  saveText: (path: string, content: string, opts: { baseMtime: number | null; bom: boolean; force?: boolean }) =>
    req<{ mtime: number; size: number }>('/api/fs/text', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, content, ...opts }) }),
  fsCreate: (dir: string, name: string) => post<{ path: string }>('/api/fs/create', { dir, name }),
  rawUrl: (path: string) => `/api/fs/raw?path=${q(path)}`,
  imageInfo: (path: string) => req<{ width: number; height: number; format: string; hasAlpha: boolean }>(`/api/image/info?path=${q(path)}`),
  imagePngUrl: (path: string, opts: { width?: number; height?: number; fit?: number } = {}) =>
    `/api/image/png?path=${q(path)}${opts.width ? `&width=${opts.width}` : ''}${opts.height ? `&height=${opts.height}` : ''}${opts.fit ? `&fit=${opts.fit}` : ''}`,
  imageConvert: (body: { path: string; dest: string; format: string; width?: number; height?: number; quality?: number; overwrite?: boolean }) => post<{ path: string }>('/api/image/convert', body),
  imageWrite: (dest: string, data: string, overwrite: boolean) => post<{ path: string }>('/api/image/write', { dest, data, overwrite }),
  netHttp: (r: ProxyRequest) => post<ProxyResult>('/api/net/http', r),
  netInfo: () => req<NetInfo>('/api/net/info'),
  netPorts: () => req<ListeningPort[]>('/api/net/ports'),
  netKill: (pid: number, force: boolean) => post<{ ok: true }>('/api/net/kill', { pid, force }),
  projectIconUrl: (path: string) => `/api/project-icon?path=${q(path)}`,
  favorites: () => req<Favorites>('/api/favorites'),
  addFavorite: (path: string, name?: string) => post<Favorites>('/api/favorites', { path, name }),
  removeFavorite: (path: string) => req<Favorites>(`/api/favorites?path=${q(path)}`, { method: 'DELETE' }),
  updateFavorite: (path: string, patch: { name?: string; group?: string | null }) =>
    req<Favorites>('/api/favorites', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, ...patch }) }),
  addFavoriteGroup: (name: string) => post<Favorites>('/api/favorites/groups', { name }),
  updateFavoriteGroup: (id: string, patch: { name?: string; collapsed?: boolean }) =>
    req<Favorites>('/api/favorites/groups', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, ...patch }) }),
  removeFavoriteGroup: (id: string) => req<Favorites>(`/api/favorites/groups?id=${q(id)}`, { method: 'DELETE' }),
  removeRecent: (path: string) => req<string[]>(`/api/recent?path=${q(path)}`, { method: 'DELETE' }),
  fsMkdir: (dir: string, name: string) => post<{ path: string }>('/api/fs/mkdir', { dir, name }),
  fsRename: (path: string, name: string) => post<{ path: string }>('/api/fs/rename', { path, name }),
  fsCopy: (paths: string[], dest: string) => post<{ paths: string[] }>('/api/fs/copy', { paths, dest }),
  fsMove: (paths: string[], dest: string) => post<{ paths: string[] }>('/api/fs/move', { paths, dest }),
  fsDuplicate: (path: string) => post<{ path: string }>('/api/fs/duplicate', { path }),
  fsTrash: (paths: string[]) => post<{ ok: true }>('/api/fs/trash', { paths }),
  fsWatchUrl: (path: string) => `/api/fs/watch?path=${q(path)}`,
  /** One stream for a recursive root plus the folders of open files outside it. */
  fsWatchManyUrl: (deep: string[], flat: string[]) => `/api/fs/watch?${[...deep.map((p) => `rpath=${q(p)}`), ...flat.map((p) => `path=${q(p)}`)].join('&')}`,
  clipboardFiles: () => req<{ change: number; paths: string[] }>('/api/clipboard/files'),
  setClipboardFiles: (paths: string[]) => post<{ change: number }>('/api/clipboard/files', { paths }),
  historyAll: (limit = 20) => req<RecentSession[]>(`/api/history-all?limit=${limit}`),
  models: (agent: 'claude' | 'codex') => req<ModelInfo[]>(`/api/models?agent=${agent}`),
  recent: () => req<string[]>('/api/recent'),
  pushRecent: (path: string) =>
    req<string[]>('/api/recent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) }),
  tools: (force = false) => req<ToolsInfo>(`/api/tools${force ? '?force=1' : ''}`),
  installUrl: (tool: string, method: string) => `/api/tools/install?tool=${q(tool)}&method=${q(method)}`,
  usage: (force = false) => req<UsageSnapshot>(`/api/usage${force ? '?force=1' : ''}`),
  attach: (files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    return req<{ path: string; name: string; kind: 'image' | 'file'; mime?: string }[]>('/api/attach', { method: 'POST', body: fd });
  },
  history: (cwd: string, agent: 'claude' | 'codex' | 'all' = 'all') => req<HistorySession[]>(`/api/history?cwd=${q(cwd)}&agent=${agent}`),
  historyRename: (agent: 'claude' | 'codex', id: string, title: string, cwd?: string) => post<{ ok: true }>('/api/history/rename', { agent, id, title, cwd }),
  historyPin: (agent: 'claude' | 'codex', id: string, pinned: boolean) => post<{ ok: true }>('/api/history/pin', { agent, id, pinned }),
  historyDelete: (agent: 'claude' | 'codex', id: string, cwd?: string) => req<{ ok: true }>(`/api/history/${q(id)}?agent=${agent}${cwd ? `&cwd=${q(cwd)}` : ''}`, { method: 'DELETE' }),
  prompts: () => req<SavedPrompt[]>('/api/prompts'),
  savePrompts: (list: SavedPrompt[]) => req<SavedPrompt[]>('/api/prompts', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(list) }),
  envFiles: (cwd: string) => req<{ path: string; rel: string; size: number }[]>(`/api/fs/env-files?cwd=${q(cwd)}`),
  search: (cwd: string, query: string) => req<{ path: string; rel: string; isDir: boolean }[]>(`/api/fs/search?cwd=${q(cwd)}&q=${q(query)}`),
  health: () => req<{ ok: boolean; version: string; commit: string; builtAt: string | null }>('/api/health'),
  updateStatus: (force = false) => req<UpdateStatus>(`/api/update/status${force ? '?force=1' : ''}`),
  updateApplyUrl: (force = false, version?: string) => `/api/update/apply?${[force ? 'force=1' : '', version ? `version=${q(version)}` : ''].filter(Boolean).join('&')}`,
  open: (path: string, app: 'terminal' | 'iterm' | 'finder' | 'vscode' | 'cursor' = 'terminal') =>
    req<{ ok: true }>('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, app }) }),
  gitStatus: (cwd: string) => req<GitStatus>(`/api/git/status?cwd=${q(cwd)}`),
  gitDiff: (cwd: string, path: string, staged: boolean) => fetch(`/api/git/diff?cwd=${q(cwd)}&path=${q(path)}&staged=${staged ? 1 : 0}`).then((r) => r.text()),
  gitLog: (cwd: string, skip = 0, limit = 30) => req<{ commits: GitCommit[]; hasMore: boolean }>(`/api/git/log?cwd=${q(cwd)}&skip=${skip}&limit=${limit}`),
  gitCommitFiles: (cwd: string, hash: string) => req<GitCommitFile[]>(`/api/git/show?cwd=${q(cwd)}&hash=${q(hash)}`),
  gitCommitDiff: (cwd: string, hash: string, path: string) => fetch(`/api/git/show-diff?cwd=${q(cwd)}&hash=${q(hash)}&path=${q(path)}`).then(async (r) => { const text = await r.text(); if (!r.ok) throw new Error(text || r.statusText); return text; }),
  gitStage: (cwd: string, paths: string[], action: 'add' | 'reset' | 'discard') =>
    req<{ ok: true }>('/api/git/stage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd, paths, action }) }),
  gitBranches: (cwd: string) => req<GitBranch[]>(`/api/git/branches?cwd=${q(cwd)}`),
  gitCheckout: (cwd: string, branch: string, create = false) => post<{ ok: boolean; output: string }>('/api/git/checkout', { cwd, branch, create }),
  gitRemote: (cwd: string, op: 'fetch' | 'pull' | 'push') => post<{ ok: boolean; output: string }>('/api/git/remote', { cwd, op }),
  gitSuggestMessage: (cwd: string) => post<{ message: string; agent: 'claude' | 'codex' }>('/api/git/suggest-message', { cwd }),
  gitCommit: (cwd: string, message: string) =>
    req<{ ok: boolean; output: string }>('/api/git/commit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd, message }) }),
  agentContext: (cwd: string) => req<AgentContext>(`/api/agent-context?cwd=${q(cwd)}`),
  backlogAll: () => req<{ cwd: string; backlog: Backlog }[]>('/api/backlog/all'),
  saveBacklog: (cwd: string, backlog: Backlog) => req<Backlog>('/api/backlog', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd, backlog }) }),
  worktreeList: (cwd: string) => req<WorktreeInfo[]>(`/api/worktree/list?cwd=${q(cwd)}`),
  worktreeCreate: (cwd: string, branch?: string) => post<WorktreeInfo>('/api/worktree/create', { cwd, branch }),
  worktreeStatus: (info: WorktreeInfo) => post<WorktreeStatus>('/api/worktree/status', { info }),
  worktreeMerge: (info: WorktreeInfo, commitMessage?: string) => post<{ ok: boolean; merged: boolean; removed: boolean; message: string; conflicts?: string[]; reason?: string }>('/api/worktree/merge', { info, commitMessage }),
  worktreeRemove: (info: WorktreeInfo, force: boolean) => post<{ ok: boolean; message: string }>('/api/worktree/remove', { info, force }),
  runScripts: (cwd: string) => req<{ manager: string; scripts: RunScript[] }>(`/api/run/scripts?cwd=${q(cwd)}`),
  runList: (cwd: string) => req<RunInfo[]>(`/api/run/list?cwd=${q(cwd)}`),
  runStart: (cwd: string, name: string, command: string) => post<RunInfo>('/api/run/start', { cwd, name, command }),
  runStop: (id: string) => post<{ ok: boolean }>('/api/run/stop', { id }),
  runRemove: (id: string) => post<{ ok: boolean }>('/api/run/remove', { id }),
  runStreamUrl: (id: string, after = -1) => `/api/run/stream?id=${q(id)}&after=${after}`,
  turnDiff: (root: string, from: string, to: string, path: string) =>
    fetch(`/api/turns/diff?root=${q(root)}&from=${q(from)}&to=${q(to)}&path=${q(path)}`).then(async (r) => { const text = await r.text(); if (!r.ok) throw new Error(text || r.statusText); return text; }),
  turnRevert: (body: { root: string; from: string; to: string; files?: string[]; hunk?: { file: string; index: number }; force?: boolean }) =>
    post<{ ok: boolean; reverted: string[]; conflicts: string[]; error?: string }>('/api/turns/revert', body),
  projectVerify: (cwd: string) => req<{ command: string; auto: boolean; suggestions: string[] }>(`/api/project/verify?cwd=${q(cwd)}`),
  saveProjectVerify: (cwd: string, command: string, auto: boolean) =>
    req<{ command: string; auto: boolean }>('/api/project/verify', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd, command, auto }) }),
  // Bounded: a request that never settles would leave a remembered session blank until the next reload.
  historyMessages: (cwd: string, id: string) => req<HistoryMessage[]>(`/api/history/${q(id)}?cwd=${q(cwd)}`, { signal: AbortSignal.timeout(30000) }),
};

// Formats Chromium decodes itself; anything else (HEIC, TIFF, PSD, RAW, …) is shown as a PNG rendered by ImageIO.
const BROWSER_IMAGE = new Set(['.png', '.apng', '.jpg', '.jpeg', '.jfif', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico']);
export function imageSrc(path: string, ext: string, rev = 0): string {
  const v = rev ? `&v=${rev}` : '';
  return BROWSER_IMAGE.has(ext.toLowerCase()) ? api.rawUrl(path) + v : api.imagePngUrl(path, { fit: 2048 }) + v;
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
