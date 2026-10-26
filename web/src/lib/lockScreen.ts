import { pendingRequests, type ChatSession } from './chatStore';
import type { LockSessionSummary } from './vibe';

/** Per-agent counts shown on the lock screen (no titles, no paths). Closed sessions are left out. */
export function lockSummary(sessions: Iterable<Pick<ChatSession, 'agent' | 'status' | 'items'>>): LockSessionSummary[] {
  const by = new Map<string, LockSessionSummary>();
  for (const s of sessions) {
    if (s.status === 'closed') continue;
    const row = by.get(s.agent) ?? { agent: s.agent, total: 0, running: 0, waiting: 0 };
    row.total++;
    if (s.status === 'running' || s.status === 'compacting') row.running++;
    if (pendingRequests(s as ChatSession) > 0) row.waiting++;
    by.set(s.agent, row);
  }
  return [...by.values()].sort((a, b) => a.agent.localeCompare(b.agent));
}

/*
 * Heartbeat trace across all displays. Coordinates are global (the macOS display arrangement), so the
 * line runs from the leftmost display to the rightmost one and lines up at the physical seams.
 * One PQRST complex every BEAT px; the complex at the main display's centre is the tallest and the
 * others shrink with distance from it. A sweep head moves left to right and leaves a fading trail,
 * like a patient monitor. With the main display at either end the big beat comes first or last and
 * the smaller ones carry on through the other displays.
 */
export interface Rect { x: number; y: number; width: number; height: number }
export interface HeartLayout { minX: number; maxX: number; mainCx: number; spread: number; baseY: number; amp: number }

export const BEAT = 560;
export const SPEED = 900;
export const TAIL = 1500;
/** Baseline height on the main display, as a fraction from the top (below the clock and session cards). */
export const BASE_FRAC = 0.76;

export function heartLayout(displays: { bounds: Rect; main: boolean }[]): HeartLayout {
  const main = (displays.find((d) => d.main) ?? displays[0]).bounds;
  const minX = Math.min(...displays.map((d) => d.bounds.x));
  const maxX = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
  return { minX, maxX, mainCx: main.x + main.width / 2, spread: main.width * 0.55, baseY: main.y + main.height * BASE_FRAC, amp: Math.min(140, main.height * 0.12) };
}

/** The shared baseline in a display's own coordinates, kept off its edges when the display sits higher or lower. */
export function localBaseline(l: HeartLayout, d: Rect): number {
  return Math.min(d.height * 0.85, Math.max(d.height * 0.15, l.baseY - d.y));
}

/** One complex as a sum of Gaussians; p is in beat units with the R peak at 0. Positive is up. */
export function ecg(p: number): number {
  const g = (c: number, w: number, a: number) => a * Math.exp(-(((p - c) / w) ** 2));
  return g(-0.17, 0.03, 0.1) + g(-0.032, 0.009, -0.12) + g(0, 0.011, 1) + g(0.03, 0.011, -0.3) + g(0.19, 0.045, 0.22);
}

export function envelope(x: number, l: HeartLayout): number {
  return l.amp * (0.14 + 0.86 * Math.exp(-(((x - l.mainCx) / l.spread) ** 2)));
}

/** Height of the trace above the baseline at global x, in px. */
export function signal(x: number, l: HeartLayout): number {
  let p = (x - l.mainCx) / BEAT;
  p -= Math.round(p);
  return envelope(x, l) * ecg(p);
}

/** Global x of the sweep head at time `now` (ms). Every cover computes the same value from the clock, so they stay in step. */
export function headX(now: number, l: HeartLayout): number {
  const span = l.maxX - l.minX + TAIL;
  return l.minX + ((now / 1000) * SPEED) % span;
}

/*
 * Seven-segment clock face (LCD style). Segments a–g in the usual order: a top, b upper right, c lower right,
 * d bottom, e lower left, f upper left, g middle. Unlit segments are drawn faintly, like a real display.
 */
export const DIGIT_SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg',
  '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
};
export const SEG = { w: 56, h: 100, t: 10, gap: 1.6, colonW: 20, space: 12 };

/** Polygon points for each segment of one digit cell at x offset `ox`. Segment ends are pointed so neighbours meet in a mitre. */
export function segmentPolygons(ox: number): Record<string, string> {
  const { w, h, t, gap } = SEG;
  const half = t / 2;
  const L = ox + half; const R = ox + w - half;
  const T = half; const M = h / 2; const B = h - half;
  const hor = (y: number) => [[L + gap, y], [L + gap + half, y - half], [R - gap - half, y - half], [R - gap, y], [R - gap - half, y + half], [L + gap + half, y + half]];
  const ver = (x: number, y1: number, y2: number) => [[x, y1 + gap], [x + half, y1 + gap + half], [x + half, y2 - gap - half], [x, y2 - gap], [x - half, y2 - gap - half], [x - half, y1 + gap + half]];
  const pts = (p: number[][]) => p.map(([x, y]) => `${+x.toFixed(2)},${+y.toFixed(2)}`).join(' ');
  return { a: pts(hor(T)), b: pts(ver(R, T, M)), c: pts(ver(R, M, B)), d: pts(hor(B)), e: pts(ver(L, M, B)), f: pts(ver(L, T, M)), g: pts(hor(M)) };
}

/** x offset of every character of e.g. "16:07:30" and the total width, in segment units. */
export function segmentLayout(text: string): { offsets: number[]; width: number } {
  const offsets: number[] = [];
  let x = 0;
  for (const ch of text) { offsets.push(x); x += (ch === ':' ? SEG.colonW : SEG.w) + SEG.space; }
  return { offsets, width: Math.max(0, x - SEG.space) };
}
