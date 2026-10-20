import { useEffect, useRef, type MutableRefObject } from 'react';
import type { AgentId } from '../lib/agent';
import { pendingRequests, type ChatSession } from '../lib/chatStore';
import AgentIcon from './AgentIcon';

import { chooseAction, destinations, dropFloor, FOOT, HALF_WIDTH, restDuration, SCALE, skeleton, type Floor, type Point, type Pose } from '../lib/companionMotion';
type Actor = { position: Point; floor: string; busy: boolean; fight: number; cooldown: number; direction: number };
const AGENTS: AgentId[] = ['claude', 'codex'];

/** Read only explicit scenery: chat messages and the input interior are never platforms. */
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
  document.querySelectorAll<HTMLElement>('[data-companion-floor]').forEach((node) => {
    const r = visibleRect(node);
    if (!r || r.right - r.left < 34) return;
    const y = node.dataset.companionEdge === 'bottom' ? r.raw.bottom : r.raw.top;
    if (y < 44 || y < r.top || y > r.bottom || y > innerHeight - 4) return;
    floors.push({ id: node.dataset.companionFloor!, left: r.left + 12, right: r.right - 12, y,
      zone: node.closest<HTMLElement>('[data-companion-zone]')?.dataset.companionZone ?? 'prompt' });
  });
  return floors;
}

