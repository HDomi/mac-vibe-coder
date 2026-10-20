import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAction, destinations, dropFloor, restDuration, skeleton, type Floor } from '../web/src/lib/companionMotion';
const floors: Floor[] = [
  { id: 'left', left: 20, right: 180, y: 200, zone: 'left' },
  { id: 'prompt', left: 220, right: 600, y: 600, zone: 'prompt' },
  { id: 'right', left: 700, right: 900, y: 300, zone: 'right' },
];
test('autonomous routes never connect opposite side panels directly', () => {
  assert.deepEqual(destinations(floors[0], floors).map(f => f.id), ['prompt']);
  assert.deepEqual(destinations(floors[2], floors).map(f => f.id), ['prompt']);
  assert.equal(destinations(floors[1], floors).length, 2);
});
test('rest dominates decisions and panel travel is rare and cooldown-gated', () => {
  const counts = { idle: 0, walk: 0, run: 0, jump: 0 };
  for (let i = 0; i < 1000; i++) counts[chooseAction(true, () => i / 1000)]++;
  assert.deepEqual(counts, { idle: 550, walk: 350, run: 50, jump: 50 });
  assert.equal(chooseAction(false, () => .999), 'run');
  assert.equal(restDuration(() => 0), 8000);
  assert.equal(restDuration(() => 1), 20000);
});
test('drop finds a platform below the pointer and falls back safely outside platforms', () => {
  assert.equal(dropFloor({ x: 400, y: 400 }, floors)?.id, 'prompt');
  assert.equal(dropFloor({ x: 70, y: 100 }, floors)?.id, 'left');
  assert.equal(dropFloor({ x: 1000, y: 280 }, floors)?.id, 'right');
  assert.equal(dropFloor({ x: 0, y: 0 }, []), undefined);
});
test('gait bends knees, plants the supporting foot and alternates punching arms', () => {
  for (const pose of ['idle', 'walk', 'run', 'jump', 'fight', 'drag'] as const) {
    for (const phase of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
      const s = skeleton(pose, phase, 300);
      for (const d of [...s.legs, ...s.arms]) assert.equal((d.match(/L/g) ?? []).length, 2);
      assert.ok(!JSON.stringify(s).includes('NaN'));
      if (pose === 'walk' || pose === 'run') assert.ok(s.legs.some(d => d.endsWith('54.00')));
    }
  }
  assert.notEqual(skeleton('fight', 0, 300, 0).arms[1], skeleton('fight', 0, 300, 1).arms[1]);
});
