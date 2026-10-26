/** Regex evaluation for the Regex tool. */

export interface RegexMatch { index: number; end: number; text: string; groups: { name: string | null; value: string | undefined; index: number }[] }

export const REGEX_FLAGS = ['g', 'i', 'm', 's', 'u', 'y', 'd'] as const;

/** `/pattern/flags` literal or a bare pattern. */
export function splitLiteral(input: string): { source: string; flags: string } | null {
  const m = /^\/((?:\\.|[^/])+)\/([dgimsuy]*)$/.exec(input.trim());
  return m ? { source: m[1], flags: m[2] } : null;
}

/** All matches with group positions. `g` (every match) and `d` (group offsets) are added; a zero-length match advances by one. */
export function runRegex(source: string, flags: string, text: string, limit = 2000): RegexMatch[] {
  const f = new Set(flags.split(''));
  f.add('g'); f.add('d');
  const re = new RegExp(source, [...f].join(''));
  const out: RegexMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < limit) {
    const names = Object.keys(m.groups ?? {});
    const groups = m.slice(1).map((value, i) => {
      const name = names.find((n) => m!.groups![n] === value && !names.slice(0, i).some((p) => m!.groups![p] === value)) ?? null;
      const idx = m!.indices?.[i + 1]?.[0] ?? -1;
      return { name, value, index: idx };
    });
    out.push({ index: m.index, end: m.index + m[0].length, text: m[0], groups });
    if (!m[0].length) re.lastIndex++;
  }
  return out;
}

export function replaceRegex(source: string, flags: string, text: string, replacement: string): string {
  return text.replace(new RegExp(source, flags), replacement);
}

/** Common patterns offered as a starting point. */
export const REGEX_PRESETS: { label: string; source: string; flags: string }[] = [
  { label: 'Email', source: '[\\w.+-]+@[\\w-]+\\.[\\w.-]+', flags: 'g' },
  { label: 'URL', source: 'https?:\\/\\/[^\\s/$.?#].[^\\s]*', flags: 'gi' },
  { label: 'IPv4', source: '\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b', flags: 'g' },
  { label: 'Date (YYYY-MM-DD)', source: '(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})', flags: 'g' },
  { label: 'Phone (KR)', source: '01[016789]-?\\d{3,4}-?\\d{4}', flags: 'g' },
  { label: 'Hex color', source: '#(?:[0-9a-fA-F]{3}){1,2}\\b', flags: 'g' },
  { label: 'UUID', source: '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', flags: 'gi' },
  { label: 'Trailing whitespace', source: '[ \\t]+$', flags: 'gm' },
];
