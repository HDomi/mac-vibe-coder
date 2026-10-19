import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, streamShell } from './shell.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Repository root: dist/server/updater.js -> ../.. ; server/updater.ts (tsx) -> .. */
export const REPO_ROOT = path.resolve(__dirname, __dirname.includes(`${path.sep}dist${path.sep}`) ? '../..' : '..');

const CHECK_TTL_MS = 10 * 60 * 1000;
/** Exit code that tells the launcher (Electron / launchd) to restart us after an update. */
export const RESTART_EXIT_CODE = 75;

export interface UpdateStatus {
  repo: string;
  branch: string | null;
  local: string | null;
  remote: string | null;
  behind: number;
  ahead: number;
  dirty: boolean;
  commits: { hash: string; subject: string }[];
  checkedAt: number;
  error: string | null;
}

let cached: UpdateStatus | null = null;

async function git(args: string[]) { return run('git', ['-C', REPO_ROOT, ...args], 60000); }

export async function checkUpdate(force = false): Promise<UpdateStatus> {
  if (!force && cached && Date.now() - cached.checkedAt < CHECK_TTL_MS) return cached;
  const status: UpdateStatus = { repo: REPO_ROOT, branch: null, local: null, remote: null, behind: 0, ahead: 0, dirty: false, commits: [], checkedAt: Date.now(), error: null };
  try {
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (!branch.ok) throw new Error(branch.stderr || 'not a git repository');
    status.branch = branch.stdout;
    const fetch = await git(['fetch', '--quiet', 'origin']);
    if (!fetch.ok) throw new Error(fetch.stderr || 'git fetch failed');
    const upstream = `origin/${status.branch}`;
    status.local = (await git(['rev-parse', '--short', 'HEAD'])).stdout;
    const remote = await git(['rev-parse', '--short', upstream]);
    if (!remote.ok) throw new Error(`no upstream ${upstream}`);
    status.remote = remote.stdout;
    const counts = (await git(['rev-list', '--left-right', '--count', `HEAD...${upstream}`])).stdout.split(/\s+/);
    status.ahead = Number(counts[0] ?? 0);
    status.behind = Number(counts[1] ?? 0);
    status.dirty = (await git(['status', '--porcelain'])).stdout.length > 0;
    if (status.behind > 0) {
      const log = await git(['log', '--format=%h%x09%s', `HEAD..${upstream}`]);
      status.commits = log.stdout.split('\n').filter(Boolean).map((l) => { const [hash, ...rest] = l.split('\t'); return { hash, subject: rest.join('\t') }; });
    }
  } catch (err) {
    status.error = (err as Error).message;
  }
  cached = status;
  return status;
}

/** git pull + install + build, streamed line by line. Resolves with the exit code; caller restarts on 0. */
export function applyUpdate(onLine: (line: string, stream: 'stdout' | 'stderr') => void): Promise<number> {
  const cmd = `cd "${REPO_ROOT}" && git pull --ff-only && npm ci --no-audit --no-fund && npm run build`;
  cached = null;
  return streamShell(cmd, onLine);
}
