import test from 'node:test';
import assert from 'node:assert/strict';
import { atWall, chooseAction, cycleLength, dropFloor, fallDuration, groundOf, hops, neighborZone, restDuration, SCALE, skeleton, type Floor, type Pose } from '../web/src/lib/companionMotion';
const floors: Floor[] = [
  { id: 'ground:left', left: 20, right: 180, y: 700, zone: 'left', ground: true },
  { id: 'left', left: 20, right: 180, y: 200, zone: 'left' },
  { id: 'prompt', left: 200, right: 680, y: 600, zone: 'prompt', ground: true },
  { id: 'files-footer', left: 700, right: 900, y: 690, zone: 'right', ground: true },
  { id: 'rung:0', left: 700, right: 900, y: 660, zone: 'right', rung: true },
  { id: 'rung:1', left: 700, right: 900, y: 630, zone: 'right', rung: true },
  { id: 'rung:2', left: 700, right: 900, y: 600, zone: 'right', rung: true },
  { id: 'toolbar', left: 700, right: 900, y: 300, zone: 'right' },
];
test('walls connect only neighbouring panels and need a ground on the far side', () => {
  assert.equal(neighborZone('left', 'right'), 'prompt');
  assert.equal(neighborZone('prompt', 'left'), 'left');
  assert.equal(neighborZone('prompt', 'right'), 'right');
  assert.equal(neighborZone('left', 'left'), null);
  assert.equal(neighborZone('right', 'right'), null);
  assert.equal(groundOf('right', floors)?.id, 'files-footer');
  assert.equal(groundOf('nowhere', floors), undefined);
  assert.equal(atWall(floors[2], 200), 'left');
  assert.equal(atWall(floors[2], 680), 'right');
  assert.equal(atWall(floors[2], 400), null);
});
test('ladder hops reach rungs within a jump in the same panel only', () => {
  assert.deepEqual(hops(floors[3], 800, floors).map((f) => f.id), ['rung:0', 'rung:1']);
  assert.deepEqual(hops(floors[5], 800, floors).map((f) => f.id), ['files-footer', 'rung:0', 'rung:2']);
  assert.deepEqual(hops(floors[6], 800, floors).map((f) => f.id), ['rung:0', 'rung:1']);
  assert.deepEqual(hops(floors[2], 400, floors), []);
});
test('decisions keep the figure lively and favour climbing on a ladder', () => {
  const counts = { idle: 0, walk: 0, run: 0, hop: 0, gesture: 0 };
  for (let i = 0; i < 1000; i++) counts[chooseAction(() => i / 1000)]++;
  assert.deepEqual(counts, { idle: 250, walk: 470, run: 100, hop: 110, gesture: 70 });
  const ladder = { idle: 0, walk: 0, run: 0, hop: 0, gesture: 0 };
  for (let i = 0; i < 1000; i++) ladder[chooseAction(() => i / 1000, true)]++;
  assert.deepEqual(ladder, { idle: 150, walk: 200, run: 0, hop: 500, gesture: 150 });
  assert.equal(restDuration(() => 0), 1200);
  assert.equal(restDuration(() => 1), 4200);
  assert.equal(fallDuration(0), 160);
  assert.ok(fallDuration(400) > fallDuration(100));
  assert.equal(fallDuration(1e6), 900);
});
test('drop finds a platform below the pointer, within a panel when asked, and falls back safely', () => {
  assert.equal(dropFloor({ x: 400, y: 400 }, floors)?.id, 'prompt');
  assert.equal(dropFloor({ x: 70, y: 100 }, floors)?.id, 'left');
  assert.equal(dropFloor({ x: 70, y: 300 }, floors)?.id, 'ground:left');
  assert.equal(dropFloor({ x: 800, y: 640 }, floors)?.id, 'rung:0');
  assert.equal(dropFloor({ x: 1000, y: 280 }, floors)?.id, 'toolbar');
  assert.equal(dropFloor({ x: 400, y: 650 }, floors, 'prompt')?.id, 'prompt');
  assert.equal(dropFloor({ x: 400, y: 650 }, floors, 'right')?.id, 'files-footer');
  assert.equal(dropFloor({ x: 0, y: 0 }, []), undefined);
  assert.equal(dropFloor({ x: 0, y: 0 }, floors, 'nowhere'), undefined);
});
test('every pose draws two-bone limbs without NaN and plants a foot while moving', () => {
  const poses: Pose[] = ['idle', 'wave', 'walk', 'run', 'flee', 'jump', 'fall', 'land', 'knock', 'climb', 'hurt', 'drag', 'fight', 'sit', 'stretch', 'look', 'scratch'];
  for (const pose of poses) {
    for (const phase of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
      const s = skeleton(pose, phase, 300);
      for (const d of [...s.legs, ...s.arms]) assert.equal((d.match(/L/g) ?? []).length, 2, `${pose} limb ${d}`);
      assert.ok(!JSON.stringify(s).includes('NaN'), pose);
      if (pose === 'walk' || pose === 'run' || pose === 'flee') assert.ok(s.legs.some((d) => d.endsWith('54.00')), pose);
    }
  }
  assert.notEqual(skeleton('fight', 0, 300, 0).arms[1], skeleton('fight', 0, 300, 1).arms[1]);
  assert.notEqual(skeleton('knock', 0, 200).arms[1], skeleton('knock', 0, 1000).arms[1]);
  assert.notEqual(skeleton('sit', 0, 2000).body, skeleton('idle', 0, 2000).body);
});
test('the planted foot moves back exactly as fast as the body advances', () => {
  const footX = (pose: Pose, phase: number) => Number(skeleton(pose, phase, 300).legs[0].split('L').pop()!.split(' ')[0]);
  for (const pose of ['walk', 'run'] as const) {
    const phase = 3 * Math.PI / 2, step = .01;
    const footSpeed = -(footX(pose, phase + step) - footX(pose, phase)) / step * SCALE;
    assert.ok(Math.abs(footSpeed - cycleLength(pose) / (2 * Math.PI)) < .01, pose);
  }
});
