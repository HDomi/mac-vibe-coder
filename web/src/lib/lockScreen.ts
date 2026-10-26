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
