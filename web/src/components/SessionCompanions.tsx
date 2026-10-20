import { useEffect, useRef } from 'react';
import type { AgentId } from '../lib/agent';
import { pendingRequests, type ChatSession } from '../lib/chatStore';
import AgentIcon from './AgentIcon';

type Floor = { id: string; left: number; right: number; y: number; zone: string };
type Point = { x: number; y: number };
type Wall = { x: number; top: number; bottom: number };
const AGENTS: AgentId[] = ['claude', 'codex'];

/** Read only explicit scenery: chat messages and the input interior are never platforms. */
function scenery() {
  const floors: Floor[] = [], walls: Wall[] = [];
  const visibleRect = (node: HTMLElement) => {
    if (!node.checkVisibility({ checkVisibilityCSS: true })) return null;
    const r = node.getBoundingClientRect();
    let left = Math.max(24, r.left), right = Math.min(innerWidth - 24, r.right);
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
    if (!r || r.right - r.left < 48) return;
    const y = node.dataset.companionEdge === 'bottom' ? r.raw.bottom : r.raw.top;
    if (y < 64 || y < r.top || y > r.bottom || y > innerHeight - 4) return;
    floors.push({ id: node.dataset.companionFloor!, left: r.left + 12, right: r.right - 12, y,
      zone: node.closest<HTMLElement>('[data-companion-zone]')?.dataset.companionZone ?? 'prompt' });
  });
  document.querySelectorAll<HTMLElement>('[data-companion-wall]').forEach((node) => {
    const r = visibleRect(node);
    if (r) walls.push({ x: node.dataset.companionWall === 'left' ? r.raw.left : r.raw.right, top: r.top, bottom: r.bottom });
  });
  return { floors, walls };
}

/** Decorative only: the overlay never captures clicks or changes the selected session. */
export default function SessionCompanions({ sessions, scene = '' }: { sessions: ChatSession[]; scene?: string }) {
  const live = sessions.filter((s) => !s.restoring && s.status !== 'closed' && s.status !== 'starting');
  return <div className="session-companions" aria-hidden="true">
    {AGENTS.filter((agent) => live.some((s) => s.agent === agent)).map((agent) =>
      <Companion key={agent} agent={agent} sessions={live} scene={scene} />)}
  </div>;
}

