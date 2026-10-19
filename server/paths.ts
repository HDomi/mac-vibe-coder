import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Resolve source and compiled entrypoints without treating any ancestor named dist as special. */
function findRoot(start: string): string {
  let current = start;
  while (true) {
    try {
      if (JSON.parse(readFileSync(path.join(current, 'package.json'), 'utf8')).name === 'mac-vibe-coder') return current;
    } catch { /* keep walking */ }
    const parent = path.dirname(current);
    if (parent === current) throw new Error('Mac Vibe Coder repository root not found');
    current = parent;
  }
}

export const REPO_ROOT = findRoot(path.dirname(fileURLToPath(import.meta.url)));
