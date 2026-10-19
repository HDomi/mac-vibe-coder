import path from 'node:path';
import { readFileSync } from 'node:fs';
import { run, streamShell } from './shell.js';
import { REPO_ROOT } from './paths.js';
export { REPO_ROOT };

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
  /** Commits between the installed build and the pushed head (informational). */
  commits: { hash: string; subject: string }[];
  checkedAt: number;
  error: string | null;
}

let cached: UpdateStatus | null = null;
let applying = false;
let checking: Promise<UpdateStatus> | null = null;
export function isUpdating() { return applying; }

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

/** The build this process started with. Read once: a rebuild on disk is not "installed" until the server restarts. */
const INSTALLED: BuildInfo = readBuildInfo();

export function checkUpdate(force = false): Promise<UpdateStatus> {
  if (checking) return checking;
  if (applying) return Promise.resolve(cached ?? { repo: REPO_ROOT, branch: null, installed: INSTALLED, remote: null, available: false, commits: [], checkedAt: Date.now(), error: 'An update is running' });
  checking = readUpdate(force).finally(() => { checking = null; });
  return checking;
}

async function readUpdate(force: boolean): Promise<UpdateStatus> {
  if (!force && cached && Date.now() - cached.checkedAt < CHECK_TTL_MS) return cached;
  const installed = INSTALLED;
  const status: UpdateStatus = { repo: REPO_ROOT, branch: null, installed, remote: null, available: false, commits: [], checkedAt: Date.now(), error: null };
  try {
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (!branch.ok) throw new Error(branch.stderr || 'not a git repository');
    status.branch = branch.stdout;
    if (status.branch === 'HEAD') throw new Error('Updates require a branch checkout, not detached HEAD.');
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
    // Commit list between the installed build and the pushed head (only when the installed commit is known locally).
    if (fetched.ok && status.available && installed.commit !== 'unknown') {
      const log = await git(['log', '--format=%h%x09%s', '-20', `${installed.commit}..origin/${status.branch}`]);
      if (log.ok) status.commits = log.stdout.split('\n').filter(Boolean).map((l) => { const [hash, ...rest] = l.split('\t'); return { hash, subject: rest.join('\t') }; });
    }
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
  const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  const cmd = `/bin/zsh ${quote(path.join(REPO_ROOT, 'scripts/apply-update.sh'))}`;
  if (applying) return Promise.reject(new Error('An update is already running'));
  applying = true;
  return (checking ?? Promise.resolve()).then(() => streamShell(cmd, onLine)).finally(() => { applying = false; cached = null; });
}
