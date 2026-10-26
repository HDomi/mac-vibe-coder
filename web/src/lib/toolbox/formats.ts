import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { parseLenient } from './json';

export type DataFormat = 'json' | 'yaml' | 'toml';
export const DATA_FORMATS: DataFormat[] = ['json', 'yaml', 'toml'];

/** Guesses the format: JSON if it parses as JSON, TOML if it looks like `[table]` / `key = value`, else YAML. */
export function detectFormat(text: string): DataFormat {
  const s = text.trim();
  if (/^[[{"]/.test(s)) { try { JSON.parse(s); return 'json'; } catch { /* fall through */ } }
  if (/^\s*\[[\w.\-" ]+\]\s*$/m.test(s) || /^\s*[\w.\-"]+\s*=\s*\S/m.test(s)) { try { parseToml(s); return 'toml'; } catch { /* fall through */ } }
  return 'yaml';
}

export function parseData(text: string, format: DataFormat): unknown {
  if (!text.trim()) throw new Error('Empty input');
  if (format === 'json') return parseLenient(text).value;
  if (format === 'toml') return parseToml(text);
  return parseYaml(text);
}

/** TOML cannot hold null or a non-table root; those are reported rather than silently dropped. */
function assertTomlable(v: unknown, path = ''): void {
  if (v === null || v === undefined) throw new Error(`TOML has no null (at ${path || 'root'})`);
  if (Array.isArray(v)) { v.forEach((x, i) => assertTomlable(x, `${path}[${i}]`)); return; }
  if (typeof v === 'object' && !(v instanceof Date)) for (const [k, x] of Object.entries(v as Record<string, unknown>)) assertTomlable(x, path ? `${path}.${k}` : k);
}

export function stringifyData(value: unknown, format: DataFormat, indentSize = 2): string {
  if (format === 'json') return JSON.stringify(value, null, indentSize);
  if (format === 'yaml') return stringifyYaml(value, { indent: indentSize, lineWidth: 0 });
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('TOML needs a table (object) at the root');
  assertTomlable(value);
  return stringifyToml(value as Record<string, unknown>);
}

export function convertData(text: string, from: DataFormat | 'auto', to: DataFormat, indentSize = 2): { output: string; from: DataFormat } {
  const src = from === 'auto' ? detectFormat(text) : from;
  return { output: stringifyData(parseData(text, src), to, indentSize), from: src };
}
