import React, { useEffect, useState } from 'react';
import { api, type UsageSnapshot, type UsageWindow } from '../lib/api';
import { t, useLang } from '../lib/i18n';

export type ViewMode = 'ide' | 'agent';

interface Props { mode: ViewMode; onMode: (m: ViewMode) => void }

function color(remain: number) {
  if (remain > 50) return 'bg-emerald-400';
  if (remain > 20) return 'bg-amber-400';
  return 'bg-red-400';
}

/** "2d 3h 15m" until `ts` (unix seconds); leading zero units are dropped. Null once the window has reset. */
export function untilReset(ts: number, now = Date.now()): string | null {
  const mins = Math.ceil((ts * 1000 - now) / 60000);
  if (mins <= 0) return null;
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function resetLabel(ts: number | null) {
  if (!ts) return t('usage.noReset');
  const left = untilReset(ts);
  return left ? t('usage.resetsAfter', { time: left }) : t('usage.reset');
}

/** Tiny battery: remaining % fills the cell from the left. Hover shows when the window resets. */
export function Battery({ label, win, error, loading }: { label: string; win: UsageWindow | null; error?: string; loading: boolean }) {
  const [hover, setHover] = useState(false);
  const [, tick] = useState(0);
  // Keep the countdown live while the popover is open.
  useEffect(() => {
    if (!hover) return;
    const timer = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(timer);
  }, [hover]);
  const remain = win ? Math.min(100, Math.max(0, 100 - win.usedPct)) : null;
  const title = error
    ? t(win ? 'usage.cached' : 'usage.unavailable', { label, reason: error })
    : win ? t('usage.used', { label, pct: win.usedPct, reset: resetLabel(win.resetsAt) }) : t(loading ? 'usage.loading' : 'usage.unavailable', { label, reason: '' });
  return (
    <div className="titlebar-nodrag relative flex items-center gap-1 cursor-default" aria-label={title} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {hover && (
        <div role="tooltip" className="absolute top-full right-0 mt-2 z-50 whitespace-nowrap rounded-md border border-white/10 bg-[#171a22] px-2.5 py-1.5 text-[11px] text-zinc-200 shadow-xl pointer-events-none">
          {win ? <div className="tabular-nums">{resetLabel(win.resetsAt)}</div> : !error && <div className="text-zinc-400">{t(loading ? 'usage.loading' : 'usage.unavailable', { label, reason: '' })}</div>}
          {error && <div className="text-amber-300">{error}</div>}
        </div>
      )}
      <span className="text-[10px] text-zinc-500">{label}</span>
      <span className="relative inline-flex items-center">
        <span className="w-[18px] h-[9px] rounded-[2px] border border-zinc-500/80 p-px flex">
          <span className={`h-full rounded-[1px] ${remain === null ? 'bg-zinc-600' : color(remain)}`} style={{ width: `${remain ?? 0}%` }} />
        </span>
        <span className="w-[2px] h-[4px] bg-zinc-500/80 rounded-r-[1px] ml-px" />
      </span>
      <span className={`text-[10px] tabular-nums w-7 ${error ? 'text-amber-400' : 'text-zinc-400'}`}>{remain === null ? '—' : `${remain}%`}</span>
    </div>
  );
}

export default function UsageBar({ mode, onMode }: Props) {
  useLang();
  const [u, setU] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();

  const load = (force = false) => {
    setLoading(true);
    api.usage(force).then((data) => { setU(data); setLoadError(undefined); }).catch((err) => setLoadError(err.message)).finally(() => setLoading(false));
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
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-400 font-medium">Claude</span>
            <Battery label="5h" win={u?.claude?.fiveHour ?? null} error={loadError ?? u?.errors.find((e) => e.startsWith('claude:'))} loading={loading} />
            <Battery label={t('usage.week')} win={u?.claude?.weekly ?? null} error={loadError ?? u?.errors.find((e) => e.startsWith('claude:'))} loading={loading} />
            {u?.claude?.model && <Battery label={u.claude.model.name.slice(0, 5)} win={u.claude.model} loading={loading} />}
          </div>
        <span className="text-zinc-700">|</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-400 font-medium">Codex</span>
            <Battery label="5h" win={u?.codex?.fiveHour ?? null} error={loadError ?? u?.errors.find((e) => e.startsWith('codex:'))} loading={loading} />
            <Battery label={t('usage.week')} win={u?.codex?.weekly ?? null} error={loadError ?? u?.errors.find((e) => e.startsWith('codex:'))} loading={loading} />
          </div>
        <button className={`titlebar-nodrag text-zinc-600 hover:text-zinc-300 ${loading ? 'animate-spin' : ''}`} onClick={() => load(true)} title={t('usage.refresh')}>↻</button>
      </div>
    </div>
  );
}
