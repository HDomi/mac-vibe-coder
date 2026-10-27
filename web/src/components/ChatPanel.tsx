import { useEffect, useMemo, useRef, useState } from 'react';
import { currentTodos, displayTitle, type ChatItem, type ChatSession } from '../lib/chatStore';
import type { AgentId, Attachment, PermissionModeId, RewindResult } from '../lib/agent';
import { api, type HistorySession, type ModelInfo } from '../lib/api';
import Composer, { type BackgroundSession } from './Composer';
import ChatSearch from './ChatSearch';
import TodoPanel from './TodoPanel';
import { ApprovalItem, AssistantItem, QuestionItem, ResultItem, ToolItem, UserItem } from './ChatItems';
import { useContextMenu } from './ContextMenu';
import { t, useLang } from '../lib/i18n';
import ProjectIcon from './ProjectIcon';
import AgentIcon from './AgentIcon';
import Icon from './Icon';
import { VerifyButton, VerifyItem } from './Verify';
import { TurnChangesItem } from './TurnChanges';
import WorktreeChip from './WorktreeChip';

/** Same prompt to Claude and Codex, each in its own worktree, to compare and keep the better result. */
export interface PairOptions { prompt: string; branch?: string; permissionMode: PermissionModeId; models: { claude: string | null; codex: string | null } }

export interface StartOptions { resume?: string; permissionMode?: PermissionModeId; agent?: AgentId; model?: string | null; title?: string; /** Start in a new git worktree (optional branch name). */ isolate?: { branch?: string } }

interface Props {
  cwd: string | null;
  /** 'folder' lists sessions of cwd; 'all' lists every session across projects (Agent mode). */
  scope?: 'folder' | 'all';
  session: ChatSession | null;
  onStart: (cwd: string, opts?: StartOptions) => void;
  onStartPair?: (cwd: string, opts: PairOptions) => void;
  onSend: (text: string, attachments: Attachment[]) => void;
  onApprove: (requestId: string, decision: 'allow' | 'allow_always' | 'deny', message?: string) => void;
  onAnswer: (requestId: string, answers: Record<string, string>) => void;
  onInterrupt: () => void;
  /** Stop one subagent / background task (Claude). */
  onStopTask?: (taskId: string) => void;
  onMode: (m: PermissionModeId) => void;
  onModel: (m: string | null) => void;
  onClose: () => void;
  pendingAttachments?: Attachment[];
  onConsumeAttachments?: () => void;
  /** Claude: preview or undo file changes since a user message. */
  onRewind?: (messageId: string, dryRun: boolean) => Promise<RewindResult>;
  /** Other live sessions that are working or waiting; the composer lists them so they stay visible. */
  background?: BackgroundSession[];
  onFocusSession?: (id: string) => void;
  /** Run the project's verification command now. */
  onVerify?: () => void;
  /** The other session of a Claude-vs-Codex comparison, if any. */
  partner?: ChatSession | null;
  onFocusPartner?: (id: string) => void;
  onClosePartner?: (id: string) => void;
  /** Ask the other agent to review a turn's changes (or the uncommitted work). */
  onCrossReview?: (changes?: Extract<ChatItem, { kind: 'changes' }>) => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const modelCache: Partial<Record<AgentId, ModelInfo[]>> = {};
function useModels(agent: AgentId) {
  const [models, setModels] = useState<ModelInfo[]>(modelCache[agent] ?? []);
  useEffect(() => {
    if (modelCache[agent]) { setModels(modelCache[agent]!); return; }
    let alive = true;
    api.models(agent).then((m) => { modelCache[agent] = m; if (alive) setModels(m); }).catch(() => {});
    return () => { alive = false; };
  }, [agent]);
  return models;
}

export function ModelSelect({ agent, value, onChange, compact }: { agent: AgentId; value: string | null; onChange: (m: string | null) => void; compact?: boolean }) {
  useLang();
  const models = useModels(agent);
  const known = value && models.some((m) => m.id === value || m.name === value);
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} title={t('chat.model')}
      className={`bg-white/5 rounded-md outline-none ${compact ? 'text-[11px] px-1.5 py-0.5 max-w-45 min-w-0' : 'text-xs px-2 py-1.5'}`}>
      <option value="">{t('chat.defaultModel')}</option>
      {value && !known && <option value={value}>{value}</option>}
      {models.map((m) => <option key={m.id} value={m.id}>{m.name}{m.isDefault ? t('chat.defaultSuffix') : ''}</option>)}
    </select>
  );
}

