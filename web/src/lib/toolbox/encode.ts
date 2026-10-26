/** Text transformations for the Encode tool. Each pair throws a plain Error on bad input. */

const HTML_NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', euro: '€', yen: '¥', pound: '£', trade: '™' };

export function htmlEncode(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export function htmlDecode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return HTML_NAMED[ent.toLowerCase()] ?? m;
  });
}

/** `encodeURIComponent` keeps `!'()*`; this escapes them too (RFC 3986), as most servers expect. */
export function urlEncode(s: string, component = true): string {
  const out = component ? encodeURIComponent(s) : encodeURI(s);
  return component ? out.replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`) : out;
}

export function urlDecode(s: string): string {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { throw new Error('Malformed percent-encoding'); }
}

/** `\uXXXX` (and `\u{...}` for astral) escapes for every non-ASCII character. */
export function unicodeEscape(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out += ch;
    else if (cp > 0xffff) out += `\\u{${cp.toString(16)}}`;
    else out += `\\u${cp.toString(16).padStart(4, '0')}`;
  }
  return out;
}

export function unicodeUnescape(s: string): string {
  return s.replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_, a: string, b: string, c: string) => String.fromCodePoint(parseInt(a ?? b ?? c, 16)));
}

/** Parses a query string into pairs; `+` means space. Order kept, duplicates kept. */
export function parseQuery(s: string): [string, string][] {
  const q = s.trim().replace(/^[^?]*\?/, '').replace(/^#/, '');
  if (!q) return [];
  return q.split('&').filter(Boolean).map((kv) => {
    const i = kv.indexOf('=');
    const k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1);
    const d = (x: string) => { try { return decodeURIComponent(x.replace(/\+/g, ' ')); } catch { return x; } };
    return [d(k), d(v)];
  });
}

export type Base = 2 | 8 | 10 | 16;
/** Parses an integer in `from` (optional 0x/0b/0o prefix, underscores and spaces allowed) and prints it in every base. BigInt, so no 2^53 limit. */
export function convertBase(s: string, from: Base): Record<Base, string> {
  const clean = s.trim().replace(/[_\s]/g, '').replace(/^0[xXbBoO]/, '');
  const neg = clean.startsWith('-');
  const body = neg ? clean.slice(1) : clean;
  const valid = { 2: /^[01]+$/, 8: /^[0-7]+$/, 10: /^\d+$/, 16: /^[0-9a-fA-F]+$/ }[from];
  if (!valid.test(body)) throw new Error(`Not a base-${from} number`);
  let n = 0n;
  const big = BigInt(from);
  for (const ch of body) n = n * big + BigInt(parseInt(ch, 16));
  if (neg) n = -n;
  const fmt = (b: Base) => (n < 0n ? '-' : '') + (n < 0n ? -n : n).toString(b);
  return { 2: fmt(2), 8: fmt(8), 10: fmt(10), 16: fmt(16) };
}
