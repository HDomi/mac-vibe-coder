import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatItem, ChatSession } from '../lib/chatStore';
import type { AgentId, Attachment, PermissionModeId } from '../lib/agent';
import { api, type HistorySession, type ModelInfo } from '../lib/api';
import Composer from './Composer';
import { ApprovalItem, AssistantItem, QuestionItem, ResultItem, ToolItem, UserItem } from './ChatItems';
import { useContextMenu } from './ContextMenu';
import { t, useLang } from '../lib/i18n';

export interface StartOptions { resume?: string; permissionMode?: PermissionModeId; agent?: AgentId; model?: string | null }

interface Props {
  cwd: string | null;
  /** 'folder' lists sessions of cwd; 'all' lists every session across projects (Agent mode). */
  scope?: 'folder' | 'all';
  session: ChatSession | null;
  onStart: (cwd: string, opts?: StartOptions) => void;
  onSend: (text: string, attachments: Attachment[]) => void;
  onApprove: (requestId: string, decision: 'allow' | 'allow_always' | 'deny', message?: string) => void;
  onAnswer: (requestId: string, answers: Record<string, string>) => void;
  onInterrupt: () => void;
  onMode: (m: PermissionModeId) => void;
  onModel: (m: string | null) => void;
  onClose: () => void;
  pendingAttachments?: Attachment[];
  onConsumeAttachments?: () => void;
}

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
      className={`bg-white/5 rounded-md outline-none ${compact ? 'text-[11px] px-1.5 py-0.5 max-w-45' : 'text-xs px-2 py-1.5'}`}>
      <option value="">{t('chat.defaultModel')}</option>
      {value && !known && <option value={value}>{value}</option>}
      {models.map((m) => <option key={m.id} value={m.id}>{m.name}{m.isDefault ? t('chat.defaultSuffix') : ''}</option>)}
    </select>
  );
}

function renderItem(it: ChatItem, childrenOf: Map<string, ChatItem[]>, actions: { approve: Props['onApprove']; answer: Props['onAnswer']; cwd: string }): React.ReactNode {
  switch (it.kind) {
    case 'user': return <UserItem key={it.id} item={it} />;
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
  }
}

const MODE_IDS: { id: PermissionModeId; key: string }[] = [
  { id: 'default', key: 'chat.mode.default' },
  { id: 'acceptEdits', key: 'chat.mode.acceptEdits' },
  { id: 'plan', key: 'chat.mode.plan' },
  { id: 'bypassPermissions', key: 'chat.mode.bypass' },
  { id: 'auto', key: 'chat.mode.auto' },
];