function renderItem(it: ChatItem, childrenOf: Map<string, ChatItem[]>, actions: { approve: Props['onApprove']; answer: Props['onAnswer']; cwd: string; rewind?: (messageId: string) => void; latestVerify?: string; verify?: () => void; review?: (changes: Extract<ChatItem, { kind: 'changes' }>) => void; otherAgent?: string }): React.ReactNode {
  switch (it.kind) {
    case 'user': return <UserItem key={it.id} item={it} onRewind={actions.rewind && UUID_RE.test(it.id) && !it.compact ? () => actions.rewind!(it.id) : undefined} />;
    case 'assistant': return <AssistantItem key={it.id} item={it} baseDir={actions.cwd} />;
    case 'tool': {
      const kids = childrenOf.get(it.id);
      return <ToolItem key={it.id} item={it}>{kids?.map((k) => renderItem(k, childrenOf, actions))}</ToolItem>;
    }
    case 'approval': return <ApprovalItem key={it.id} item={it} onDecide={(d, m) => actions.approve(it.id, d, m)} />;
    case 'question': return <QuestionItem key={it.id} item={it} onAnswer={(a) => actions.answer(it.id, a)} />;
    case 'result': return <ResultItem key={it.id} item={it} />;
    case 'error': return <div key={it.id} className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-200 whitespace-pre-wrap">{it.message}</div>;
    case 'system': return <div key={it.id} className="text-xs text-zinc-500 text-center py-1">{it.text}</div>;
    case 'changes': return <TurnChangesItem key={it.id} item={it} onReview={actions.review ? () => actions.review!(it) : undefined} reviewer={actions.otherAgent} />;
    case 'verify': return <VerifyItem key={it.id} item={it} latest={it.id === actions.latestVerify} onRerun={it.id === actions.latestVerify ? actions.verify : undefined} />;
  }
}

const MODE_IDS: { id: PermissionModeId; key: string }[] = [
  { id: 'default', key: 'chat.mode.default' },
  { id: 'acceptEdits', key: 'chat.mode.acceptEdits' },
  { id: 'plan', key: 'chat.mode.plan' },
  { id: 'bypassPermissions', key: 'chat.mode.bypass' },
  { id: 'auto', key: 'chat.mode.auto' },
];

