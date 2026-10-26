/** Icon containers built from PNG bytes: Windows .ico and macOS .icns. Both embed PNGs as is. */

export interface PngEntry { size: number; data: Uint8Array }

/** ICONDIR + ICONDIRENTRY[] + PNG payloads. A width/height byte of 0 means 256. */
export function buildIco(entries: PngEntry[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => a.size - b.size);
  const head = 6 + 16 * sorted.length;
  const total = head + sorted.reduce((n, e) => n + e.data.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0, true); dv.setUint16(2, 1, true); dv.setUint16(4, sorted.length, true);
  let offset = head;
  sorted.forEach((e, i) => {
    if (e.size > 256) throw new Error('ICO images are at most 256 px');
    const p = 6 + i * 16;
    out[p] = e.size === 256 ? 0 : e.size;
    out[p + 1] = e.size === 256 ? 0 : e.size;
    out[p + 2] = 0; out[p + 3] = 0;
    dv.setUint16(p + 4, 1, true); dv.setUint16(p + 6, 32, true);
    dv.setUint32(p + 8, e.data.length, true); dv.setUint32(p + 12, offset, true);
    out.set(e.data, offset);
    offset += e.data.length;
  });
  return out;
}

/** OSType per pixel size; the @2x types reuse the larger bitmaps. */
export const ICNS_TYPES: { type: string; px: number }[] = [
  { type: 'icp4', px: 16 }, { type: 'icp5', px: 32 }, { type: 'icp6', px: 64 }, { type: 'ic07', px: 128 }, { type: 'ic08', px: 256 }, { type: 'ic09', px: 512 }, { type: 'ic10', px: 1024 },
  { type: 'ic11', px: 32 }, { type: 'ic12', px: 64 }, { type: 'ic13', px: 256 }, { type: 'ic14', px: 512 },
];

export function buildIcns(bySize: Map<number, Uint8Array>): Uint8Array {
  const chunks = ICNS_TYPES.filter((t) => bySize.has(t.px)).map((t) => ({ type: t.type, data: bySize.get(t.px)! }));
  const total = 8 + chunks.reduce((n, c) => n + 8 + c.data.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  const tag = (at: number, s: string) => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
  tag(0, 'icns'); dv.setUint32(4, total);
  let p = 8;
  for (const c of chunks) { tag(p, c.type); dv.setUint32(p + 4, 8 + c.data.length); out.set(c.data, p + 8); p += 8 + c.data.length; }
  return out;
}

/** Pixel size of a PNG from its IHDR, for checks. */
export function pngSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return null;
  const dv = new DataView(b.buffer, b.byteOffset);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

export function webManifest(name: string, color: string): string {
  return JSON.stringify({
    name, short_name: name,
    icons: [
      { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    theme_color: color, background_color: color, display: 'standalone',
  }, null, 2);
}

export function faviconHtml(hasSvg: boolean): string {
  return [
    '<link rel="icon" href="/favicon.ico" sizes="48x48">',
    hasSvg ? '<link rel="icon" href="/favicon.svg" type="image/svg+xml">' : '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">',
  ].join('\n');
}