function StartScreen({ cwd, scope = 'folder', onStart }: { cwd: string | null; scope?: 'folder' | 'all'; onStart: Props['onStart'] }) {
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
  useEffect(() => { try { localStorage.setItem('vibe.agent', agent); setModel(localStorage.getItem(`vibe.model.${agent}`)); } catch { /* ignore */ } }, [agent]);
  useEffect(() => { try { localStorage.setItem('vibe.mode', mode); } catch { /* ignore */ } }, [mode]);
  useEffect(() => { try { model ? localStorage.setItem(`vibe.model.${agent}`, model) : localStorage.removeItem(`vibe.model.${agent}`); } catch { /* ignore */ } }, [model, agent]);

  const loadHistory = () => {
    if (!cwd) return;
    setLoadingHistory(true);
    const p = scope === 'all'
      ? api.historyAll(300).then((rows) => rows.map((r) => ({ agent: r.agent, sessionId: r.sessionId, summary: r.title, lastModified: r.lastModified, cwd: r.cwd ?? undefined, pinned: r.pinned })))
      : api.history(cwd, 'all');
    p.then(setHistory).catch(() => setHistory([])).finally(() => setLoadingHistory(false));
  };
  useEffect(() => { setHistory([]); loadHistory(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [cwd, scope]);

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
      <div className="text-lg font-medium mb-6 break-all">{scope === 'all' ? t('chat.freeConversation') : cwd}</div>
      {scope === 'all' && <div className="text-xs text-zinc-500 -mt-4 mb-6">{t('chat.freeHint', { cwd })}</div>}
      <div className="flex items-center gap-1 mb-4 rounded-lg bg-white/5 p-1 w-fit text-sm">
        {(['claude', 'codex'] as AgentId[]).map((a) => (
          <button key={a} onClick={() => setAgent(a)} className={`px-4 py-1.5 rounded-md ${agent === a ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white'}`}>{a === 'claude' ? t('chat.claudeCode') : 'Codex'}</button>
        ))}
      </div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <button className="rounded-lg bg-blue-500/30 hover:bg-blue-500/40 px-4 py-2 text-sm" onClick={() => onStart(cwd, opts())}>{t('chat.newSession', { agent: agentName })} <span className="text-zinc-400 text-xs ml-1">⌘N</span></button>
        <select value={mode} onChange={(e) => setMode(e.target.value as PermissionModeId)} className="bg-white/5 rounded-md text-xs px-2 py-1.5 outline-none">
          {MODE_IDS.filter((m) => m.id !== 'auto' || agent === 'claude').map((m) => <option key={m.id} value={m.id}>{t(m.key)}</option>)}
        </select>
        <ModelSelect agent={agent} value={model} onChange={setModel} />
      </div>
      <div className="text-xs text-zinc-500 mb-6">{agent === 'codex' ? t('chat.codexHint') : t('chat.claudeHint')}</div>
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
            onClick={() => onStart(h.cwd ?? cwd, opts({ resume: h.sessionId, agent: h.agent }))}
            onContextMenu={(e) => menu.open(e, [
              { label: t('common.resume'), onClick: () => onStart(h.cwd ?? cwd, opts({ resume: h.sessionId, agent: h.agent })) },
              { label: h.pinned ? t('common.unpin') : t('common.pin'), onClick: () => togglePin(h) },
              { label: t('common.rename'), onClick: () => { setRenaming(h.sessionId); setDraft(h.customTitle || h.summary || ''); } },
              { label: t('common.copySessionId'), onClick: () => navigator.clipboard.writeText(h.sessionId) },
              { separator: true },
              { label: h.pinned ? t('common.deleteUnpinFirst') : t('common.deletePermanently'), danger: true, disabled: !!h.pinned, onClick: () => remove(h) },
            ])}>
            {h.pinned && <span title={t('common.pinned')}>📌</span>}
            <span className={`text-[10px] rounded px-1.5 py-0.5 ${h.agent === 'codex' ? 'bg-emerald-500/15 text-emerald-200' : 'bg-blue-500/15 text-blue-200'}`}>{h.agent}</span>
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

export default function ChatPanel({ cwd, scope = 'folder', session, onStart, onSend, onApprove, onAnswer, onInterrupt, onMode, onModel, onClose, pendingAttachments, onConsumeAttachments }: Props) {
  useLang();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

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

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [session?.items]);

  if (!session) return <StartScreen cwd={cwd} scope={scope} onStart={onStart} />;

  const running = session.status === 'running' || session.status === 'compacting';
  const close = () => {
    if (running && !window.confirm(t('chat.confirmCloseRunning'))) return;
    onClose();
  };
  const jump = () => { const el = scroller.current; if (el) { el.scrollTop = el.scrollHeight; stick.current = true; setAtBottom(true); } };

  return (
    <div className="h-full flex flex-col min-w-0">
      <div className="h-10 shrink-0 flex items-center gap-3 px-4 border-b border-white/10 text-xs">
        <span className={`w-2 h-2 rounded-full ${running ? 'bg-amber-400 animate-pulse' : session.status === 'closed' ? 'bg-zinc-600' : 'bg-emerald-400'}`} />
        <span className="font-medium text-zinc-200">{session.agent === 'codex' ? 'Codex' : 'Claude'}</span>
        <ModelSelect agent={session.agent} value={session.model ?? null} onChange={onModel} compact />
        <span className="text-zinc-500 truncate" title={session.cwd}>{session.cwd.split('/').slice(-2).join('/')}</span>
        {session.status === 'compacting' && <span className="text-amber-300">{t('chat.compacting')}</span>}
        <div className="flex-1" />
        {session.agentSessionId && <button className="text-zinc-600 hover:text-zinc-300" title={t('chat.copySessionIdTitle', { id: session.agentSessionId })} onClick={() => navigator.clipboard.writeText(session.agentSessionId!)}>id</button>}
        {session.agent === 'claude' && <span className="text-zinc-500">${session.totalCostUsd.toFixed(3)}</span>}
        <button className="text-zinc-400 hover:text-white" onClick={close} title={t('chat.closeSession')}>✕</button>
      </div>
      <div className="flex-1 min-h-0 relative">
        <div ref={scroller} className="absolute inset-0 overflow-y-auto px-5 py-4 space-y-3"
          onScroll={(e) => { const el = e.currentTarget; const b = el.scrollHeight - el.scrollTop - el.clientHeight < 60; stick.current = b; setAtBottom(b); }}>
          {top.length === 0 && <div className="text-center text-zinc-600 text-sm py-10">{session.status === 'starting' ? t('chat.starting') : t('chat.firstMessage')}</div>}
          {top.map((it) => renderItem(it, childrenOf, { approve: onApprove, answer: onAnswer, cwd: session.cwd }))}
        </div>
        {!atBottom && (
          <button onClick={jump} className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-[#1b1f2a] border border-white/15 px-3 py-1 text-xs text-zinc-300 shadow-lg hover:bg-[#242938]">{t('chat.jumpLatest')}</button>
        )}
      </div>
      <Composer cwd={session.cwd} agent={session.agent} disabled={session.status === 'closed'} running={running} mode={session.permissionMode} commands={session.commands}
        onSend={onSend} onStop={onInterrupt} onMode={onMode} pendingAttachments={pendingAttachments} onConsumeAttachments={onConsumeAttachments} />
    </div>
  );
}
