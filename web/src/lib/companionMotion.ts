export type Floor = { id: string; left: number; right: number; y: number; zone: string; ground?: boolean; rung?: boolean };
export type Point = { x: number; y: number };
export type Pose = 'idle' | 'wave' | 'walk' | 'run' | 'flee' | 'jump' | 'fall' | 'land' | 'knock' | 'climb' | 'hurt' | 'drag' | 'sit' | 'stretch' | 'look' | 'scratch'
  | 'fight' | 'punch' | 'kick' | 'block' | 'hit' | 'down' | 'aim' | 'shoot' | 'shot' | 'limp';
export type Action = 'idle' | 'walk' | 'run' | 'hop' | 'gesture' | 'leap';
export type Side = 'left' | 'right';
export type AttackKind = 'punch' | 'kick' | 'block';
export const SCALE = .77;
export const HALF_WIDTH = 24 * SCALE;
export const FOOT = 54 * SCALE;
/** Panels in screen order; walls only connect immediate neighbours. */
export const ZONES = ['left', 'prompt', 'right'];
export const SPEED: Record<'walk' | 'run' | 'flee', number> = { walk: 34, run: 80, flee: 118 };
export const GESTURES: Pose[] = ['sit', 'stretch', 'look', 'scratch'];
export const GESTURE_DURATION: Partial<Record<Pose, number>> = { sit: 2600, stretch: 1500, look: 1400, scratch: 1300, knock: 1300, land: 240, hurt: 550 };
/** Sparring moves: how long they take, when the blow lands (fraction), and how far it reaches in screen pixels. */
export const ATTACKS: Record<AttackKind, { duration: number; strikeAt: number; reach: number; knockback: number }> = {
  punch: { duration: 420, strikeAt: .5, reach: 13, knockback: 12 },
  kick: { duration: 560, strikeAt: .55, reach: 17, knockback: 18 },
  block: { duration: 500, strikeAt: 2, reach: 0, knockback: 0 },
};
export const HIT_DURATION = 380, DOWN_DURATION = 1100, FIGHT_RANGE = 20, FIGHT_BREAK = 70;
/** Rifle: draw, three rounds 300ms apart, lower; the muzzle sits ahead of the figure at chest height (figure units). */
export const RIFLE = { draw: 350, interval: 300, shots: 3, total: 1350, flash: 120, stun: 330, knockback: 6, minGap: 24, maxTilt: 40, collapse: 1500 };
export const MUZZLE = { x: 46, y: 25 }, STOCK = { x: 25, y: 28 };
const toWorld = (position: Point, direction: number, p: Point): Point => ({ x: position.x + direction * (p.x - 24) * SCALE, y: position.y - (54 - p.y) * SCALE });
/** Rifle tilt (degrees, figure space) that points the barrel at the target's chest, limited so the hands stay on it. */
export function aimAngle(position: Point, direction: number, target: Point) {
  const m = toWorld(position, direction, MUZZLE);
  const deg = Math.atan2(target.y - 20 - m.y, (target.x - m.x) * direction) * 180 / Math.PI;
  return Math.max(-RIFLE.maxTilt, Math.min(RIFLE.maxTilt, deg));
}
/** Muzzle in screen space after the barrel has been tilted about the stock. */
export function muzzle(position: Point, direction: number, angle = 0): Point {
  const rad = angle * Math.PI / 180, dx = MUZZLE.x - STOCK.x, dy = MUZZLE.y - STOCK.y;
  return toWorld(position, direction, { x: STOCK.x + dx * Math.cos(rad) - dy * Math.sin(rad), y: STOCK.y + dx * Math.sin(rad) + dy * Math.cos(rad) });
}
const stride = (pose: Pose) => (pose === 'walk' ? 5 : 8);
/** Screen pixels covered by one full gait cycle, so a planted foot stays put instead of skating. */
export const cycleLength = (pose: Pose) => stride(pose) * SCALE * Math.PI * 2;
export const restDuration = (random = Math.random) => 1200 + random() * 3000;
export const fallDuration = (height: number) => Math.max(160, Math.min(900, Math.sqrt(2 * Math.max(0, height) / 1800) * 1000));
export const fightDuration = (random = Math.random) => 4500 + random() * 2500;

