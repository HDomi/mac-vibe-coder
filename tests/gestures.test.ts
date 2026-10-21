import { test } from 'node:test';
import assert from 'node:assert/strict';

// gestures.ts touches window/document at call time only; a minimal fake is enough to drive the wheel handler.
type Listener = (e: Partial<WheelEvent> & { preventDefault?: () => void; target?: unknown }) => void;
function setup(opts: { electron?: boolean } = {}) {
  const listeners: Listener[] = [];
  const zooms: number[] = [];
  let nativeSwipe: ((dir: string) => void) | null = null;
  (globalThis as unknown as { window: unknown }).window = {
    vibe: { isElectron: opts.electron ?? true, zoomBy: (s: number) => zooms.push(s), onSwipe: (cb: (dir: string) => void) => { nativeSwipe = cb; } },
    addEventListener: (_t: string, l: Listener) => listeners.push(l),
    removeEventListener: () => {},
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
  (globalThis as unknown as { document: unknown }).document = { body: {} };
  (globalThis as unknown as { getComputedStyle: unknown }).getComputedStyle = () => ({ overflowX: 'visible' });
  return { listeners, zooms, swipe: (dir: string) => nativeSwipe?.(dir) };
}
const leaf = { scrollWidth: 0, clientWidth: 0, parentElement: null };

test('pinch (ctrl+wheel) scales the page zoom and swallows the event', async () => {
  const env = setup();
  const { installGestures } = await import('../web/src/lib/gestures');
  installGestures(() => assert.fail('no swipe expected'));
  let prevented = false;
  env.listeners[0]({ ctrlKey: true, deltaY: -50, deltaX: 0, preventDefault: () => { prevented = true; }, target: leaf });
  assert.ok(prevented);
  assert.equal(env.zooms.length, 1);
  assert.ok(Math.abs(env.zooms[0] - Math.exp(0.5)) < 1e-9);
});

test('a run of horizontal two-finger scrolling past the threshold is one swipe; fingers moving right = "right"', async () => {
  const env = setup();
  const { installGestures } = await import('../web/src/lib/gestures');
  const swipes: string[] = [];
  installGestures((d) => swipes.push(d));
  for (let i = 0; i < 10; i++) env.listeners[0]({ ctrlKey: false, deltaX: -40, deltaY: 2, target: leaf });
  assert.deepEqual(swipes, ['right']); // fired once at 160px, then held until the gesture ends
  for (let i = 0; i < 10; i++) env.listeners[0]({ ctrlKey: false, deltaX: 3, deltaY: 60, target: leaf });
  assert.deepEqual(swipes, ['right']); // vertical scrolling never counts
});

test('horizontal deltas over a horizontally scrollable element belong to it', async () => {
  const env = setup();
  const { installGestures } = await import('../web/src/lib/gestures');
  const swipes: string[] = [];
  installGestures((d) => swipes.push(d));
  (globalThis as unknown as { getComputedStyle: unknown }).getComputedStyle = () => ({ overflowX: 'auto' });
  const scroller = { scrollWidth: 900, clientWidth: 300, parentElement: null };
  const inner = { scrollWidth: 0, clientWidth: 0, parentElement: scroller };
  for (let i = 0; i < 10; i++) env.listeners[0]({ ctrlKey: false, deltaX: 40, deltaY: 0, target: inner });
  assert.deepEqual(swipes, []);
});

test('three-finger swipes from the main process reach the same handler', async () => {
  const env = setup();
  const { installGestures } = await import('../web/src/lib/gestures');
  const swipes: string[] = [];
  installGestures((d) => swipes.push(d));
  env.swipe('left'); env.swipe('up');
  assert.deepEqual(swipes, ['left']);
});

test('outside Electron nothing is installed', async () => {
  const env = setup({ electron: false });
  const { installGestures } = await import('../web/src/lib/gestures');
  installGestures(() => {});
  assert.equal(env.listeners.length, 0);
});
