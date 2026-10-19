import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_DIR } from './config.js';

export const ATTACH_DIR = path.join(CONFIG_DIR, 'attachments');

/** Save an uploaded file (browser mode or clipboard paste) and return its absolute path. */
export async function saveAttachment(file: File): Promise<string> {
  await fs.mkdir(ATTACH_DIR, { recursive: true });
  const safe = (file.name || 'file').replace(/[^\w.\-가-힣]+/g, '_').slice(0, 80);
  const dest = path.join(ATTACH_DIR, `${Date.now()}-${safe}`);
  await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()));
  return dest;
}
