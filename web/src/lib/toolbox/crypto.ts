import { bytesToHex, fromBytes, toBytes, utf8ToBytes, type ByteFormat, type Bytes } from './bytes';
import { md5 } from './md5';

export type AesMode = 'AES-GCM' | 'AES-CBC' | 'AES-CTR';
export type KeySource = 'raw' | 'passphrase';

export interface AesOptions {
  mode: AesMode;
  /** `raw`: the key field holds the key bytes in `keyFormat`. `passphrase`: PBKDF2-SHA256 derives the key. */
  keySource: KeySource;
  key: string;
  keyFormat: ByteFormat;
  /** Only for `passphrase`. */
  salt: string;
  saltFormat: ByteFormat;
  iterations: number;
  keyBits: 128 | 192 | 256;
  iv: string;
  ivFormat: ByteFormat;
  /** Output format for encrypt, input format for decrypt. */
  dataFormat: ByteFormat;
}

export const AES_DEFAULTS: AesOptions = {
  mode: 'AES-GCM', keySource: 'raw', key: '', keyFormat: 'utf8', salt: '', saltFormat: 'utf8', iterations: 100000, keyBits: 256,
  iv: '', ivFormat: 'utf8', dataFormat: 'base64',
};

async function importAesKey(o: AesOptions): Promise<CryptoKey> {
  if (o.keySource === 'passphrase') {
    const base = await crypto.subtle.importKey('raw', utf8ToBytes(o.key), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: toBytes(o.salt, o.saltFormat), iterations: o.iterations }, base, { name: o.mode, length: o.keyBits }, false, ['encrypt', 'decrypt']);
  }
  const raw = toBytes(o.key, o.keyFormat);
  if (![16, 24, 32].includes(raw.length)) throw new Error(`Key must be 16, 24 or 32 bytes (got ${raw.length})`);
  return crypto.subtle.importKey('raw', raw, { name: o.mode }, false, ['encrypt', 'decrypt']);
}

function ivFor(o: AesOptions): Bytes {
  const iv = toBytes(o.iv, o.ivFormat);
  if (o.mode === 'AES-CBC' && iv.length !== 16) throw new Error(`CBC needs a 16-byte IV (got ${iv.length})`);
  if (o.mode === 'AES-CTR' && iv.length !== 16) throw new Error(`CTR needs a 16-byte counter block (got ${iv.length})`);
  if (o.mode === 'AES-GCM' && iv.length === 0) throw new Error('GCM needs a nonce (12 bytes recommended)');
  return iv;
}

function params(o: AesOptions, iv: Bytes): AesGcmParams | AesCbcParams | AesCtrParams {
  if (o.mode === 'AES-CTR') return { name: 'AES-CTR', counter: iv, length: 64 };
  return { name: o.mode, iv };
}

/** Plaintext (UTF-8) -> ciphertext in `dataFormat`. GCM output carries the 16-byte tag at the end, as most libraries do. */
export async function aesEncrypt(plain: string, o: AesOptions): Promise<string> {
  const key = await importAesKey(o);
  const iv = ivFor(o);
  const out = await crypto.subtle.encrypt(params(o, iv), key, utf8ToBytes(plain));
  return fromBytes(new Uint8Array(out), o.dataFormat);
}

export async function aesDecrypt(cipher: string, o: AesOptions): Promise<string> {
  const key = await importAesKey(o);
  const iv = ivFor(o);
  let out: ArrayBuffer;
  try { out = await crypto.subtle.decrypt(params(o, iv), key, toBytes(cipher, o.dataFormat)); }
  catch { throw new Error('Decrypt failed: wrong key, IV, mode, or corrupted data'); }
  return fromBytes(new Uint8Array(out), 'utf8');
}

export function randomBytes(n: number): Bytes { return crypto.getRandomValues(new Uint8Array(n)); }

export type HashAlg = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
export const HASH_ALGS: HashAlg[] = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

export async function digest(alg: HashAlg, data: Bytes): Promise<string> {
  if (alg === 'MD5') return md5(data);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest(alg, data)));
}

export async function hmac(alg: Exclude<HashAlg, 'MD5'>, secret: Bytes, data: Bytes): Promise<string> {
  const k = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: alg }, false, ['sign']);
  return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', k, data)));
}

/** RFC 4122 v4; falls back to getRandomValues where randomUUID is missing (insecure contexts). */
export function uuidV4(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = bytesToHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** UUID v7: 48-bit unix ms, then random. Sorts by creation time. */
export function uuidV7(now = Date.now()): string {
  const b = randomBytes(16);
  const ms = BigInt(now);
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70; b[8] = (b[8] & 0x3f) | 0x80;
  const h = bytesToHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface PasswordOptions { length: number; upper: boolean; lower: boolean; digits: boolean; symbols: boolean }

/** Unbiased pick per character (rejection sampling); every enabled class appears at least once when length allows. */
export function randomPassword(o: PasswordOptions): string {
  const classes = [o.upper && 'ABCDEFGHJKLMNPQRSTUVWXYZ', o.lower && 'abcdefghijkmnopqrstuvwxyz', o.digits && '23456789', o.symbols && '!@#$%^&*()-_=+[]{};:,.?/'].filter((x): x is string => !!x);
  if (!classes.length || o.length < 1) return '';
  const all = classes.join('');
  const pick = (set: string) => {
    const max = 256 - (256 % set.length);
    for (;;) { const r = randomBytes(1)[0]; if (r < max) return set[r % set.length]; }
  };
  const chars: string[] = [];
  for (let i = 0; i < o.length; i++) chars.push(pick(i < classes.length ? classes[i] : all));
  // Fisher-Yates so the guaranteed characters are not always at the front.
  for (let i = chars.length - 1; i > 0; i--) { const j = randomBytes(1)[0] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}
