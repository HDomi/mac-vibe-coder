import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { run } from './shell.js';

/*
 * Updates for the standalone app (the .app built by electron-builder, see electron-builder.yml).
 * The release workflow attaches Vibrato-<version>-<arch>-mac.zip and SHA256SUMS.txt to every
 * version tag's GitHub release. Applying an update downloads the zip, checks its hash, unpacks it next to
 * the cache and records it as pending; the Electron main process swaps the bundle in after the app quits
 * and reopens it (electron/main.cts startBundleSwap). Nothing touches the installed app until then.
 */

export const BUNDLE_ID = 'com.hdomi.vibrato';
/** GitHub REST base for the releases. Overridable for local end-to-end tests against a fake feed. */
export const FEED = process.env.VIBRATO_UPDATE_FEED || 'https://api.github.com/repos/HDomi/vibrato';
export const UPDATE_DIR = process.env.VIBRATO_UPDATE_DIR || path.join(homedir(), 'Library', 'Caches', BUNDLE_ID, 'update');
export const PENDING_FILE = 'pending.json';

/** The .app bundle this code runs from, or null when it runs from a source checkout. */
export function bundleOf(root: string): string | null {
  const marker = '.app/Contents/Resources/app';
  const i = root.indexOf(marker);
  return i < 0 ? null : root.slice(0, i + 4);
}

/** Why the bundle cannot replace itself, or null. Translocated or mounted copies are read-only. */
export function bundleProblem(bundle: string): string | null {
  if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) return 'Move Vibrato to the Applications folder and open it from there to enable updates.';
  return null;
}

export interface ReleaseAsset { name: string; browser_download_url: string; size: number }
export interface Release { tag_name: string; name?: string | null; body?: string | null; draft?: boolean; prerelease?: boolean; published_at?: string | null; assets: ReleaseAsset[] }

/** One installable release as the update dialog lists it. */
export interface ReleaseSummary { version: string; tag: string; name: string; publishedAt: string | null; notes: string }

/** The zip for this machine's architecture and the checksum list, as published by the release workflow. */
export function pickAssets(release: Release, arch: string = process.arch): { zip: ReleaseAsset | null; sums: ReleaseAsset | null } {
  const a = arch === 'arm64' ? 'arm64' : 'x64';
  return {
    zip: release.assets.find((x) => x.name.endsWith(`-${a}-mac.zip`)) ?? null,
    sums: release.assets.find((x) => x.name === 'SHA256SUMS.txt') ?? null,
  };
}

/** `shasum -a 256` output ("<hex>  <name>", optional "*" before binary names) to name -> hash. */
export function parseSums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m) out.set(path.basename(m[2].trim()), m[1].toLowerCase());
  }
  return out;
}

const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'vibrato-updater' };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw Object.assign(new Error(`${url.replace(FEED, 'GitHub')}: HTTP ${res.status}`), { status: res.status });
  return await res.json() as T;
}

export const latestRelease = () => getJson<Release>(`${FEED}/releases/latest`);
export const releaseByTag = (tag: string) => getJson<Release>(`${FEED}/releases/tags/${encodeURIComponent(tag)}`);

/** The newest published releases that carry a zip for this machine, newest first. */
export async function recentReleases(limit = 3): Promise<ReleaseSummary[]> {
  const list = await getJson<Release[]>(`${FEED}/releases?per_page=15`);
  return list.filter((r) => !r.draft && !r.prerelease && pickAssets(r).zip && pickAssets(r).sums).slice(0, limit).map((r) => ({
    version: r.tag_name.replace(/^v/, ''), tag: r.tag_name, name: r.name || r.tag_name, publishedAt: r.published_at ?? null, notes: (r.body ?? '').trim().slice(0, 1500),
  }));
}

/** Commit subjects between two tags, newest first (empty when GitHub cannot compare them). */
export async function releaseCommits(fromTag: string, toTag: string): Promise<{ hash: string; subject: string }[]> {
  try {
    const cmp = await getJson<{ commits?: { sha: string; commit: { message: string } }[] }>(`${FEED}/compare/${encodeURIComponent(fromTag)}...${encodeURIComponent(toTag)}`);
    return (cmp.commits ?? []).slice(-20).reverse().map((c) => ({ hash: c.sha.slice(0, 7), subject: c.commit.message.split('\n')[0] }));
  } catch { return []; }
}

