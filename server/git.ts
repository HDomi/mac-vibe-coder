import { run } from './shell.js';
import { resolvePath } from './fs.js';

export interface GitFile { path: string; index: string; worktree: string; staged: boolean; untracked: boolean }
export interface GitStatus { repo: boolean; root: string | null; branch: string | null; ahead: number; behind: number; files: GitFile[] }

async function git(cwd: string, args: string[], timeout = 30000) {
  return run('git', ['-C', cwd, ...args], timeout);
}

export async function gitStatus(dir: string): Promise<GitStatus> {
  const cwd = resolvePath(dir);
  const root = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (!root.ok) return { repo: false, root: null, branch: null, ahead: 0, behind: 0, files: [] };
  const st = await git(cwd, ['status', '--porcelain=v1', '--branch', '-z']);
  const parts = st.stdout.split('\0');
  const head = parts.shift() ?? '';
  let branch: string | null = null; let ahead = 0; let behind = 0;
  const bm = head.match(/^## (\S+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/);
  if (bm) {
    branch = bm[1].replace(/^No commits yet on /, '');
    const info = bm[3] ?? '';
    ahead = Number(info.match(/ahead (\d+)/)?.[1] ?? 0);
    behind = Number(info.match(/behind (\d+)/)?.[1] ?? 0);
  }
  const files: GitFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const index = p[0]; const worktree = p[1]; const path = p.slice(3);
    if (index === 'R' || index === 'C') i++; // skip rename source entry
    files.push({ path, index, worktree, staged: index !== ' ' && index !== '?', untracked: index === '?' });
  }
  return { repo: true, root: root.stdout, branch, ahead, behind, files };
}

export async function gitDiff(dir: string, path: string, staged: boolean): Promise<string> {
  const cwd = resolvePath(dir);
  const args = staged ? ['diff', '--cached', '--', path] : ['diff', '--', path];
  const r = await git(cwd, args);
  if (r.ok && r.stdout) return r.stdout;
  // Untracked file: show the whole file as additions.
  const nt = await git(cwd, ['diff', '--no-index', '--', '/dev/null', path]);
  return nt.stdout || r.stderr || '';
}

export async function gitStage(dir: string, paths: string[], action: 'add' | 'reset' | 'discard'): Promise<void> {
  const cwd = resolvePath(dir);
  if (action === 'add') await git(cwd, ['add', '--', ...paths]);
  else if (action === 'reset') await git(cwd, ['reset', '-q', '--', ...paths]);
  else await git(cwd, ['checkout', '--', ...paths]);
}

export async function gitCommit(dir: string, message: string): Promise<{ ok: boolean; output: string }> {
  const cwd = resolvePath(dir);
  const r = await git(cwd, ['commit', '-m', message]);
  return { ok: r.ok, output: r.ok ? r.stdout : r.stderr || r.stdout };
}

export interface GitCommit { hash: string; parents: string[]; refs: string[]; subject: string; author: string; date: string }

/** A page of the commit log. `hasMore` is derived by asking for one extra row. */
export async function gitLog(dir: string, skip = 0, limit = 30): Promise<{ commits: GitCommit[]; hasMore: boolean }> {
  const cwd = resolvePath(dir);
  const lim = Math.max(1, Math.min(200, limit));
  const r = await git(cwd, ['log', '--all', '--ignore-missing', '--topo-order', '--decorate=short', `--skip=${Math.max(0, skip)}`, `-${lim + 1}`, '--format=%H%x1f%P%x1f%D%x1f%s%x1f%an%x1f%ar', 'HEAD']);
  if (!r.ok) return { commits: [], hasMore: false };
  const rows = r.stdout.split('\n').filter(Boolean).map((l) => {
    const [hash, parents, refs, subject, author, date] = l.split('\x1f');
    return { hash, parents: parents ? parents.split(' ') : [], refs: refs ? refs.split(', ') : [], subject, author, date };
  });
  return { commits: rows.slice(0, lim), hasMore: rows.length > lim };
}

export interface GitBranch { name: string; current: boolean; remote: boolean; upstream: string | null }

export async function gitBranches(dir: string): Promise<GitBranch[]> {
  const cwd = resolvePath(dir);
  // A literal unit separator in the format string: `%xNN` is not expanded by `git branch --format`.
  const r = await git(cwd, ['for-each-ref', '--format=%(HEAD)\u001f%(refname:short)\u001f%(upstream:short)\u001f%(refname)', 'refs/heads', 'refs/remotes']);
  if (!r.ok) return [];
  return r.stdout.split('\n').filter(Boolean).map((l) => {
    const [head, name, upstream, ref] = l.split('\u001f');
    return { name: name ?? '', current: head === '*', remote: (ref ?? '').startsWith('refs/remotes/'), upstream: upstream || null };
  }).filter((b) => b.name && !b.name.endsWith('/HEAD') && b.name !== 'origin');
}

export async function gitCheckout(dir: string, branch: string, create = false): Promise<{ ok: boolean; output: string }> {
  const cwd = resolvePath(dir);
  const args = create ? ['checkout', '-b', branch] : branch.startsWith('origin/') ? ['checkout', '--track', branch] : ['checkout', branch];
  const r = await git(cwd, args);
  return { ok: r.ok, output: r.ok ? (r.stdout || r.stderr) : r.stderr || r.stdout };
}

export async function gitRemoteOp(dir: string, op: 'fetch' | 'pull' | 'push'): Promise<{ ok: boolean; output: string }> {
  const cwd = resolvePath(dir);
  const args = op === 'fetch' ? ['fetch', '--all', '--prune'] : op === 'pull' ? ['pull', '--ff-only'] : ['push', '-u', 'origin', 'HEAD'];
  const r = await git(cwd, args, 120000);
  return { ok: r.ok, output: [r.stdout, r.stderr].filter(Boolean).join('\n') };
}
