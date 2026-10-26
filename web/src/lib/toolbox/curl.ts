import { parseLenient } from './json';

/** One HTTP request, as read from a cURL command or a fetch() call, and as written back out. */
export interface HttpRequestSpec {
  method: string;
  url: string;
  headers: [string, string][];
  /** Raw body text; for `form` requests this stays undefined. */
  body?: string;
  /** multipart/form-data fields from `-F`; `file` marks `@path` values. */
  form?: { name: string; value: string; file: boolean }[];
  insecure?: boolean;
  followRedirects?: boolean;
  compressed?: boolean;
}

/**
 * Splits a shell command into words the way bash would for the quoting cURL copies use:
 * '…', "…" (with \ escapes), $'…' (ANSI-C, what Chrome emits for bodies), backslash-newline
 * continuations, and `^` continuations from "Copy as cURL (cmd)".
 */
export function shellWords(input: string): string[] {
  const s = input.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');
  const out: string[] = [];
  let cur = '';
  let has = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (/\s/.test(ch)) { if (has) { out.push(cur); cur = ''; has = false; } continue; }
    has = true;
    if (ch === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0) throw new Error('Unterminated single quote');
      cur += s.slice(i + 1, end); i = end; continue;
    }
    if (ch === '$' && s[i + 1] === "'") {
      i += 2;
      for (; i < s.length && s[i] !== "'"; i++) {
        if (s[i] !== '\\') { cur += s[i]; continue; }
        const n = s[++i];
        const simple: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', a: '\x07', b: '\b', e: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"' };
        if (n in simple) cur += simple[n];
        else if (n === 'x') { const h = /^[0-9a-fA-F]{1,2}/.exec(s.slice(i + 1))![0]; cur += String.fromCharCode(parseInt(h, 16)); i += h.length; }
        else if (n === 'u' || n === 'U') { const h = /^[0-9a-fA-F]{1,8}/.exec(s.slice(i + 1))![0]; cur += String.fromCodePoint(parseInt(h, 16)); i += h.length; }
        else cur += '\\' + n;
      }
      if (i >= s.length) throw new Error("Unterminated $' quote");
      continue;
    }
    if (ch === '"') {
      i++;
      for (; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === '\\' && '"\\$`\n'.includes(s[i + 1])) { cur += s[++i]; continue; }
        cur += s[i];
      }
      if (i >= s.length) throw new Error('Unterminated double quote');
      continue;
    }
    if (ch === '\\' && i + 1 < s.length) { cur += s[++i]; continue; }
    cur += ch;
  }
  if (has) out.push(cur);
  return out;
}

const VALUE_FLAGS: Record<string, string> = {
  '-X': 'request', '--request': 'request', '-H': 'header', '--header': 'header',
  '-d': 'data', '--data': 'data', '--data-raw': 'data-raw', '--data-binary': 'data', '--data-ascii': 'data', '--data-urlencode': 'data-urlencode',
  '--json': 'json', '-F': 'form', '--form': 'form', '--form-string': 'form-string', '-u': 'user', '--user': 'user',
  '-b': 'cookie', '--cookie': 'cookie', '-A': 'user-agent', '--user-agent': 'user-agent', '-e': 'referer', '--referer': 'referer',
  '--url': 'url', '-o': 'skip', '--output': 'skip', '-m': 'skip', '--max-time': 'skip', '--connect-timeout': 'skip', '-w': 'skip', '--write-out': 'skip',
  '-x': 'skip', '--proxy': 'skip', '--retry': 'skip', '-c': 'skip', '--cookie-jar': 'skip', '-T': 'skip', '--upload-file': 'skip', '-r': 'skip', '--range': 'skip',
  '--cacert': 'skip', '--cert': 'skip', '--key': 'skip', '--resolve': 'skip', '--limit-rate': 'skip', '-K': 'skip', '--config': 'skip',
};
const BOOL_FLAGS: Record<string, string> = {
  '-G': 'get', '--get': 'get', '-I': 'head', '--head': 'head', '-k': 'insecure', '--insecure': 'insecure', '-L': 'location', '--location': 'location',
  '--compressed': 'compressed', '-s': '', '--silent': '', '-S': '', '--show-error': '', '-v': '', '--verbose': '', '-i': '', '--include': '',
  '-f': '', '--fail': '', '-N': '', '--no-buffer': '', '-g': '', '--globoff': '', '--http1.1': '', '--http2': '', '-#': '', '--progress-bar': '',
};

