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
export interface UpdateStatus { repo: string; branch: string | null; installed: BuildInfo; remote: BuildInfo | null; available: boolean; commits: { hash: string; subject: string }[]; checkedAt: number; error: string | null }

export interface GitFile { path: string; index: string; worktree: string; staged: boolean; untracked: boolean }
export interface GitBranch { name: string; current: boolean; remote: boolean; upstream: string | null }
export interface GitStatus { repo: boolean; root: string | null; branch: string | null; ahead: number; behind: number; files: GitFile[] }

export interface RecentSession { agent: 'claude' | 'codex'; sessionId: string; title: string; cwd: string | null; lastModified: number; pinned?: boolean }
export interface ModelInfo { id: string; name: string; description?: string; isDefault?: boolean }

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
  text: (path: string) => req<{ content: string; truncated: boolean; size: number }>(`/api/fs/text?path=${q(path)}`),
  rawUrl: (path: string) => `/api/fs/raw?path=${q(path)}`,
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
  historyAll: (limit = 20) => req<RecentSession[]>(`/api/history-all?limit=${limit}`),
  models: (agent: 'claude' | 'codex') => req<ModelInfo[]>(`/api/models?agent=${agent}`),
  recent: () => req<string[]>('/api/recent'),
  pushRecent: (path: string) =>
    req<string[]>('/api/recent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) }),
  tools: () => req<ToolsInfo>('/api/tools'),
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
  search: (cwd: string, query: string) => req<{ path: string; rel: string; isDir: boolean }[]>(`/api/fs/search?cwd=${q(cwd)}&q=${q(query)}`),
  health: () => req<{ ok: boolean; version: string; commit: string; builtAt: string | null }>('/api/health'),
  updateStatus: (force = false) => req<UpdateStatus>(`/api/update/status${force ? '?force=1' : ''}`),
  updateApplyUrl: (force = false) => `/api/update/apply${force ? '?force=1' : ''}`,
  open: (path: string, app: 'terminal' | 'iterm' | 'finder' | 'vscode' | 'cursor' = 'terminal', command?: string) =>
    req<{ ok: true }>('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, app, command }) }),
  gitStatus: (cwd: string) => req<GitStatus>(`/api/git/status?cwd=${q(cwd)}`),
  gitDiff: (cwd: string, path: string, staged: boolean) => fetch(`/api/git/diff?cwd=${q(cwd)}&path=${q(path)}&staged=${staged ? 1 : 0}`).then((r) => r.text()),
  gitLog: (cwd: string) => req<{ hash: string; subject: string; author: string; date: string }[]>(`/api/git/log?cwd=${q(cwd)}`),
  gitStage: (cwd: string, paths: string[], action: 'add' | 'reset' | 'discard') =>
    req<{ ok: true }>('/api/git/stage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd, paths, action }) }),
  gitBranches: (cwd: string) => req<GitBranch[]>(`/api/git/branches?cwd=${q(cwd)}`),
  gitCheckout: (cwd: string, branch: string, create = false) => post<{ ok: boolean; output: string }>('/api/git/checkout', { cwd, branch, create }),
  gitRemote: (cwd: string, op: 'fetch' | 'pull' | 'push') => post<{ ok: boolean; output: string }>('/api/git/remote', { cwd, op }),
  gitCommit: (cwd: string, message: string) =>
    req<{ ok: boolean; output: string }>('/api/git/commit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd, message }) }),
  historyMessages: (cwd: string, id: string) => req<HistoryMessage[]>(`/api/history/${q(id)}?cwd=${q(cwd)}`),
};

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
