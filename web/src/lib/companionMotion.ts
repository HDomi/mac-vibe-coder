export type Floor = { id: string; left: number; right: number; y: number; zone: string; ground?: boolean; rung?: boolean };
export type Point = { x: number; y: number };
export type Pose = 'idle' | 'wave' | 'walk' | 'run' | 'flee' | 'jump' | 'fall' | 'land' | 'knock' | 'climb' | 'hurt' | 'drag' | 'fight' | 'sit' | 'stretch' | 'look' | 'scratch';
export type Action = 'idle' | 'walk' | 'run' | 'hop' | 'gesture';
export type Side = 'left' | 'right';
export const SCALE = .77;
export const HALF_WIDTH = 24 * SCALE;
export const FOOT = 54 * SCALE;
/** Panels in screen order; walls only connect immediate neighbours. */
export const ZONES = ['left', 'prompt', 'right'];
export const SPEED: Record<'walk' | 'run' | 'flee', number> = { walk: 30, run: 72, flee: 115 };
export const GESTURES: Pose[] = ['sit', 'stretch', 'look', 'scratch'];
export const GESTURE_DURATION: Partial<Record<Pose, number>> = { sit: 2600, stretch: 1500, look: 1400, scratch: 1300, knock: 1300, land: 240, hurt: 550 };
const stride = (pose: Pose) => (pose === 'walk' ? 5 : 8);
/** Screen pixels covered by one full gait cycle, so a planted foot stays put instead of skating. */
export const cycleLength = (pose: Pose) => stride(pose) * SCALE * Math.PI * 2;
export const restDuration = (random = Math.random) => 1200 + random() * 3000;
export const fallDuration = (height: number) => Math.max(160, Math.min(900, Math.sqrt(2 * Math.max(0, height) / 1800) * 1000));

