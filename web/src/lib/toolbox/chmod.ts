/** Unix permission bits: octal, symbolic, ls-style strings and chmod expressions. */

export interface Perm { r: boolean; w: boolean; x: boolean }
export interface Mode { user: Perm; group: Perm; other: Perm; setuid: boolean; setgid: boolean; sticky: boolean }

const permOf = (n: number): Perm => ({ r: !!(n & 4), w: !!(n & 2), x: !!(n & 1) });
const numOf = (p: Perm) => (p.r ? 4 : 0) | (p.w ? 2 : 0) | (p.x ? 1 : 0);

export function fromOctal(s: string): Mode {
  const t = s.trim().replace(/^0o/i, '');
  if (!/^[0-7]{3,4}$/.test(t)) throw new Error('Octal mode is 3 or 4 digits 0-7');
  const d = t.padStart(4, '0').split('').map(Number);
  return { setuid: !!(d[0] & 4), setgid: !!(d[0] & 2), sticky: !!(d[0] & 1), user: permOf(d[1]), group: permOf(d[2]), other: permOf(d[3]) };
}

export function toOctal(m: Mode): string {
  const special = (m.setuid ? 4 : 0) | (m.setgid ? 2 : 0) | (m.sticky ? 1 : 0);
  const base = `${numOf(m.user)}${numOf(m.group)}${numOf(m.other)}`;
  return special ? `${special}${base}` : base;
}

/** `rwsr-xr-t` style: s/S and t/T carry the special bits (lowercase when x is also set). */
export function toSymbolic(m: Mode): string {
  const part = (p: Perm, special: boolean, ch: 's' | 't') => `${p.r ? 'r' : '-'}${p.w ? 'w' : '-'}${special ? (p.x ? ch : ch.toUpperCase()) : p.x ? 'x' : '-'}`;
  return part(m.user, m.setuid, 's') + part(m.group, m.setgid, 's') + part(m.other, m.sticky, 't');
}

/** Accepts `rwxr-xr-x`, an `ls -l` column like `-rwxr-xr-x@` / `drwxr-xr-x+`, or a full `ls -l` line. */
export function fromSymbolic(s: string): Mode {
  const m = /([-dlcbps]?)([-r][-w][-xsS][-r][-w][-xsS][-r][-w][-xtT])[@+.]?/.exec(s.trim());
  if (!m) throw new Error('Expected something like rwxr-xr-x');
  const c = m[2];
  const p = (o: number): Perm => ({ r: c[o] === 'r', w: c[o + 1] === 'w', x: /[xst]/.test(c[o + 2]) });
  return { user: p(0), group: p(3), other: p(6), setuid: /[sS]/.test(c[2]), setgid: /[sS]/.test(c[5]), sticky: /[tT]/.test(c[8]) };
}

/** Applies a chmod symbolic expression (`u+x,go-w`, `a=r`, `+x`) to a mode. */
export function applyExpr(base: Mode, expr: string): Mode {
  const m: Mode = JSON.parse(JSON.stringify(base));
  for (const clause of expr.split(',')) {
    const c = /^([ugoa]*)([+\-=])([rwxXst]*)$/.exec(clause.trim());
    if (!c) throw new Error(`Bad clause "${clause}"`);
    const who = (c[1] || 'a').replace('a', 'ugo');
    const op = c[2], bits = c[3];
    const anyX = m.user.x || m.group.x || m.other.x;
    for (const w of new Set(who)) {
      const key = w === 'u' ? 'user' : w === 'g' ? 'group' : 'other';
      const p = m[key];
      const want = { r: bits.includes('r'), w: bits.includes('w'), x: bits.includes('x') || (bits.includes('X') && anyX) };
      if (op === '=') { p.r = want.r; p.w = want.w; p.x = want.x; }
      else for (const k of ['r', 'w', 'x'] as const) if (want[k]) p[k] = op === '+';
      if (bits.includes('s') || op === '=') {
        const val = op === '-' ? false : bits.includes('s');
        if (w === 'u' && (bits.includes('s') || op === '=')) m.setuid = op === '=' ? val : bits.includes('s') ? op === '+' : m.setuid;
        if (w === 'g' && (bits.includes('s') || op === '=')) m.setgid = op === '=' ? val : bits.includes('s') ? op === '+' : m.setgid;
      }
      if (bits.includes('t') && w === 'o') m.sticky = op !== '-';
    }
    if (bits.includes('t') && !who.includes('o')) m.sticky = op !== '-';
  }
  return m;
}

/** Plain-language reading of a mode, for the hint line. Keys are i18n suffixes. */
export const COMMON_MODES: { octal: string; key: string }[] = [
  { octal: '644', key: 'file' }, { octal: '600', key: 'private' }, { octal: '755', key: 'exec' }, { octal: '700', key: 'privateDir' },
  { octal: '775', key: 'groupWrite' }, { octal: '400', key: 'readOnly' }, { octal: '1777', key: 'tmp' }, { octal: '2775', key: 'sharedDir' },
];
