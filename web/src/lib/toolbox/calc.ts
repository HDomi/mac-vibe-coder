/**
 * A small calculator: numbers (1_000, 1e3, 0xff, 0b101, 0o17), + - * / % ^ **, << >> & |, parentheses,
 * functions, constants, and `name = expr` variables across lines. No eval.
 */

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string } | { t: '('; } | { t: ')' } | { t: ',' };

const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: (x, d = 0) => { const f = 10 ** d; return Math.round(x * f) / f; }, floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc,
  ln: Math.log, log: (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b)), log2: Math.log2, log10: Math.log10, exp: Math.exp,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  min: Math.min, max: Math.max, pow: Math.pow, hypot: Math.hypot, sign: Math.sign,
  deg: (r) => (r * 180) / Math.PI, rad: (d) => (d * Math.PI) / 180,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2, inf: Infinity };

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    const num = /^(0x[0-9a-f_]+|0b[01_]+|0o[0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:e[+-]?\d+)?)/i.exec(s.slice(i));
    if (num) {
      const raw = num[0].replace(/_/g, '');
      const v = /^0[box]/i.test(raw) ? Number(raw) : parseFloat(raw);
      if (Number.isNaN(v)) throw new Error(`Bad number "${num[0]}"`);
      out.push({ t: 'num', v }); i += num[0].length;
      if (s[i] === '%' && !/[\d(a-z_.]/i.test(s.slice(i + 1).trimStart()[0] ?? '')) { (out[out.length - 1] as { v: number }).v /= 100; i++; }
      continue;
    }
    const id = /^[a-z_][a-z0-9_]*/i.exec(s.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    const op = /^(\*\*|<<|>>|[-+*/%^&|=])/.exec(s.slice(i));
    if (op) { out.push({ t: 'op', v: op[0] }); i += op[0].length; continue; }
    if (ch === '(' || ch === ')' || ch === ',') { out.push({ t: ch } as Tok); i++; continue; }
    throw new Error(`Unexpected "${ch}"`);
  }
  return out;
}

const BIN: Record<string, [number, (a: number, b: number) => number, boolean?]> = {
  '|': [1, (a, b) => Number(BigInt.asIntN(64, BigInt(Math.trunc(a)) | BigInt(Math.trunc(b))))],
  '&': [2, (a, b) => Number(BigInt.asIntN(64, BigInt(Math.trunc(a)) & BigInt(Math.trunc(b))))],
  '<<': [3, (a, b) => Math.trunc(a) * 2 ** Math.trunc(b)], '>>': [3, (a, b) => Math.floor(a / 2 ** Math.trunc(b))],
  '+': [4, (a, b) => a + b], '-': [4, (a, b) => a - b],
  '*': [5, (a, b) => a * b], '/': [5, (a, b) => a / b], '%': [5, (a, b) => a % b],
  '^': [7, (a, b) => a ** b, true], '**': [7, (a, b) => a ** b, true],
};

/** Precedence climbing over the token list. */
function evaluate(toks: Tok[], vars: Record<string, number>): number {
  let p = 0;
  const peek = () => toks[p];
  const primary = (): number => {
    const t = toks[p++];
    if (!t) throw new Error('Unexpected end');
    if (t.t === 'num') return t.v;
    if (t.t === 'op' && (t.v === '-' || t.v === '+')) { const v = expr(6); return t.v === '-' ? -v : v; }
    if (t.t === '(') { const v = expr(0); if (toks[p++]?.t !== ')') throw new Error('Missing )'); return v; }
    if (t.t === 'id') {
      const name = t.v.toLowerCase();
      if (peek()?.t === '(') {
        const f = FUNCS[name];
        if (!f) throw new Error(`Unknown function ${t.v}`);
        p++;
        const args: number[] = [];
        if (peek()?.t !== ')') { args.push(expr(0)); while (peek()?.t === ',') { p++; args.push(expr(0)); } }
        if (toks[p++]?.t !== ')') throw new Error('Missing )');
        return f(...args);
      }
      if (t.v in vars) return vars[t.v];
      if (name in CONSTS) return CONSTS[name];
      throw new Error(`Unknown name ${t.v}`);
    }
    throw new Error('Unexpected token');
  };
  const expr = (minPrec: number): number => {
    let left = primary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== 'op' || !(t.v in BIN)) break;
      const [prec, fn, right] = BIN[t.v];
      if (prec < minPrec) break;
      p++;
      left = fn(left, expr(right ? prec : prec + 1));
    }
    return left;
  };
  const v = expr(0);
  if (p < toks.length) throw new Error('Unexpected input after the expression');
  return v;
}

export interface CalcLine { input: string; value?: number; error?: string; name?: string }

/** Evaluates each line; `x = …` defines a variable, `ans` is the previous result. Blank and `#`/`//` lines are skipped. */
export function calcLines(text: string): CalcLine[] {
  const vars: Record<string, number> = {};
  return text.split('\n').map((input) => {
    const src = input.replace(/(#|\/\/).*$/, '').trim();
    if (!src) return { input };
    try {
      const m = /^([a-z_][a-z0-9_]*)\s*=(?!=)(.*)$/i.exec(src);
      const toks = tokenize(m ? m[2] : src);
      const value = evaluate(toks, vars);
      if (m) vars[m[1]] = value;
      vars.ans = value;
      return { input, value, name: m?.[1] };
    } catch (e) { return { input, error: e instanceof Error ? e.message : String(e) }; }
  });
}

export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v) && Math.abs(v) < 1e21) return v.toLocaleString('en-US');
  const s = Number(v.toPrecision(12));
  return Math.abs(s) >= 1e21 || (Math.abs(s) < 1e-6 && s !== 0) ? s.toExponential() : s.toLocaleString('en-US', { maximumFractionDigits: 12 });
}

/** Unit tables: value of one unit in the base unit. */
export const LENGTH_UNITS = ['px', 'rem', 'em', 'pt', 'pc', 'in', 'cm', 'mm', 'vw', 'vh', '%'] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

/** CSS lengths at 96 dpi. `rem`/`em`/`%` use `base` px, `vw`/`vh` use the viewport size. */
export function cssLengths(value: number, unit: LengthUnit, ctx: { base: number; vw: number; vh: number }): Record<LengthUnit, number> {
  const px: Record<LengthUnit, number> = { px: 1, rem: ctx.base, em: ctx.base, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, vw: ctx.vw / 100, vh: ctx.vh / 100, '%': ctx.base / 100 };
  const inPx = value * px[unit];
  return Object.fromEntries(LENGTH_UNITS.map((u) => [u, inPx / px[u]])) as Record<LengthUnit, number>;
}

export const DATA_UNITS = ['bit', 'B', 'KB', 'MB', 'GB', 'TB', 'PB', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;
export type DataUnit = (typeof DATA_UNITS)[number];
const BYTES: Record<DataUnit, number> = { bit: 1 / 8, B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, PB: 1e15, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4, PiB: 1024 ** 5 };

export function dataSizes(value: number, unit: DataUnit): Record<DataUnit, number> {
  const b = value * BYTES[unit];
  return Object.fromEntries(DATA_UNITS.map((u) => [u, b / BYTES[u]])) as Record<DataUnit, number>;
}

/** Transfer time of `bytes` at `mbps` megabits per second. */
export function transferSeconds(bytes: number, mbps: number): number { return (bytes * 8) / (mbps * 1e6); }