export function chooseAction(random = Math.random, onLadder = false): Action {
  const n = random();
  if (onLadder) return n < .15 ? 'idle' : n < .35 ? 'walk' : n < .85 ? 'hop' : 'gesture';
  return n < .25 ? 'idle' : n < .72 ? 'walk' : n < .82 ? 'run' : n < .93 ? 'hop' : 'gesture';
}
export function neighborZone(zone: string, side: Side) {
  const i = ZONES.indexOf(zone);
  return i < 0 ? null : ZONES[i + (side === 'right' ? 1 : -1)] ?? null;
}
export const groundOf = (zone: string, floors: Floor[]) => floors.find((f) => f.ground && f.zone === zone);
export const atWall = (floor: Floor, x: number): Side | null => (x <= floor.left + .5 ? 'left' : x >= floor.right - .5 ? 'right' : null);
/** Ladder rungs and ledges within one jump, in the same panel and roughly above or below the feet. */
export function hops(floor: Floor, x: number, floors: Floor[]) {
  return floors.filter((f) => f.id !== floor.id && f.zone === floor.zone && Math.abs(f.y - floor.y) > 10 && Math.abs(f.y - floor.y) <= 84 && x >= f.left - 24 && x <= f.right + 24);
}
export function dropFloor(point: Point, floors: Floor[], zone?: string) {
  const pool = zone ? floors.filter((f) => f.zone === zone) : floors;
  const below = pool.filter((f) => point.x >= f.left - 4 && point.x <= f.right + 4 && f.y >= point.y - 8).sort((a, b) => a.y - b.y)[0];
  if (below || zone) return below ?? groundOf(zone!, floors);
  return [...floors].sort((a, b) =>
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
/** The figure faces +x; the renderer mirrors it for the other direction. */
export function skeleton(pose: Pose, phase: number, time: number, fightRole = 0) {
  const moving = pose === 'walk' || pose === 'run' || pose === 'flee';
  const fast = moving && pose !== 'walk';
  const ramp = Math.min(1, time / 400);
  let bob = moving ? Math.abs(Math.sin(phase)) * (fast ? 1.8 : .8) : Math.sin(time / 1800) * .25;
  if (pose === 'sit') bob = -10 * ramp;
  if (pose === 'land') bob = -4 * Math.sin(Math.min(1, time / 240) * Math.PI);
  if (pose === 'stretch') bob = 1.5 * ramp;
  const lean = moving ? (pose === 'flee' ? 5 : fast ? 4 : 1.5) : pose === 'knock' ? 2 : pose === 'hurt' ? -3 : pose === 'land' ? 2 : 0;
  const hip = { x: 23 + (pose === 'hurt' ? Math.sin(time / 40) : 0), y: 38 - bob };
  const shoulder = { x: hip.x + lean, y: 27 - bob };
  const lift = fast ? 5 : 2.5;
  let feet = [0, Math.PI].map((offset) => ({
    x: 23 + (moving ? -Math.cos(phase + offset) * stride(pose) : offset ? 4 : -4),
    y: moving ? 54 - Math.max(0, Math.sin(phase + offset)) * lift : 54,
  }));
  let arms = [0, Math.PI].map((offset) => {
    const swing = moving ? Math.cos(phase + offset) * (fast ? 7 : 4) : offset ? 3 : -3;
    return path(shoulder, { x: shoulder.x + swing, y: 34 - bob }, { x: shoulder.x + swing + 2, y: 39 - bob - (fast ? 5 : 0) });
  });
  if (pose === 'flee') arms = [-3, 3].map((side) => path(shoulder, { x: shoulder.x + side * 2, y: 18 }, { x: shoulder.x + side * 3 + Math.sin(time / 70) * 2, y: 10 }));
  if (pose === 'wave') arms[1] = path(shoulder, { x: 32, y: 23 }, { x: 34 + Math.sin(time / 130) * 2, y: 15 });
  if (pose === 'jump' || pose === 'climb' || pose === 'drag') {
    feet = [{ x: 16, y: pose === 'drag' ? 52 : 47 }, { x: 30, y: 50 }];
    arms = pose === 'climb'
      ? [path(shoulder, { x: 27, y: 19 }, { x: 31, y: 13 }), path(shoulder, { x: 31, y: 21 }, { x: 36, y: 16 })]
      : [path(shoulder, { x: 16, y: 30 }, { x: 13, y: 23 }), path(shoulder, { x: 30, y: 30 }, { x: 34, y: 22 })];
  }
  if (pose === 'fall') {
    const flail = Math.sin(time / 90) * 2;
    feet = [{ x: 15 + flail, y: 50 }, { x: 31 - flail, y: 52 }];
    arms = [path(shoulder, { x: 15, y: 20 }, { x: 11, y: 14 + flail }), path(shoulder, { x: 32, y: 20 }, { x: 36, y: 13 - flail })];
  }
  if (pose === 'land') {
    feet = [{ x: 15, y: 54 }, { x: 31, y: 54 }];
    arms = [path(shoulder, { x: 20, y: 35 - bob }, { x: 22, y: 41 - bob }), path(shoulder, { x: 30, y: 35 - bob }, { x: 33, y: 41 - bob })];
  }
  if (pose === 'knock') {
    // Two quick raps then a pause, with the knuckles landing on the wall ahead of the figure.
    const beat = time % 1400, tap = beat < 800 ? Math.max(0, Math.sin(beat / 400 * Math.PI)) : 0;
    arms = [path(shoulder, { x: 22, y: 34 }, { x: 23, y: 40 }), path(shoulder, { x: 31 + tap * 2, y: 25 }, { x: 33 + tap * 5, y: 24 })];
  }
  if (pose === 'hurt') {
    feet = [{ x: 18, y: 54 }, { x: 30, y: 48 }];
    arms = [path(shoulder, { x: 14, y: 22 }, { x: 10, y: 17 }), path(shoulder, { x: 32, y: 22 }, { x: 36, y: 16 })];
  }
  if (pose === 'sit') {
    feet = [{ x: 30, y: 54 }, { x: 33, y: 54 }];
    arms = [path(shoulder, { x: 28, y: 35 - bob }, { x: 29, y: 44 - bob }), path(shoulder, { x: 30, y: 35 - bob }, { x: 32, y: 44 - bob })];
  }
  if (pose === 'stretch') {
    feet = [{ x: 19, y: 54 - bob }, { x: 27, y: 54 - bob }];
    arms = [path(shoulder, { x: 20, y: 18 - bob }, { x: 19, y: 9 - bob }), path(shoulder, { x: 28, y: 18 - bob }, { x: 29, y: 9 - bob })];
  }
  if (pose === 'look') arms[1] = path(shoulder, { x: 31, y: 23 }, { x: 31, y: 14 });
  if (pose === 'scratch') arms[1] = path(shoulder, { x: 31, y: 21 }, { x: 29 + Math.sin(time / 120) * 1.5, y: 12 });
  if (pose === 'fight') {
    const beat = time % 1200;
    const attack = fightRole === 0 ? beat < 600 : beat >= 600;
    const punch = attack ? Math.max(0, Math.sin((beat % 600) / 600 * Math.PI)) : 0;
    arms = [path(shoulder, { x: 29, y: 30 }, { x: 31, y: 24 }), path(shoulder, { x: 31 + punch * 3, y: 26 }, { x: 31 + punch * 12, y: 23 })];
    feet = [{ x: 17, y: 54 }, { x: 30, y: 54 }];
  }
  const legLength = pose === 'idle' || pose === 'wave' || pose === 'look' || pose === 'scratch' ? 8.5 : 9.5;
  const headX = shoulder.x - 11 + (pose === 'hurt' ? -3 : pose === 'look' ? 2 : 0);
  const headY = shoulder.y - 25 + (pose === 'hurt' ? -2 : 0);
  return { body: path({ x: shoulder.x, y: shoulder.y - 3 }, hip), legs: feet.map((foot) => leg(hip, foot, legLength)), arms, headX, headY };
}
