import { useEffect, useState } from 'react';
import { api, type WorktreeInfo, type WorktreeStatus } from '../lib/api';
import { t, useLang } from '../lib/i18n';
import Icon from './Icon';
import { toast } from './Toast';

/** Start screen: worktrees left behind by closed sessions, to reopen, merge or discard. */
export default function LeftoverWorktrees({ cwd, open, onOpen }: { cwd: string; open: string[]; onOpen: (wt: WorktreeInfo) => void }) {
  useLang();
  const [list, setList] = useState<(WorktreeInfo & { st?: WorktreeStatus })[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => api.worktreeList(cwd).then(async (rows) => {
    setList(rows);
    const withSt = await Promise.all(rows.map(async (w) => ({ ...w, st: await api.worktreeStatus(w).catch(() => undefined) })));
    setList(withSt);
  }).catch(() => setList([]));
  useEffect(() => { void load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [cwd]);
  const shown = list.filter((w) => !open.includes(w.path));
  if (!shown.length) return null;
  const merge = async (w: WorktreeInfo) => {
    setBusy(w.path);
    try {
      const r = await api.worktreeMerge(w, w.branch);
      if (r.ok) toast(r.merged ? t('worktree.merged', { branch: w.branch, base: w.baseBranch ?? '' }) : t('worktree.removedOnly'));
      else toast(r.reason && r.reason !== 'git' ? t(`worktree.err.${r.reason}`, { base: w.baseBranch ?? '' }) : r.message, 'error');
      await load();
    } finally { setBusy(null); }
  };
  const discard = async (w: WorktreeInfo & { st?: WorktreeStatus }) => {
    if (!window.confirm(t('worktree.confirmDiscard', { branch: w.branch, n: w.st?.dirty.length ?? 0, ahead: w.st?.ahead ?? 0 }))) return;
    setBusy(w.path);
    try { await api.worktreeRemove(w, true); await load(); } finally { setBusy(null); }
  };
  return (
    <div className="mb-6 rounded-lg border border-violet-400/15 p-3 text-[12px]">
      <div className="flex items-center gap-2 mb-2 text-zinc-300"><Icon name="branch" size={13} className="text-violet-300" />{t('worktree.leftover')}<span className="text-zinc-500">{shown.length}</span></div>
      <div className="space-y-1">
        {shown.map((w) => (
          <div key={w.path} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/[0.03]">
            <span className="font-mono text-violet-200 truncate min-w-0" title={w.path}>{w.branch}</span>
            {w.baseBranch && <span className="shrink-0 text-zinc-600">← {w.baseBranch}</span>}
            {w.st && <span className="shrink-0 text-[11px] text-zinc-500">{t('worktree.commits', { n: w.st.ahead })} · {t('worktree.uncommitted', { n: w.st.dirty.length })}</span>}
            <div className="flex-1" />
            <button disabled={!!busy} onClick={() => onOpen(w)} className="shrink-0 rounded px-1.5 py-0.5 text-zinc-300 hover:bg-white/10 disabled:opacity-40">{t('worktree.openSession')}</button>
            <button disabled={!!busy || !w.baseBranch} onClick={() => void merge(w)} className="shrink-0 rounded px-1.5 py-0.5 text-violet-200 hover:bg-violet-400/15 disabled:opacity-40">{t('worktree.commitMerge')}</button>
            <button disabled={!!busy} onClick={() => void discard(w)} className="shrink-0 rounded px-1.5 py-0.5 text-zinc-500 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-40">{t('worktree.discard')}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