/** Only the small figures accept pointer input; the rest of the overlay is transparent to clicks. */
export default function SessionCompanions({ sessions, scene = '' }: { sessions: ChatSession[]; scene?: string }) {
  const actors = useRef(new Map<AgentId, Actor>());
  const live = sessions.filter((s) => !s.restoring && s.status !== 'closed' && s.status !== 'starting');
  return <div className="session-companions">
    {AGENTS.filter((agent) => live.some((s) => s.agent === agent)).map((agent) =>
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
    let frame = 0, last = 0, measured = -Infinity, nextMove = 0, lastTravel = -Infinity, phase = 0;
    let floors: Floor[] = [], initialized = false, zone = '', seenScene = scene;
    let drag: { pointer: number; dx: number; dy: number } | null = null;
    let flight: { from: Point; to: Point; start: number; duration: number; pose: Pose; height: number } | null = null;
    const clamp = (floor: Floor, x: number) => ({ x: Math.max(floor.left, Math.min(floor.right, x)), y: floor.y });
    const rest = (now: number) => { nextMove = now + restDuration(); };
    const launch = (floor: Floor, now: number, pose: Pose, x?: number) => {
      const from = { ...actor.position };
      const target = clamp(floor, x ?? floor.left + (agent === 'claude' ? .3 : .7) * (floor.right - floor.left));
      const grounded = pose === 'walk' || pose === 'run';
      flight = { from, to: target, start: now, pose,
        duration: grounded ? Math.max(700, Math.abs(target.x - from.x) / (pose === 'walk' ? 24 : 55) * 1000) : Math.max(600, Math.min(1800, Math.hypot(target.x - from.x, target.y - from.y) * 2)),
        height: grounded ? 0 : Math.min(75, Math.max(0, Math.min(from.y, target.y) - 44)) };
      actor.floor = floor.id; actor.busy = true; actor.fight = 0;
      actor.direction = target.x >= from.x ? 1 : -1;
      zone = floor.zone;
      if (!grounded) lastTravel = now;
    };
    const render = (pose: Pose, now: number) => {
      actor.position.x = Math.max(HALF_WIDTH, Math.min(innerWidth - HALF_WIDTH, actor.position.x));
      actor.position.y = Math.max(42, Math.min(innerHeight - 4, actor.position.y));
      el.style.transform = `translate3d(${actor.position.x - HALF_WIDTH}px, ${actor.position.y - FOOT}px, 0)`;
      // No spinning the whole body: jump poses tuck the limbs, landing restores planted feet.
      figure.style.transform = `scale(${SCALE * actor.direction}, ${SCALE})`;
      const poseTime = pose === 'fight' ? now - actor.fight : now;
      const bones = skeleton(pose, phase, poseTime, agent === 'claude' ? 0 : 1);
      [bones.body, ...bones.legs, ...bones.arms].forEach((d, i) => {
        const target = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
        drawn[i] = target.map((n, j) => drawn[i] ? drawn[i][j] + (n - drawn[i][j]) * .45 : n);
        let j = 0;
        paths[i].setAttribute('d', d.replace(/-?\d+(?:\.\d+)?/g, () => drawn[i][j++].toFixed(2)));
      });
      head.style.transform = `translate(${bones.headX}px, ${bones.headY}px)`;
      el.dataset.pose = pose; el.dataset.floor = actor.floor; el.dataset.zone = zone;
      el.dataset.travel = drag ? 'drag' : flight ? flight.pose : 'rest';
    };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 30) return;
      const dt = Math.min(64, now - last); last = now;
      const changed = seenScene !== current.current.scene;
      if (changed || now - measured > 300) { floors = scenery(); measured = now; }
      if (!floors.length) { el.style.visibility = 'hidden'; initialized = false; actor.busy = true; return; }
      el.style.visibility = 'visible';
      const prompt = floors.find((f) => f.id === 'prompt');
      if (!initialized) {
        const floor = prompt ?? floors[0];
        actor.position = clamp(floor, floor.left + (agent === 'claude' ? .35 : .65) * (floor.right - floor.left));
        actor.floor = floor.id; zone = floor.zone; initialized = true; actor.busy = false; flight = null; rest(now);
      }
      if (changed) {
        seenScene = current.current.scene;
        if (!drag && prompt && zone === 'right') launch(prompt, now, 'eject');
      }
      if (drag) { render('drag', now); return; }
      if (!floors.some((f) => f.id === actor.floor)) {
        // Missing scenery returns through the prompt, never straight into the opposite panel.
        const safe = prompt ?? floors.find((f) => f.zone === zone);
        if (!safe) { el.style.visibility = 'hidden'; actor.busy = true; return; }
        launch(safe, now, 'jump');
      }
      const floor = floors.find((f) => f.id === actor.floor)!;
      const waiting = current.current.sessions.some((s) => s.agent === agent && pendingRequests(s) > 0);
      const peer = actors.current.get(agent === 'claude' ? 'codex' : 'claude');
      if (actor.fight && (now - actor.fight >= 2400 || !peer || peer.busy || peer.floor !== actor.floor || Math.abs(peer.position.x - actor.position.x) > 65)) { actor.fight = 0; rest(now); }
      if (!flight && !actor.fight && peer && !peer.busy && !peer.fight && peer.floor === actor.floor && now > actor.cooldown && now > peer.cooldown && Math.abs(peer.position.x - actor.position.x) > 12 && Math.abs(peer.position.x - actor.position.x) < 42) {
        actor.fight = peer.fight = now; actor.cooldown = peer.cooldown = now + 45000;
        actor.direction = peer.position.x > actor.position.x ? 1 : -1; peer.direction = -actor.direction;
      }
      if (!flight && !actor.fight && now >= nextMove) {
        const action = waiting ? 'idle' : chooseAction(now - lastTravel > 60000);
        const choices = destinations(floor, floors);
        if (action === 'jump' && choices.length) launch(choices[Math.floor(Math.random() * choices.length)], now, 'jump');
        else if (action === 'walk' || action === 'run') {
          const x = actor.position.x + (Math.random() < .5 ? -1 : 1) * (action === 'walk' ? 22 + Math.random() * 35 : 45 + Math.random() * 40);
          if (Math.abs(clamp(floor, x).x - actor.position.x) > 8) launch(floor, now, action, x); else rest(now);
        } else rest(now);
      }
      let pose: Pose = actor.fight ? 'fight' : waiting && now % 10000 < 1500 ? 'wave' : 'idle';
      if (flight) {
        const p = Math.min(1, (now - flight.start) / flight.duration), eased = p * p * (3 - 2 * p);
        const oldX = actor.position.x;
        actor.position = { x: flight.from.x + (flight.to.x - flight.from.x) * eased,
          y: flight.from.y + (flight.to.y - flight.from.y) * eased - Math.sin(Math.PI * p) * flight.height };
        // Distance-driven cadence decelerates with the body instead of skating on landing.
        phase += Math.abs(actor.position.x - oldX) / (flight.pose === 'run' ? 22 : 14) * Math.PI * 2;
        pose = flight.pose;
        if (p === 1) { flight = null; actor.busy = false; rest(now); pose = 'idle'; }
      } else {
        actor.position = clamp(floor, actor.position.x); actor.busy = false;
        if (pose === 'idle') phase += dt / 4000;
      }
      render(pose, now);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !initialized || drag) return;
      e.preventDefault(); e.stopPropagation();
      drag = { pointer: e.pointerId, dx: actor.position.x - e.clientX, dy: actor.position.y - e.clientY };
      flight = null; actor.fight = 0; actor.busy = true; actor.cooldown = performance.now() + 3000;
      el.setPointerCapture(e.pointerId); render('drag', performance.now());
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      actor.position = { x: e.clientX + drag.dx, y: e.clientY + drag.dy }; render('drag', performance.now());
    };
    const drop = () => {
      if (!drag) return;
      const pointer = drag.pointer; drag = null;
      if (el.hasPointerCapture(pointer)) el.releasePointerCapture(pointer);
      floors = scenery(); measured = performance.now();
      const floor = dropFloor(actor.position, floors);
      if (floor) {
        launch(floor, performance.now(), 'jump', actor.position.x);
        flight!.height = 0;
        flight!.duration = Math.max(180, Math.min(700, Math.sqrt(Math.abs(floor.y - actor.position.y) / 600) * 1000));
      }
      else { initialized = false; actor.busy = true; }
    };
    const invalidate = () => { measured = -Infinity; };
    const sync = () => {
      cancelAnimationFrame(frame); drop(); el.style.visibility = 'hidden'; actor.busy = true; actor.fight = 0;
      if (!document.hidden && !media.matches) { measured = -Infinity; last = 0; flight = null; actor.busy = false; rest(performance.now()); frame = requestAnimationFrame(tick); }
    };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', drop); el.addEventListener('pointercancel', drop); el.addEventListener('lostpointercapture', drop);
    window.addEventListener('blur', drop);
    media.addEventListener('change', sync); document.addEventListener('visibilitychange', sync);
    window.addEventListener('resize', invalidate); document.addEventListener('scroll', invalidate, true);
    sync();
    return () => {
      cancelAnimationFrame(frame); actors.current.delete(agent);
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
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
