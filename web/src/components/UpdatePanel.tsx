import { useEffect, useRef, useState } from 'react';
import { api, type UpdateStatus } from '../lib/api';
import { t, useLang } from '../lib/i18n';

/** Small badge for the sidebar header; opens the modal with commit list and apply log. */
export function UpdateBadge() {
  useLang();
  const [st, setSt] = useState<UpdateStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const load = (force = false) => { setChecking(true); return api.updateStatus(force).then(setSt).catch(() => {}).finally(() => setChecking(false)); };
  useEffect(() => {
    load();
    const timer = setInterval(() => load(), 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  const available = !!st?.available;
  const installed = st?.installed;
  return (
    <>
      <button className={`titlebar-nodrag text-[11px] rounded-full px-2 py-0.5 ${available ? 'bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30' : 'text-zinc-600 hover:text-zinc-300'}`}
        onClick={() => setOpen(true)} title={st?.error ?? (available ? t('update.availableTitle', { v: st?.remote?.version ?? '' }) : t('update.upToDateTitle', { v: installed?.version ?? '' }))}>
        {available ? t('update.badgeVersion', { v: st?.remote?.version ?? '' }) : installed ? `v${installed.version}` : '…'}
      </button>
      {open && <UpdateModal status={st} checking={checking} onClose={() => setOpen(false)} onRefresh={() => load(true)} />}
    </>
  );
}

function UpdateModal({ status, checking, onClose, onRefresh }: { status: UpdateStatus | null; checking: boolean; onClose: () => void; onRefresh: () => void }) {
  useLang();
  const [log, setLog] = useState<{ line: string; err: boolean }[]>([]);
  const [phase, setPhase] = useState<'idle' | 'running' | 'restarting' | 'failed'>('idle');
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [log]);

  const apply = (force = false) => {
    setPhase('running'); setLog([]);
    const es = new EventSource(api.updateApplyUrl(force));
    es.addEventListener('start', (e) => setLog((l) => [...l, { line: `$ ${(e as MessageEvent).data}`, err: false }]));
    es.addEventListener('stdout', (e) => setLog((l) => [...l, { line: (e as MessageEvent).data, err: false }]));
    es.addEventListener('stderr', (e) => setLog((l) => [...l, { line: (e as MessageEvent).data, err: true }]));
    es.addEventListener('done', (e) => { if ((e as MessageEvent).data !== '0') { setPhase('failed'); es.close(); } });
    es.addEventListener('restart', () => {
      es.close(); setPhase('restarting');
      // Poll until the server is back, then reload the page.
      const started = Date.now();
      const poll = () => {
        fetch('/api/health').then((r) => { if (r.ok) location.reload(); else throw new Error(); })
          .catch(() => { if (Date.now() - started < 120000) setTimeout(poll, 1000); });
      };
      setTimeout(poll, 2000);
    });
    es.onerror = () => { es.close(); if (phase === 'running') setPhase('failed'); };
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="w-[640px] max-w-[92vw] max-h-[85vh] rounded-xl bg-[#12151c] border border-white/10 shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center px-5 h-12 border-b border-white/10">
          <div className="font-medium">{t('update.title')}</div>
          <div className="flex-1" />
          <button className="text-xs text-zinc-400 hover:text-white mr-3 flex items-center gap-1 disabled:opacity-60" onClick={onRefresh} disabled={checking}>
            <span className={`inline-block ${checking ? 'animate-spin' : ''}`}>↻</span>{checking ? t('update.checking') : t('update.checkAgain')}
          </button>
          <button className="text-zinc-400 hover:text-white" onClick={onClose}>✕</button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto text-sm">
          {!status && !checking && <div className="text-zinc-500">{t('update.checking')}</div>}
          {checking && <div className="text-zinc-500 text-xs">{t('update.checking')}</div>}
          {status?.error && <div className="text-amber-300 text-xs">{status.error}</div>}
          {status && !status.error && (
            <div className="text-xs text-zinc-400 space-y-0.5">
              <div>{t('update.installed')}: <span className="text-zinc-200">v{status.installed.version}</span> <span className="font-mono">{status.installed.commit}</span>{status.installed.builtAt ? ` · ${new Date(status.installed.builtAt).toLocaleString()}` : ''}</div>
              <div>{t('update.pushed')}: <span className="text-zinc-200">v{status.remote?.version ?? '?'}</span> <span className="font-mono">{status.remote?.commit ?? ''}</span> · {status.branch}</div>
              {status.dirty && <div className="text-amber-300">{t('update.dirty')}</div>}
            </div>
          )}
          {status && status.available ? (
            <div className="rounded-lg border border-white/10 divide-y divide-white/5">
              {status.commits.length === 0 && <div className="px-3 py-1.5 text-xs text-zinc-500">{t('update.newBuildAvailable')}</div>}
              {status.commits.map((c) => (
                <div key={c.hash} className="px-3 py-1.5 flex gap-3"><span className="font-mono text-zinc-500 text-xs">{c.hash}</span><span className="truncate">{c.subject}</span></div>
              ))}
            </div>
          ) : status && !status.error ? <div className="text-zinc-400">{t('update.upToDate')}</div> : null}
          <div className="flex gap-2">
            <button disabled={phase === 'running' || phase === 'restarting' || !status || !status.available}
              className="rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 px-3 py-1.5 disabled:opacity-40" onClick={() => apply(false)}>
              {t('update.apply')}
            </button>
            {phase === 'failed' && <button className="rounded bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs" onClick={() => apply(true)}>{t('update.force')}</button>}
          </div>
          {phase === 'restarting' && <div className="text-emerald-300 text-xs animate-pulse">{t('update.restarting')}</div>}
          {log.length > 0 && (
            <div ref={logRef} className="rounded-lg bg-black/50 p-3 font-mono text-[12px] max-h-64 overflow-auto">
              {log.map((l, i) => <div key={i} className={l.err ? 'text-amber-200' : 'text-zinc-300'}>{l.line}</div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
