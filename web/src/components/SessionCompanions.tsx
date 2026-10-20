import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { AgentId } from '../lib/agent';
import { api } from '../lib/api';
import { pendingRequests, type ChatSession } from '../lib/chatStore';
import AgentIcon from './AgentIcon';
import { aimAngle, ATTACKS, atWall, chooseAction, chooseAttack, cycleLength, DOWN_DURATION, dropFloor, fallDuration, FIGHT_BREAK, FIGHT_RANGE, fightDuration, floorBelow, FOOT, GESTURE_DURATION, GESTURES, groundOf, HALF_WIDTH, HIT_DURATION, hops, landsHit, leapTargets, muzzle, neighborZone, restDuration, RIFLE, SCALE, skeleton, SPEED, STOCK, type AttackKind, type Floor, type Point, type Pose, type Side } from '../lib/companionMotion';

type Actor = {
  position: Point; floor: string; busy: boolean; direction: number; cooldown: number;
  /** Sparring state shared with the peer through the actors map. */
  fight: number; fightUntil: number; hits: number; hitUntil: number; downUntil: number; nextAttack: number;
  attack: { kind: AttackKind; start: number; landed: boolean } | null;
  /** Rifle: the shooter's sequence, and on the target the stun window and the pending collapse. */
  gun: { start: number; shots: number; lastShot: number; target: Actor } | null; lastGun: number; shotUntil: number; collapse: number;
  /** Mid-jump or mid-fall: not a valid rifle target because stopping it would leave it hanging in the air. */
  airborne: boolean;
  /** Lets the shooter stop whatever the target was doing. */
  halt: () => void;
};
/** One queued motion: a hold (no `to`) or a move between two points, optionally landing on a floor. */
type Step = { pose: Pose; duration: number; start?: number; from?: Point; to?: Point; height?: number; ease?: 'linear' | 'smooth' | 'gravity'; floor?: Floor; face?: number; onEnd?: (now: number) => void };
type Rect = { left: number; right: number; top: number; bottom: number };
const AGENTS: AgentId[] = ['claude', 'codex'];
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

/** Platforms: explicit floors, list rows as ladder rungs, and one ground per panel (marked or the panel's bottom edge). */
function scenery() {
  const floors: Floor[] = [];
  const clips = new Map<Element, Rect>();
  const clipOf = (p: HTMLElement | null): Rect => {
    if (!p) return { left: HALF_WIDTH, right: innerWidth - HALF_WIDTH, top: 0, bottom: innerHeight };
    const cached = clips.get(p);
    if (cached) return cached;
    const outer = clipOf(p.parentElement), style = getComputedStyle(p);
    let clip = outer;
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX + style.overflowY)) {
      const r = p.getBoundingClientRect();
      clip = { left: Math.max(outer.left, r.left), right: Math.min(outer.right, r.right), top: Math.max(outer.top, r.top), bottom: Math.min(outer.bottom, r.bottom) };
    }
    clips.set(p, clip);
    return clip;
  };
  const visibleRect = (node: HTMLElement) => {
    if (!node.checkVisibility({ checkVisibilityCSS: true })) return null;
    const r = node.getBoundingClientRect(), clip = clipOf(node.parentElement);
    const left = Math.max(clip.left, r.left), right = Math.min(clip.right, r.right), top = Math.max(clip.top, r.top), bottom = Math.min(clip.bottom, r.bottom);
    return right > left && bottom >= top ? { left, right, top, bottom, raw: r } : null;
  };
  const zoneOf = (node: HTMLElement) => node.closest<HTMLElement>('[data-companion-zone]')?.dataset.companionZone ?? 'prompt';
  const usable = (y: number, r: Rect) => y >= 44 && y >= r.top && y <= r.bottom && y <= innerHeight - 4;
  const zones = new Map<string, Rect>();
  document.querySelectorAll<HTMLElement>('[data-companion-zone]').forEach((node) => {
    const r = visibleRect(node);
    if (r && !zones.has(node.dataset.companionZone!)) zones.set(node.dataset.companionZone!, r);
  });
  const grounds = new Map<string, Floor>();
  document.querySelectorAll<HTMLElement>('[data-companion-floor]').forEach((node) => {
    const r = visibleRect(node);
    if (!r || r.right - r.left < 34) return;
    const y = node.dataset.companionEdge === 'bottom' ? r.raw.bottom : r.raw.top;
    if (!usable(y, r)) return;
    const floor: Floor = { id: node.dataset.companionFloor!, left: r.left + 12, right: r.right - 12, y, zone: zoneOf(node) };
    if ('companionGround' in node.dataset && !grounds.has(floor.zone)) { floor.ground = true; grounds.set(floor.zone, floor); }
    floors.push(floor);
  });
  let rung = 0;
  document.querySelectorAll<HTMLElement>('[data-companion-rung]').forEach((node) => {
    const r = visibleRect(node);
    if (!r || r.right - r.left < 34 || !usable(r.raw.bottom, r)) return;
    floors.push({ id: `rung:${rung++}`, left: r.left + 12, right: r.right - 12, y: r.raw.bottom, zone: zoneOf(node), rung: true });
  });
  for (const [zone, r] of zones) {
    const left = Math.max(HALF_WIDTH, r.left + 6), right = Math.min(innerWidth - HALF_WIDTH, r.right - 6);
    if (right - left < 34) continue;
    const ground = grounds.get(zone);
    if (ground) { ground.left = left; ground.right = right; }
    else if (r.bottom - 2 >= 44 && r.bottom <= innerHeight) floors.push({ id: `ground:${zone}`, left, right, y: r.bottom - 2, zone, ground: true });
  }
  return floors;
}

