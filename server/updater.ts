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
    'git pull --ff-only',
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
