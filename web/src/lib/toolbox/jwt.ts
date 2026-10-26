import { base64ToBytes, bytesToUtf8, utf8ToBytes, type Bytes } from './bytes';

export interface JwtParts {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  /** `header.payload` exactly as signed. */
  signingInput: string;
  raw: [string, string, string];
}

/** Splits and base64url-decodes a compact JWS/JWT. A leading `Bearer ` and surrounding whitespace are ignored. */
export function decodeJwt(token: string): JwtParts {
  const clean = token.trim().replace(/^Bearer\s+/i, '').trim();
  const parts = clean.split('.');
  if (parts.length !== 3) throw new Error('A JWT has three dot-separated parts');
  const [h, p, s] = parts;
  const parse = (seg: string, name: string) => {
    let text: string;
    try { text = bytesToUtf8(base64ToBytes(seg)); } catch { throw new Error(`${name} is not base64url`); }
    let obj: unknown;
    try { obj = JSON.parse(text); } catch { throw new Error(`${name} is not JSON`); }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(`${name} is not an object`);
    return obj as Record<string, unknown>;
  };
  return { header: parse(h, 'Header'), payload: parse(p, 'Payload'), signature: s, signingInput: `${h}.${p}`, raw: [h, p, s] };
}

export type JwtAlg = 'HS256' | 'HS384' | 'HS512' | 'RS256' | 'RS384' | 'RS512' | 'ES256' | 'ES384' | 'ES512' | 'PS256' | 'PS384' | 'PS512';

const HASH: Record<string, string> = { '256': 'SHA-256', '384': 'SHA-384', '512': 'SHA-512' };
const CURVE: Record<string, string> = { '256': 'P-256', '384': 'P-384', '512': 'P-521' };

function pemToDer(pem: string): Bytes {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return base64ToBytes(b64);
}

/** JOSE ECDSA signatures are r||s; WebCrypto wants the same raw form, so no DER conversion is needed. */
export async function verifyJwt(token: JwtParts, key: string): Promise<boolean> {
  const alg = String(token.header.alg ?? '');
  const bits = alg.slice(2);
  const hash = HASH[bits];
  if (!hash) throw new Error(`Unsupported alg: ${alg || '(none)'}`);
  const data = utf8ToBytes(token.signingInput);
  const sig = base64ToBytes(token.signature);
  const subtle = crypto.subtle;
  if (alg.startsWith('HS')) {
    const k = await subtle.importKey('raw', utf8ToBytes(key), { name: 'HMAC', hash }, false, ['verify']);
    return subtle.verify('HMAC', k, sig, data);
  }
  const isPem = /-----BEGIN/.test(key);
  if (!isPem) {
    let jwk: JsonWebKey;
    try { jwk = JSON.parse(key); } catch { throw new Error('Public key must be PEM or JWK'); }
    if (alg.startsWith('ES')) {
      const k = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: CURVE[bits] }, false, ['verify']);
      return subtle.verify({ name: 'ECDSA', hash }, k, sig, data);
    }
    const name = alg.startsWith('PS') ? 'RSA-PSS' : 'RSASSA-PKCS1-v1_5';
    const k = await subtle.importKey('jwk', jwk, { name, hash }, false, ['verify']);
    return subtle.verify(alg.startsWith('PS') ? { name, saltLength: Number(bits) / 8 } : name, k, sig, data);
  }
  const der = pemToDer(key);
  if (alg.startsWith('ES')) {
    const k = await subtle.importKey('spki', der, { name: 'ECDSA', namedCurve: CURVE[bits] }, false, ['verify']);
    return subtle.verify({ name: 'ECDSA', hash }, k, sig, data);
  }
  const name = alg.startsWith('PS') ? 'RSA-PSS' : 'RSASSA-PKCS1-v1_5';
  const k = await subtle.importKey('spki', der, { name, hash }, false, ['verify']);
  return subtle.verify(alg.startsWith('PS') ? { name, saltLength: Number(bits) / 8 } : name, k, sig, data);
}

/** Builds and signs an HS* token. Header gets `typ: JWT` unless given. */
export async function signHsJwt(header: Record<string, unknown>, payload: Record<string, unknown>, secret: string): Promise<string> {
  const alg = String(header.alg ?? 'HS256');
  const hash = HASH[alg.slice(2)];
  if (!alg.startsWith('HS') || !hash) throw new Error(`Signing supports HS256/384/512, not ${alg}`);
  const b64u = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const input = `${b64u(JSON.stringify({ typ: 'JWT', ...header, alg }))}.${b64u(JSON.stringify(payload))}`;
  const k = await crypto.subtle.importKey('raw', utf8ToBytes(secret), { name: 'HMAC', hash }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, utf8ToBytes(input)));
  let bin = '';
  for (const x of sig) bin += String.fromCharCode(x);
  return `${input}.${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/** Claims that carry a unix-seconds time, for the human-readable column. */
export const TIME_CLAIMS = new Set(['exp', 'iat', 'nbf', 'auth_time', 'updated_at']);

/** Null while valid; otherwise which time claim fails, at `now` (ms). */
export function jwtTimeStatus(payload: Record<string, unknown>, now = Date.now()): { claim: 'exp' | 'nbf'; at: number } | null {
  const sec = now / 1000;
  if (typeof payload.exp === 'number' && payload.exp < sec) return { claim: 'exp', at: payload.exp };
  if (typeof payload.nbf === 'number' && payload.nbf > sec) return { claim: 'nbf', at: payload.nbf };
  return null;
}
