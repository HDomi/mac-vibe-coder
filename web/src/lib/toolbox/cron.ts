/** Five-field cron (minute hour day-of-month month day-of-week) with names, ranges, steps and @macros. */

export interface CronField { values: Set<number>; any: boolean }
export interface CronSchedule { minute: CronField; hour: CronField; dom: CronField; month: CronField; dow: CronField; source: string }

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *',
};
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const SPEC = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS, base: 1 },
  { name: 'day of week', min: 0, max: 7, names: DAYS, base: 0 },
] as const;

function parseField(src: string, i: number): CronField {
  const spec = SPEC[i];
  const values = new Set<number>();
  const num = (t: string) => {
    const up = t.toUpperCase();
    if ('names' in spec) { const k = (spec.names as readonly string[]).indexOf(up); if (k >= 0) return k + spec.base; }
    if (!/^\d+$/.test(t)) throw new Error(`Bad ${spec.name} value "${t}"`);
    const n = Number(t);
    if (n < spec.min || n > spec.max) throw new Error(`${spec.name} ${n} is out of range ${spec.min}-${spec.max}`);
    return n;
  };
  const any = src === '*' || src === '?';
  for (const part of src.split(',')) {
    if (!part) throw new Error(`Empty item in ${spec.name}`);
    const [range, stepStr] = part.split('/');
    const step = stepStr === undefined ? 1 : Number(stepStr);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad step "${stepStr}" in ${spec.name}`);
    let lo: number, hi: number;
    if (range === '*' || range === '?') { lo = spec.min; hi = i === 4 ? 6 : spec.max; }
    else if (range.includes('-')) { const [a, b] = range.split('-'); lo = num(a); hi = num(b); if (lo > hi) throw new Error(`Range ${range} runs backwards in ${spec.name}`); }
    else { lo = num(range); hi = stepStr === undefined ? lo : (i === 4 ? 6 : spec.max); }
    for (let v = lo; v <= hi; v += step) values.add(i === 4 && v === 7 ? 0 : v);
  }
  return { values, any: any };
}

export function parseCron(expr: string): CronSchedule {
  const src = MACROS[expr.trim().toLowerCase()] ?? expr.trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 6) throw new Error('Six fields: seconds (Quartz/Spring style) are not supported; drop the first field');
  if (parts.length !== 5) throw new Error(`Cron needs 5 fields, got ${parts.length}`);
  if (/[LW#]/i.test(src.replace(/[A-Z]{3}/gi, ''))) throw new Error('L, W and # (Quartz extensions) are not supported');
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, i));
  return { minute, hour, dom, month, dow, source: src };
}

/** Day matches per POSIX cron: when both day fields are restricted, either may match. */
function dayMatches(s: CronSchedule, dom: number, dow: number): boolean {
  if (s.dom.any && s.dow.any) return true;
  if (s.dom.any) return s.dow.values.has(dow);
  if (s.dow.any) return s.dom.values.has(dom);
  return s.dom.values.has(dom) || s.dow.values.has(dow);
}

/** The next `count` run times after `from` (ms), in local time or UTC. */
export function nextRuns(s: CronSchedule, count: number, from = Date.now(), utc = false): Date[] {
  const d = new Date(from);
  const get = {
    Y: () => (utc ? d.getUTCFullYear() : d.getFullYear()), M: () => (utc ? d.getUTCMonth() : d.getMonth()), D: () => (utc ? d.getUTCDate() : d.getDate()),
    W: () => (utc ? d.getUTCDay() : d.getDay()), h: () => (utc ? d.getUTCHours() : d.getHours()), m: () => (utc ? d.getUTCMinutes() : d.getMinutes()),
  };
  const set = (Y: number, M: number, D: number, h: number, m: number) => { if (utc) d.setTime(Date.UTC(Y, M, D, h, m)); else d.setTime(new Date(Y, M, D, h, m).getTime()); };
  set(get.Y(), get.M(), get.D(), get.h(), get.m() + 1);
  const out: Date[] = [];
  for (let guard = 0; out.length < count && guard < 200000; guard++) {
    if (!s.month.values.has(get.M() + 1)) { set(get.Y(), get.M() + 1, 1, 0, 0); continue; }
    if (!dayMatches(s, get.D(), get.W())) { set(get.Y(), get.M(), get.D() + 1, 0, 0); continue; }
    if (!s.hour.values.has(get.h())) { set(get.Y(), get.M(), get.D(), get.h() + 1, 0); continue; }
    if (!s.minute.values.has(get.m())) { set(get.Y(), get.M(), get.D(), get.h(), get.m() + 1); continue; }
    out.push(new Date(d.getTime()));
    set(get.Y(), get.M(), get.D(), get.h(), get.m() + 1);
  }
  return out;
}

/** Compact list form of a field for the breakdown table: "0,15,30,45" or "every value". */
export function fieldSummary(f: CronField, i: number): string {
  const all = [...f.values].sort((a, b) => a - b);
  const span = i === 4 ? 7 : SPEC[i].max - SPEC[i].min + 1;
  if (all.length === span) return '*';
  const label = (v: number) => (i === 3 ? MONTHS[v - 1] : i === 4 ? DAYS[v] : String(v));
  return all.map(label).join(', ');
}

export const CRON_FIELD_NAMES = SPEC.map((s) => s.name);

export const CRON_PRESETS: { expr: string; key: string }[] = [
  { expr: '*/5 * * * *', key: 'every5' },
  { expr: '0 * * * *', key: 'hourly' },
  { expr: '0 9 * * *', key: 'daily9' },
  { expr: '0 9 * * 1-5', key: 'weekdays9' },
  { expr: '30 18 * * 5', key: 'friday' },
  { expr: '0 0 1 * *', key: 'monthly' },
  { expr: '0 3 * * 0', key: 'sunday3' },
  { expr: '0 */6 * * *', key: 'every6h' },
];
