import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type GitBranch, type GitCommit, type GitFile, type GitStatus } from '../lib/api';
import { t, useLang } from '../lib/i18n';
import CommitGraph from './CommitGraph';

interface Props { cwd: string | null; visible: boolean }

const CODE: Record<string, string> = { M: 'mod', A: 'add', D: 'del', R: 'ren', C: 'copy', U: 'conf', '?': 'new' };
const PAGE = 30;

function DiffView({ text }: { text: string }) {
  useLang();
  if (!text) return <div className="p-3 text-xs text-zinc-500">{t('git.noChanges')}</div>;
  return (
    <pre className="p-3 text-[12px] font-mono leading-relaxed whitespace-pre overflow-auto">
      {text.split('\n').map((l, i) => (
        <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'bg-emerald-500/10 text-emerald-200' : l.startsWith('-') && !l.startsWith('---') ? 'bg-red-500/10 text-red-200' : l.startsWith('@@') ? 'text-blue-300' : 'text-zinc-400'}>{l || ' '}</div>
      ))}
    </pre>
  );
}

/** Sticky section header: colored marker, title, count pill, optional actions on the right. */
function SectionHeader({ color, title, count, children }: { color: string; title: string; count?: number; children?: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 px-3 h-8 bg-[#12151c]/95 backdrop-blur border-b border-white/5 text-[11px]">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      <span className="font-medium tracking-wide text-zinc-300">{title}</span>
      {count !== undefined && <span className="min-w-[18px] px-1.5 py-px rounded-full bg-white/5 text-[10px] text-zinc-400 text-center font-mono">{count}</span>}
      <div className="flex-1" />
      <div className="flex items-center gap-2 text-[10px] text-zinc-500">{children}</div>
    </div>
  );
}

export default function GitPanel({ cwd, visible }: Props) {
  useLang();
  const [st, setSt] = useState<GitStatus | null>(null);
  const [sel, setSel] = useState<{ path: string; staged: boolean } | null>(null);
  const [diff, setDiff] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [log, setLog] = useState<GitCommit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [remoteBusy, setRemoteBusy] = useState<string | null>(null);
  const logRef = useRef<GitCommit[]>([]);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  useEffect(() => { logRef.current = log; }, [log]);

  const refresh = useCallback(() => {
    if (!cwd) return;
    api.gitStatus(cwd).then(setSt).catch(() => setSt(null));
    api.gitBranches(cwd).then(setBranches).catch(() => setBranches([]));
    // First page only. Pages already scrolled in are kept when the head is unchanged.
    api.gitLog(cwd, 0, PAGE).then((r) => {
      const cur = logRef.current;
      if (cur.length > r.commits.length && JSON.stringify(cur.slice(0, r.commits.length)) === JSON.stringify(r.commits)) return;
      setLog(r.commits); setHasMore(r.hasMore);
    }).catch(() => { setLog([]); setHasMore(false); });
  }, [cwd]);

  const loadMore = useCallback(() => {
    if (!cwd || loadingRef.current) return;
    loadingRef.current = true; setLoadingMore(true);
    const skip = logRef.current.length;
    api.gitLog(cwd, skip, PAGE).then((r) => {
      setLog((prev) => {
        const seen = new Set(prev.map((c) => c.hash));
        return [...prev, ...r.commits.filter((c) => !seen.has(c.hash))];
      });
      setHasMore(r.hasMore);
    }).catch(() => setHasMore(false)).finally(() => { loadingRef.current = false; setLoadingMore(false); });
  }, [cwd]);

  // Reset paging when the project changes.
  useEffect(() => { setLog([]); setHasMore(false); setSel(null); }, [cwd]);
  useEffect(() => { if (visible) refresh(); }, [visible, refresh]);
  useEffect(() => {
    if (!visible || !cwd) return;
    const timer = setInterval(refresh, 8000);
    return () => clearInterval(timer);
  }, [visible, cwd, refresh]);
  useEffect(() => {
    if (!cwd || !sel) { setDiff(''); return; }
    api.gitDiff(cwd, sel.path, sel.staged).then(setDiff).catch(() => setDiff(''));
  }, [cwd, sel]);

  // Infinite scroll: fetch the next page when the sentinel enters the commit list's viewport.
  useEffect(() => {
    const el = sentinelRef.current, root = scrollRef.current;
    if (!el || !root || !hasMore || sel) return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { root, rootMargin: '200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, sel, loadMore, log.length]);

  if (!cwd) return <div className="h-full flex items-center justify-center text-zinc-600 text-sm">{t('git.openProject')}</div>;
  if (st && !st.repo) return <div className="h-full flex items-center justify-center text-zinc-600 text-sm">{t('git.notRepo')}</div>;

  const staged = st?.files.filter((f) => f.staged) ?? [];
  const unstaged = st?.files.filter((f) => !f.staged || f.worktree !== ' ') ?? [];
  const stage = (files: GitFile[], action: 'add' | 'reset' | 'discard') => {
    if (!files.length) return;
    if (action === 'discard' && !window.confirm(t('git.confirmDiscard', { n: files.length }))) return;
    setBusy(true);
    api.gitStage(cwd, files.map((f) => f.path), action).then(refresh).finally(() => setBusy(false));
  };
  const commit = () => {
    if (!msg.trim() || !staged.length) return;
    setBusy(true); setNote(null);
    api.gitCommit(cwd, msg.trim()).then((r) => { setNote(r.output); if (r.ok) setMsg(''); refresh(); }).finally(() => setBusy(false));
  };

  const remote = (op: 'fetch' | 'pull' | 'push') => {
    setRemoteBusy(op); setNote(null);
    api.gitRemote(cwd, op).then((r) => setNote(`${op}: ${r.ok ? t('git.ok') : t('git.failed')} ${r.output.split('\n').slice(-1)[0] ?? ''}`)).catch((e) => setNote(`${op} ${t('git.failed')}: ${e.message}`)).finally(() => { setRemoteBusy(null); refresh(); });
  };
  const checkout = (value: string) => {
    if (!value) return;
    if (value === '__new__') {
      const name = window.prompt(t('git.newBranchPrompt'));
      if (!name) return;
      setBusy(true);
      api.gitCheckout(cwd, name.trim(), true).then((r) => setNote(r.output.split('\n')[0] ?? '')).finally(() => { setBusy(false); refresh(); });
      return;
    }
    setBusy(true);
    api.gitCheckout(cwd, value).then((r) => setNote(r.output.split('\n')[0] ?? '')).finally(() => { setBusy(false); refresh(); });
  };

  const Row = ({ f, isStaged }: { f: GitFile; isStaged: boolean }) => {
    const code = isStaged ? f.index : (f.untracked ? '?' : f.worktree);
    const tone = f.untracked || code === 'A' ? 'text-emerald-300 bg-emerald-500/10' : code === 'D' ? 'text-red-300 bg-red-500/10' : 'text-amber-300 bg-amber-500/10';
    const active = sel?.path === f.path && sel.staged === isStaged;
    return (
      <div className={`group flex items-center gap-2 px-3 py-1 text-xs cursor-pointer border-l-2 ${active ? 'bg-blue-500/15 border-blue-400' : 'border-transparent hover:bg-white/5'}`} onClick={() => setSel({ path: f.path, staged: isStaged })}>
        <span className={`w-9 text-center text-[9px] font-mono rounded px-1 py-px ${tone}`}>{CODE[code] ?? ''}</span>
        <span className="truncate flex-1 font-mono text-zinc-300" title={f.path}>{f.path}</span>
        <button className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-white w-5 h-5 rounded hover:bg-white/10" title={isStaged ? t('git.unstage') : t('git.stage')} onClick={(e) => { e.stopPropagation(); stage([f], isStaged ? 'reset' : 'add'); }}>{isStaged ? '−' : '＋'}</button>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col text-sm">
      <div className="h-9 shrink-0 flex items-center gap-2 px-2 border-b border-white/10 text-xs">
        <select value={st?.branch ?? ''} onChange={(e) => checkout(e.target.value)} disabled={busy || !!remoteBusy} title={t('git.switchBranch')}
          className="bg-white/5 rounded-md px-1.5 py-1 outline-none max-w-[45%] font-medium text-zinc-200">
          {st?.branch && !branches.some((b) => b.name === st.branch) && <option value={st.branch}>{st.branch}</option>}
          {branches.filter((b) => !b.remote).map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
          {branches.some((b) => b.remote) && <optgroup label={t('git.remote')}>{branches.filter((b) => b.remote).map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}</optgroup>}
          <option value="__new__">{t('git.newBranch')}</option>
        </select>
        {st && (st.ahead > 0 || st.behind > 0) && <span className="text-zinc-500 whitespace-nowrap font-mono">↑{st.ahead} ↓{st.behind}</span>}
        <div className="flex-1" />
        {(['fetch', 'pull', 'push'] as const).map((op) => (
          <button key={op} disabled={!!remoteBusy || busy} onClick={() => remote(op)}
            className={`px-2 py-1 rounded hover:bg-white/10 disabled:opacity-40 ${remoteBusy === op ? 'text-amber-300 animate-pulse' : 'text-zinc-300'}`}>{op}</button>
        ))}
        <button className="text-zinc-400 hover:text-white px-1" onClick={refresh} disabled={busy} title={t('common.refresh')}>↻</button>
      </div>
      {note && <div className="px-3 py-1 text-[11px] text-amber-200 border-b border-white/5 truncate" title={note}>{note}</div>}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="max-h-[45%] overflow-y-auto border-b border-white/10">
          <SectionHeader color="bg-emerald-400" title={t('git.stagedTitle')} count={staged.length}>
            {staged.length > 0 && <button className="hover:text-white" onClick={() => stage(staged, 'reset')}>{t('git.unstageAll')}</button>}
          </SectionHeader>
          {staged.length === 0 ? <div className="px-3 py-2 text-[11px] text-zinc-600">{t('git.nothingStaged')}</div> : <div className="py-1">{staged.map((f) => <Row key={'s' + f.path} f={f} isStaged />)}</div>}
          <SectionHeader color="bg-amber-400" title={t('git.changesTitle')} count={unstaged.length}>
            {unstaged.length > 0 && <>
              <button className="hover:text-white" onClick={() => stage(unstaged, 'add')}>{t('git.stageAll')}</button>
              {unstaged.some((f) => !f.untracked) && <button className="hover:text-red-300" onClick={() => stage(unstaged.filter((f) => !f.untracked), 'discard')}>{t('git.discard')}</button>}
            </>}
          </SectionHeader>
          {st && unstaged.length === 0 ? <div className="px-3 py-2 text-[11px] text-zinc-600">{t('git.clean')}</div> : <div className="py-1">{unstaged.map((f) => <Row key={'u' + f.path} f={f} isStaged={false} />)}</div>}
        </div>
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto bg-[#0b0d12]">
          {sel ? (
            <>
              <SectionHeader color="bg-blue-400" title={sel.path}>
                <button className="hover:text-white" onClick={() => setSel(null)}>✕ {t('git.closeDiff')}</button>
              </SectionHeader>
              <DiffView text={diff} />
            </>
          ) : (
            <>
              <SectionHeader color="bg-violet-400" title={t('git.recentCommits')} count={log.length}>
                {!hasMore && log.length > 0 && <span>{t('git.allLoaded')}</span>}
              </SectionHeader>
              {log.length === 0 && <div className="px-3 py-3 text-[11px] text-zinc-600">{t('git.noCommits')}</div>}
              <CommitGraph commits={log} />
              <div ref={sentinelRef} className="px-3 py-2 text-[10px] text-zinc-600 text-center">
                {loadingMore ? <span className="animate-pulse">{t('git.loadingMore')}</span> : hasMore ? <button className="hover:text-zinc-300" onClick={loadMore}>{t('git.loadMore')}</button> : null}
              </div>
            </>
          )}
        </div>
        <div className="shrink-0 border-t border-white/10 bg-[#12151c]">
          <div className="flex items-center gap-2 px-3 h-7 text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
            <span className="font-medium tracking-wide text-zinc-300">{t('git.commitTitle')}</span>
            {st?.branch && <span className="font-mono text-[10px] text-zinc-500 truncate">· {st.branch}</span>}
          </div>
          <div className="px-2 pb-2 space-y-2">
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} placeholder={t('git.commitPlaceholder')}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); commit(); } }}
              className="w-full bg-[#0b0d12] rounded-md border border-white/10 focus:border-sky-400/40 px-2 py-1.5 text-xs outline-none resize-none font-mono" />
            <div className="flex items-center gap-2">
              <button disabled={busy || !msg.trim() || !staged.length} className="rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-xs px-3 py-1.5 disabled:opacity-40" onClick={commit}>{t('git.commit', { n: staged.length })}</button>
              <button disabled={busy || !msg.trim() || !staged.length || !!remoteBusy} className="rounded bg-white/5 hover:bg-white/10 text-xs px-3 py-1.5 disabled:opacity-40"
                onClick={() => { setBusy(true); api.gitCommit(cwd, msg.trim()).then((r) => { if (r.ok) { setMsg(''); remote('push'); } else setNote(r.output); }).finally(() => setBusy(false)); }}>{t('git.commitPush')}</button>
              <span className="ml-auto text-[10px] text-zinc-600">⌘↩</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
