/** Color parsing and conversion for the Color tool. Alpha is kept as 0..1. */

export interface Rgba { r: number; g: number; b: number; a: number }

const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff', gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', brown: '#a52a2a', navy: '#000080', teal: '#008080', olive: '#808000', maroon: '#800000', lime: '#00ff00', silver: '#c0c0c0', transparent: '#00000000' };

const clamp = (n: number, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, n));

/** Accepts #rgb/#rgba/#rrggbb/#rrggbbaa, rgb()/rgba() (commas or spaces, % or 0-255), hsl()/hsla(), and a few CSS names. */
export function parseColor(input: string): Rgba {
  const s = input.trim().toLowerCase();
  const named = NAMED[s];
  if (named) return parseColor(named);
  let m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return h.length === 8
      ? { r: (n >>> 24) & 255, g: (n >>> 16) & 255, b: (n >>> 8) & 255, a: (n & 255) / 255 }
      : { r: (n >>> 16) & 255, g: (n >>> 8) & 255, b: n & 255, a: 1 };
  }
  m = /^rgba?\(\s*([^)]+)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) throw new Error('rgb() needs three channels');
    const ch = (p: string) => (p.endsWith('%') ? clamp(parseFloat(p) / 100 * 255) : clamp(parseFloat(p)));
    const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    const out = { r: Math.round(ch(parts[0])), g: Math.round(ch(parts[1])), b: Math.round(ch(parts[2])), a: clamp(a, 0, 1) };
    if ([out.r, out.g, out.b, out.a].some(Number.isNaN)) throw new Error('Bad rgb() value');
    return out;
  }
  m = /^hsla?\(\s*([^)]+)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) throw new Error('hsl() needs three values');
    const h = parseFloat(parts[0]), sat = parseFloat(parts[1]) / 100, l = parseFloat(parts[2]) / 100;
    const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    if ([h, sat, l, a].some(Number.isNaN)) throw new Error('Bad hsl() value');
    return { ...hslToRgb(h, sat, l), a: clamp(a, 0, 1) };
  }
  throw new Error('Unrecognized color');
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hh = (((h % 360) + 360) % 360) / 360;
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return { r: Math.round(f(hh + 1 / 3) * 255), g: Math.round(f(hh) * 255), b: Math.round(f(hh - 1 / 3) * 255) };
}

export function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }): { h: number; s: number; l: number } {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  return { h, s, l };
}

export function rgbToHsv({ r, g, b }: { r: number; g: number; b: number }): { h: number; s: number; v: number } {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d) { h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4; h *= 60; }
  return { h, s, v: max };
}

const hex2 = (n: number) => Math.round(clamp(n)).toString(16).padStart(2, '0');

export function toHex(c: Rgba, withAlpha = c.a < 1): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${withAlpha ? hex2(c.a * 255) : ''}`;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function formatColor(c: Rgba): Record<'hex' | 'rgb' | 'hsl' | 'hsv' | 'cmyk', string> {
  const { h, s, l } = rgbToHsl(c);
  const hsv = rgbToHsv(c);
  const k = 1 - Math.max(c.r, c.g, c.b) / 255;
  const cmyk = k === 1 ? [0, 0, 0] : [(1 - c.r / 255 - k) / (1 - k), (1 - c.g / 255 - k) / (1 - k), (1 - c.b / 255 - k) / (1 - k)];
  const alpha = c.a < 1 ? ` / ${r1(c.a * 100)}%` : '';
  return {
    hex: toHex(c),
    rgb: `rgb(${c.r} ${c.g} ${c.b}${alpha})`,
    hsl: `hsl(${r1(h)} ${r1(s * 100)}% ${r1(l * 100)}%${alpha})`,
    hsv: `hsv(${r1(hsv.h)} ${r1(hsv.s * 100)}% ${r1(hsv.v * 100)}%)`,
    cmyk: `cmyk(${Math.round(cmyk[0] * 100)}% ${Math.round(cmyk[1] * 100)}% ${Math.round(cmyk[2] * 100)}% ${Math.round(k * 100)}%)`,
  };
}

/** WCAG 2 relative luminance and contrast ratio against another color. */
export function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Lighter/darker steps for a palette strip: the color at lightness 10%..90% in HSL. */
export function shades(c: Rgba): Rgba[] {
  const { h, s } = rgbToHsl(c);
  return [0.95, 0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.25, 0.15].map((l) => ({ ...hslToRgb(h, s, l), a: 1 }));
}