async function download(url: string, file: string, onProgress: (pct: number) => void): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': headers['User-Agent'] }, redirect: 'follow', signal: AbortSignal.timeout(15 * 60 * 1000) });
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0; let shown = -1;
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  body.on('data', (chunk: Buffer) => {
    got += chunk.length;
    const pct = total ? Math.floor((got / total) * 10) * 10 : -1;
    if (pct > shown) { shown = pct; onProgress(pct); }
  });
  await pipeline(body, createWriteStream(file));
}

async function sha256(file: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

async function plist(app: string, key: string): Promise<string> {
  const r = await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', path.join(app, 'Contents', 'Info.plist')], 10000);
  return r.ok ? r.stdout.trim() : '';
}

/**
 * Download, verify and unpack `release` into UPDATE_DIR, then record it as pending. Resolves with 0 on success.
 * The running app is not touched; the swap happens after it quits.
 */
export async function stageRelease(release: Release, onLine: (line: string, stream: 'stdout' | 'stderr') => void): Promise<number> {
  const version = release.tag_name.replace(/^v/, '');
  const { zip, sums } = pickAssets(release);
  if (!zip || !sums) { onLine(`Release ${release.tag_name} has no ${process.arch} zip or SHA256SUMS.txt.`, 'stderr'); return 1; }
  await fs.mkdir(UPDATE_DIR, { recursive: true });
  const stage = path.join(UPDATE_DIR, 'staged');
  const zipFile = path.join(UPDATE_DIR, zip.name);
  await fs.rm(stage, { recursive: true, force: true });
  await fs.rm(path.join(UPDATE_DIR, PENDING_FILE), { force: true });
  try {
    onLine(`▸ download ${zip.name} (${(zip.size / 1048576).toFixed(0)} MB)`, 'stdout');
    await download(zip.browser_download_url, zipFile, (pct) => { if (pct >= 0) onLine(`  ${pct}%`, 'stdout'); });
    onLine('▸ verify SHA-256', 'stdout');
    const sumsFile = path.join(UPDATE_DIR, 'SHA256SUMS.txt');
    await download(sums.browser_download_url, sumsFile, () => {});
    const want = parseSums(await fs.readFile(sumsFile, 'utf8')).get(zip.name);
    const got = await sha256(zipFile);
    if (!want || want !== got) { onLine(`Checksum mismatch for ${zip.name}.`, 'stderr'); return 1; }
    onLine('▸ unpack', 'stdout');
    await fs.mkdir(stage, { recursive: true });
    const unzip = await run('/usr/bin/ditto', ['-x', '-k', zipFile, stage], 5 * 60 * 1000);
    if (!unzip.ok) { onLine(unzip.stderr || 'unzip failed', 'stderr'); return 1; }
    const appName = (await fs.readdir(stage)).find((n) => n.endsWith('.app'));
    if (!appName) { onLine('The zip holds no .app bundle.', 'stderr'); return 1; }
    const app = path.join(stage, appName);
    const [id, v] = [await plist(app, 'CFBundleIdentifier'), await plist(app, 'CFBundleShortVersionString')];
    if (id !== BUNDLE_ID || v !== version) { onLine(`Unexpected bundle ${id} ${v} (want ${BUNDLE_ID} ${version}).`, 'stderr'); return 1; }
    const sig = await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], 120000);
    if (!sig.ok) { onLine(`Signature check failed: ${sig.stderr}`, 'stderr'); return 1; }
    await run('/usr/bin/xattr', ['-cr', app], 60000);
    await fs.writeFile(path.join(UPDATE_DIR, PENDING_FILE), JSON.stringify({ app, version, stagedAt: new Date().toISOString() }));
    onLine(`▸ v${version} ready; restarting to install`, 'stdout');
    return 0;
  } finally {
    await fs.rm(zipFile, { force: true }).catch(() => {});
  }
}
