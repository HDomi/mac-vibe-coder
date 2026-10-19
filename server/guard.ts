/**
 * Request origin guard.
 *
 * The server listens on loopback only, but any web page the user opens in a browser can still
 * reach http://127.0.0.1:<port>: simple cross-site POSTs (no preflight), <img>/<script> GETs,
 * WebSockets (not subject to CORS) and DNS rebinding (attacker hostname resolving to 127.0.0.1).
 * Every HTTP request and WebSocket upgrade goes through `rejectReason` first.
 *
 *  - Host must be a loopback name (defeats DNS rebinding).
 *  - Origin, when present, must be this server's own origin (or the Vite dev server when MVC_DEV=1).
 *  - Without Origin, Sec-Fetch-Site must not say the request came from another site.
 *  - Clients that send neither (curl, Electron's health probe, local scripts) already run as the
 *    user on this machine and are allowed.
 */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const DEV_PORT = 5173;
const DEV = process.env.MVC_DEV === '1';

function hostParts(host: string): { name: string; port: number | null } | null {
  const m = host.trim().toLowerCase().match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
  if (!m) return null;
  return { name: m[1], port: m[2] ? Number(m[2]) : null };
}

function allowedPort(p: number | null, serverPort: number) {
  return p === serverPort || (DEV && p === DEV_PORT);
}

export interface GuardInput { host?: string | null; origin?: string | null; secFetchSite?: string | null }

/** Null when the request may proceed, otherwise a short reason for the 403. */
export function rejectReason(h: GuardInput, serverPort: number): string | null {
  const host = h.host ? hostParts(h.host) : null;
  if (!host || !LOOPBACK.has(host.name) || !allowedPort(host.port ?? 80, serverPort)) return 'bad host';
  if (h.origin) {
    let o: URL;
    try { o = new URL(h.origin); } catch { return 'bad origin'; }
    if (o.protocol !== 'http:' || !LOOPBACK.has(o.hostname) || !allowedPort(Number(o.port || 80), serverPort)) return 'cross-origin';
    return null;
  }
  const site = (h.secFetchSite ?? '').toLowerCase();
  if (site === 'cross-site' || site === 'same-site') return 'cross-site';
  return null;
}
