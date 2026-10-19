import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

interface Hit { path: string; rel: string; isDir: boolean }

interface Props {
  cwd: string;
  onClose: () => void;
  onOpen: (hit: Hit) => void;
  onAttach: (hit: Hit) => void;
}

/** ⌘P: fuzzy file search inside the project. Enter opens, ⌘Enter attaches to chat. */
export default function QuickOpen({ cwd, onClose, onOpen, onAttach }: Props) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLoading(true);
      api.search(cwd, q).then((h) => { setHits(h); setIdx(0); }).catch(() => setHits([])).finally(() => setLoading(false));
    }, 120);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [q, cwd]);

  useEffect(() => { listRef.current?.children[idx]?.scrollIntoView({ block: 'nearest' }); }, [idx]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(hits.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const h = hits[idx]; if (h) { (e.metaKey || e.ctrlKey ? onAttach : onOpen)(h); onClose(); } }
    else if (e.key === 'Escape') onClose();
  };

  return (
    <div className="absolute inset-0 z-30 bg-black/50 flex items-start justify-center pt-[12vh]" onClick={onClose}>
      <div className="w-[640px] max-w-[92vw] rounded-xl bg-[#12151c] border border-white/10 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search files in project…  (Enter: preview · ⌘Enter: attach to chat)"
          className="w-full bg-transparent px-4 py-3 text-sm outline-none border-b border-white/10" />
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {hits.map((h, i) => (
            <div key={h.path} onMouseEnter={() => setIdx(i)} onClick={() => { onOpen(h); onClose(); }}
              className={`px-4 py-1.5 text-sm flex items-center gap-2 cursor-pointer ${i === idx ? 'bg-blue-500/20' : ''}`}>
              <span>{h.isDir ? '📁' : '📄'}</span>
              <span className="truncate flex-1 font-mono text-[13px]">{h.rel}</span>
              {i === idx && !h.isDir && <button className="text-[10px] text-zinc-400 hover:text-white" onClick={(e) => { e.stopPropagation(); onAttach(h); onClose(); }}>attach</button>}
            </div>
          ))}
          {!loading && hits.length === 0 && <div className="px-4 py-3 text-xs text-zinc-500">No matches</div>}
          {loading && hits.length === 0 && <div className="px-4 py-3 text-xs text-zinc-500">Searching…</div>}
        </div>
      </div>
    </div>
  );
}
