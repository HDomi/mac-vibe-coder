import { encode } from 'uqr';

export type Ecc = 'L' | 'M' | 'Q' | 'H';

export interface QrOptions { ecc: Ecc; margin: number; fg: string; bg: string }

/** Module matrix with the quiet zone already added. */
export function qrMatrix(text: string, o: Pick<QrOptions, 'ecc' | 'margin'>): boolean[][] {
  if (!text) throw new Error('Nothing to encode');
  const r = encode(text, { ecc: o.ecc, border: o.margin });
  return r.data;
}

/** One <path> of unit squares, merged per row run, so the SVG stays small. */
export function qrSvg(m: boolean[][], o: Pick<QrOptions, 'fg' | 'bg'>, px = m.length * 8): string {
  const n = m.length;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!m[y][x]) continue;
      let w = 1;
      while (x + w < n && m[y][x + w]) w++;
      d += `M${x} ${y}h${w}v1h-${w}z`;
      x += w - 1;
    }
  }
  const bg = o.bg && o.bg !== 'transparent' ? `<rect width="${n}" height="${n}" fill="${o.bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" shape-rendering="crispEdges">${bg}<path fill="${o.fg}" d="${d}"/></svg>`;
}

/** Wi-Fi join string understood by iOS and Android cameras. */
export function wifiPayload(ssid: string, password: string, auth: 'WPA' | 'WEP' | 'nopass', hidden: boolean): string {
  const esc = (s: string) => s.replace(/([\\;,":])/g, '\\$1');
  return `WIFI:T:${auth};S:${esc(ssid)};${auth === 'nopass' ? '' : `P:${esc(password)};`}${hidden ? 'H:true;' : ''};`;
}