function Companion({ agent, sessions, scene }: { agent: AgentId; sessions: ChatSession[]; scene: string }) {
  const root = useRef<HTMLDivElement>(null);
  const current = useRef({ sessions, scene });
  current.current = { sessions, scene };

  useEffect(() => {
    const el = root.current!, figure = el.firstElementChild as HTMLElement;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, last = 0, measured = -Infinity, nextMove = 0;
    let world: ReturnType<typeof scenery> = { floors: [], walls: [] };
    let position: Point | null = null, floorId = '', zone = '', seenScene = current.current.scene;
    let direction = 1;
    let flight: { from: Point; to: Point; start: number; duration: number; height: number; flip: boolean; eject: boolean; wall: Wall | undefined } | null = null;
    const landAt = (floor: Floor, x: number) => ({ x: Math.max(floor.left, Math.min(floor.right, x)), y: floor.y });
    const launch = (floor: Floor, now: number, eject = false) => {
      // Give the two heads separate landing lanes so they remain legible together.
      const lane = (agent === 'claude' ? .1 : .55) + Math.random() * .35;
      const target = landAt(floor, floor.left + lane * (floor.right - floor.left));
      const from = position!;
      const wall = world.walls.find((w) => (from.x - w.x) * (target.x - w.x) < 0 && Math.max(from.y, target.y) >= w.top && Math.min(from.y, target.y) <= w.bottom);
      const walking = floor.id === floorId && !eject;
      flight = { from, to: target, start: now, duration: Math.max(650, Math.min(2200, Math.hypot(target.x - from.x, target.y - from.y) * 2.7)),
        height: walking ? 0 : Math.min(Math.max(0, Math.min(from.y, target.y) - 64), eject ? 150 : wall ? 120 : 65),
        flip: !walking && (eject || !!wall || Math.random() > .5), eject, wall };
      floorId = floor.id;
      zone = floor.zone;
      direction = target.x >= from.x ? 1 : -1;
    };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 32) return;
      last = now;
      const changed = seenScene !== current.current.scene;
      if (changed || now - measured > 300) { world = scenery(); measured = now; }
      const prompt = world.floors.find((f) => f.id === 'prompt');
      if (!world.floors.length) { el.style.visibility = 'hidden'; position = null; flight = null; seenScene = current.current.scene; return; }
      el.style.visibility = 'visible';
      if (!position) {
        const floor = prompt ?? world.floors[0];
        position = landAt(floor, floor.left + (floor.right - floor.left) * (agent === 'claude' ? .3 : .7));
        floorId = floor.id; zone = floor.zone;
        nextMove = now + (agent === 'claude' ? 900 : 1800);
      }
      if (changed) {
        seenScene = current.current.scene;
        // A changing right-hand scene throws its residents back onto the composer ledge.
        if (prompt && (zone === 'right' || position.x > (world.walls.find((w) => w.x > prompt.right)?.x ?? Infinity))) launch(prompt, now, true);
      }
      if (!world.floors.some((f) => f.id === floorId)) launch(prompt ?? world.floors[0], now, zone === 'right');
      const own = current.current.sessions.filter((s) => s.agent === agent);
      const waiting = own.some((s) => pendingRequests(s) > 0);
      const busy = own.some((s) => s.status === 'running' || s.status === 'compacting');
      if (!flight && now >= nextMove) {
        const others = world.floors.filter((f) => f.id !== floorId);
        const target = waiting && prompt ? prompt : others.length && Math.random() < .75 ? others[Math.floor(Math.random() * others.length)] : world.floors.find((f) => f.id === floorId)!;
        if (waiting && floorId === target.id) nextMove = now + 1800;
        else launch(target, now);
      }
      let rotation = 0, pose = waiting ? 'wave' : 'idle';
      if (flight) {
        const p = Math.min(1, (now - flight.start) / flight.duration);
        position = { x: flight.from.x + (flight.to.x - flight.from.x) * p,
          y: flight.from.y + (flight.to.y - flight.from.y) * p - 4 * flight.height * p * (1 - p) };
        rotation = flight.flip ? p * 360 : 0;
        pose = flight.eject ? 'eject' : flight.wall && Math.abs(position.x - flight.wall.x) < 30 ? 'vault' : 'run';
        el.dataset.travel = flight.eject ? 'eject' : flight.wall ? 'vault' : flight.height ? 'jump' : 'walk';
        if (p === 1) { flight = null; nextMove = now + (busy ? 550 : 1400 + Math.random() * 1500); }
      } else {
        const floor = world.floors.find((f) => f.id === floorId);
        if (floor) position = landAt(floor, position.x);
        el.dataset.travel = 'rest';
      }
      el.dataset.floor = floorId;
      el.dataset.zone = zone;
      el.dataset.pose = pose;
      // Feet meet the measured border; keep the entire figure inside the viewport.
      position.x = Math.max(24, Math.min(innerWidth - 24, position.x));
      position.y = Math.max(60, Math.min(innerHeight - 4, position.y));
      el.style.transform = `translate3d(${position.x - 24}px, ${position.y - 54}px, 0)`;
      figure.style.transform = `scaleX(${direction}) rotate(${rotation}deg)`;
    };
    const invalidate = () => { measured = -Infinity; };
    const sync = () => {
      cancelAnimationFrame(frame);
      el.style.visibility = 'hidden';
      if (!document.hidden && !motion.matches) { measured = -Infinity; last = 0; flight = null; nextMove = performance.now() + 800; frame = requestAnimationFrame(tick); }
    };
    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('resize', invalidate);
    document.addEventListener('scroll', invalidate, true);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      motion.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('resize', invalidate);
      document.removeEventListener('scroll', invalidate, true);
    };
  }, [agent]);

  return <div ref={root} className={`session-companion session-companion-${agent}`} data-pose="idle" data-agent={agent}>
    <div className="companion-figure">
      <svg width="48" height="60" viewBox="0 0 48 60" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M24 25 L23 39" />
        <g className="companion-arm companion-arm-back"><path d="M24 28 L16 33 L12 29" /></g>
        <g className="companion-arm companion-arm-front"><path d="M24 28 L31 34 L36 29" /></g>
        <g className="companion-leg companion-leg-back"><path d="M23 39 L17 46 L13 54" /></g>
        <g className="companion-leg companion-leg-front"><path d="M23 39 L30 46 L34 54" /></g>
      </svg>
      <div className="companion-head"><AgentIcon agent={agent} size={22} /></div>
    </div>
    <span className="companion-shadow" />
  </div>;
}
