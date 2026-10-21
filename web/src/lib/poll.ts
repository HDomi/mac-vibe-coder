/**
 * Calls `fn` every `ms` while the app window is in front. Ticks that fall while it is hidden or in the
 * background are skipped, and the first refocus after a skipped tick catches up at once, so what the
 * user sees on return is as fresh as with a plain interval. Returns the cleanup function.
 */
export function pollWhileActive(fn: () => void, ms: number): () => void {
  let missed = false;
  const active = () => !document.hidden && document.hasFocus();
  const timer = window.setInterval(() => { if (active()) fn(); else missed = true; }, ms);
  const wake = () => { if (missed && active()) { missed = false; fn(); } };
  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', wake);
  return () => { window.clearInterval(timer); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); };
}
