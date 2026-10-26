/** Byte <-> text conversions shared by the toolbox tools. No dependencies; runs in the renderer and node tests. */

export type ByteFormat = 'utf8' | 'hex' | 'base64' | 'base64url';
/** Bytes backed by a plain ArrayBuffer, which is what WebCrypto's BufferSource parameters require. */
export type Bytes = Uint8Array<ArrayBuffer>;

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

export function utf8ToBytes(s: string): Bytes { return enc.encode(s); }
export function bytesToUtf8(b: Uint8Array): string { return dec.decode(b); }

export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

export function hexToBytes(hex: string): Bytes {
  const clean = hex.replace(/^0x/i, '').replace(/[\s:_-]/g, '');
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2) throw new Error('Invalid hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToBase64(b: Uint8Array, url = false): string {
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  const s = btoa(bin);
  return url ? s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : s;
}

/** Accepts standard or url-safe alphabets, with or without padding. */
export function base64ToBytes(s: string): Bytes {
  let clean = s.replace(/[\s]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error('Invalid base64');
  while (clean.length % 4) clean += '=';
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toBytes(s: string, f: ByteFormat): Bytes {
  if (f === 'hex') return hexToBytes(s);
  if (f === 'base64' || f === 'base64url') return base64ToBytes(s);
  return utf8ToBytes(s);
}

export function fromBytes(b: Uint8Array, f: ByteFormat): string {
  if (f === 'hex') return bytesToHex(b);
  if (f === 'base64') return bytesToBase64(b);
  if (f === 'base64url') return bytesToBase64(b, true);
  return bytesToUtf8(b);
}

/** Text as UTF-8 base64 and back; base64 of arbitrary bytes decodes to a replacement-char string, never throws. */
export function base64Encode(text: string, url = false): string { return bytesToBase64(utf8ToBytes(text), url); }
export function base64Decode(text: string): string { return bytesToUtf8(base64ToBytes(text)); }
