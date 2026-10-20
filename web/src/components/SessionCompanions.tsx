import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { AgentId } from '../lib/agent';
import { api } from '../lib/api';
import { pendingRequests, type ChatSession } from '../lib/chatStore';
import AgentIcon from './AgentIcon';
import { atWall, chooseAction, cycleLength, dropFloor, fallDuration, FOOT, GESTURE_DURATION, GESTURES, groundOf, HALF_WIDTH, hops, neighborZone, restDuration, SCALE, skeleton, SPEED, type Floor, type Point, type Pose, type Side } from '../lib/companionMotion';

type Actor = { position: Point; floor: string; busy: boolean; fight: number; cooldown: number; direction: number };
/** One queued motion: a hold (no `to`) or a move between two points, optionally landing on a floor. */
type Step = { pose: Pose; duration: number; start?: number; from?: Point; to?: Point; height?: number; ease?: 'linear' | 'smooth' | 'gravity'; floor?: Floor; face?: number; onEnd?: (now: number) => void };
const AGENTS: AgentId[] = ['claude', 'codex'];
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

/** Platforms: explicit floors, file rows as ladder rungs, and one ground per panel (marked or the panel's bottom edge). */
function scenery() {
  const floors: Floor[] = [];
  const visibleRect = (node: HTMLElement) => {
    if (!node.checkVisibility({ checkVisibilityCSS: true })) return null;
    const r = node.getBoundingClientRect();
    let left = Math.max(HALF_WIDTH, r.left), right = Math.min(innerWidth - HALF_WIDTH, r.right);
    let top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
    for (let p = node.parentElement; p; p = p.parentElement) {
      const style = getComputedStyle(p), clip = p.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
    }
    return right > left && bottom >= top ? { left, right, top, bottom, raw: r } : null;
  };
  const zoneOf = (node: HTMLElement) => node.closest<HTMLElement>('[data-companion-zone]')?.dataset.companionZone ?? 'prompt';
  const usable = (y: number, r: { top: number; bottom: number }) => y >= 44 && y >= r.top && y <= r.bottom && y <= innerHeight - 4;
  const zones = new Map<string, { left: number; right: number; bottom: number }>();
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
    const paths = [...el.querySelectorAll<SVGPathElement>('.companion-body path')];
    const drawn: number[][] = [];
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const actor: Actor = { position: { x: 0, y: 0 }, floor: '', busy: false, fight: 0, cooldown: 0, direction: 1 };
    actors.current.set(agent, actor);
    let frame = 0, last = 0, measured = -Infinity, nextMove = 0, lastCross = -Infinity, phase = 0, poseSince = 0, shownPose: Pose = 'idle';
    let floors: Floor[] = [], initialized = false, zone = '', seenScene = scene;
    let queue: Step[] = [];
    let drag: { pointer: number; dx: number; dy: number; x: number; y: number; at: number; moved: boolean } | null = null;
    const clamp = (floor: Floor, x: number) => ({ x: Math.max(floor.left, Math.min(floor.right, x)), y: floor.y });
    const rest = (now: number) => { nextMove = now + restDuration(); };
    const tail = () => queue.length ? (queue[queue.length - 1].to ?? tailOf(queue.length - 1)) : actor.position;
    const tailOf = (i: number): Point => { for (; i >= 0; i--) if (queue[i].to) return queue[i].to!; return actor.position; };
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
    const stroll = (pose: 'walk' | 'run', floor: Floor, now: number) => {
      let x = floor.ground && Math.random() < .45 ? (Math.random() < .5 ? floor.left : floor.right) : floor.left + Math.random() * (floor.right - floor.left);
      if (Math.abs(x - actor.position.x) < 24) x = actor.position.x + (x < actor.position.x ? -40 : 40);
      const to = clamp(floor, x);
      if (Math.abs(to.x - actor.position.x) < 8) { rest(now); return; }
      move(pose, to, { onEnd: () => { const side = floor.ground ? atWall(floor, to.x) : null; if (side) wallArrival(floor, side); } });
    };
    const decide = (floor: Floor, now: number) => {
      const waiting = current.current.sessions.some((s) => s.agent === agent && pendingRequests(s) > 0);
      const action = waiting ? 'idle' : chooseAction(Math.random, !!floor.rung);
      if (action === 'hop') {
        const choices = hops(floor, actor.position.x, floors);
        if (choices.length) { landOn(pick(choices), actor.position.x, 'jump'); return; }
        const below = floor.ground ? undefined : dropFloor(actor.position, floors, zone);
        if (below && below.id !== floor.id) { landOn(below, actor.position.x); return; }
      }
      if (action === 'gesture') { hold(pick(GESTURES), undefined, { face: Math.random() < .5 ? -1 : 1 }); return; }
      if (action === 'idle') { rest(now); return; }
      stroll(action === 'run' ? 'run' : 'walk', floor, now);
    };
    const ouch = (clickX: number, now: number) => {
      queue = []; actor.fight = 0; actor.cooldown = now + 8000;
      const floor = floors.find((f) => f.id === actor.floor);
      hold('hurt', GESTURE_DURATION.hurt, { face: clickX >= actor.position.x ? 1 : -1 });
      if (!floor) return;
      let side: Side = clickX > actor.position.x ? 'left' : 'right';
      if (Math.abs((side === 'right' ? floor.right : floor.left) - actor.position.x) < 50) side = side === 'right' ? 'left' : 'right';
      const to = clamp(floor, side === 'right' ? floor.right : floor.left);
      move('flee', to, { onEnd: () => { if (floor.ground && atWall(floor, to.x)) wallArrival(floor, side, true); } });
    };
    const render = (pose: Pose, now: number) => {
      actor.position.x = Math.max(HALF_WIDTH, Math.min(innerWidth - HALF_WIDTH, actor.position.x));
      actor.position.y = Math.max(42, Math.min(innerHeight - 4, actor.position.y));
      el.style.transform = `translate3d(${actor.position.x - HALF_WIDTH}px, ${actor.position.y - FOOT}px, 0)`;
      figure.style.transform = `scale(${SCALE * actor.direction}, ${SCALE})`;
      if (pose !== shownPose) { shownPose = pose; poseSince = now; }
      const bones = skeleton(pose, phase, pose === 'fight' ? now - actor.fight : now - poseSince, agent === 'claude' ? 0 : 1);
      [bones.body, ...bones.legs, ...bones.arms].forEach((d, i) => {
        const target = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
        drawn[i] = target.map((n, j) => drawn[i] ? drawn[i][j] + (n - drawn[i][j]) * .45 : n);
        let j = 0;
        paths[i].setAttribute('d', d.replace(/-?\d+(?:\.\d+)?/g, () => drawn[i][j++].toFixed(2)));
      });
      head.style.transform = `translate(${bones.headX}px, ${bones.headY}px)`;
      el.dataset.pose = pose; el.dataset.floor = actor.floor; el.dataset.zone = zone;
      el.dataset.travel = drag ? 'drag' : queue.length ? queue[0].pose : 'rest';
    };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 30) return;
      last = now;
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
        actor.fight = 0; landOn(landing, actor.position.x); floor = landing;
      }
      const waiting = current.current.sessions.some((s) => s.agent === agent && pendingRequests(s) > 0);
      const peer = actors.current.get(agent === 'claude' ? 'codex' : 'claude');
      if (actor.fight && (now - actor.fight >= 2400 || !peer || peer.busy || peer.floor !== actor.floor || Math.abs(peer.position.x - actor.position.x) > 65)) { actor.fight = 0; rest(now); }
      if (!queue.length && !actor.fight && peer && !peer.busy && !peer.fight && peer.floor === actor.floor && now > actor.cooldown && now > peer.cooldown && Math.abs(peer.position.x - actor.position.x) > 12 && Math.abs(peer.position.x - actor.position.x) < 42) {
        actor.fight = peer.fight = now; actor.cooldown = peer.cooldown = now + 45000;
        actor.direction = peer.position.x > actor.position.x ? 1 : -1; peer.direction = -actor.direction;
      }
      if (!queue.length && !actor.fight && now >= nextMove && floor) decide(floor, now);
      let pose: Pose = actor.fight ? 'fight' : waiting && now % 10000 < 1500 ? 'wave' : 'idle';
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
        pose = step.pose;
        if (p === 1) {
          queue.shift();
          if (step.floor) { actor.floor = step.floor.id; zone = step.floor.zone; }
          step.onEnd?.(now);
          if (!queue.length) { actor.busy = false; rest(now); pose = 'idle'; }
        }
      } else if (floor) {
        actor.position = clamp(floor, actor.position.x); actor.busy = false;
      }
      render(pose, now);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !initialized || drag) return;
      e.preventDefault(); e.stopPropagation();
      drag = { pointer: e.pointerId, dx: actor.position.x - e.clientX, dy: actor.position.y - e.clientY, x: e.clientX, y: e.clientY, at: performance.now(), moved: false };
      el.setPointerCapture(e.pointerId);
    };
    const moveDrag = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      if (!drag.moved) { drag.moved = true; queue = []; actor.fight = 0; actor.busy = true; actor.cooldown = performance.now() + 2500; }
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
      cancelAnimationFrame(frame); drop(); el.style.visibility = 'hidden'; actor.busy = true; actor.fight = 0;
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
        <path /><path opacity=".65" /><path /><path opacity=".65" /><path />
      </svg>
      <div className="companion-head"><AgentIcon agent={agent} size={22} /></div>
    </div>
    <span className="companion-shadow" />
  </div>;
}
