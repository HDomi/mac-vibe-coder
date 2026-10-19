import { useEffect, useState } from 'react';
import { api, type UsageSnapshot, type UsageWindow } from '../lib/api';
import { t, useLang } from '../lib/i18n';

export type ViewMode = 'ide' | 'agent';

interface Props { mode: ViewMode; onMode: (m: ViewMode) => void }

function color(remain: number) {
  if (remain > 50) return 'bg-emerald-400';
  if (remain > 20) return 'bg-amber-400';
  return 'bg-red-400';
}

function resetLabel(ts: number | null) {
  if (!ts) return '';
  const diff = ts * 1000 - Date.now();
  if (diff <= 0) return t('usage.reset');
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? t('usage.resetsIn', { h, m }) : t('usage.resetsInM', { m });
}

/** Tiny battery: remaining % fills the cell from the left. */
function Battery({ label, win }: { label: string; win: UsageWindow | null }) {
  if (!win) return null;
  const remain = Math.max(0, 100 - win.usedPct);
  return (
    <div className="flex items-center gap-1" title={t('usage.used', { label, pct: win.usedPct, reset: resetLabel(win.resetsAt) })}>
      <span className="text-[10px] text-zinc-500">{label}</span>
      <span className="relative inline-flex items-center">
        <span className="w-[18px] h-[9px] rounded-[2px] border border-zinc-500/80 p-px flex">
          <span className={`h-full rounded-[1px] ${color(remain)}`} style={{ width: `${remain}%` }} />
        </span>
        <span className="w-[2px] h-[4px] bg-zinc-500/80 rounded-r-[1px] ml-px" />
      </span>
      <span className="text-[10px] tabular-nums text-zinc-400 w-7">{remain}%</span>
    </div>
  );
}

export default function UsageBar({ mode, onMode }: Props) {
  useLang();
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
    <div className="titlebar-drag h-9 shrink-0 flex items-center border-b border-white/10 bg-[#0e1117] text-xs select-none relative">
      {/* Mode switch, centered */}
      <div className="absolute left-1/2 -translate-x-1/2 titlebar-nodrag flex items-center rounded-md bg-white/5 p-0.5">
        {(['ide', 'agent'] as ViewMode[]).map((m) => (
          <button key={m} onClick={() => onMode(m)}
            className={`px-3 py-0.5 rounded text-[11px] font-medium transition-colors ${mode === m ? 'bg-white/15 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {m === 'ide' ? t('usage.ide') : t('usage.agent')}
          </button>
        ))}
      </div>
      {/* Usage batteries, right-aligned */}
      <div className="ml-auto flex items-center gap-3 pr-3">
        {u?.claude && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-400 font-medium">Claude</span>
            <Battery label="5h" win={u.claude.fiveHour} />
            <Battery label={t('usage.week')} win={u.claude.weekly} />
            {u.claude.model && <Battery label={u.claude.model.name.slice(0, 5)} win={u.claude.model} />}
          </div>
        )}
        {u?.claude && u?.codex && <span className="text-zinc-700">|</span>}
        {u?.codex && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-400 font-medium">Codex</span>
            <Battery label="5h" win={u.codex.fiveHour} />
            <Battery label={t('usage.week')} win={u.codex.weekly} />
          </div>
        )}
        {u && !u.claude && !u.codex && <span className="text-zinc-600">{t('usage.noData')}{u.errors.length ? ` · ${u.errors[0]}` : ''}</span>}
        <button className={`titlebar-nodrag text-zinc-600 hover:text-zinc-300 ${loading ? 'animate-spin' : ''}`} onClick={() => load(true)} title={t('usage.refresh')}>↻</button>
      </div>
    </div>
  );
}