export function parseCurl(cmd: string): HttpRequestSpec {
  const words = shellWords(cmd.trim());
  if (!words.length || !/^curl(\.exe)?$/i.test(words[0].split('/').pop() ?? '')) throw new Error('Not a curl command');
  const req: HttpRequestSpec = { method: '', url: '', headers: [] };
  const data: string[] = [];
  let get = false, head = false, json = false;
  for (let i = 1; i < words.length; i++) {
    let w = words[i];
    let val: string | undefined;
    if (w.startsWith('--') && w.includes('=')) { const k = w.indexOf('='); val = w.slice(k + 1); w = w.slice(0, k); }
    // Bundled short flags: -sSL, -XPOST, -H'…'.
    if (/^-[A-Za-z#]{2,}/.test(w) && !w.startsWith('--')) {
      const first = '-' + w[1];
      if (VALUE_FLAGS[first]) { val = w.slice(2); w = first; }
      else {
        const rest = w.slice(1).split('').map((c) => '-' + c);
        const valIdx = rest.findIndex((f) => VALUE_FLAGS[f]);
        if (valIdx >= 0 && valIdx < rest.length - 1) { val = w.slice(valIdx + 2); rest.length = valIdx + 1; }
        for (const f of rest.slice(0, -1)) apply(f, undefined);
        w = rest[rest.length - 1];
      }
    }
    apply(w, val);
    function apply(flag: string, v: string | undefined) {
      const kind = VALUE_FLAGS[flag];
      if (kind) {
        const value = v ?? words[++i];
        if (value === undefined) throw new Error(`${flag} needs a value`);
        switch (kind) {
          case 'request': req.method = value.toUpperCase(); break;
          case 'header': { const k = value.indexOf(':'); if (k > 0) req.headers.push([value.slice(0, k).trim(), value.slice(k + 1).trim()]); break; }
          case 'data': data.push(value.startsWith('@') ? `<file ${value.slice(1)}>` : value); break;
          case 'data-raw': data.push(value); break;
          case 'data-urlencode': { const k = value.indexOf('='); data.push(k < 0 ? encodeURIComponent(value) : `${value.slice(0, k)}=${encodeURIComponent(value.slice(k + 1))}`); break; }
          case 'json': data.push(value); json = true; break;
          case 'form': case 'form-string': {
            const k = value.indexOf('=');
            const name = k < 0 ? value : value.slice(0, k), fv = k < 0 ? '' : value.slice(k + 1);
            (req.form ??= []).push({ name, value: kind === 'form' && fv.startsWith('@') ? fv.slice(1) : fv, file: kind === 'form' && fv.startsWith('@') });
            break;
          }
          case 'user': req.headers.push(['Authorization', `Basic ${btoa(unescape(encodeURIComponent(value)))}`]); break;
          case 'cookie': req.headers.push(['Cookie', value]); break;
          case 'user-agent': req.headers.push(['User-Agent', value]); break;
          case 'referer': req.headers.push(['Referer', value]); break;
          case 'url': req.url = value; break;
        }
        return;
      }
      if (flag in BOOL_FLAGS) {
        const b = BOOL_FLAGS[flag];
        if (b === 'get') get = true; else if (b === 'head') head = true;
        else if (b === 'insecure') req.insecure = true; else if (b === 'location') req.followRedirects = true; else if (b === 'compressed') req.compressed = true;
        return;
      }
      if (flag.startsWith('-') && flag.length > 1) return; // unknown flag without a value: ignore
      if (!req.url) req.url = flag;
    }
  }
  if (!req.url) throw new Error('No URL in the command');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(req.url)) req.url = `http://${req.url}`;
  const hasHeader = (n: string) => req.headers.some(([k]) => k.toLowerCase() === n);
  if (json) {
    if (!hasHeader('content-type')) req.headers.push(['Content-Type', 'application/json']);
    if (!hasHeader('accept')) req.headers.push(['Accept', 'application/json']);
  }
  if (data.length && get) {
    req.url += (req.url.includes('?') ? '&' : '?') + data.join('&');
  } else if (data.length) {
    req.body = data.join('&');
    if (!hasHeader('content-type') && !json) req.headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
  }
  req.method ||= head ? 'HEAD' : (req.body !== undefined || req.form) && !get ? 'POST' : 'GET';
  return req;
}

