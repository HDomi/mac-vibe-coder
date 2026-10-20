export type Floor = { id: string; left: number; right: number; y: number; zone: string };
export type Point = { x: number; y: number };
export type Pose = 'idle' | 'wave' | 'walk' | 'run' | 'jump' | 'eject' | 'drag' | 'fight';
export const SCALE = .7;
export const HALF_WIDTH = 24 * SCALE;
export const FOOT = 54 * SCALE;
export const restDuration = (random = Math.random) => 8000 + random() * 12000;

/** Side panels only connect through the prompt; never cross directly between them. */
export function destinations(floor: Floor, floors: Floor[]) {
  return floors.filter((f) => f.id !== floor.id && (f.zone === floor.zone || f.zone === 'prompt' || floor.zone === 'prompt'));
}
export function chooseAction(canTravel: boolean, random = Math.random): 'idle' | 'walk' | 'run' | 'jump' {
  const n = random();
  return n < .55 ? 'idle' : n < .90 ? 'walk' : n < .95 || !canTravel ? 'run' : 'jump';
}
export function dropFloor(point: Point, floors: Floor[]) {
  const below = floors.filter((f) => point.x >= f.left && point.x <= f.right && f.y >= point.y - 8);
  return below.sort((a, b) => a.y - b.y)[0] ?? [...floors].sort((a, b) =>
    Math.hypot(Math.max(a.left - point.x, 0, point.x - a.right), a.y - point.y) -
    Math.hypot(Math.max(b.left - point.x, 0, point.x - b.right), b.y - point.y))[0];
}
const path = (...points: Point[]) => points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
/** Two-bone legs keep the supporting foot on the floor instead of rotating a rigid limb. */
function leg(hip: Point, foot: Point, length: number) {
  const dx = foot.x - hip.x, dy = foot.y - hip.y, d = Math.max(.01, Math.hypot(dx, dy));
  const bend = Math.sqrt(Math.max(0, length ** 2 - (d / 2) ** 2));
  return path(hip, { x: (hip.x + foot.x) / 2 + dy / d * bend, y: (hip.y + foot.y) / 2 - dx / d * bend }, foot);
}
export function skeleton(pose: Pose, phase: number, time: number, fightRole = 0) {
  const moving = pose === 'walk' || pose === 'run';
  const stride = pose === 'run' ? 8 : 5;
  const bob = moving ? Math.abs(Math.sin(phase)) * (pose === 'run' ? 1.8 : .7) : Math.sin(time / 1800) * .25;
  const hip = { x: 23, y: 38 - bob };
  const shoulder = { x: moving ? (pose === 'run' ? 27 : 25) : 24, y: 27 - bob };
  let feet = [0, Math.PI].map((offset) => ({ x: 23 + (moving ? -Math.cos(phase + offset) * stride : offset ? 4 : -4), y: moving ? 54 - Math.max(0, Math.sin(phase + offset)) * (pose === 'run' ? 5 : 2.5) : 54 }));
  let arms = [0, Math.PI].map((offset) => {
    const swing = moving ? Math.cos(phase + offset) * (pose === 'run' ? 7 : 4) : offset ? 3 : -3;
    return path(shoulder, { x: shoulder.x + swing, y: 34 - bob }, { x: shoulder.x + swing + 2, y: 39 - bob - (pose === 'run' ? 5 : 0) });
  });
  if (pose === 'wave') arms[1] = path(shoulder, { x: 32, y: 23 }, { x: 34 + Math.sin(time / 130) * 2, y: 15 });
  if (pose === 'jump' || pose === 'eject' || pose === 'drag') {
    feet = [{ x: 16, y: pose === 'drag' ? 52 : 47 }, { x: 30, y: 50 }];
    arms = [path(shoulder, { x: 16, y: 30 }, { x: 13, y: 23 }), path(shoulder, { x: 30, y: 30 }, { x: 34, y: 22 })];
  }
  if (pose === 'fight') {
    const beat = time % 1200;
    const attack = fightRole === 0 ? beat < 600 : beat >= 600;
    const punch = attack ? Math.max(0, Math.sin((beat % 600) / 600 * Math.PI)) : 0;
    arms = [path(shoulder, { x: 29, y: 30 }, { x: 31, y: 24 }), path(shoulder, { x: 31 + punch * 3, y: 26 }, { x: 31 + punch * 12, y: 23 })];
    feet = [{ x: 17, y: 54 }, { x: 30, y: 54 }];
  }
  return { body: path({ x: shoulder.x, y: shoulder.y - 3 }, hip), legs: feet.map((foot) => leg(hip, foot, pose === 'idle' || pose === 'wave' ? 8.5 : 9.5)), arms, headX: shoulder.x - 11, headY: 2 - bob };
}
