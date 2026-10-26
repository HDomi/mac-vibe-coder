/** String escaping for embedding text in code, shells, SQL and CSV. Each kind has an escape and, where well defined, an unescape. */

export type EscapeKind = 'json' | 'js' | 'template' | 'shellSingle' | 'shellDouble' | 'regex' | 'sql' | 'csv' | 'c' | 'xml';
export const ESCAPE_KINDS: EscapeKind[] = ['json', 'js', 'template', 'shellSingle', 'shellDouble', 'regex', 'sql', 'csv', 'c', 'xml'];

const C_ESC: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f', '\v': '\\v', '\0': '\\0', '\\': '\\\\' };

function cStyle(s: string, quote: string, asciiOnly: boolean): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (C_ESC[ch]) out += C_ESC[ch];
    else if (ch === quote) out += '\\' + ch;
    else if (cp < 0x20 || cp === 0x7f) out += `\\x${cp.toString(16).padStart(2, '0')}`;
    else if (asciiOnly && cp > 0x7e) out += cp > 0xffff ? `\\u{${cp.toString(16)}}` : `\\u${cp.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return out;
}

function cUnescape(s: string): string {
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[0-7]{1,3}|.)/gs, (_, e: string) => {
    if (e[0] === 'u') return String.fromCodePoint(parseInt(e[1] === '{' ? e.slice(2, -1) : e.slice(1), 16));
    if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    if (/^[0-7]+$/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' } as Record<string, string>)[e] ?? e;
  });
}

export function escapeAs(s: string, kind: EscapeKind, opts: { asciiOnly?: boolean } = {}): string {
  switch (kind) {
    case 'json': { const j = JSON.stringify(s).slice(1, -1); return opts.asciiOnly ? j.replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) : j; }
    case 'js': return cStyle(s, "'", !!opts.asciiOnly);
    case 'template': return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    case 'shellSingle': return `'${s.replace(/'/g, `'\\''`)}'`;
    case 'shellDouble': return `"${s.replace(/(["\\$`])/g, '\\$1').replace(/!/g, '"\'!\'"')}"`;
    case 'regex': return s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
    case 'sql': return `'${s.replace(/'/g, "''")}'`;
    case 'csv': return /[",\n\r]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    case 'c': return cStyle(s, '"', true);
    case 'xml': return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] as string);
  }
}

export function unescapeAs(s: string, kind: EscapeKind): string {
  switch (kind) {
    case 'json': try { return JSON.parse(`"${s.replace(/^"|"$/g, '')}"`); } catch { throw new Error('Invalid JSON string escape'); }
    case 'js': case 'c': return cUnescape(s.replace(/^(['"])([\s\S]*)\1$/, '$2'));
    case 'template': return s.replace(/^`|`$/g, '').replace(/\\([`\\$])/g, '$1');
    case 'shellSingle': {
      const t = s.trim();
      if (!t.startsWith("'")) throw new Error('Expected a single-quoted shell word');
      return t.replace(/'\\''/g, "'").replace(/^'|'$/g, '');
    }
    case 'shellDouble': return s.trim().replace(/^"|"$/g, '').replace(/"'!'"/g, '!').replace(/\\(["\\$`])/g, '$1');
    case 'regex': return s.replace(/\\(.)/g, '$1');
    case 'sql': return s.trim().replace(/^'|'$/g, '').replace(/''/g, "'");
    case 'csv': { const t = s.trim(); return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : s; }
    case 'xml': return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      if (named[e.toLowerCase()]) return named[e.toLowerCase()];
      return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    });
  }
}