/**
 * Reads `fetch("url", { … })` as copied from browser dev tools ("Copy as fetch" / "Copy as Node.js fetch").
 * The options object is JSON-like; it is parsed leniently.
 */
export function parseFetch(code: string): HttpRequestSpec {
  const m = /fetch\s*\(\s*(["'`])((?:\\.|(?!\1).)*)\1\s*(?:,\s*([\s\S]*?))?\)\s*;?\s*$/.exec(code.trim());
  if (!m) throw new Error('Not a fetch(…) call');
  const url = m[2].replace(/\\(.)/g, '$1');
  let opts: Record<string, unknown> = {};
  if (m[3]?.trim()) {
    const v = parseLenient(m[3]).value;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('fetch options are not an object');
    opts = v as Record<string, unknown>;
  }
  const headers = opts.headers && typeof opts.headers === 'object' ? Object.entries(opts.headers as Record<string, unknown>).map(([k, v]): [string, string] => [k, String(v)]) : [];
  const body = typeof opts.body === 'string' ? opts.body : opts.body == null ? undefined : JSON.stringify(opts.body);
  return { method: String(opts.method ?? (body !== undefined ? 'POST' : 'GET')).toUpperCase(), url, headers, body };
}

/** Accepts either a curl command or a fetch() call. */
export function parseRequest(text: string): HttpRequestSpec {
  return /^\s*curl(\.exe)?\s/i.test(text) ? parseCurl(text) : parseFetch(text);
}

/** POSIX single quoting: safe for any byte except NUL. */
export function shq(s: string): string {
  return /^[A-Za-z0-9_\-.,/:=@%+]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

export function toCurl(r: HttpRequestSpec, multiline = true): string {
  const parts = [`curl ${shq(r.url)}`];
  const implicit = (r.body !== undefined || r.form?.length) ? 'POST' : 'GET';
  if (r.method !== implicit) parts.push(r.method === 'HEAD' ? '-I' : `-X ${r.method}`);
  for (const [k, v] of r.headers) parts.push(`-H ${shq(`${k}: ${v}`)}`);
  for (const f of r.form ?? []) parts.push(`-F ${shq(`${f.name}=${f.file ? '@' : ''}${f.value}`)}`);
  if (r.body !== undefined) parts.push(`--data-raw ${shq(r.body)}`);
  if (r.compressed) parts.push('--compressed');
  if (r.followRedirects) parts.push('-L');
  if (r.insecure) parts.push('-k');
  return parts.join(multiline ? ' \\\n  ' : ' ');
}

const jsStr = (s: string) => JSON.stringify(s);
const isJsonBody = (r: HttpRequestSpec) => {
  const ct = r.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  if (!r.body || !/json/i.test(ct)) return null;
  try { return JSON.parse(r.body) as unknown; } catch { return null; }
};
const indent = (s: string, n: number) => s.split('\n').map((l, i) => (i ? ' '.repeat(n) + l : l)).join('\n');

export function toFetch(r: HttpRequestSpec): string {
  const lines: string[] = [];
  if (r.method !== 'GET') lines.push(`  method: ${jsStr(r.method)},`);
  if (r.headers.length) {
    lines.push('  headers: {');
    for (const [k, v] of r.headers) lines.push(`    ${jsStr(k)}: ${jsStr(v)},`);
    lines.push('  },');
  }
  const json = isJsonBody(r);
  if (r.form?.length) lines.push('  body: form,');
  else if (json !== null) lines.push(`  body: JSON.stringify(${indent(JSON.stringify(json, null, 2), 2)}),`);
  else if (r.body !== undefined) lines.push(`  body: ${jsStr(r.body)},`);
  if (r.followRedirects === false) lines.push(`  redirect: 'manual',`);
  const pre = r.form?.length ? `const form = new FormData();\n${r.form.map((f) => `form.append(${jsStr(f.name)}, ${f.file ? `/* file: ${f.value} */ new Blob([])` : jsStr(f.value)});`).join('\n')}\n\n` : '';
  const call = lines.length ? `await fetch(${jsStr(r.url)}, {\n${lines.join('\n')}\n})` : `await fetch(${jsStr(r.url)})`;
  return `${pre}const res = ${call};\nconst data = await res.${/json/i.test(r.headers.find(([k]) => k.toLowerCase() === 'accept')?.[1] ?? '') || json !== null ? 'json' : 'text'}();`;
}

export function toAxios(r: HttpRequestSpec): string {
  const lines = [`  method: ${jsStr(r.method.toLowerCase())},`, `  url: ${jsStr(r.url)},`];
  if (r.headers.length) {
    lines.push('  headers: {');
    for (const [k, v] of r.headers) lines.push(`    ${jsStr(k)}: ${jsStr(v)},`);
    lines.push('  },');
  }
  const json = isJsonBody(r);
  if (r.form?.length) lines.push('  data: form,');
  else if (json !== null) lines.push(`  data: ${indent(JSON.stringify(json, null, 2), 2)},`);
  else if (r.body !== undefined) lines.push(`  data: ${jsStr(r.body)},`);
  if (r.followRedirects === false) lines.push('  maxRedirects: 0,');
  const pre = r.form?.length ? `const form = new FormData();\n${r.form.map((f) => `form.append(${jsStr(f.name)}, ${f.file ? `/* file: ${f.value} */ new Blob([])` : jsStr(f.value)});`).join('\n')}\n\n` : '';
  return `${pre}import axios from 'axios';\n\nconst { data } = await axios({\n${lines.join('\n')}\n});`;
}

const pyStr = (s: string) => JSON.stringify(s);
const toPy = (v: unknown, n = 0): string => {
  const pad = ' '.repeat(n + 4), end = ' '.repeat(n);
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => pad + toPy(x, n + 4)).join(',\n')},\n${end}]` : '[]';
  if (typeof v === 'object') { const e = Object.entries(v as Record<string, unknown>); return e.length ? `{\n${e.map(([k, x]) => `${pad}${pyStr(k)}: ${toPy(x, n + 4)}`).join(',\n')},\n${end}}` : '{}'; }
  return typeof v === 'string' ? pyStr(v) : String(v);
};

export function toPython(r: HttpRequestSpec): string {
  const json = isJsonBody(r);
  const headers = r.headers.filter(([k]) => !(json !== null && k.toLowerCase() === 'content-type'));
  const args = [pyStr(r.url)];
  const pre: string[] = ['import requests', ''];
  if (headers.length) { pre.push(`headers = ${toPy(Object.fromEntries(headers))}`); args.push('headers=headers'); }
  if (json !== null) { pre.push(`payload = ${toPy(json)}`); args.push('json=payload'); }
  else if (r.body !== undefined) { pre.push(`data = ${pyStr(r.body)}`); args.push('data=data'); }
  if (r.form?.length) {
    const files = r.form.filter((f) => f.file), fields = r.form.filter((f) => !f.file);
    if (fields.length) { pre.push(`data = ${toPy(Object.fromEntries(fields.map((f) => [f.name, f.value])))}`); args.push('data=data'); }
    if (files.length) { pre.push(`files = {${files.map((f) => `${pyStr(f.name)}: open(${pyStr(f.value)}, "rb")`).join(', ')}}`); args.push('files=files'); }
  }
  if (r.insecure) args.push('verify=False');
  if (r.followRedirects === false) args.push('allow_redirects=False');
  if (pre.length > 2) pre.push('');
  return `${pre.join('\n')}\nres = requests.${['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(r.method) ? r.method.toLowerCase() : `request(${pyStr(r.method)}, `}${['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(r.method) ? '(' : ''}${args.join(', ')})\nprint(res.status_code, res.text)`;
}
