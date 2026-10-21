/*
 * Trackpad gestures, Electron only.
 *
 * Pinch: Chromium delivers a macOS pinch as a wheel event with ctrlKey set; the page zoom follows it
 * (same scale Cmd+/Cmd- use, so Cmd+0 resets it).
 *
 * Swipe between pages: with the macOS default ("scroll left or right with two fingers") the gesture
 * arrives as horizontal wheel deltas, so a run of mostly-horizontal scrolling that nothing under the
 * pointer can consume counts as a swipe. The three-finger setting is reported by AppKit instead and
 * reaches us from the main process (window 'swipe' event). Both call the same handler.
 */
export type SwipeDirection = 'left' | 'right';

const SWIPE_DISTANCE = 160;
const SWIPE_IDLE_MS = 250;

/** True when `el` or an ancestor scrolls horizontally, so the wheel delta belongs to it. */
function scrollsHorizontally(el: Element | null): boolean {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === 'auto' || overflow === 'scroll') return true;
    }
  }
  return false;
}

export function installGestures(onSwipe: (dir: SwipeDirection) => void): () => void {
  if (!window.vibe?.isElectron) return () => {};
  let distance = 0;
  let fired = false;
  let idle = 0;
  const reset = () => { distance = 0; fired = false; };
  const wheel = (e: WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      window.vibe?.zoomBy?.(Math.exp(-e.deltaY * 0.01));
      return;
    }
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.5) return; // vertical scrolling, leave it alone
    window.clearTimeout(idle);
    idle = window.setTimeout(reset, SWIPE_IDLE_MS);
    if (fired || scrollsHorizontally(e.target as Element | null)) return;
    distance += e.deltaX;
    if (Math.abs(distance) < SWIPE_DISTANCE) return;
    fired = true;
    // Fingers moving right scroll content left (negative deltaX): the "back" gesture.
    onSwipe(distance < 0 ? 'right' : 'left');
  };
  window.addEventListener('wheel', wheel, { capture: true, passive: false });
  window.vibe?.onSwipe?.((dir) => { if (dir === 'left' || dir === 'right') onSwipe(dir); });
  return () => { window.removeEventListener('wheel', wheel, { capture: true }); window.clearTimeout(idle); };
}
