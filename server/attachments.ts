import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_DIR } from './config.js';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

export const ATTACH_DIR = path.join(CONFIG_DIR, 'attachments');

/** Save an uploaded file (browser mode or clipboard paste) and return its absolute path. */
export async function saveAttachment(file: File): Promise<string> {
  await fs.mkdir(ATTACH_DIR, { recursive: true });
  const safe = (file.name || 'file').replace(/[^\w.\-가-힣]+/g, '_').slice(0, 80);
  const dest = path.join(ATTACH_DIR, `${randomUUID()}-${safe}`);
  await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()));
  return dest;
}

const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif' };
/**
 * Images over this size are not written; the card keeps its "[image]" placeholder. Writing is synchronous
 * so the tool result keeps its place among the agent's events; image blocks are a few MB at most.
 */
const MAX_TOOL_IMAGE = 10 * 1024 * 1024;

/**
 * Write a base64 image a tool returned (Read of a picture, a screenshot, a generated image) so the chat
 * can show it. Named by content hash, so replays and repeated reads reuse one file. Null when unusable.
 */
export function saveToolImage(base64: unknown, mime: unknown): string | null {
  if (typeof base64 !== 'string' || !base64) return null;
  const ext = IMAGE_EXT[String(mime ?? 'image/png').toLowerCase()];
  if (!ext || base64.length * 0.75 > MAX_TOOL_IMAGE) return null;
  try {
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length) return null;
    const dir = path.join(ATTACH_DIR, 'tool-images');
    const dest = path.join(dir, `${createHash('sha1').update(bytes).digest('hex')}.${ext}`);
    if (!existsSync(dest)) { mkdirSync(dir, { recursive: true }); writeFileSync(dest, bytes); }
    return dest;
  } catch { return null; }
}