/** Both figures appear whenever their CLI is connected, even with no session open; only the figures accept pointer input. */
export default function SessionCompanions({ sessions, scene = '' }: { sessions: ChatSession[]; scene?: string }) {
  const actors = useRef(new Map<AgentId, Actor>());
  const [connected, setConnected] = useState<AgentId[]>([]);
  useEffect(() => {
    let on = true;
    const load = () => api.tools().then((info) => { if (on) setConnected(info.tools.filter((t) => t.installed && t.loggedIn !== false).map((t) => t.id)); }).catch(() => {});
    load();
    const timer = setInterval(load, 60000);
    return () => { on = false; clearInterval(timer); };
  }, []);
  const live = sessions.filter((s) => !s.restoring && s.status !== 'closed' && s.status !== 'starting');
  return <div className="session-companions">
    {AGENTS.filter((agent) => connected.includes(agent) || live.some((s) => s.agent === agent)).map((agent) =>
      <Companion key={agent} agent={agent} sessions={live} scene={scene} actors={actors} />)}
  </div>;
}

function Companion({ agent, sessions, scene, actors }: { agent: AgentId; sessions: ChatSession[]; scene: string; actors: MutableRefObject<Map<AgentId, Actor>> }) {
  const root = useRef<HTMLDivElement>(null);
  const current = useRef({ sessions, scene });
  current.current = { sessions, scene };
  useEffect(() => {
    const el = root.current!, figure = el.querySelector<HTMLElement>('.companion-figure')!;
    const head = el.querySelector<HTMLElement>('.companion-head')!;
    const paths = [...el.querySelectorAll<SVGPathElement>('.companion-limb')];
    const rifle = el.querySelector<SVGPathElement>('.companion-rifle')!, flash = el.querySelector<SVGPathElement>('.companion-flash')!;
    const drawn: number[][] = [];
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const actor: Actor = { position: { x: 0, y: 0 }, floor: '', busy: false, direction: 1, cooldown: 0, fight: 0, fightUntil: 0, hits: 0, hitUntil: 0, downUntil: 0, nextAttack: 0, attack: null,
      gun: null, lastGun: -Infinity, shotUntil: 0, collapse: 0, airborne: false, halt: () => { queue = []; actor.busy = false; actor.attack = null; } };
    actors.current.set(agent, actor);
    let frame = 0, last = 0, measured = -Infinity, nextMove = 0, lastCross = -Infinity, lastLeap = -Infinity, phase = 0, poseSince = 0, shownPose: Pose = 'idle';
    let floors: Floor[] = [], initialized = false, zone = '', seenScene = scene;
    let queue: Step[] = [], tilt = 0;
    let drag: { pointer: number; dx: number; dy: number; x: number; y: number; moved: boolean } | null = null;
    const clamp = (floor: Floor, x: number) => ({ x: Math.max(floor.left, Math.min(floor.right, x)), y: floor.y });
    const rest = (now: number) => { nextMove = now + restDuration(); };
    const tail = (): Point => { for (let i = queue.length - 1; i >= 0; i--) if (queue[i].to) return queue[i].to!; return actor.position; };
    const hold = (pose: Pose, duration = GESTURE_DURATION[pose] ?? 1000, extra: Partial<Step> = {}) => { queue.push({ pose, duration, ...extra }); actor.busy = true; };
    const move = (pose: Pose, to: Point, extra: Partial<Step> = {}) => {
      const from = { ...tail() };
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const step: Step = { pose, from, to, ease: 'linear', duration: Math.max(250, Math.abs(to.x - from.x) / (SPEED[pose as 'walk' | 'run' | 'flee'] ?? SPEED.run) * 1000), ...extra };
      if (pose === 'jump') Object.assign(step, { ease: 'smooth', height: Math.max(10, Math.min(50, 18 + Math.max(0, from.y - to.y) * .35)), duration: Math.max(380, Math.min(900, distance * 2.2)) }, extra);
      if (pose === 'fall') Object.assign(step, { ease: 'gravity', height: 0, duration: fallDuration(to.y - from.y) }, extra);
      if (pose === 'climb') Object.assign(step, { ease: 'smooth', height: 14, duration: 650 }, extra);
      queue.push(step); actor.busy = true;
      return step;
    };
    const landOn = (floor: Floor, x: number, pose?: Pose) => {
      const to = clamp(floor, x), from = tail();
      move(pose ?? (to.y >= from.y - 4 && floor.zone === zone ? 'fall' : 'jump'), to, { floor });
      hold('land');
    };
    /** Knock twice, then slip over the wall and drop onto the neighbouring panel's floor (or give up and turn back). */
    const cross = (ground: Floor, side: Side, now: number) => {
      const x = side === 'right' ? ground.left : ground.right;
      move('climb', { x, y: Math.min(actor.position.y, ground.y) - 16 }, { face: side === 'right' ? 1 : -1 });
      landOn(ground, x, 'fall');
      lastCross = now;
    };
    const turnBack = (floor: Floor, side: Side) => {
      hold('look', 500, { face: side === 'right' ? -1 : 1 });
      move('walk', clamp(floor, actor.position.x + (side === 'right' ? -1 : 1) * (40 + Math.random() * 60)));
    };
    const wallArrival = (floor: Floor, side: Side, panic = false) => {
      const decideCrossing = (now: number) => {
        const next = neighborZone(zone, side), ground = next ? groundOf(next, floors) : undefined;
        if (ground && (panic || (now - lastCross > 9000 && Math.random() < .8))) cross(ground, side, now);
        else turnBack(floor, side);
      };
      if (panic) decideCrossing(performance.now());
      else hold('knock', GESTURE_DURATION.knock, { face: side === 'right' ? 1 : -1, onEnd: decideCrossing });
    };
    const strollTo = (pose: 'walk' | 'run', floor: Floor, x: number, now: number) => {
      const to = clamp(floor, x);
      if (Math.abs(to.x - actor.position.x) < 8) { rest(now); return; }
      move(pose, to, { onEnd: () => { const side = floor.ground ? atWall(floor, to.x) : null; if (side) wallArrival(floor, side); } });
    };
    const stroll = (pose: 'walk' | 'run', floor: Floor, now: number) => {
      let x = floor.ground && Math.random() < .45 ? (Math.random() < .5 ? floor.left : floor.right) : floor.left + Math.random() * (floor.right - floor.left);
      if (Math.abs(x - actor.position.x) < 24) x = actor.position.x + (x < actor.position.x ? -40 : 40);
      strollTo(pose, floor, x, now);
    };
    /** The rare long leap: a high arc straight onto another panel's floor. */
    const leap = (target: Floor, now: number) => {
      const to = clamp(target, target.left + 20 + Math.random() * (target.right - target.left - 40));
      move('jump', to, { floor: target, height: 110, duration: 1150, ease: 'smooth' });
      hold('land');
      lastLeap = now;
    };
    const decide = (floor: Floor, now: number, peer: Actor | undefined) => {
      const waiting = current.current.sessions.some((s) => s.agent === agent && pendingRequests(s) > 0);
      const action = waiting ? 'idle' : chooseAction(Math.random, !!floor.rung, !!floor.ground && now - lastLeap > 90000);
      const nearPeer = peer && !peer.busy && peer.floor === floor.id;
      // Ambush: any platform, any distance, as long as the target is standing somewhere and not already mid-air or down.
      if (peer && peer.floor && !peer.gun && !peer.airborne && !peer.collapse && now >= peer.downUntil && now - actor.lastGun > RIFLE.cooldown && Math.random() < RIFLE.chance
        && Math.abs(peer.position.x - actor.position.x) > RIFLE.minGap) { startGun(peer, now); return; }
      if (action === 'leap') {
        const targets = leapTargets(floor, floors);
        if (targets.length) { leap(pick(targets), now); return; }
      }
      if (action === 'hop') {
        const choices = hops(floor, actor.position.x, floors);
        if (choices.length) { landOn(pick(choices), actor.position.x, 'jump'); return; }
        const below = floor.ground ? undefined : dropFloor(actor.position, floors, zone);
        if (below && below.id !== floor.id) { landOn(below, actor.position.x); return; }
      }
      if (action === 'gesture') { hold(pick(GESTURES), undefined, { face: nearPeer ? Math.sign(peer.position.x - actor.position.x) || 1 : Math.random() < .5 ? -1 : 1 }); return; }
      if (action === 'idle') { if (nearPeer && Math.abs(peer.position.x - actor.position.x) < 160) actor.direction = peer.position.x > actor.position.x ? 1 : -1; rest(now); return; }
      // Curiosity: sometimes wander over to the other figure, which is how most scuffles start.
      if (nearPeer && now > actor.cooldown && Math.abs(peer.position.x - actor.position.x) > 50 && Math.random() < .3) {
        strollTo(action === 'run' ? 'run' : 'walk', floor, peer.position.x - Math.sign(peer.position.x - actor.position.x) * 24, now); return;
      }
      stroll(action === 'run' ? 'run' : 'walk', floor, now);
    };
    const ouch = (fromX: number, now: number) => {
      queue = []; actor.fight = 0; actor.attack = null; actor.cooldown = Math.max(actor.cooldown, now + 8000);
      const floor = floors.find((f) => f.id === actor.floor);
      hold('hurt', GESTURE_DURATION.hurt, { face: fromX >= actor.position.x ? 1 : -1 });
      if (!floor) return;
      let side: Side = fromX > actor.position.x ? 'left' : 'right';
      if (Math.abs((side === 'right' ? floor.right : floor.left) - actor.position.x) < 50) side = side === 'right' ? 'left' : 'right';
      const to = clamp(floor, side === 'right' ? floor.right : floor.left);
      move('flee', to, { onEnd: () => { if (floor.ground && atWall(floor, to.x)) wallArrival(floor, side, true); } });
    };
    /** Bullet trail and impact spark, drawn in the overlay and removed once their fade finishes. */
    const tracer = (from: Point, to: Point) => {
      const overlay = el.parentElement;
      if (!overlay) return;
      const line = document.createElement('span'), spark = document.createElement('span');
      line.className = 'companion-tracer'; spark.className = 'companion-spark';
      line.style.width = `${Math.hypot(to.x - from.x, to.y - from.y)}px`;
      line.style.transform = `translate(${from.x}px, ${from.y}px) rotate(${Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI}deg)`;
      spark.style.left = `${to.x - 5}px`; spark.style.top = `${to.y - 5}px`;
      overlay.append(line, spark);
      setTimeout(() => { line.remove(); spark.remove(); }, 300);
    };
    const startGun = (target: Actor, now: number) => {
      queue = []; actor.attack = null; actor.busy = true;
      actor.gun = { start: now, shots: 0, lastShot: -Infinity, target }; actor.lastGun = now;
      actor.direction = target.position.x >= actor.position.x ? 1 : -1;
    };
    /** Draw, fire three rounds at the target (each one stuns and nudges it), then lower the rifle; the third round drops the target. */
    const gunTick = (now: number): Pose => {
      const g = actor.gun!, t = now - g.start, target = g.target;
      actor.direction = target.position.x >= actor.position.x ? 1 : -1;
      tilt = aimAngle(actor.position, actor.direction, target.position);
      if (g.shots < RIFLE.shots && t >= RIFLE.draw + g.shots * RIFLE.interval) {
        g.shots++; g.lastShot = now;
        tracer(muzzle(actor.position, actor.direction, tilt), { x: target.position.x - actor.direction * 3, y: target.position.y - 20 });
        target.halt(); target.shotUntil = now + RIFLE.stun; target.attack = null;
        const under = floors.find((f) => f.id === target.floor);
        if (under) target.position = clamp(under, target.position.x + actor.direction * RIFLE.knockback);
        if (g.shots === RIFLE.shots) { target.hits += 3; target.collapse = now; }
      }
      if (t >= RIFLE.total) { actor.gun = null; tilt = 0; actor.busy = false; actor.nextAttack = now + 400; if (!actor.fight) rest(now); return 'aim'; }
      return now - g.lastShot < RIFLE.flash ? 'shoot' : 'aim';
    };
    /** Shot three times: tumble onto the platform below if there is one, otherwise crumple on the spot, then limp off. */
    const collapse = (now: number) => {
      actor.collapse = 0; actor.fight = 0; actor.attack = null; queue = []; actor.cooldown = Math.max(actor.cooldown, now + 20000);
      const below = floorBelow(actor.position, actor.floor, floors, zone);
      if (below) move('limp', clamp(below, actor.position.x), { floor: below, ease: 'gravity', duration: fallDuration(below.y - actor.position.y) + 150 });
      hold('down', RIFLE.collapse, { onEnd: (t) => { const shooter = actors.current.get(agent === 'claude' ? 'codex' : 'claude'); ouch(shooter?.position.x ?? actor.position.x + 1, t); } });
    };
    const startFight = (peer: Actor, now: number) => {
      const until = now + fightDuration();
      for (const a of [actor, peer]) { a.fight = now; a.fightUntil = until; a.hits = 0; a.hitUntil = 0; a.downUntil = 0; a.attack = null; a.nextAttack = now + 300 + Math.random() * 400; a.cooldown = now + 45000; }
      actor.direction = peer.position.x > actor.position.x ? 1 : -1; peer.direction = -actor.direction;
    };
    /** Loser limps off, winner flexes, a draw ends with both looking around. */
    const endFight = (peer: Actor | undefined, now: number) => {
      actor.fight = 0; actor.attack = null;
      if (!peer) { rest(now); return; }
      if (actor.hits > peer.hits) ouch(peer.position.x, now);
      else if (actor.hits < peer.hits) hold('stretch', 1200, { face: Math.sign(peer.position.x - actor.position.x) || 1 });
      else hold('look', 900, { face: Math.sign(actor.position.x - peer.position.x) || 1 });
    };
    /** Sparring: face the peer, close in, and trade punches, kicks and blocks that connect by hit box. */
    const spar = (floor: Floor, peer: Actor, now: number, dt: number): Pose => {
      if (now < actor.downUntil) return 'down';
      if (now < actor.shotUntil) return 'shot';
      if (now < actor.hitUntil) return 'hit';
      const dir = peer.position.x > actor.position.x ? 1 : -1;
      if (actor.attack) {
        const spec = ATTACKS[actor.attack.kind], p = (now - actor.attack.start) / spec.duration;
        if (!actor.attack.landed && p >= spec.strikeAt) {
          actor.attack.landed = true;
          if (landsHit(actor.position, actor.direction, peer.position, actor.attack.kind) && now >= peer.downUntil) {
            const blocked = peer.attack?.kind === 'block' && peer.direction === -actor.direction;
            peer.position = clamp(floor, peer.position.x + actor.direction * (blocked ? 3 : spec.knockback));
            if (!blocked) {
              peer.hits++; peer.attack = null; peer.hitUntil = now + HIT_DURATION;
              if (peer.hits % 3 === 0) { peer.downUntil = now + DOWN_DURATION; peer.hitUntil = 0; peer.nextAttack = peer.downUntil + 300; }
            }
          }
        }
        if (p >= 1) { actor.attack = null; actor.nextAttack = now + 200 + Math.random() * 500; }
        else return actor.attack.kind;
      }
      actor.direction = dir;
      const gap = Math.abs(peer.position.x - actor.position.x);
      if (gap > FIGHT_RANGE) actor.position = clamp(floor, actor.position.x + dir * 45 * dt / 1000);
      else if (gap < 10) actor.position = clamp(floor, actor.position.x - dir * 30 * dt / 1000);
      else if (now >= actor.nextAttack && now >= peer.downUntil) {
        if (!peer.gun && now - actor.lastGun > RIFLE.cooldown && Math.random() < RIFLE.chance) { startGun(peer, now); return 'aim'; }
        actor.attack = { kind: chooseAttack(), start: now, landed: false };
      }
      return actor.attack?.kind ?? 'fight';
    };
    const render = (pose: Pose, now: number) => {
      actor.position.x = Math.max(HALF_WIDTH, Math.min(innerWidth - HALF_WIDTH, actor.position.x));
      actor.position.y = Math.max(42, Math.min(innerHeight - 4, actor.position.y));
      el.style.transform = `translate3d(${actor.position.x - HALF_WIDTH}px, ${actor.position.y - FOOT}px, 0)`;
      figure.style.transform = `scale(${SCALE * actor.direction}, ${SCALE})`;
      if (pose !== shownPose) { shownPose = pose; poseSince = now; }
      const bones = skeleton(pose, phase, now - poseSince, queue[0]?.pose === 'down' ? queue[0].duration : undefined);
      [bones.body, ...bones.legs, ...bones.arms].forEach((d, i) => {
        const target = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
        drawn[i] = target.map((n, j) => drawn[i] ? drawn[i][j] + (n - drawn[i][j]) * .45 : n);
        let j = 0;
        paths[i].setAttribute('d', d.replace(/-?\d+(?:\.\d+)?/g, () => drawn[i][j++].toFixed(2)));
      });
      rifle.setAttribute('d', bones.rifle); flash.setAttribute('d', bones.flash);
      const turn = bones.rifle && tilt ? `rotate(${tilt.toFixed(1)} ${STOCK.x} ${STOCK.y})` : '';
      for (const node of [rifle, flash, paths[3], paths[4]]) { if (turn) node.setAttribute('transform', turn); else node.removeAttribute('transform'); }
      head.style.transform = `translate(${bones.headX}px, ${bones.headY}px)`;
      el.dataset.pose = pose; el.dataset.floor = actor.floor; el.dataset.zone = zone; el.dataset.hits = String(actor.hits);
      el.dataset.travel = drag ? 'drag' : queue.length ? queue[0].pose : 'rest';
    };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 30) return;
      const dt = Math.min(64, now - last); last = now;
      const changed = seenScene !== current.current.scene;
      if (changed) seenScene = current.current.scene;
      if (changed || now - measured > 300) { floors = scenery(); measured = now; }
      if (!floors.length) { el.style.visibility = 'hidden'; initialized = false; actor.busy = true; return; }
      el.style.visibility = 'visible';
      if (!initialized) {
        const floor = groundOf('prompt', floors) ?? floors.find((f) => f.ground) ?? floors[0];
        actor.position = clamp(floor, floor.left + (agent === 'claude' ? .35 : .65) * (floor.right - floor.left));
        actor.floor = floor.id; zone = floor.zone; initialized = true; actor.busy = false; queue = []; rest(now);
      }
      if (drag) { render(drag.moved ? 'drag' : 'idle', now); return; }
      if (queue.some((s) => s.floor && !floors.some((f) => f.id === s.floor!.id))) { queue = []; actor.busy = false; }
      let floor = floors.find((f) => f.id === actor.floor);
      if (!floor && !queue.length) {
        // Lost scenery drops onto the panel's own floor; a vanished panel sends the figure back to the prompt.
        const landing = dropFloor(actor.position, floors, zone) ?? groundOf('prompt', floors) ?? dropFloor(actor.position, floors);
        if (!landing) { el.style.visibility = 'hidden'; actor.busy = true; return; }
        actor.fight = 0; actor.attack = null; landOn(landing, actor.position.x); floor = landing;
      }
      const waiting = current.current.sessions.some((s) => s.agent === agent && pendingRequests(s) > 0);
      const peer = actors.current.get(agent === 'claude' ? 'codex' : 'claude');
      if (actor.collapse) collapse(now);
      if (actor.fight && !actor.gun && (now >= actor.fightUntil || !peer || !peer.fight || peer.busy || peer.floor !== actor.floor || Math.abs(peer.position.x - actor.position.x) > FIGHT_BREAK)) endFight(peer, now);
      if (!queue.length && !actor.fight && peer && !peer.busy && !peer.fight && peer.floor === actor.floor && now > actor.cooldown && now > peer.cooldown && Math.abs(peer.position.x - actor.position.x) > 12 && Math.abs(peer.position.x - actor.position.x) < 42) startFight(peer, now);
      if (!queue.length && !actor.fight && !actor.gun && now >= nextMove && now >= actor.shotUntil && floor) decide(floor, now, peer);
      let pose: Pose = actor.gun ? gunTick(now) : actor.fight && peer && floor ? spar(floor, peer, now, dt) : waiting && now % 10000 < 1500 ? 'wave' : 'idle';
      const step = queue[0];
      if (step) {
        if (!step.start) { step.start = now; if (step.face) actor.direction = step.face; else if (step.to && step.from && step.to.x !== step.from.x) actor.direction = step.to.x > step.from.x ? 1 : -1; }
        const p = Math.min(1, (now - step.start) / step.duration);
        if (step.to && step.from) {
          const eased = step.ease === 'gravity' ? p * p : step.ease === 'smooth' ? p * p * (3 - 2 * p) : p;
          const oldX = actor.position.x;
          actor.position = { x: step.from.x + (step.to.x - step.from.x) * eased, y: step.from.y + (step.to.y - step.from.y) * eased - Math.sin(Math.PI * p) * (step.height ?? 0) };
          if (step.pose in SPEED) phase += Math.abs(actor.position.x - oldX) / cycleLength(step.pose) * Math.PI * 2;
        }
        pose = step.pose; actor.airborne = !!step.to && !(step.pose in SPEED);
        if (p === 1) {
          queue.shift();
          if (step.floor) { actor.floor = step.floor.id; zone = step.floor.zone; }
          step.onEnd?.(now);
          if (!queue.length) { actor.busy = false; rest(now); pose = 'idle'; }
        }
      } else if (floor) {
        actor.position = clamp(floor, actor.position.x); actor.busy = !!actor.gun; actor.airborne = false;
        if (now < actor.shotUntil && !actor.gun) pose = 'shot';
      }
      render(pose, now);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !initialized || drag) return;
      e.preventDefault(); e.stopPropagation();
      drag = { pointer: e.pointerId, dx: actor.position.x - e.clientX, dy: actor.position.y - e.clientY, x: e.clientX, y: e.clientY, moved: false };
      el.setPointerCapture(e.pointerId);
    };
    const moveDrag = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      if (!drag.moved) { drag.moved = true; queue = []; actor.fight = 0; actor.attack = null; actor.gun = null; actor.collapse = 0; actor.busy = true; actor.cooldown = performance.now() + 2500; }
      actor.position = { x: e.clientX + drag.dx, y: e.clientY + drag.dy }; render('drag', performance.now());
    };
    const drop = () => {
      if (!drag) return;
      const { pointer, moved, x } = drag; drag = null;
      if (el.hasPointerCapture(pointer)) el.releasePointerCapture(pointer);
      const now = performance.now();
      if (!moved) { ouch(x, now); return; }
      floors = scenery(); measured = now;
      const floor = dropFloor(actor.position, floors);
      if (floor) { queue = []; landOn(floor, actor.position.x); }
      else { initialized = false; actor.busy = true; }
    };
    const invalidate = () => { measured = -Infinity; };
    const sync = () => {
      cancelAnimationFrame(frame); drop(); el.style.visibility = 'hidden'; actor.busy = true; actor.fight = 0; actor.attack = null; actor.gun = null; actor.collapse = 0;
      if (!document.hidden && !media.matches) { measured = -Infinity; last = 0; queue = []; actor.busy = false; rest(performance.now()); frame = requestAnimationFrame(tick); }
    };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', moveDrag);
    el.addEventListener('pointerup', drop); el.addEventListener('pointercancel', drop); el.addEventListener('lostpointercapture', drop);
    window.addEventListener('blur', drop);
    media.addEventListener('change', sync); document.addEventListener('visibilitychange', sync);
    window.addEventListener('resize', invalidate); document.addEventListener('scroll', invalidate, true);
    sync();
    return () => {
      cancelAnimationFrame(frame); actors.current.delete(agent);
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', moveDrag);
      el.removeEventListener('pointerup', drop); el.removeEventListener('pointercancel', drop); el.removeEventListener('lostpointercapture', drop);
      window.removeEventListener('blur', drop);
      media.removeEventListener('change', sync); document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('resize', invalidate); document.removeEventListener('scroll', invalidate, true);
    };
  }, [agent, actors]);
  return <div ref={root} className={`session-companion session-companion-${agent}`} data-pose="idle" data-agent={agent} title={agent === 'claude' ? 'Claude' : 'Codex'}>
    <div className="companion-figure" aria-hidden="true">
      <svg className="companion-body" width="48" height="60" viewBox="0 0 48 60" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
        <path className="companion-limb" /><path className="companion-limb" opacity=".65" /><path className="companion-limb" /><path className="companion-limb" opacity=".65" /><path className="companion-limb" />
        <path className="companion-rifle" stroke="#b8bec9" strokeWidth="3.4" /><path className="companion-flash" fill="#ffd166" stroke="none" />
      </svg>
      <div className="companion-head"><AgentIcon agent={agent} size={22} /></div>
    </div>
    <span className="companion-shadow" />
  </div>;
}
