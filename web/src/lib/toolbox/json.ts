/** JSON parsing helpers for the JSON tool: lenient input, path strings, and value search. */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export interface ParseResult { value: JsonValue; /** True when the text only parsed after unwrapping a JSON string or relaxing syntax. */ relaxed: boolean }

/**
 * Strict JSON first. Then common near-JSON: a JSON string that itself contains JSON (API logs),
 * trailing commas, single quotes, unquoted keys, comments, and `NaN`/`Infinity`/`undefined`.
 */
export function parseLenient(text: string): ParseResult {
  const s = text.trim();
  if (!s) throw new Error('Empty input');
  try { return unwrap(JSON.parse(s)); } catch (e) {
    const relaxed = s
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:"'\\])\/\/.*$/gm, '$1')
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/'((?:[^'\\]|\\.)*)'/g, (_, inner: string) => `"${inner.replace(/"/g, '\\"').replace(/\\'/g, "'")}"`)
      .replace(/\b(NaN|-?Infinity|undefined)\b/g, 'null');
    try { return { ...unwrap(JSON.parse(relaxed)), relaxed: true }; } catch { throw e instanceof Error ? e : new Error(String(e)); }
  }
}

/** A string holding JSON (double-encoded) is shown as its contents. */
function unwrap(v: JsonValue): ParseResult {
  if (typeof v === 'string') {
    const t = v.trim();
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try { return { value: JSON.parse(t), relaxed: true }; } catch { /* keep as string */ }
    }
  }
  return { value: v, relaxed: false };
}

/** Line and column of a `JSON.parse` SyntaxError position, when the engine reports one. */
export function errorPosition(message: string, text: string): { line: number; col: number; pos: number } | null {
  const m = /position (\d+)/.exec(message) ?? /at line (\d+) column (\d+)/.exec(message);
  if (!m) return null;
  if (m.length === 3 && /line/.test(m[0])) return { line: Number(m[1]), col: Number(m[2]), pos: 0 };
  const pos = Number(m[1]);
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  return { line, col, pos };
}

/** `$.a.b[0]["weird key"]` for a key path. */
export function jsonPath(path: (string | number)[]): string {
  return '$' + path.map((k) => (typeof k === 'number' ? `[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`)).join('');
}

/** JS-style `a.b[0]` without the `$`, for code. */
export function jsAccessor(path: (string | number)[]): string {
  return path.map((k, i) => (typeof k === 'number' ? `[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? (i ? `.${k}` : k) : `[${JSON.stringify(k)}]`)).join('');
}

export function countNodes(v: JsonValue): number {
  if (Array.isArray(v)) return 1 + v.reduce((n: number, x) => n + countNodes(x), 0);
  if (v && typeof v === 'object') return 1 + Object.values(v).reduce((n: number, x) => n + countNodes(x), 0);
  return 1;
}

/** Paths whose key or primitive value contains `q` (case-insensitive). */
export function searchJson(v: JsonValue, q: string, limit = 500): (string | number)[][] {
  const needle = q.toLowerCase();
  const out: (string | number)[][] = [];
  if (!needle) return out;
  const walk = (x: JsonValue, path: (string | number)[]) => {
    if (out.length >= limit) return;
    if (Array.isArray(x)) x.forEach((c, i) => walk(c, [...path, i]));
    else if (x && typeof x === 'object') {
      for (const [k, c] of Object.entries(x)) {
        if (k.toLowerCase().includes(needle)) out.push([...path, k]);
        walk(c, [...path, k]);
      }
    } else if (String(x).toLowerCase().includes(needle)) out.push(path);
  };
  walk(v, []);
  return out;
}

/** Keys sorted recursively, so two objects with the same content format identically. */
export function sortKeys(v: JsonValue): JsonValue {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

/** TypeScript interface text inferred from a value, for pasting into code. */
export function toTypeScript(v: JsonValue, root = 'Root'): string {
  const out: string[] = [];
  const seen = new Map<string, string>();
  const nameFor = (key: string) => key.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toUpperCase()) || 'Item';
  const typeOf = (x: JsonValue, hint: string): string => {
    if (x === null) return 'null';
    if (Array.isArray(x)) {
      if (!x.length) return 'unknown[]';
      const inner = [...new Set(x.map((e) => typeOf(e, hint.replace(/s$/, '') || hint)))];
      return inner.length === 1 ? `${inner[0]}[]` : `(${inner.join(' | ')})[]`;
    }
    if (typeof x === 'object') {
      const fields = Object.entries(x).map(([k, c]) => `  ${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${typeOf(c, k)};`);
      const body = fields.length ? `{\n${fields.join('\n')}\n}` : '{}';
      let name = nameFor(hint);
      if (seen.has(name) && seen.get(name) !== body) { let i = 2; while (seen.has(`${name}${i}`) && seen.get(`${name}${i}`) !== body) i++; name = `${name}${i}`; }
      if (!seen.has(name)) { seen.set(name, body); out.push(`export interface ${name} ${body}`); }
      return name;
    }
    return typeof x;
  };
  const top = typeOf(v, root);
  if (!(v && typeof v === 'object' && !Array.isArray(v))) out.push(`export type ${root} = ${top};`);
  return out.reverse().join('\n\n');
}
