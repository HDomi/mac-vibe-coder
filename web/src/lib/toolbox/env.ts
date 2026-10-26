/** dotenv parsing and comparison for the .env tool. Follows the dotenv / Vite / Next.js syntax. */

export interface EnvEntry { key: string; value: string; line: number; quote: '' | '"' | "'" | '`'; exported: boolean }
export interface EnvParse { entries: EnvEntry[]; duplicates: string[]; errors: { line: number; text: string }[] }

export function parseEnv(text: string): EnvParse {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const entries: EnvEntry[] = [];
  const errors: { line: number; text: string }[] = [];
  const seen = new Map<string, number>();
  const dups = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const s = raw.trim();
    if (!s || s.startsWith('#')) continue;
    const m = /^(export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s?(.*)$/.exec(s);
    if (!m) { errors.push({ line: i + 1, text: raw }); continue; }
    const [, exp, key] = m;
    let rest = m[3];
    let value: string, quote: EnvEntry['quote'] = '';
    const q = rest[0];
    if (q === '"' || q === "'" || q === '`') {
      quote = q;
      let body = rest.slice(1);
      let end = findClose(body, q);
      const start = i;
      // Quoted values may span lines.
      while (end < 0 && i + 1 < lines.length) { i++; body += '\n' + lines[i]; end = findClose(body, q); }
      if (end < 0) { errors.push({ line: start + 1, text: raw }); continue; }
      value = body.slice(0, end);
      if (q === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else {
      value = rest.replace(/\s+#.*$/, '').trim();
    }
    if (seen.has(key)) dups.add(key);
    seen.set(key, entries.length);
    entries.push({ key, value, line: i + 1, quote, exported: !!exp });
  }
  return { entries, duplicates: [...dups], errors };
}

function findClose(s: string, q: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && q === '"') { i++; continue; }
    if (s[i] === q) return i;
  }
  return -1;
}

/** Last assignment wins, as in dotenv. */
export function envMap(p: EnvParse): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of p.entries) m.set(e.key, e.value);
  return m;
}

export type EnvStatus = 'same' | 'diff' | 'onlyA' | 'onlyB' | 'empty';
export interface EnvRow { key: string; a?: string; b?: string; status: EnvStatus }

export function compareEnv(a: EnvParse, b: EnvParse): EnvRow[] {
  const ma = envMap(a), mb = envMap(b);
  const keys = [...new Set([...ma.keys(), ...mb.keys()])];
  return keys.map((key) => {
    const va = ma.get(key), vb = mb.get(key);
    const status: EnvStatus = va === undefined ? 'onlyB' : vb === undefined ? 'onlyA' : (va === '' || vb === '') && va !== vb ? 'empty' : va === vb ? 'same' : 'diff';
    return { key, a: va, b: vb, status };
  });
}

/** The same file with every value blanked; comments, order, blank lines and `export` stay. */
export function toExample(text: string): string {
  const p = parseEnv(text);
  const byLine = new Map(p.entries.map((e) => [e.line, e]));
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let skipUntil = 0;
  lines.forEach((l, i) => {
    if (i + 1 <= skipUntil) return;
    const m = /^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=/.exec(l);
    if (!m) { out.push(l); return; }
    // A multi-line value ends at the entry's recorded line.
    const entry = [...byLine.values()].find((e) => e.key === m[3] && e.line >= i + 1);
    if (entry) skipUntil = entry.line;
    out.push(`${m[1]}${m[2] ?? ''}${m[3]}=`);
  });
  return out.join('\n');
}

/** Lines to append to `target` so it has every key `source` has (values from source, or blank). */
export function missingLines(target: EnvParse, source: EnvParse, withValues: boolean): string {
  const have = envMap(target);
  const add = source.entries.filter((e, i, all) => !have.has(e.key) && all.findIndex((x) => x.key === e.key) === i);
  return add.map((e) => `${e.key}=${withValues ? quoteValue(e.value) : ''}`).join('\n');
}

export function quoteValue(v: string): string {
  if (v === '') return '';
  return /[\s#"'`\\]/.test(v) || v.includes('\n') ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"` : v;
}

/** Shows the shape of a secret without revealing it. */
export function maskValue(v: string): string {
  if (v.length <= 4) return '•'.repeat(v.length);
  return `${v.slice(0, 2)}${'•'.repeat(Math.min(12, v.length - 4))}${v.slice(-2)}`;
}
