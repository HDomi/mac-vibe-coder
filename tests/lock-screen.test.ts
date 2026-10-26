import test from 'node:test';
import assert from 'node:assert/strict';
import { BEAT, envelope, headX, heartLayout, localBaseline, lockSummary, signal, SPEED, TAIL } from '../web/src/lib/lockScreen';
import type { ChatSession } from '../web/src/lib/chatStore';

// The arrangement measured on the development Mac: built-in panel left, main LG in the middle,
// a portrait monitor on the right that sits 452px higher.
const displays = [
  { bounds: { x: -1728, y: 0, width: 1728, height: 1117 }, main: false },
  { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, main: true },
  { bounds: { x: 1920, y: -452, width: 1080, height: 1920 }, main: false },
];

const s = (agent: 'claude' | 'codex', status: ChatSession['status'], items: ChatSession['items'] = []) => ({ agent, status, items });

test('session summary counts per agent without titles and skips closed sessions', () => {
  const list = lockSummary([
    s('claude', 'running'), s('claude', 'idle'), s('claude', 'closed'), s('codex', 'compacting'),
    s('claude', 'running', [{ kind: 'user', id: 'u', text: 'go' }, { kind: 'approval', id: 'a', requestId: 'r', toolName: 'Bash', input: {} }] as ChatSession['items']),
  ]);
  assert.deepEqual(list, [
    { agent: 'claude', total: 3, running: 2, waiting: 1 },
    { agent: 'codex', total: 1, running: 1, waiting: 0 },
  ]);
  assert.deepEqual(lockSummary([]), []);
});

test('the tallest beat sits at the centre of the main display', () => {
  const l = heartLayout(displays);
  assert.equal(l.mainCx, 960);
  assert.equal(l.minX, -1728);
  assert.equal(l.maxX, 3000);
  let best = -Infinity; let at = 0;
  for (let x = l.minX; x <= l.maxX; x += 0.5) { const y = signal(x, l); if (y > best) { best = y; at = x; } }
  assert.ok(Math.abs(at - 960) < 2, `peak at ${at}`);
  assert.ok(Math.abs(best - l.amp) < 1);
});

test('beats shrink with distance from the main display but never vanish', () => {
  const l = heartLayout(displays);
  const peaks = [-2, -1, 0, 1, 2].map((k) => signal(l.mainCx + k * BEAT, l));
  assert.ok(peaks[0] < peaks[1] && peaks[1] < peaks[2]);
  assert.ok(peaks[4] < peaks[3] && peaks[3] < peaks[2]);
  assert.ok(envelope(l.minX, l) > 0.1 * l.amp);
});

test('main display at the left end: the big beat comes first and smaller ones carry on to the right', () => {
  const l = heartLayout([
    { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, main: true },
    { bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, main: false },
  ]);
  assert.ok(signal(l.mainCx, l) > signal(l.mainCx + 2 * BEAT, l));
  assert.ok(signal(l.mainCx + 2 * BEAT, l) > 0);
});

test('the baseline lines up across displays and stays off their edges', () => {
  const l = heartLayout(displays);
  // Same global height on every display that reaches it.
  for (const d of displays) assert.equal(localBaseline(l, d.bounds) + d.bounds.y, l.baseY);
  // A display that sits far lower keeps the line inside its upper part instead of off-screen.
  const low = { x: 0, y: 2000, width: 1000, height: 800 };
  assert.equal(localBaseline(l, low), 800 * 0.15);
});

test('every cover computes the same head position from the clock and the sweep wraps', () => {
  const l = heartLayout(displays);
  const span = l.maxX - l.minX + TAIL;
  assert.equal(headX(0, l), l.minX);
  assert.equal(headX(1000, l), l.minX + SPEED);
  assert.ok(Math.abs(headX((span / SPEED) * 1000, l) - l.minX) < 1e-6);
});

test('seven-segment digits light the right segments and lay out HH:MM:SS', async () => {
  const { DIGIT_SEGMENTS, SEG, segmentLayout, segmentPolygons } = await import('../web/src/lib/lockScreen');
  assert.equal(Object.keys(DIGIT_SEGMENTS).length, 10);
  assert.equal(DIGIT_SEGMENTS['8'], 'abcdefg');
  assert.ok(!DIGIT_SEGMENTS['0'].includes('g'));
  assert.equal(DIGIT_SEGMENTS['1'], 'bc');
  const { offsets, width } = segmentLayout('16:07:30');
  assert.equal(offsets.length, 8);
  assert.equal(width, 6 * SEG.w + 2 * SEG.colonW + 7 * SEG.space);
  // every segment of a cell stays inside it
  const xs = Object.values(segmentPolygons(offsets[7])).flatMap((p) => p.split(' ').map((q) => Number(q.split(',')[0])));
  assert.ok(Math.min(...xs) >= offsets[7] && Math.max(...xs) <= offsets[7] + SEG.w);
});
