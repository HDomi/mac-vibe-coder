import { useCallback, useEffect, useRef, useState } from 'react';

/** Persisted pane width with a drag handle. `side` is which pane the handle resizes. */
export function usePaneWidth(key: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(() => {
    try { const v = Number(localStorage.getItem(key)); return v >= min && v <= max ? v : initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, String(width)); } catch { /* ignore */ } }, [key, width]);
  const clamp = useCallback((w: number) => Math.min(max, Math.max(min, w)), [min, max]);
  return { width, setWidth: (w: number) => setWidth(clamp(w)) };
}

interface Props {
  /** Called with the pointer's horizontal delta from drag start. */
  onDrag: (dx: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

export default function Splitter({ onDrag, onStart, onEnd }: Props) {
  const startX = useRef(0);
  const [active, setActive] = useState(false);
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    startX.current = e.clientX;
    setActive(true);
    onStart?.();
    const move = (ev: PointerEvent) => onDrag(ev.clientX - startX.current);
    const up = () => { setActive(false); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.cursor = ''; document.body.style.userSelect = ''; onEnd?.(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  return (
    <div onPointerDown={onDown} className={`relative w-px shrink-0 bg-fill/10 cursor-col-resize group ${active ? 'bg-blue-400' : ''}`}>
      <div className="absolute inset-y-0 -left-1 -right-1" />
      <div className={`absolute inset-y-0 left-0 w-px ${active ? 'bg-blue-400' : 'group-hover:bg-blue-400/60'}`} />
    </div>
  );
}
