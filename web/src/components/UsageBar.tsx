import { useEffect, useState } from 'react';
import { api, type UsageSnapshot, type UsageWindow } from '../lib/api';
import { UpdateBadge } from './UpdatePanel';

function color(remain: number) {
  if (remain > 50) return 'bg-emerald-400';
  if (remain > 20) return 'bg-amber-400';
  return 'bg-red-400';
}

function resetLabel(ts: number | null) {
  if (!ts) return '';
  const diff = ts * 1000 - Date.now();
  if (diff <= 0) return 'reset';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `resets in ${h}h ${m}m` : `resets in ${m}m`;
}

function Pill({ label, win }: { label: string; win: UsageWindow | null }) {
  if (!win) return null;
  const remain = Math.max(0, 100 - win.usedPct);
  return (
    <div className="flex items-center gap-1.5" title={`${label}: ${win.usedPct}% used · ${resetLabel(win.resetsAt)}`}>
      <span className="text-[10px] text-zinc-500 font-medium">{label}</span>
      <div className="w-10 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full ${color(remain)}`} style={{ width: `${remain}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-zinc-300">{remain}</span>
    </div>
  );
}

export default function UsageBar() {
  const [u, setU] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const load = (force = false) => {
    setLoading(true);
    api.usage(force).then(setU).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    const t = setInterval(() => load(), 5 * 60 * 1000);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  return (
    <div className="titlebar-drag h-9 shrink-0 flex items-center justify-center gap-5 border-b border-white/10 bg-[#0e1117] text-xs select-none relative">
      <div className="absolute right-3 top-0 h-full flex items-center"><UpdateBadge /></div>
      {u?.claude && (
        <div className="flex items-center gap-3">
          <span className="text-zinc-400 font-medium">Claude</span>
          <Pill label="5h" win={u.claude.fiveHour} />
          <Pill label="week" win={u.claude.weekly} />
          {u.claude.model && <Pill label={u.claude.model.name} win={u.claude.model} />}
        </div>
      )}
      {u?.claude && u?.codex && <span className="text-zinc-700">|</span>}
      {u?.codex && (
        <div className="flex items-center gap-3">
          <span className="text-zinc-400 font-medium">Codex</span>
          <Pill label="5h" win={u.codex.fiveHour} />
          <Pill label="week" win={u.codex.weekly} />
        </div>
      )}
      {u && !u.claude && !u.codex && <span className="text-zinc-600">No usage data{u.errors.length ? ` · ${u.errors[0]}` : ''}</span>}
      <button className={`titlebar-nodrag text-zinc-600 hover:text-zinc-300 ${loading ? 'animate-spin' : ''}`} onClick={() => load(true)} title="Refresh usage">↻</button>
    </div>
  );
}
