import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run, streamShell } from './shell.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Repository root: dist/server/updater.js -> ../.. ; server/updater.ts (tsx) -> .. */
export const REPO_ROOT = path.resolve(__dirname, __dirname.includes(`${path.sep}dist${path.sep}`) ? '../..' : '..');

const CHECK_TTL_MS = 10 * 60 * 1000;
/** Exit code that tells the launcher (Electron / launchd) to restart us after an update. */
export const RESTART_EXIT_CODE = 75;

export interface BuildInfo { version: string; commit: string; builtAt: string | null }

export interface UpdateStatus {
  repo: string;
  branch: string | null;
  /** What the running app was built from (dist/build-info.json). */
  installed: BuildInfo;
  /** What is pushed to origin/<branch>. */
  remote: BuildInfo | null;
  /** True when the pushed version is newer, or same version but a different commit. */
  available: boolean;
  /** Commits the checkout is behind origin (informational). */
  behind: number;
  dirty: boolean;
  commits: { hash: string; subject: string }[];
  checkedAt: number;
  error: string | null;
}

let cached: UpdateStatus | null = null;

async function git(args: string[], timeout = 60000) { return run('git', ['-C', REPO_ROOT, ...args], timeout); }

export function readBuildInfo(): BuildInfo {
  try {
    const raw = JSON.parse(readFileSync(path.join(REPO_ROOT, 'dist', 'build-info.json'), 'utf8'));
    return { version: String(raw.version ?? 'dev'), commit: String(raw.commit ?? 'unknown'), builtAt: raw.builtAt ?? null };
  } catch {
    try { return { version: String(JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version ?? 'dev'), commit: 'unknown', builtAt: null }; }
    catch { return { version: 'dev', commit: 'unknown', builtAt: null }; }
  }
}

/** Positive when a > b (semver-ish: numeric dot parts, prerelease ignored). */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Convert an origin URL (ssh or https) into a raw.githubusercontent.com base, or null for non-GitHub remotes. */
function rawBase(remoteUrl: string, branch: string): string | null {
  const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${branch}` : null;
}

export async function checkUpdate(force = false): Promise<UpdateStatus> {
  if (!force && cached && Date.now() - cached.checkedAt < CHECK_TTL_MS) return cached;
  const installed = readBuildInfo();
  const status: UpdateStatus = { repo: REPO_ROOT, branch: null, installed, remote: null, available: false, behind: 0, dirty: false, commits: [], checkedAt: Date.now(), error: null };
  try {
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (!branch.ok) throw new Error(branch.stderr || 'not a git repository');
    status.branch = branch.stdout;
    const remoteUrl = (await git(['remote', 'get-url', 'origin'])).stdout;
    // Pushed commit: cheap, no object download.
    const ls = await git(['ls-remote', 'origin', `refs/heads/${status.branch}`], 30000);
    if (!ls.ok) throw new Error(ls.stderr || 'git ls-remote failed');
    const remoteCommit = (ls.stdout.split(/\s+/)[0] ?? '').slice(0, 7);
    if (!remoteCommit) throw new Error(`branch ${status.branch} not found on origin`);
    // Pushed version: read package.json from the fetched ref (authoritative). raw.githubusercontent.com
    // is only a fallback because its CDN can lag several minutes behind a push.
    let remoteVersion: string | null = null;
    const fetched = await git(['fetch', '--quiet', 'origin', status.branch]);
    if (fetched.ok) {
      const show = await git(['show', `origin/${status.branch}:package.json`]);
      if (show.ok) { try { remoteVersion = String(JSON.parse(show.stdout).version ?? ''); } catch { /* ignore */ } }
    }
    const base = rawBase(remoteUrl, status.branch);
    if (!remoteVersion && base) {
      try {
        const res = await fetch(`${base}/package.json?ts=${Date.now()}`, { signal: AbortSignal.timeout(8000), headers: { 'Cache-Control': 'no-cache' } });
        if (res.ok) remoteVersion = String((await res.json() as { version?: string }).version ?? '');
      } catch { /* ignore */ }
    }
    status.remote = { version: remoteVersion ?? 'unknown', commit: remoteCommit, builtAt: null };
    const vcmp = remoteVersion ? compareVersions(remoteVersion, installed.version) : 0;
    status.available = vcmp > 0 || (vcmp === 0 && installed.commit !== 'unknown' && !remoteCommit.startsWith(installed.commit) && !installed.commit.startsWith(remoteCommit));
    if (fetched.ok) {
      const upstream = `origin/${status.branch}`;
      const counts = (await git(['rev-list', '--left-right', '--count', `HEAD...${upstream}`])).stdout.split(/\s+/);
      status.behind = Number(counts[1] ?? 0);
      const since = installed.commit !== 'unknown' ? `${installed.commit}..${upstream}` : `HEAD..${upstream}`;
      const log = await git(['log', '--format=%h%x09%s', '-20', since]);
      if (log.ok) status.commits = log.stdout.split('\n').filter(Boolean).map((l) => { const [hash, ...rest] = l.split('\t'); return { hash, subject: rest.join('\t') }; });
    }
    status.dirty = (await git(['status', '--porcelain'])).stdout.length > 0;
  } catch (err) {
    status.error = (err as Error).message;
  }
  cached = status;
  return status;
}

/**
 * Staged update, streamed line by line. Resolves with the exit code; caller restarts on 0.
 * The new version is cloned, installed and built in a temporary directory first; only
 * when that succeeds is the checkout fast-forwarded and the built artifacts
 * (node_modules, dist, web/dist) swapped in. The temp directory is always removed.
 * A failure anywhere leaves the running installation untouched.
 */
export function applyUpdate(onLine: (line: string, stream: 'stdout' | 'stderr') => void): Promise<number> {
  const root = REPO_ROOT.replace(/"/g, '\\"');
  const cmd = [
    'set -e',
    `cd "${root}"`,
    'BRANCH="$(git rev-parse --abbrev-ref HEAD)"',
    'REMOTE="$(git remote get-url origin)"',
    'TMP="$(mktemp -d "${TMPDIR:-/tmp}/mvc-update.XXXXXX")"',
    'trap \'echo "cleanup $TMP"; rm -rf "$TMP"\' EXIT',
    `[ -d "${root}/runtime/node/bin" ] && export PATH="${root}/runtime/node/bin:$PATH" || true`,
    'echo "▸ clone $BRANCH into $TMP"',
    'git clone --quiet --depth 1 --branch "$BRANCH" "$REMOTE" "$TMP/src"',
    'cd "$TMP/src"',
    'echo "▸ npm ci (temp)"',
    'npm ci --no-audit --no-fund',
    'echo "▸ build (temp)"',
    'npm run build',
    `cd "${root}"`,
    'echo "▸ fast-forward checkout"',
    'git pull --ff-only || echo "warn: checkout not fast-forwarded (local changes?); artifacts still updated"',
    'echo "▸ swap in built artifacts"',
    `rsync -a --delete "$TMP/src/node_modules/" "${root}/node_modules/"`,
    `rsync -a --delete "$TMP/src/dist/" "${root}/dist/"`,
    `rsync -a --delete "$TMP/src/web/dist/" "${root}/web/dist/"`,
    'echo "▸ brand runtime"',
    'scripts/brand-electron.sh || true',
    'echo "▸ done: $(git rev-parse --short HEAD)"',
  ].join('\n');
  cached = null;
  return streamShell(cmd, onLine);
}