export function chooseAction(random = Math.random, onLadder = false, canLeap = false): Action {
  const n = random();
  if (canLeap && n < .03) return 'leap';
  if (onLadder) return n < .15 ? 'idle' : n < .35 ? 'walk' : n < .85 ? 'hop' : 'gesture';
  return n < .25 ? 'idle' : n < .68 ? 'walk' : n < .82 ? 'run' : n < .93 ? 'hop' : 'gesture';
}
export function chooseAttack(random = Math.random): AttackKind {
  const n = random();
  return n < .5 ? 'punch' : n < .8 ? 'kick' : 'block';
}
/** A blow lands when the target stands in front of the attacker within reach (plus the target's own body width). */
export function landsHit(attacker: Point, direction: number, target: Point, kind: AttackKind) {
  const dx = (target.x - attacker.x) * direction;
  return dx > 0 && dx <= ATTACKS[kind].reach + 9 && Math.abs(target.y - attacker.y) < 6;
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
/** Grounds of other panels: targets for the rare long leap. */
export const leapTargets = (floor: Floor, floors: Floor[]) => floors.filter((f) => f.ground && f.zone !== floor.zone);
/** The nearest platform underneath the feet in the same panel, if there is one to tumble onto. */
export function floorBelow(point: Point, floorId: string, floors: Floor[], zone: string) {
  return floors.filter((f) => f.id !== floorId && f.zone === zone && f.y > point.y + 4 && point.x >= f.left - 4 && point.x <= f.right + 4).sort((a, b) => a.y - b.y)[0];
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
const LEG = 9.2;
/** Two-bone legs keep the supporting foot on the floor instead of rotating a rigid limb; a straight leg means hip and foot are a full leg apart. */
function leg(hip: Point, foot: Point, length = LEG) {
  const dx = foot.x - hip.x, dy = foot.y - hip.y, d = Math.max(.01, Math.hypot(dx, dy));
  const bend = Math.sqrt(Math.max(0, length ** 2 - (d / 2) ** 2));
  return path(hip, { x: (hip.x + foot.x) / 2 + dy / d * bend, y: (hip.y + foot.y) / 2 - dx / d * bend }, foot);
}
/**
 * The figure faces +x; the renderer mirrors it for the other direction.
 * Proportions: head 0–22, shoulders at 25, hips at 36, soles at 54, so an upright leg is nearly straight.
 */
export function skeleton(pose: Pose, phase: number, time: number) {
  const moving = pose === 'walk' || pose === 'run' || pose === 'flee';
  const fast = moving && pose !== 'walk';
  const ramp = Math.min(1, time / 400);
  const sway = Math.abs(Math.sin(phase));
  // Hips sit lowest in double support and rise as the stance leg straightens underneath.
  let hipY = moving ? (fast ? 37.5 - sway * 1.5 : 36.6 - sway * .6) : 36.3 - Math.sin(time / 1800) * .25;
  if (pose === 'sit') hipY = 36 + 10 * ramp;
  if (pose === 'land') hipY = 36 + 4 * Math.sin(Math.min(1, time / 240) * Math.PI);
  if (pose === 'stretch') hipY = 36 - 1.5 * ramp;
  if (pose === 'fight' || pose === 'punch' || pose === 'kick') hipY = 37 - Math.abs(Math.sin(time / 180)) * .6;
  if (pose === 'aim' || pose === 'shoot') hipY = 37;
  if (pose === 'block') hipY = 38;
  const strike = pose === 'punch' || pose === 'kick' ? Math.sin(Math.min(1, time / ATTACKS[pose].duration) * Math.PI) : 0;
  const lean = moving ? (pose === 'flee' ? 5 : fast ? 4 : 1.5) : pose === 'knock' ? 2 : pose === 'hurt' || pose === 'hit' ? -4 : pose === 'shot' ? -6 : pose === 'aim' ? 1.5 : pose === 'shoot' ? -.5 : pose === 'land' ? 2
    : pose === 'punch' ? 1 + strike * 3 : pose === 'kick' ? 1 - strike * 4 : pose === 'fight' || pose === 'block' ? 1 : 0;
  let hip = { x: 23 + (pose === 'hurt' ? Math.sin(time / 40) : 0), y: hipY };
  let shoulder = { x: hip.x + lean, y: hipY - 11 };
  const lift = fast ? 6 : 2.5;
  let feet = [0, Math.PI].map((offset) => ({
    x: 23 + (moving ? -Math.cos(phase + offset) * stride(pose) : offset ? 4 : -4),
    y: moving ? 54 - Math.max(0, Math.sin(phase + offset)) * lift : 54,
  }));
  let arms = [0, Math.PI].map((offset) => {
    const swing = moving ? Math.cos(phase + offset) * (fast ? 6 : 4) : offset ? 2.5 : -2.5;
    return fast
      ? path(shoulder, { x: shoulder.x + swing * .6 - 1, y: shoulder.y + 5.5 }, { x: shoulder.x + swing + 4, y: shoulder.y + 3 })
      : path(shoulder, { x: shoulder.x + swing * .8, y: shoulder.y + 6 }, { x: shoulder.x + swing * 1.3 + 1, y: shoulder.y + 11.5 });
  });
  if (pose === 'flee') arms = [-3, 3].map((side) => path(shoulder, { x: shoulder.x + side * 2, y: shoulder.y - 7 }, { x: shoulder.x + side * 3 + Math.sin(time / 70) * 2, y: shoulder.y - 15 }));
  if (pose === 'wave') arms[1] = path(shoulder, { x: 32, y: 21 }, { x: 34 + Math.sin(time / 130) * 2, y: 13 });
  if (pose === 'jump' || pose === 'climb' || pose === 'drag') {
    feet = [{ x: 16, y: pose === 'drag' ? 52 : 47 }, { x: 30, y: 50 }];
    arms = pose === 'climb'
      ? [path(shoulder, { x: 27, y: 17 }, { x: 31, y: 11 }), path(shoulder, { x: 31, y: 19 }, { x: 36, y: 14 })]
      : [path(shoulder, { x: 16, y: 28 }, { x: 13, y: 21 }), path(shoulder, { x: 30, y: 28 }, { x: 34, y: 20 })];
  }
  if (pose === 'fall') {
    const flail = Math.sin(time / 90) * 2;
    feet = [{ x: 15 + flail, y: 50 }, { x: 31 - flail, y: 52 }];
    arms = [path(shoulder, { x: 15, y: 18 }, { x: 11, y: 12 + flail }), path(shoulder, { x: 32, y: 18 }, { x: 36, y: 11 - flail })];
  }
  if (pose === 'land') {
    feet = [{ x: 15, y: 54 }, { x: 31, y: 54 }];
    arms = [path(shoulder, { x: 20, y: shoulder.y + 8 }, { x: 22, y: shoulder.y + 14 }), path(shoulder, { x: 30, y: shoulder.y + 8 }, { x: 33, y: shoulder.y + 14 })];
  }
  if (pose === 'knock') {
    // Two quick raps then a pause, with the knuckles landing on the wall ahead of the figure.
    const beat = time % 1400, tap = beat < 800 ? Math.max(0, Math.sin(beat / 400 * Math.PI)) : 0;
    arms = [path(shoulder, { x: 22, y: 32 }, { x: 23, y: 38 }), path(shoulder, { x: 31 + tap * 2, y: 23 }, { x: 33 + tap * 5, y: 22 })];
  }
  if (pose === 'hurt' || pose === 'hit' || pose === 'shot') {
    feet = pose === 'hurt' ? [{ x: 18, y: 54 }, { x: 30, y: 48 }] : pose === 'shot' ? [{ x: 20, y: 54 }, { x: 27, y: 50 }] : [{ x: 20, y: 54 }, { x: 28, y: 54 }];
    arms = [path(shoulder, { x: 14, y: 20 }, { x: 10, y: 15 }), path(shoulder, { x: 32, y: 20 }, { x: 36, y: 14 })];
  }
  let rifle = '', flash = '';
  if (pose === 'aim' || pose === 'shoot') {
    // Stock at the shoulder, cheek on it, trigger hand close and the other hand on the fore-end; recoil slides it back.
    const recoil = pose === 'shoot' ? 2 * (1 - Math.min(1, time / RIFLE.flash)) : 0;
    feet = [{ x: 18, y: 54 }, { x: 29, y: 54 }];
    rifle = path({ x: STOCK.x - recoil, y: STOCK.y }, { x: MUZZLE.x - recoil, y: MUZZLE.y });
    arms = [path(shoulder, { x: 29, y: shoulder.y + 4 }, { x: 31 - recoil, y: 27 }), path(shoulder, { x: 33, y: shoulder.y + 4 }, { x: 39 - recoil, y: 26 })];
    if (pose === 'shoot' && time < RIFLE.flash * .7) {
      const m = { x: MUZZLE.x - recoil, y: MUZZLE.y };
      flash = `M${m.x} ${m.y - 4} L${m.x + 2} ${m.y - 1} L${m.x + 10} ${m.y} L${m.x + 2} ${m.y + 1} L${m.x} ${m.y + 4} L${m.x - 1} ${m.y + 1} L${m.x - 3} ${m.y} L${m.x - 1} ${m.y - 1} Z`;
    }
  }
  if (pose === 'sit') {
    feet = [{ x: 30, y: 54 }, { x: 33, y: 54 }];
    arms = [path(shoulder, { x: 28, y: shoulder.y + 8 }, { x: 29, y: shoulder.y + 17 }), path(shoulder, { x: 30, y: shoulder.y + 8 }, { x: 32, y: shoulder.y + 17 })];
  }
  if (pose === 'stretch') {
    feet = [{ x: 19, y: 54 - (36 - hipY) }, { x: 27, y: 54 - (36 - hipY) }];
    arms = [path(shoulder, { x: 20, y: shoulder.y - 7 }, { x: 19, y: shoulder.y - 16 }), path(shoulder, { x: 28, y: shoulder.y - 7 }, { x: 29, y: shoulder.y - 16 })];
  }
  if (pose === 'look') arms[1] = path(shoulder, { x: 31, y: 21 }, { x: 31, y: 12 });
  if (pose === 'scratch') arms[1] = path(shoulder, { x: 31, y: 19 }, { x: 29 + Math.sin(time / 120) * 1.5, y: 10 });
  if (pose === 'fight' || pose === 'punch' || pose === 'kick' || pose === 'block') {
    // Guard stance: rear fist by the chin, lead fist forward; blows extend from it.
    feet = [{ x: 17, y: 54 }, { x: 30, y: 54 }];
    arms = [path(shoulder, { x: 28, y: shoulder.y + 5 }, { x: 29, y: shoulder.y - 1 }), path(shoulder, { x: 30, y: shoulder.y + 6 }, { x: 32, y: shoulder.y })];
    if (pose === 'punch') arms[1] = path(shoulder, { x: 31 + strike * 4, y: shoulder.y + 2 }, { x: 32 + strike * 11, y: shoulder.y });
    if (pose === 'kick') { feet = [{ x: 18, y: 54 }, { x: 30 + strike * 13, y: 54 - strike * 18 }]; arms[0] = path(shoulder, { x: 18, y: shoulder.y + 4 }, { x: 15, y: shoulder.y + 1 }); }
    if (pose === 'block') arms = [path(shoulder, { x: 29, y: shoulder.y + 3 }, { x: 28, y: shoulder.y - 4 }), path(shoulder, { x: 30, y: shoulder.y + 6 }, { x: 28, y: shoulder.y + 1 })];
  }
  let headX = shoulder.x - 11 + (pose === 'hurt' || pose === 'hit' ? -3 : pose === 'shot' ? -4 : pose === 'look' ? 2 : pose === 'aim' || pose === 'shoot' ? 1 : 0);
  let headY = shoulder.y - 25 + (pose === 'hurt' || pose === 'hit' ? -2 : pose === 'shot' ? -3 : 0);
  if (pose === 'down') {
    // Flat on the back, knees up; the renderer eases in from the standing hit so it reads as toppling over.
    const rise = time > DOWN_DURATION - 250 ? (time - (DOWN_DURATION - 250)) / 250 : 0;
    hip = { x: 30 - rise * 7, y: 52 - rise * 16 };
    shoulder = { x: 19 + rise * 5, y: 52 - rise * 27 };
    feet = [{ x: 42 - rise * 23, y: 54 }, { x: 44 - rise * 17, y: 53 + rise }];
    arms = [path(shoulder, { x: 22, y: 46 }, { x: 28, y: 48 }), path(shoulder, { x: 14, y: 47 }, { x: 10, y: 52 })];
    headX = shoulder.x - 23 + rise * 12; headY = shoulder.y - 11 - rise * 14;
  }
  if (pose === 'limp') {
    // Tumbling off the ledge: body sideways in the air, limbs hanging.
    hip = { x: 29, y: 46 }; shoulder = { x: 19, y: 44 };
    feet = [{ x: 36, y: 52 }, { x: 38, y: 54 }];
    arms = [path(shoulder, { x: 14, y: 50 }, { x: 13, y: 55 }), path(shoulder, { x: 22, y: 51 }, { x: 24, y: 56 })];
    headX = shoulder.x - 23; headY = shoulder.y - 11;
  }
  return { body: path({ x: shoulder.x, y: shoulder.y - 3 }, hip), legs: feet.map((foot) => leg(hip, foot)), arms, headX, headY, rifle, flash };
}
