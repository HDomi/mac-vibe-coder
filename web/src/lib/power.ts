import type { ChatSession } from './chatStore';

const KEY = 'vibe.keepAwake';
/** User switch (default on): hold a no-idle-sleep assertion while something is actually running. */
export function keepAwakeEnabled() { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } }
export function setKeepAwakeEnabled(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ }
  window.dispatchEvent(new Event('vibe:keep-awake'));
}
/** Work that a sleeping Mac would freeze mid-way: an agent turn, or a shell that printed output recently. */
export function workInProgress(sessions: Iterable<Pick<ChatSession, 'status'>>, shellsBusy: boolean) {
  for (const s of sessions) if (s.status === 'running' || s.status === 'compacting') return true;
  return shellsBusy;
}
