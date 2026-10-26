/** Case conversion, counting, and line operations for the Text tool. */

/** Splits identifiers and sentences into lowercase words: "fooBarBaz", "foo_bar", "Foo Bar" all give [foo, bar, baz]. */
export function words(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

export type CaseStyle = 'camel' | 'pascal' | 'snake' | 'kebab' | 'constant' | 'title' | 'sentence' | 'upper' | 'lower' | 'dot' | 'path';
export const CASE_STYLES: CaseStyle[] = ['camel', 'pascal', 'snake', 'kebab', 'constant', 'dot', 'path', 'title', 'sentence', 'upper', 'lower'];

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** Applies per line so a pasted list converts in one go. */
export function convertCase(s: string, style: CaseStyle): string {
  return s.split('\n').map((line) => {
    if (style === 'upper') return line.toUpperCase();
    if (style === 'lower') return line.toLowerCase();
    const w = words(line);
    switch (style) {
      case 'camel': return w.map((x, i) => (i ? cap(x) : x)).join('');
      case 'pascal': return w.map(cap).join('');
      case 'snake': return w.join('_');
      case 'kebab': return w.join('-');
      case 'constant': return w.join('_').toUpperCase();
      case 'dot': return w.join('.');
      case 'path': return w.join('/');
      case 'title': return w.map(cap).join(' ');
      case 'sentence': return w.map((x, i) => (i ? x : cap(x))).join(' ');
    }
  }).join('\n');
}

export interface TextStats { chars: number; charsNoSpace: number; bytes: number; words: number; lines: number; sentences: number; paragraphs: number }

export function textStats(s: string): TextStats {
  return {
    chars: [...s].length,
    charsNoSpace: [...s.replace(/\s/g, '')].length,
    bytes: new TextEncoder().encode(s).length,
    words: (s.match(/[\p{L}\p{N}'’_-]+/gu) ?? []).length,
    lines: s ? s.split('\n').length : 0,
    sentences: (s.match(/[^.!?。！？]+[.!?。！？]+/g) ?? []).length || (s.trim() ? 1 : 0),
    paragraphs: s.split(/\n\s*\n/).filter((p) => p.trim()).length,
  };
}

export type LineOp = 'sort' | 'sortDesc' | 'sortNumeric' | 'dedupe' | 'reverse' | 'trim' | 'removeEmpty' | 'shuffle' | 'addNumbers' | 'unindent';
export const LINE_OPS: LineOp[] = ['sort', 'sortDesc', 'sortNumeric', 'dedupe', 'removeEmpty', 'trim', 'unindent', 'reverse', 'shuffle', 'addNumbers'];

export function lineOp(s: string, op: LineOp): string {
  let lines = s.split('\n');
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  switch (op) {
    case 'sort': lines.sort(collator.compare); break;
    case 'sortDesc': lines.sort((a, b) => collator.compare(b, a)); break;
    case 'sortNumeric': lines.sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0)); break;
    case 'dedupe': lines = [...new Set(lines)]; break;
    case 'reverse': lines.reverse(); break;
    case 'trim': lines = lines.map((l) => l.trim()); break;
    case 'removeEmpty': lines = lines.filter((l) => l.trim()); break;
    case 'shuffle': for (let i = lines.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [lines[i], lines[j]] = [lines[j], lines[i]]; } break;
    case 'addNumbers': { const w = String(lines.length).length; lines = lines.map((l, i) => `${String(i + 1).padStart(w)}  ${l}`); break; }
    case 'unindent': {
      const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
      const min = indents.length ? Math.min(...indents) : 0;
      lines = lines.map((l) => l.slice(Math.min(min, /^[ \t]*/.exec(l)![0].length)));
      break;
    }
  }
  return lines.join('\n');
}

export const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.';
