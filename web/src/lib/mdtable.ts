/** GitHub-flavored Markdown tables: find them in a document, edit as a grid, write back aligned. */

export type Align = 'left' | 'center' | 'right' | null;
export interface MdTable { start: number; end: number; header: string[]; align: Align[]; rows: string[][] }

/** Terminal-style display width: Hangul, CJK and fullwidth forms take two columns, combining marks none. */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x300 && c <= 0x36f) || (c >= 0x200b && c <= 0x200f) || c === 0xfe0f) continue;
    if ((c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
      || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd)) w += 2;
    else w += 1;
  }
  return w;
}

/** Cells of one row. Only `\|` keeps a pipe inside a cell (GFM rule, code spans included). */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function alignOf(cell: string): Align {
  const l = cell.startsWith(':'), r = cell.endsWith(':');
  return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
}

export function findTables(md: string): MdTable[] {
  const lines = md.split(/\r?\n/);
  const out: MdTable[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
    if (f) { if (!fence) fence = f[1][0].repeat(f[1].length); else if (l.trim().startsWith(fence)) fence = null; continue; }
    if (fence || !l.includes('|') || i + 1 >= lines.length || !DELIM.test(lines[i + 1]) || !lines[i + 1].includes('-')) continue;
    const header = splitRow(l);
    const delim = splitRow(lines[i + 1]);
    if (header.length !== delim.length) continue;
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].trim() && lines[j].includes('|') && !/^\s{0,3}(`{3,}|~{3,}|#)/.test(lines[j]); j++) {
      const cells = splitRow(lines[j]);
      rows.push(header.map((_, k) => cells[k] ?? ''));
    }
    out.push({ start: i, end: j - 1, header, align: delim.map(alignOf), rows });
    i = j - 1;
  }
  return out;
}

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function pad(s: string, w: number, a: Align): string {
  const gap = w - displayWidth(s);
  if (gap <= 0) return s;
  if (a === 'right') return ' '.repeat(gap) + s;
  if (a === 'center') return ' '.repeat(Math.floor(gap / 2)) + s + ' '.repeat(Math.ceil(gap / 2));
  return s + ' '.repeat(gap);
}

/** Aligned table text; every column is padded to its widest cell. */
export function formatTable(t: Pick<MdTable, 'header' | 'align' | 'rows'>): string {
  const cols = t.header.length;
  const cells = [t.header, ...t.rows].map((r) => Array.from({ length: cols }, (_, k) => esc(r[k] ?? '')));
  const widths = Array.from({ length: cols }, (_, k) => Math.max(3, ...cells.map((r) => displayWidth(r[k]))));
  const line = (r: string[]) => `| ${r.map((c, k) => pad(c, widths[k], t.align[k] ?? null)).join(' | ')} |`;
  const delim = `| ${widths.map((w, k) => {
    const a = t.align[k] ?? null;
    const inner = '-'.repeat(Math.max(1, w - (a === 'center' ? 2 : a ? 1 : 0)));
    return a === 'center' ? `:${inner}:` : a === 'left' ? `:${inner}` : a === 'right' ? `${inner}:` : inner;
  }).join(' | ')} |`;
  return [line(cells[0]), delim, ...cells.slice(1).map(line)].join('\n');
}

/** Replaces the lines of one table (as found by findTables) with new text, keeping the file's line endings. */
export function replaceRange(md: string, start: number, end: number, text: string): string {
  const eol = md.includes('\r\n') ? '\r\n' : '\n';
  const lines = md.split(/\r?\n/);
  lines.splice(start, end - start + 1, ...text.split('\n'));
  return lines.join(eol);
}

/** Formats every table in the document; everything else is left byte for byte. */
export function formatAllTables(md: string): string {
  let out = md;
  for (const t of findTables(md).reverse()) out = replaceRange(out, t.start, t.end, formatTable(t));
  return out;
}

export function emptyTable(cols = 3, rows = 2): Pick<MdTable, 'header' | 'align' | 'rows'> {
  return { header: Array.from({ length: cols }, (_, i) => `Column ${i + 1}`), align: Array(cols).fill(null), rows: Array.from({ length: rows }, () => Array(cols).fill('')) };
}

/** Tab- or comma-separated text (spreadsheet copy, CSV) to rows; quoted CSV fields may hold commas and newlines. */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const sep = src.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"' && cell === '') { q = true; continue; }
    if (ch === sep) { row.push(cell); cell = ''; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows;
}

export function toCsv(t: Pick<MdTable, 'header' | 'rows'>): string {
  const f = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [t.header, ...t.rows].map((r) => r.map(f).join(',')).join('\n');
}

export function toHtml(t: Pick<MdTable, 'header' | 'align' | 'rows'>): string {
  const e = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const st = (k: number) => (t.align[k] ? ` style="text-align:${t.align[k]}"` : '');
  return `<table>\n  <thead>\n    <tr>${t.header.map((h, k) => `<th${st(k)}>${e(h)}</th>`).join('')}</tr>\n  </thead>\n  <tbody>\n${t.rows.map((r) => `    <tr>${r.map((c, k) => `<td${st(k)}>${e(c)}</td>`).join('')}</tr>`).join('\n')}\n  </tbody>\n</table>`;
}