function StartScreen({ cwd, scope = 'folder', onStart, onStartPair }: { cwd: string | null; scope?: 'folder' | 'all'; onStart: Props['onStart']; onStartPair?: Props['onStartPair'] }) {
  useLang();
  const menu = useContextMenu();
  const [history, setHistory] = useState<HistorySession[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [mode, setMode] = useState<PermissionModeId>(() => { try { return (localStorage.getItem('vibe.mode') as PermissionModeId) || 'default'; } catch { return 'default'; } });
  const [agent, setAgent] = useState<AgentId>(() => { try { return (localStorage.getItem('vibe.agent') as AgentId) || 'claude'; } catch { return 'claude'; } });
  const [model, setModel] = useState<string | null>(() => { try { return localStorage.getItem(`vibe.model.${agent}`); } catch { return null; } });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState('');
  // Worktree start: only offered inside a git repository with at least one commit.
  const [isGit, setIsGit] = useState(false);
  const [isolate, setIsolate] = useState(false);
  const [branch, setBranch] = useState('');
  const [compare, setCompare] = useState(false);
  const [pairPrompt, setPairPrompt] = useState('');
  useEffect(() => {
    setIsGit(false); setIsolate(false);
    if (!cwd || scope === 'all') return;
    let alive = true;
    api.gitStatus(cwd).then((st) => { if (alive) setIsGit(st.repo); }).catch(() => {});
    return () => { alive = false; };
  }, [cwd, scope]);
  useEffect(() => { try { localStorage.setItem('vibe.agent', agent); setModel(localStorage.getItem(`vibe.model.${agent}`)); } catch { /* ignore */ } }, [agent]);
  useEffect(() => { try { localStorage.setItem('vibe.mode', mode); } catch { /* ignore */ } }, [mode]);
  useEffect(() => { try { model ? localStorage.setItem(`vibe.model.${agent}`, model) : localStorage.removeItem(`vibe.model.${agent}`); } catch { /* ignore */ } }, [model, agent]);

  const historyRequest = useRef(0);
  const loadHistory = () => {
    const request = ++historyRequest.current;
    if (!cwd) return;
    setLoadingHistory(true);
    const p = scope === 'all'
      ? api.historyAll(300).then((rows) => rows.map((r) => ({ agent: r.agent, sessionId: r.sessionId, summary: r.title, lastModified: r.lastModified, cwd: r.cwd ?? undefined, pinned: r.pinned })))
      : api.history(cwd, 'all');
    p.then((rows) => { if (request === historyRequest.current) setHistory(rows); }).catch(() => { if (request === historyRequest.current) setHistory([]); }).finally(() => { if (request === historyRequest.current) setLoadingHistory(false); });
  };
  useEffect(() => { setHistory([]); loadHistory(); return () => { historyRequest.current++; }; /* eslint-disable-line react-hooks/exhaustive-deps */ }, [cwd, scope]);

  if (!cwd) return <div className="h-full flex items-center justify-center text-zinc-600 text-sm">{t('chat.openFolderFirst')}</div>;
  const shown = filter.trim() ? history.filter((h) => `${h.customTitle ?? ''} ${h.summary} ${h.firstPrompt ?? ''} ${h.cwd ?? ''}`.toLowerCase().includes(filter.toLowerCase())) : history;
  const opts = (extra: Partial<StartOptions> = {}) => ({ permissionMode: mode, agent, model, ...extra });
  const rename = (h: HistorySession) => {
    const title = draft.trim(); setRenaming(null);
    if (!title) return;
    api.historyRename(h.agent, h.sessionId, title, cwd).then(loadHistory).catch(() => {});
  };
  const titleOf = (h: HistorySession) => h.customTitle || h.summary || h.firstPrompt || h.sessionId;
  const remove = (h: HistorySession) => {
    if (h.pinned) { window.alert(t('common.pinnedUnpinFirst', { title: titleOf(h) })); return; }
    if (!window.confirm(t('common.confirmDeleteSession', { title: titleOf(h) }))) return;
    api.historyDelete(h.agent, h.sessionId, cwd).then(loadHistory).catch((e) => window.alert(e.message));
  };
  const togglePin = (h: HistorySession) => api.historyPin(h.agent, h.sessionId, !h.pinned).then(loadHistory).catch(() => {});
  const agentName = agent === 'claude' ? 'Claude' : 'Codex';

  return (
    <div className="h-full overflow-y-auto p-8 max-w-2xl mx-auto">
      <div className="text-xs text-zinc-500 mb-1">{scope === 'all' ? t('chat.agent') : t('chat.project')}</div>
      {scope === 'all'
        ? <div className="text-lg font-medium mb-6">{t('chat.freeConversation')}</div>
        : <div className="flex items-center gap-3 mb-6" title={cwd}><ProjectIcon path={cwd} name={cwd.split('/').pop() || cwd} size={40} /><div className="text-xl font-semibold truncate">{cwd.split('/').pop() || cwd}</div></div>}
      {scope === 'all' && <div className="text-xs text-zinc-500 -mt-4 mb-6">{t('chat.freeHint', { cwd })}</div>}
      <div className="flex items-center gap-1 mb-4 rounded-lg bg-white/5 p-1 w-fit text-sm">
        {(['claude', 'codex'] as AgentId[]).map((a) => (
          <button key={a} onClick={() => { setAgent(a); setCompare(false); }} className={`px-4 py-1.5 rounded-md ${agent === a && !compare ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white'}`}>{a === 'claude' ? t('chat.claudeCode') : 'Codex'}</button>
        ))}
        {isGit && onStartPair && <button onClick={() => setCompare(true)} className={`px-4 py-1.5 rounded-md flex items-center gap-1.5 ${compare ? 'bg-violet-500/20 text-violet-100' : 'text-zinc-400 hover:text-white'}`} title={t('pair.hint')}><Icon name="branch" size={13} />{t('pair.tab')}</button>}
      </div>
      {compare && isGit && onStartPair ? (
        <div className="mb-6 rounded-lg border border-violet-400/25 bg-violet-400/[0.05] p-3 space-y-2.5">
          <div className="text-xs text-zinc-400 leading-relaxed">{t('pair.about')}</div>
          <textarea value={pairPrompt} onChange={(e) => setPairPrompt(e.target.value)} rows={4} placeholder={t('pair.placeholder')}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && pairPrompt.trim()) onStartPair(cwd, { prompt: pairPrompt.trim(), branch: branch.trim() || undefined, permissionMode: mode, models: { claude: localStorage.getItem('vibe.model.claude'), codex: localStorage.getItem('vibe.model.codex') } }); }}
            className="w-full rounded-md bg-black/40 border border-white/10 focus:border-violet-400/50 px-3 py-2 text-[13px] outline-none resize-y" />
          <div className="flex items-center gap-2 flex-wrap">
            <button disabled={!pairPrompt.trim()} className="rounded-lg bg-violet-500/30 hover:bg-violet-500/40 disabled:opacity-40 px-4 py-2 text-sm"
              onClick={() => onStartPair(cwd, { prompt: pairPrompt.trim(), branch: branch.trim() || undefined, permissionMode: mode, models: { claude: localStorage.getItem('vibe.model.claude'), codex: localStorage.getItem('vibe.model.codex') } })}>
              {t('pair.start')} <span className="text-zinc-400 text-xs ml-1">⌘⏎</span>
            </button>
            <select value={mode} onChange={(e) => setMode(e.target.value as PermissionModeId)} className="bg-white/5 rounded-md text-xs px-2 py-1.5 outline-none">
              {MODE_IDS.filter((m) => m.id !== 'auto').map((m) => <option key={m.id} value={m.id}>{t(m.key)}</option>)}
            </select>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={t('pair.branchPlaceholder')} spellCheck={false}
              className="w-48 rounded-md bg-black/40 border border-white/10 focus:border-violet-400/50 px-2 py-1.5 font-mono text-[11.5px] outline-none" />
          </div>
        </div>
      ) : <>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <button className="rounded-lg bg-blue-500/30 hover:bg-blue-500/40 px-4 py-2 text-sm" onClick={() => onStart(cwd, opts(isolate ? { isolate: { branch: branch.trim() || undefined } } : {}))}>{t('chat.newSession', { agent: agentName })} <span className="text-zinc-400 text-xs ml-1">⌘N</span></button>
        <select value={mode} onChange={(e) => setMode(e.target.value as PermissionModeId)} className="bg-white/5 rounded-md text-xs px-2 py-1.5 outline-none">
          {MODE_IDS.filter((m) => m.id !== 'auto' || agent === 'claude').map((m) => <option key={m.id} value={m.id}>{t(m.key)}</option>)}
        </select>
        <ModelSelect agent={agent} value={model} onChange={setModel} />
      </div>
      {isGit && (
        <div className={`mb-3 rounded-lg border px-3 py-2 text-xs transition-colors ${isolate ? 'border-violet-400/30 bg-violet-400/[0.06]' : 'border-white/5'}`}>
          <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
            <input type="checkbox" checked={isolate} onChange={(e) => setIsolate(e.target.checked)} />
            <Icon name="branch" size={13} className={isolate ? 'text-violet-300' : 'text-zinc-500'} />
            {t('worktree.startIn')}
          </label>
          {isolate && (
            <div className="mt-2 pl-6 space-y-1.5">
              <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={t('worktree.branchPlaceholder')} spellCheck={false}
                className="w-64 rounded-md bg-black/40 border border-white/10 focus:border-violet-400/50 px-2 py-1 font-mono text-[11.5px] outline-none" />
              <div className="text-[11px] text-zinc-500 leading-relaxed">{t('worktree.startHint')}</div>
            </div>
          )}
        </div>
      )}
      <div className="text-xs text-zinc-500 mb-6">{agent === 'codex' ? t('chat.codexHint') : t('chat.claudeHint')}</div>
      </>}
      <div className="flex items-center text-xs text-zinc-500 mb-2 gap-3">
        <span>{scope === 'all' ? t('chat.previousAll', { n: history.length }) : t('chat.previousFolder')}</span>
        <div className="flex-1" />
        {scope === 'all' && <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('common.search')} className="bg-white/5 rounded px-2 py-1 text-xs outline-none w-40" />}
        {loadingHistory && <span className="text-zinc-600">{t('chat.loading')}</span>}
      </div>
      {history.length === 0 && !loadingHistory && <div className="text-xs text-zinc-600">{t('chat.noSessions')}</div>}
      <div className="space-y-1">
        {shown.map((h) => (
          <div key={h.agent + h.sessionId} className="w-full text-left rounded-lg border border-white/10 hover:bg-white/5 px-3 py-2 cursor-pointer flex items-center gap-3"
            onClick={() => onStart(h.cwd ?? cwd, opts({ resume: h.sessionId, agent: h.agent, title: h.customTitle || h.summary || undefined }))}
            onContextMenu={(e) => menu.open(e, [
              { label: t('common.resume'), onClick: () => onStart(h.cwd ?? cwd, opts({ resume: h.sessionId, agent: h.agent, title: h.customTitle || h.summary || undefined })) },
              { label: h.pinned ? t('common.unpin') : t('common.pin'), onClick: () => togglePin(h) },
              { label: t('common.rename'), onClick: () => { setRenaming(h.sessionId); setDraft(h.customTitle || h.summary || ''); } },
              { label: t('common.copySessionId'), onClick: () => navigator.clipboard.writeText(h.sessionId) },
              { separator: true },
              { label: h.pinned ? t('common.deleteUnpinFirst') : t('common.deletePermanently'), danger: true, disabled: !!h.pinned, onClick: () => remove(h) },
            ])}>
            {h.pinned && <span title={t('common.pinned')}>📌</span>}
            <AgentIcon agent={h.agent} size={18} />
            <div className="flex-1 min-w-0">
              {renaming === h.sessionId
                ? <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onClick={(e) => e.stopPropagation()} onBlur={() => rename(h)}
                    onKeyDown={(e) => { if (e.key === 'Enter') rename(h); if (e.key === 'Escape') setRenaming(null); }}
                    className="w-full bg-black/40 rounded px-2 py-0.5 text-sm outline-none border border-blue-400/50" />
                : <div className="text-sm truncate">{titleOf(h)}</div>}
              <div className="text-[11px] text-zinc-500 truncate">{new Date(h.lastModified).toLocaleString()}{h.gitBranch ? ` · ${h.gitBranch}` : ''}{scope === 'all' && h.cwd ? ` · ${h.cwd.replace(/^\/Users\/[^/]+/, '~')}` : ''}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ChatPanel({ cwd, scope = 'folder', session, onStart, onStartPair, onSend, onApprove, onAnswer, onInterrupt, onStopTask, onMode, onModel, onClose, pendingAttachments, onConsumeAttachments, background, onFocusSession, onRewind, onVerify, onCrossReview, partner, onFocusPartner, onClosePartner }: Props) {
  useLang();
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);          // follow new content until the user scrolls up
  const programmatic = useRef(false);  // ignore scroll events we caused ourselves
  const [atBottom, setAtBottom] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [searching, setSearching] = useState(false);
  // ⌘F (dispatched by the app's shortcut handler) opens the in-chat search bar.
  useEffect(() => {
    const open = () => setSearching(true);
    window.addEventListener('vibe:chat-search', open);
    return () => window.removeEventListener('vibe:chat-search', open);
  }, []);
  useEffect(() => { setSearching(false); }, [session?.id]);

  const { top, childrenOf } = useMemo(() => {
    const childrenOf = new Map<string, ChatItem[]>();
    const top: ChatItem[] = [];
    for (const it of session?.items ?? []) {
      const parent = (it.kind === 'assistant' || it.kind === 'tool') ? it.parent : null;
      if (parent) { const l = childrenOf.get(parent) ?? []; l.push(it); childrenOf.set(parent, l); }
      else top.push(it);
    }
    return { top, childrenOf };
  }, [session?.items]);
  const latestVerify = useMemo(() => { const items = session?.items ?? []; for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'verify') return items[i].id; return undefined; }, [session?.items]);

  const scrollToBottom = () => {
    const el = scroller.current; if (!el) return;
    programmatic.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => { programmatic.current = false; });
  };
  // Follow content growth (streaming text, images, expanding cards) while stuck to the bottom.
  useEffect(() => {
    const el = content.current; if (!el) return;
    const ro = new ResizeObserver(() => { if (stick.current) scrollToBottom(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [session?.id]);
  useEffect(() => { if (stick.current) scrollToBottom(); }, [session?.items]);
  useEffect(() => { stick.current = true; setAtBottom(true); scrollToBottom(); }, [session?.id]);
  // 1s tick for the elapsed counter in the activity line.
  useEffect(() => {
    if (!session?.turnStartedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session?.turnStartedAt]);

  if (!session) return <StartScreen cwd={cwd} scope={scope} onStart={onStart} onStartPair={onStartPair} />;

  const running = session.status === 'running' || session.status === 'compacting';
  const close = () => {
    if (running && !window.confirm(t('chat.confirmCloseRunning'))) return;
    onClose();
  };
  // Undo file changes from a user message on: preview with a dry run, confirm with the file list, then restore.
  const canRewind = !!onRewind && session.agent === 'claude' && !running && session.status !== 'closed';
  const rewind = async (messageId: string) => {
    if (!onRewind) return;
    const dry = await onRewind(messageId, true);
    if (!dry.canRewind) { window.alert(t('rewind.unavailable', { reason: dry.error ?? '' })); return; }
    const files = dry.filesChanged ?? [];
    if (!files.length) { window.alert(t('rewind.nothing')); return; }
    // macOS reports /tmp and /var through /private; compare without it so paths show relative to the project.
    const strip = (p: string) => p.replace(/^\/private(?=\/(?:tmp|var)\/)/, '');
    const base = strip(session.cwd).replace(/\/$/, '') + '/';
    const rel = (p: string) => (strip(p).startsWith(base) ? strip(p).slice(base.length) : p);
    const list = files.slice(0, 12).map((f) => `• ${rel(f)}`).join('\n') + (files.length > 12 ? `\n… +${files.length - 12}` : '');
    if (!window.confirm(t('rewind.confirm', { n: files.length, ins: dry.insertions ?? 0, del: dry.deletions ?? 0, files: list }))) return;
    const done = await onRewind(messageId, false);
    if (!done.canRewind) window.alert(t('rewind.failed', { reason: done.error ?? '' }));
  };
  const jump = () => { stick.current = true; setAtBottom(true); scrollToBottom(); };
  // Bring the tool card that started a subagent into view (from the task relation graph).
  const showToolCard = (toolUseId: string) => {
    const el = content.current?.querySelector<HTMLElement>(`[data-tool-use="${CSS.escape(toolUseId)}"]`);
    if (!el) return;
    stick.current = false; setAtBottom(false);
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('ring-2', 'ring-violet-400/60');
    setTimeout(() => el.classList.remove('ring-2', 'ring-violet-400/60'), 1800);
  };
  const onScroll = () => {
    if (programmatic.current) return;
    const el = scroller.current; if (!el) return;
    const b = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    stick.current = b; setAtBottom(b);
  };
  const onWheel = (e: React.WheelEvent) => { if (e.deltaY < 0 && scroller.current && scroller.current.scrollHeight > scroller.current.clientHeight) { stick.current = false; setAtBottom(false); } };

  // What the agent is doing right now, for the CLI-style status line.
  const activity = (() => {
    if (!running) return null;
    if (session.status === 'compacting') return t('activity.compacting');
    const items = session.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === 'user') break;
      if (it.kind === 'approval' && !it.decision) return t('activity.waitingApproval');
      if (it.kind === 'question' && !it.resolved) return t('activity.waitingAnswer');
    }
    const openTool = [...items].reverse().find((it) => it.kind === 'tool' && !it.done) as Extract<ChatItem, { kind: 'tool' }> | undefined;
    if (openTool) {
      const isSub = ['Agent', 'Task', 'SubAgent'].includes(openTool.name);
      const detail = (() => { const i = (openTool.input ?? {}) as Record<string, unknown>; const v = i.command ?? i.file_path ?? i.pattern ?? i.query ?? i.description ?? ''; return String(v).split('\n')[0].slice(0, 60); })();
      return `${isSub ? t('activity.subagent') : t('activity.running', { tool: openTool.name })}${detail ? ` · ${detail}` : ''}`;
    }
    const last = items[items.length - 1];
    if (last?.kind === 'assistant' && last.streaming && !last.text) return t('activity.thinking');
    return t('activity.working');
  })();
  const elapsed = session.turnStartedAt ? Math.max(0, Math.round((now - session.turnStartedAt) / 1000)) : 0;
  const elapsedLabel = t(elapsed >= 3600 ? 'activity.elapsedHours' : elapsed >= 60 ? 'activity.elapsedMinutes' : 'activity.elapsedSeconds', {
    hours: Math.floor(elapsed / 3600),
    minutes: Math.floor(elapsed / 60) % 60,
    seconds: elapsed % 60,
  });

  return (
    <div className="h-full flex flex-col min-w-0">
      <div data-companion-floor="chat-header" data-companion-edge="bottom" className="@container h-10 shrink-0 flex items-center gap-3 px-4 border-b border-white/10 text-xs whitespace-nowrap">
        <span className={`w-2 h-2 rounded-full ${running ? 'bg-amber-400 animate-pulse' : session.status === 'closed' ? 'bg-zinc-600' : 'bg-emerald-400'}`} />
        <AgentIcon agent={session.agent} size={16} />
        <span className="font-medium text-zinc-200">{session.agent === 'codex' ? 'Codex' : 'Claude'}</span>
        <ModelSelect agent={session.agent} value={session.model ?? null} onChange={onModel} compact />
        <span className="text-zinc-500 truncate min-w-0 @max-[560px]:hidden" title={session.cwd}>{session.cwd.split('/').slice(-2).join('/')}</span>
        {session.worktree && <WorktreeChip info={session.worktree} running={running} onFinished={onClose} commitTitle={displayTitle(session, 60) ?? session.worktree.branch}
          partner={partner && partner.worktree ? { id: partner.id, agent: partner.agent, worktree: partner.worktree, running: partner.status === 'running' } : undefined}
          onFocusPartner={onFocusPartner} onClosePartner={onClosePartner} />}
        {session.status === 'compacting' && <span className="text-amber-300">{t('chat.compacting')}</span>}
        <div className="flex-1" />
        {onCrossReview && <button onClick={() => onCrossReview()} className="shrink-0 flex items-center gap-1 rounded-md px-1.5 py-1 text-zinc-500 hover:text-zinc-200 hover:bg-white/5" title={t('review.headerHint', { agent: session.agent === 'claude' ? 'Codex' : 'Claude' })}>
          <Icon name="sparkle" size={13} /><span className="@max-[600px]:hidden">{t('review.short')}</span>
        </button>}
        {onVerify && session.cwd && <VerifyButton cwd={session.cwd} running={running} onRun={onVerify} />}
        {session.agentSessionId && <button className="text-zinc-600 hover:text-zinc-300" title={t('chat.copySessionIdTitle', { id: session.agentSessionId })} onClick={() => navigator.clipboard.writeText(session.agentSessionId!)}>id</button>}
        {session.agent === 'claude' && <span className="text-zinc-500 @max-[440px]:hidden">${session.totalCostUsd.toFixed(3)}</span>}
        <button className="w-7 h-7 -mr-2 shrink-0 flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-white/10" onClick={close} title={t('chat.closeSession')}><Icon name="close" /></button>
      </div>
      <div className="flex-1 min-h-0 relative">
        {searching && <ChatSearch content={content} scroller={scroller} version={session.items} onClose={() => setSearching(false)}
          onJump={() => { stick.current = false; setAtBottom(false); }} />}
        <div ref={scroller} className="absolute inset-0 overflow-y-auto" onScroll={onScroll} onWheel={onWheel}>
          <div ref={content} className="px-5 py-4 space-y-3">
            {top.length === 0 && <div className="text-center text-zinc-600 text-sm py-10">{session.restoring ? t('chat.restoring') : session.status === 'starting' ? t('chat.starting') : t('chat.firstMessage')}</div>}
            {top.map((it) => renderItem(it, childrenOf, { approve: onApprove, answer: onAnswer, cwd: session.cwd, rewind: canRewind ? rewind : undefined, latestVerify, verify: running ? undefined : onVerify, review: onCrossReview, otherAgent: session.agent === 'claude' ? 'Codex' : 'Claude' }))}
          </div>
        </div>
        {!atBottom && (
          <button onClick={jump} className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-[#1b1f2a] border border-white/15 px-3 py-1 text-xs text-zinc-300 shadow-lg hover:bg-[#242938]">{t('chat.jumpLatest')}</button>
        )}
      </div>
      {activity && (
        <div data-companion-floor="chat-activity" className="h-7 shrink-0 flex items-center gap-2 px-4 text-[11px] text-zinc-400 border-t border-white/5 bg-[#0e1117]">
          <span className="inline-block w-3 h-3 rounded-full border-2 border-amber-400/70 border-t-transparent animate-spin" />
          <span className="shrink-0 whitespace-nowrap text-zinc-600 tabular-nums">{elapsedLabel}</span>
          <span className="truncate">{activity}</span>
        </div>
      )}
      <TodoPanel todos={currentTodos(session)} running={running} />
      <Composer key={session.id} draftKey={session.id} cwd={session.cwd} agent={session.agent} disabled={session.status === 'closed'} running={running} mode={session.permissionMode} commands={session.commands}
        onSend={(text, atts) => { stick.current = true; setAtBottom(true); onSend(text, atts); requestAnimationFrame(scrollToBottom); }}
        onStop={onInterrupt} onMode={onMode} pendingAttachments={pendingAttachments} onConsumeAttachments={onConsumeAttachments}
        background={background} onFocusSession={onFocusSession}
        tasks={session.tasks} taskRootLabel={displayTitle(session, 24) ?? (session.agent === 'codex' ? 'Codex' : 'Claude')} taskRootSub={session.agentSessionId?.slice(0, 8)} onShowTaskCard={showToolCard} onStopTask={session.agent === 'claude' ? onStopTask : undefined} />
    </div>
  );
}
