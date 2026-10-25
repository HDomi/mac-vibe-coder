import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FsError, resolvePath } from './fs.js';
import { run } from './shell.js';

/**
 * Image conversion through macOS `sips` (ImageIO): reads everything Preview.app opens — PNG, JPEG,
 * HEIC, AVIF, WebP, SVG, TIFF, PSD, camera RAW, … — and writes the formats below. WebP is the one
 * common format ImageIO cannot write; the client encodes it with Chromium's canvas and saves the
 * bytes through `writeImageBytes`.
 */
export const SIPS_WRITE: Record<string, { lossy?: boolean }> = {
  png: {}, jpeg: { lossy: true }, heic: { lossy: true }, avif: { lossy: true }, tiff: {}, gif: {}, bmp: {},
  ico: {}, icns: {}, jp2: { lossy: true }, tga: {}, psd: {}, pdf: {}, exr: {}, pbm: {}, astc: {}, ktx: {}, pvr: {},
};
/** Sizes ImageIO accepts for icon containers (it writes nothing for anything else). */
export const ICNS_SIZES = [16, 32, 48, 128, 256, 512];
export const ICO_MAX = 256;

export interface ImageInfo { width: number; height: number; format: string; hasAlpha: boolean }

export async function imageInfo(p: string): Promise<ImageInfo> {
  const abs = resolvePath(p);
  const r = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'format', '-g', 'hasAlpha', abs], 20000);
  const get = (k: string) => r.stdout.match(new RegExp(`${k}: (.+)`))?.[1]?.trim();
  const width = Number(get('pixelWidth')); const height = Number(get('pixelHeight'));
  if (!r.ok || !width || !height) throw new FsError('EIMAGE', `Not a readable image: ${abs}`, 422);
  return { width, height, format: get('format') ?? '', hasAlpha: get('hasAlpha') === 'yes' };
}

function checkSize(format: string, w?: number, h?: number) {
  if (w !== undefined && (!Number.isInteger(w) || w < 1 || w > 30000)) throw new FsError('EINVAL', 'Invalid width', 400);
  if (h !== undefined && (!Number.isInteger(h) || h < 1 || h > 30000)) throw new FsError('EINVAL', 'Invalid height', 400);
  if (format === 'ico' && (w !== h || !w || w > ICO_MAX)) throw new FsError('EINVAL', `ICO must be square, at most ${ICO_MAX}px`, 400);
  if (format === 'icns' && (w !== h || !w || !ICNS_SIZES.includes(w))) throw new FsError('EINVAL', `ICNS must be square: ${ICNS_SIZES.join(', ')}`, 400);
}

async function sips(src: string, out: string, format: string, opts: { width?: number; height?: number; quality?: number; fit?: number }) {
  const args = ['-s', 'format', format];
  if (opts.quality !== undefined && SIPS_WRITE[format]?.lossy) args.push('-s', 'formatOptions', String(Math.round(Math.min(100, Math.max(1, opts.quality)))));
  if (opts.width && opts.height) args.push('-z', String(opts.height), String(opts.width));
  else if (opts.fit) args.push('-Z', String(opts.fit));
  const r = await run('sips', [...args, src, '--out', out], 120000);
  // sips exits 0 and writes nothing when ImageIO refuses a size/format combination.
  const size = await fs.stat(out).then((s) => s.size).catch(() => 0);
  if (!size) {
    await fs.rm(out, { force: true });
    throw new FsError('ECONVERT', `Could not convert to ${format}${r.stderr ? `: ${r.stderr.split('\n').pop()}` : ''}`, 422);
  }
}

/** Write next to `dest` first and rename over it, so a failed conversion never leaves a half file. */
async function placeAt(dest: string, overwrite: boolean, produce: (tmp: string) => Promise<void>): Promise<string> {
  const dir = path.dirname(dest);
  const st = await fs.stat(dir).catch(() => null);
  if (!st?.isDirectory()) throw new FsError('ENOENT', `Not found: ${dir}`, 404);
  if (!overwrite && await fs.access(dest).then(() => true, () => false)) throw new FsError('EEXIST', `Already exists: ${dest}`, 409);
  const tmp = path.join(dir, `.${path.basename(dest)}.${randomUUID().slice(0, 8)}.mvc-tmp${path.extname(dest)}`);
  try {
    await produce(tmp);
    await fs.rename(tmp, dest);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return dest;
}

export async function convertImage(o: { path: string; dest: string; format: string; width?: number; height?: number; quality?: number; overwrite?: boolean }): Promise<string> {
  if (!SIPS_WRITE[o.format]) throw new FsError('EINVAL', `Unsupported format: ${o.format}`, 400);
  checkSize(o.format, o.width, o.height);
  const src = resolvePath(o.path);
  const dest = resolvePath(o.dest);
  return placeAt(dest, !!o.overwrite, (tmp) => sips(src, tmp, o.format, o))
    .catch((err) => { if (err instanceof FsError) throw err; throw new FsError('ECONVERT', (err as Error).message, 500); });
}

/** PNG rendering of any readable image (preview of HEIC/TIFF/PSD/RAW, and the WebP encoder's input). */
export async function renderPng(p: string, opts: { width?: number; height?: number; fit?: number }): Promise<Buffer> {
  const src = resolvePath(p);
  const tmp = path.join(os.tmpdir(), `mvc-render-${randomUUID()}.png`);
  // `sips -Z` also enlarges; a preview bound only ever shrinks.
  if (opts.fit && !opts.width) {
    const info = await imageInfo(src);
    if (Math.max(info.width, info.height) <= opts.fit) opts = { ...opts, fit: undefined };
  }
  try {
    await sips(src, tmp, 'png', opts);
    return await fs.readFile(tmp);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

/** Save bytes the client encoded (WebP). */
export async function writeImageBytes(destPath: string, data: Buffer, overwrite: boolean): Promise<string> {
  if (!data.length) throw new FsError('EINVAL', 'Empty image', 400);
  return placeAt(resolvePath(destPath), overwrite, (tmp) => fs.writeFile(tmp, data));
}
