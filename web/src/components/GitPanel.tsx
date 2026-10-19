import { useCallback, useEffect, useState } from 'react';
import { api, type GitBranch, type GitFile, type GitStatus } from '../lib/api';

interface Props { cwd: string | null; visible: boolean }

const CODE: Record<string, string> = { M: 'mod', A: 'add', D: 'del', R: 'ren', C: 'copy', U: 'conf', '?': 'new' };

function DiffView({ text }: { text: string }) {
  if (!text) return <div className="p-3 text-xs text-zinc-500">No changes</div>;
  return (
    <pre className="p-3 text-[12px] font-mono leading-relaxed whitespace-pre overflow-auto">
      {text.split('\n').map((l, i) => (
        <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'bg-emerald-500/10 text-emerald-200' : l.startsWith('-') && !l.startsWith('---') ? 'bg-red-500/10 text-red-200' : l.startsWith('@@') ? 'text-blue-300' : 'text-zinc-400'}>{l || ' '}</div>
      ))}
    </pre>
  );
}

export default function GitPanel({ cwd, visible }: Props) {
  const [st, setSt] = useState<GitStatus | null>(null);
  const [sel, setSel] = useState<{ path: string; staged: boolean } | null>(null);
  const [diff, setDiff] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [log, setLog] = useState<{ hash: string; subject: string; author: string; date: string }[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [remoteBusy, setRemoteBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!cwd) return;
    api.gitStatus(cwd).then(setSt).catch(() => setSt(null));
    api.gitLog(cwd).then(setLog).catch(() => setLog([]));
    api.gitBranches(cwd).then(setBranches).catch(() => setBranches([]));
  }, [cwd]);

  useEffect(() => { if (visible) refresh(); }, [visible, refresh]);
  useEffect(() => {
    if (!visible || !cwd) return;
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [visible, cwd, refresh]);
  useEffect(() => {
    if (!cwd || !sel) { setDiff(''); return; }
    api.gitDiff(cwd, sel.path, sel.staged).then(setDiff).catch(() => setDiff(''));
  }, [cwd, sel]);

  if (!cwd) return <div className="h-full flex items-center justify-center text-zinc-600 text-sm">Open a project</div>;
  if (st && !st.repo) return <div className="h-full flex items-center justify-center text-zinc-600 text-sm">Not a git repository</div>;

  const staged = st?.files.filter((f) => f.staged) ?? [];
  const unstaged = st?.files.filter((f) => !f.staged || f.worktree !== ' ') ?? [];
  const stage = (files: GitFile[], action: 'add' | 'reset' | 'discard') => {
    if (!files.length) return;
    if (action === 'discard' && !window.confirm(`Discard working tree changes in ${files.length} file(s)? This cannot be undone.`)) return;
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
    api.gitRemote(cwd, op).then((r) => setNote(`${op}: ${r.ok ? 'ok' : 'failed'} ${r.output.split('\n').slice(-1)[0] ?? ''}`)).catch((e) => setNote(`${op} failed: ${e.message}`)).finally(() => { setRemoteBusy(null); refresh(); });
  };
  const checkout = (value: string) => {
    if (!value) return;
    if (value === '__new__') {
      const name = window.prompt('New branch name (e.g. Feat/123-short-desc)');
      if (!name) return;
      setBusy(true);
      api.gitCheckout(cwd, name.trim(), true).then((r) => setNote(r.output.split('\n')[0] ?? '')).finally(() => { setBusy(false); refresh(); });
      return;
    }
    setBusy(true);
    api.gitCheckout(cwd, value).then((r) => setNote(r.output.split('\n')[0] ?? '')).finally(() => { setBusy(false); refresh(); });
  };

  const Row = ({ f, isStaged }: { f: GitFile; isStaged: boolean }) => (
    <div className={`flex items-center gap-2 px-2 py-1 text-xs cursor-pointer ${sel?.path === f.path && sel.staged === isStaged ? 'bg-blue-500/20' : 'hover:bg-white/5'}`} onClick={() => setSel({ path: f.path, staged: isStaged })}>
      <span className={`w-9 text-[10px] ${f.untracked ? 'text-emerald-300' : (isStaged ? f.index : f.worktree) === 'D' ? 'text-red-300' : 'text-amber-300'}`}>{CODE[isStaged ? f.index : (f.untracked ? '?' : f.worktree)] ?? ''}</span>
      <span className="truncate flex-1 font-mono" title={f.path}>{f.path}</span>
      <button className="text-zinc-500 hover:text-white px-1" title={isStaged ? 'Unstage' : 'Stage'} onClick={(e) => { e.stopPropagation(); stage([f], isStaged ? 'reset' : 'add'); }}>{isStaged ? '−' : '＋'}</button>
    </div>
  );

  return (
    <div className="h-full flex flex-col text-sm">
      <div className="h-9 shrink-0 flex items-center gap-2 px-2 border-b border-white/10 text-xs">
        <select value={st?.branch ?? ''} onChange={(e) => checkout(e.target.value)} disabled={busy || !!remoteBusy} title="Switch branch"
          className="bg-white/5 rounded-md px-1.5 py-1 outline-none max-w-[45%] font-medium text-zinc-200">
          {st?.branch && !branches.some((b) => b.name === st.branch) && <option value={st.branch}>{st.branch}</option>}
          {branches.filter((b) => !b.remote).map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
          {branches.some((b) => b.remote) && <optgroup label="Remote">{branches.filter((b) => b.remote).map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}</optgroup>}
          <option value="__new__">+ New branch…</option>
        </select>
        {st && (st.ahead > 0 || st.behind > 0) && <span className="text-zinc-500 whitespace-nowrap">↑{st.ahead} ↓{st.behind}</span>}
        <div className="flex-1" />
        {(['fetch', 'pull', 'push'] as const).map((op) => (
          <button key={op} disabled={!!remoteBusy || busy} onClick={() => remote(op)}
            className={`px-2 py-1 rounded hover:bg-white/10 disabled:opacity-40 ${remoteBusy === op ? 'text-amber-300 animate-pulse' : 'text-zinc-300'}`}>{op}</button>
        ))}
        <button className="text-zinc-400 hover:text-white px-1" onClick={refresh} disabled={busy} title="Refresh">↻</button>
      </div>
      {note && <div className="px-3 py-1 text-[11px] text-amber-200 border-b border-white/5 truncate" title={note}>{note}</div>}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="max-h-[45%] overflow-y-auto border-b border-white/10">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500 flex items-center">Staged ({staged.length})
            <div className="flex-1" /><button className="hover:text-white" onClick={() => stage(staged, 'reset')}>unstage all</button></div>
          {staged.map((f) => <Row key={'s' + f.path} f={f} isStaged />)}
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500 flex items-center">Changes ({unstaged.length})
            <div className="flex-1" /><button className="hover:text-white mr-2" onClick={() => stage(unstaged, 'add')}>stage all</button>
            <button className="hover:text-red-300" onClick={() => stage(unstaged.filter((f) => !f.untracked), 'discard')}>discard</button></div>
          {unstaged.map((f) => <Row key={'u' + f.path} f={f} isStaged={false} />)}
          {st && st.files.length === 0 && <div className="px-3 py-3 text-xs text-zinc-600">Clean</div>}
        </div>
        <div className="flex-1 min-h-0 overflow-auto bg-[#0b0d12]">
          {sel ? <DiffView text={diff} /> : (
            <div className="p-3 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Recent commits</div>
              {log.map((c) => <div key={c.hash} className="text-xs flex gap-2"><span className="font-mono text-zinc-500">{c.hash}</span><span className="truncate flex-1">{c.subject}</span><span className="text-zinc-600 whitespace-nowrap">{c.date}</span></div>)}
            </div>
          )}
        </div>
        <div className="shrink-0 border-t border-white/10 p-2 space-y-2">
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} placeholder="Commit message (feat: / fix: / misc: …)"
            className="w-full bg-[#12151c] rounded-md border border-white/10 px-2 py-1.5 text-xs outline-none resize-none font-mono" />
          <div className="flex items-center gap-2">
            <button disabled={busy || !msg.trim() || !staged.length} className="rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-xs px-3 py-1.5 disabled:opacity-40" onClick={commit}>Commit ({staged.length})</button>
            <button disabled={busy || !msg.trim() || !staged.length || !!remoteBusy} className="rounded bg-white/5 hover:bg-white/10 text-xs px-3 py-1.5 disabled:opacity-40"
              onClick={() => { setBusy(true); api.gitCommit(cwd, msg.trim()).then((r) => { if (r.ok) { setMsg(''); remote('push'); } else setNote(r.output); }).finally(() => setBusy(false)); }}>Commit & Push</button>
          </div>
        </div>
      </div>
    </div>
  );
}
