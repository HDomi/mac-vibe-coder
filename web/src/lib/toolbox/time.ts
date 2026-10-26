/** Timestamp parsing for the Time tool. */

export interface ParsedTime { ms: number; unit: 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds' | 'iso' | 'natural' }

/**
 * Accepts unix seconds / ms / µs / ns (chosen by digit count), ISO 8601, RFC 2822, `YYYY-MM-DD HH:mm`, and `now`.
 * Plain numbers of 1-11 digits are seconds, 12-14 ms, 15-17 µs, 18+ ns.
 */
export function parseTime(input: string, now = Date.now()): ParsedTime {
  const s = input.trim();
  if (!s || /^now$/i.test(s)) return { ms: now, unit: 'natural' };
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const digits = s.replace(/^-|\..*$/g, '').length;
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error('Number out of range');
    if (digits <= 11) return { ms: n * 1000, unit: 'seconds' };
    if (digits <= 14) return { ms: n, unit: 'milliseconds' };
    if (digits <= 17) return { ms: n / 1000, unit: 'microseconds' };
    return { ms: n / 1e6, unit: 'nanoseconds' };
  }
  // "2024-01-02 03:04" → treat as local time, like the Date constructor does for "2024-01-02T03:04".
  const norm = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? s.replace(' ', 'T') : s;
  const ms = Date.parse(norm);
  if (Number.isNaN(ms)) throw new Error('Unrecognized date');
  return { ms, unit: /^\d{4}-\d{2}-\d{2}/.test(s) ? 'iso' : 'natural' };
}

/** ISO 8601 with a numeric offset for `tz` (an IANA zone), e.g. 2024-01-02T12:00:00+09:00. */
export function isoInZone(ms: number, tz: string): string {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'longOffset' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const off = get('timeZoneName').replace('GMT', '') || '+00:00';
  const frac = d.getUTCMilliseconds() ? `.${String(d.getUTCMilliseconds()).padStart(3, '0')}` : '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${frac}${off === '+00:00' || off === '-00:00' ? 'Z' : off.length === 3 ? `${off}:00` : off}`;
}

/** "in 3 hours" / "2 days ago" style, in the given locale. */
export function relativeTime(ms: number, now = Date.now(), locale = 'en'): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536e6], ['month', 2592e6], ['week', 6048e5], ['day', 864e5], ['hour', 36e5], ['minute', 6e4], ['second', 1e3]];
  for (const [u, size] of units) if (abs >= size || u === 'second') return rtf.format(Math.round(diff / size), u);
  return rtf.format(0, 'second');
}

/** ISO 8601 duration ("P1DT2H") -> ms. Weeks and fractional seconds accepted. */
export function parseDuration(s: string): number {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(s.trim());
  if (!m || s.trim().length < 2) throw new Error('Not an ISO 8601 duration');
  const [, y, mo, w, d, h, mi, sec] = m.map((x) => (x ? Number(x) : 0)) as number[];
  return ((((y * 365 + mo * 30 + w * 7 + d) * 24 + h) * 60 + mi) * 60 + sec) * 1000;
}

export function formatDuration(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  let rest = Math.abs(ms);
  const d = Math.floor(rest / 864e5); rest -= d * 864e5;
  const h = Math.floor(rest / 36e5); rest -= h * 36e5;
  const m = Math.floor(rest / 6e4); rest -= m * 6e4;
  const s = rest / 1000;
  const parts = [d && `${d}d`, h && `${h}h`, m && `${m}m`, (s || (!d && !h && !m)) && `${Number(s.toFixed(3))}s`].filter(Boolean);
  return sign + parts.join(' ');
}

/** Zones worth listing without a search box: the local one first, then common ones. */
export const COMMON_ZONES = ['UTC', 'Asia/Seoul', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Kolkata', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'Australia/Sydney'];
