import { useCallback, useEffect, useRef, useState } from 'react';
import { backgroundState, displayTitle, pendingRequests, sortSessions, type ChatSession } from './lib/chatStore';
import { api, ApiError, type Entry, type Favorites, type HomeInfo, type Listing, type RecentSession } from './lib/api';
import { agentClient, type Attachment } from './lib/agent';
import { reconnectTerminals, terminalsBusy } from './lib/terminals';
import { keepAwakeEnabled, workInProgress } from './lib/power';
import { alertDialog, confirmDialog } from './lib/dialogs';
import { installGestures, type SwipeDirection } from './lib/gestures';
import { requestNotificationPermission, useSessions, setOnScreenSession } from './lib/useSessions';
import Sidebar from './components/Sidebar';
import FileList from './components/FileList';
import Preview from './components/Preview';
import ToolsPanel from './components/ToolsPanel';
import UsageBar, { type ViewMode } from './components/UsageBar';
import ChatPanel, { type StartOptions } from './components/ChatPanel';
import type { BackgroundSession } from './components/Composer';
import TerminalPanel from './components/TerminalPanel';
import BrowserPanel from './components/BrowserPanel';
import GitPanel from './components/GitPanel';
import Splitter, { usePaneWidth } from './components/Splitter';
import { ContextMenuProvider, useContextMenu, type MenuItem } from './components/ContextMenu';
import QuickOpen from './components/QuickOpen';
import { t, useLang } from './lib/i18n';
import AgentIcon from './components/AgentIcon';
import Lightbox from './components/Lightbox';
import Icon from './components/Icon';
import SessionCompanions from './components/SessionCompanions';

const LS_CWD = 'vibe.cwd';
const LS_PROJECT = 'vibe.project';
const LS_SIDEBAR = 'vibe.sidebar.collapsed';
const LS_RIGHT = 'vibe.right.collapsed';
const LS_MODE = 'vibe.mode.view';
const LS_ACTIVE_SESSION = 'vibe.active.session';

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic)$/i;

export default function App() {
  return (
    <ContextMenuProvider>
      <AppInner />
    </ContextMenuProvider>
  );
}

function AppInner() {
  useLang();
  const menu = useContextMenu();
  const [home, setHome] = useState<HomeInfo | null>(null);
  const [favorites, setFavorites] = useState<Favorites>({ favorites: [], groups: [] });
  const [recent, setRecent] = useState<string[]>([]);
  const [cwd, setCwd] = useState<string>(() => { try { return localStorage.getItem(LS_CWD) || '~'; } catch { return '~'; } });
  const [project, setProject] = useState<string | null>(() => { try { return localStorage.getItem(LS_PROJECT); } catch { return null; } });
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [rightTab, setRightTab] = useState<'files' | 'preview' | 'browser' | 'terminal' | 'git'>('files');
  // Remembered so an update/relaunch comes back to the tab that was on screen, not the new-session view.
  const [activeSession, setActiveSession] = useState<string | 'new' | null>(() => { try { return localStorage.getItem(LS_ACTIVE_SESSION); } catch { return null; } });
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(LS_SIDEBAR) === '1'; } catch { return false; } });
  const [rightCollapsed, setRightCollapsed] = useState(() => { try { return localStorage.getItem(LS_RIGHT) === '1'; } catch { return false; } });
  const [dragging, setDragging] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const [companions, setCompanions] = useState(() => { try { return localStorage.getItem('vibe.companions') !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('vibe.companions', companions ? '1' : '0'); } catch { /* ignore */ } }, [companions]);
  const [view, setView] = useState<ViewMode>(() => { try { return (localStorage.getItem(LS_MODE) as ViewMode) || 'ide'; } catch { return 'ide'; } });
  const [agentActive, setAgentActive] = useState<string | 'new' | null>(null);
  useEffect(() => { try { localStorage.setItem(LS_MODE, view); } catch { /* ignore */ } }, [view]);
  useEffect(() => { try { activeSession ? localStorage.setItem(LS_ACTIVE_SESSION, activeSession) : localStorage.removeItem(LS_ACTIVE_SESSION); } catch { /* ignore */ } }, [activeSession]);
  const sidebar = usePaneWidth('vibe.w.sidebar', 256, 180, 480);
  const right = usePaneWidth('vibe.w.right', 420, 280, 1200);
  const S = useSessions();
  // A session revived after a server restart gets a new id; keep it selected.
  useEffect(() => {
    if (activeSession && S.replaced[activeSession]) setActiveSession(S.replaced[activeSession]);
    if (agentActive && S.replaced[agentActive]) setAgentActive(S.replaced[agentActive]);
  }, [S.replaced, activeSession, agentActive]);

  useEffect(() => {
    api.home().then(setHome).catch(() => {});
    api.favorites().then(setFavorites).catch(() => {});
    api.recent().then(setRecent).catch(() => {});
  }, []);
  useEffect(() => { try { localStorage.setItem(LS_SIDEBAR, collapsed ? '1' : '0'); } catch { /* ignore */ } }, [collapsed]);
  useEffect(() => { try { localStorage.setItem(LS_RIGHT, rightCollapsed ? '1' : '0'); } catch { /* ignore */ } }, [rightCollapsed]);
  const paneTransition = dragging ? '' : 'transition-[width] duration-250 ease-[cubic-bezier(.2,.8,.2,1)]';

  useEffect(() => {
    let alive = true;
    api.list(cwd).then((l) => {
      if (!alive) return;
      setListing(l); setError(null);
      try { localStorage.setItem(LS_CWD, l.path); } catch { /* ignore */ }
    }).catch((e: ApiError) => { if (alive) setError({ code: e.code ?? 'ERR', message: e.message }); });
    return () => { alive = false; };
  }, [cwd, refreshTick]);
  // Live refresh: the server watches the folder on screen and nudges us when its contents change.
  useEffect(() => {
    if (!listing?.path) return;
    const es = new EventSource(api.fsWatchUrl(listing.path));
    es.addEventListener('change', () => setRefreshTick((t) => t + 1));
    return () => es.close();
  }, [listing?.path]);

  useEffect(() => { try { project ? localStorage.setItem(LS_PROJECT, project) : localStorage.removeItem(LS_PROJECT); } catch { /* ignore */ } }, [project]);
  useEffect(() => { const h = () => requestNotificationPermission(); window.addEventListener('click', h, { once: true }); return () => window.removeEventListener('click', h); }, []);

  const projectSessions = sortSessions(Object.values(S.sessions).filter((s) => s.cwd === project));
  const session = activeSession === 'new' ? null
    : (activeSession && S.sessions[activeSession]?.cwd === project ? S.sessions[activeSession] : projectSessions[0]) ?? null;

  const navigate = useCallback((p: string) => { setCwd(p); setSelected(null); }, []);
  // Local file links inside markdown (chat or preview) open in the Preview tab.
  useEffect(() => {
    const h = (ev: Event) => {
      const path = (ev as CustomEvent<{ path: string }>).detail?.path;
      if (!path) return;
      api.stat(path).then((e) => { if (e.isDir) navigate(e.path); else { setSelected(e); setRightTab('preview'); } }).catch(() => {});
    };
    window.addEventListener('vibe:open-file', h);
    return () => window.removeEventListener('vibe:open-file', h);
  }, [navigate]);
  const openProject = useCallback((p: string) => {
    setProject(p); navigate(p); setActiveSession(null);
    api.pushRecent(p).then(setRecent).catch(() => {});
  }, [navigate]);
  // Notifications are skipped for the session on screen while the window is focused.
  useEffect(() => { setOnScreenSession(view === 'agent' ? (agentActive && agentActive !== 'new' ? agentActive : null) : (session?.id ?? null)); }, [view, agentActive, session?.id]);
  // Clicking a notification brings its session on screen in whichever view is active.
  const focusSession = useRef<(id: string) => void>(() => {});
  const approveRef = useRef<(sessionId: string, requestId: string, decision: 'allow' | 'allow_always' | 'deny') => void>(() => {});
  approveRef.current = S.approve;
  focusSession.current = (id: string) => {
    const s = S.sessions[id];
    if (!s) return;
    if (view === 'agent') setAgentActive(id);
    else { if (s.cwd !== project) openProject(s.cwd); setActiveSession(id); }
  };
  useEffect(() => {
    const h = (ev: Event) => { const id = (ev as CustomEvent<{ sessionId: string }>).detail?.sessionId; if (id) focusSession.current(id); };
    window.addEventListener('vibe:notify-click', h);
    window.vibe?.onNotificationClick?.((id) => focusSession.current(id));
    window.vibe?.onNotificationApproval?.(({ sessionId, requestId, decision }) => approveRef.current(sessionId, requestId, decision));
    // Waking from sleep: reconnect the agent socket (re-attaches every live session) and the shells at once.
    window.vibe?.onPowerResume?.(() => { agentClient.reconnectNow(); reconnectTerminals(); });
    return () => window.removeEventListener('vibe:notify-click', h);
  }, []);
  // Keep the Mac awake only while an agent turn or a busy shell is in flight; re-evaluated on session changes and every 10s for shells.
  const sessionsForPower = useRef(S.sessions);
  sessionsForPower.current = S.sessions;
  useEffect(() => {
    if (!window.vibe?.keepAwake) return;
    let last: boolean | null = null;
    const update = () => {
      const busy = keepAwakeEnabled() && workInProgress(Object.values(sessionsForPower.current), terminalsBusy());
      if (busy !== last) { last = busy; window.vibe!.keepAwake!(busy); }
    };
    update();
    const timer = window.setInterval(update, 10000);
    window.addEventListener('vibe:keep-awake', update);
    return () => { window.clearInterval(timer); window.removeEventListener('vibe:keep-awake', update); window.vibe!.keepAwake!(false); };
  }, []);
  useEffect(() => { window.dispatchEvent(new Event('vibe:keep-awake')); }, [S.sessions]);
  // Trackpad swipes step through the session tabs (right = previous, like "back"). While the Browser tab's
  // native view holds focus, the swipe is its history instead.
  const swipeRef = useRef<(dir: SwipeDirection) => void>(() => {});
  swipeRef.current = (dir) => {
    if (rightTab === 'browser' && !rightCollapsed && !document.hasFocus() && window.vibe?.browser) {
      void (dir === 'right' ? window.vibe.browser.back() : window.vibe.browser.forward());
      return;
    }
    const list = view === 'agent' ? sortSessions(Object.values(S.sessions)) : projectSessions;
    const current = view === 'agent' ? agentActive : session?.id;
    const next = list[list.findIndex((s) => s.id === current) + (dir === 'right' ? -1 : 1)];
    if (!next) return;
    if (view === 'agent') setAgentActive(next.id); else setActiveSession(next.id);
  };
  useEffect(() => installGestures((dir) => swipeRef.current(dir)), []);

  const isFavorite = !!listing && favorites.favorites.some((f) => f.path === listing.path);
  const toggleFavorite = () => {
    if (!listing) return;
    (isFavorite ? api.removeFavorite(listing.path) : api.addFavorite(listing.path)).then(setFavorites).catch(() => {});
  };
  const pickFolder = async () => {
    if (window.vibe?.pickFolder) { const p = await window.vibe.pickFolder(); if (p) openProject(p); }
    else { const p = window.prompt(t('app.folderPathPrompt'), listing?.path ?? '~'); if (p) openProject(p); }
  };
  const start = (c: string, o?: StartOptions) => S.start(c, o).then(setActiveSession).catch((e) => alertDialog(e.message, 'error'));
  const closeSession = async (id: string) => {
    const s = S.sessions[id];
    if (!s) return;
    if ((s.status === 'running' || s.status === 'compacting') && !(await confirmDialog(t('app.confirmCloseRunning'), { ok: t('common.close') }))) return;
    S.close(id);
    if (activeSession === id) setActiveSession(null);
  };
  const resumeSession = (s: RecentSession) => {
    const dir = s.cwd ?? project ?? cwd;
    if (s.cwd && s.cwd !== project) openProject(s.cwd);
    void start(dir, { agent: s.agent, resume: s.sessionId, title: s.title || undefined });
  };
  const attach = (entries: Entry[]) => {
    setPendingAttachments((prev) => [...prev, ...entries.filter((e) => !e.isDir).map((e) => ({ path: e.path, name: e.name, kind: IMAGE_RE.test(e.name) ? 'image' as const : 'file' as const }))]);
    if (!session && project) setActiveSession(null);
  };

  const rightTabs = [['files', t('app.tab.files')], ['preview', t('app.tab.preview')], ['browser', t('app.tab.browser')], ['terminal', t('app.tab.terminal')], ['git', t('app.tab.git')]] as const;

  // Global keyboard shortcuts.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (document.querySelector('[data-update-locked="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      const inText = (e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]');
      if (k === 'p' && !e.shiftKey) { e.preventDefault(); if (project) setQuickOpen((v) => !v); }
      else if (k === 'b') { e.preventDefault(); setCollapsed((v) => !v); }
      else if (k === 'j') { e.preventDefault(); setRightCollapsed((v) => !v); }
      else if (k === 'k') { e.preventDefault(); window.dispatchEvent(new Event('vibe:focus-composer')); }
      else if (k === 'f' && !e.shiftKey && !(e.target as HTMLElement)?.closest?.('[data-own-find]')) { e.preventDefault(); window.dispatchEvent(new Event('vibe:chat-search')); }
      else if (k === 'n' && !e.shiftKey) { e.preventDefault(); if (view === 'agent') setAgentActive('new'); else if (project) setActiveSession('new'); }
      else if (k === 'w') {
        e.preventDefault();
        const target = view === 'agent' ? S.sessions[agentActive ?? ''] : session;
        if (target) void (async () => {
          if ((target.status === 'running' || target.status === 'compacting') && !(await confirmDialog(t('app.confirmCloseRunning'), { ok: t('common.close') }))) return;
          S.close(target.id);
          if (view === 'agent') setAgentActive(null); else setActiveSession(null);
        })();
      }
      else if (k === '/') { e.preventDefault(); setShowTools(true); }
      else if (['1', '2', '3', '4', '5'].includes(e.key) && !inText) { e.preventDefault(); setRightTab(rightTabs[Number(e.key) - 1][0]); setRightCollapsed(false); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [project, session, S, view, agentActive]);

  return (
      <div className="h-full flex flex-col">
        <Lightbox />
        <UsageBar mode={view} onMode={setView} companions={companions} onCompanions={() => setCompanions((v) => !v)} />
        {companions && <SessionCompanions sessions={Object.values(S.sessions)} scene={`${view}:${rightTab}:${rightCollapsed}`} />}
        {view === 'agent' ? (
          <AgentView home={home?.home ?? '~'} S={S} active={agentActive} setActive={setAgentActive} />
        ) : (
        <div className="flex-1 flex min-h-0 relative">
          <div data-companion-zone="left" data-companion-wall="right" style={{ width: collapsed ? 40 : sidebar.width }} className={`shrink-0 h-full overflow-hidden ${paneTransition}`}>
            <Sidebar home={home} favorites={favorites} recent={recent} cwd={project ?? ''} collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)}
              onNavigate={openProject} onFavoritesChange={setFavorites} onRecentChange={setRecent}
              onPickFolder={pickFolder} onOpenSettings={() => setShowTools(true)} onResumeSession={resumeSession} />
          </div>
          {!collapsed && <Splitter onStart={() => setDragging(true)} onEnd={() => setDragging(false)} onDrag={(dx) => sidebar.setWidth(sidebar.width + dx)} />}
          <main className="flex-1 min-w-0 flex bg-surface-0">
            <div data-companion-zone="prompt" className="flex-1 min-w-0 flex flex-col">
              {project && projectSessions.length > 0 && (
                <div data-companion-floor="session-tabs" data-companion-edge="bottom" className="h-9 shrink-0 flex items-center gap-1 px-2 border-b border-fill/10 text-xs overflow-x-auto">
                  {projectSessions.map((s) => (
                    <div key={s.id} onClick={() => setActiveSession(s.id)} onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeSession(s.id); } }}
                      onContextMenu={(e) => menu.open(e, sessionMenu(s, S.setPinned, () => closeSession(s.id)))}
                      className={`group flex items-center gap-1.5 rounded-md pl-2.5 pr-1 py-1 whitespace-nowrap cursor-pointer ${session?.id === s.id ? 'bg-fill/10 text-fg' : 'text-fg-3 hover:bg-fill/5'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${s.status === 'running' || s.status === 'compacting' ? 'bg-amber-400 animate-pulse' : s.status === 'closed' ? 'bg-fg-5' : 'bg-emerald-400'}`} />
                      <AgentIcon agent={s.agent} size={14} />
                      {s.pinned && <span className="text-[9px]" title={t('common.pin')}>📌</span>}
                      <span className="text-fg-4">{displayTitle(s, 18) ?? t('common.new')}</span>
                      <AttentionBadge s={s} />
                      <button className="ml-1 w-5 h-5 flex items-center justify-center rounded text-fg-4 hover:text-fg hover:bg-fill/15 opacity-0 group-hover:opacity-100" title={t('app.closeSession')}
                        onClick={(e) => { e.stopPropagation(); closeSession(s.id); }}><Icon name="close" size={11} /></button>
                    </div>
                  ))}
                  <button className="w-7 h-7 flex items-center justify-center rounded-md text-fg-3 hover:text-fg hover:bg-fill/10" onClick={() => setActiveSession('new')} title={t('app.newSession')}><Icon name="plus" /></button>
                </div>
              )}
              <div className="flex-1 min-h-0">
                <ChatPanel cwd={project} session={session}
                  onStart={start}
                  onSend={(t, a) => session && S.send(session.id, t, a)}
                  onApprove={(r, d, m) => session && S.approve(session.id, r, d, m)}
                  onAnswer={(r, a) => session && S.answer(session.id, r, a)}
                  onInterrupt={() => session && S.interrupt(session.id)}
                  onMode={(m) => session && S.setMode(session.id, m)}
                  onModel={(m) => session && S.setModel(session.id, m)}
                  onClose={() => { if (session) { S.close(session.id); setActiveSession(null); } }}
                  pendingAttachments={pendingAttachments} onConsumeAttachments={() => setPendingAttachments([])}
                  background={backgroundSessions(S.sessions, session?.id)} onFocusSession={(id) => focusSession.current(id)}
                  onRewind={(id, dry) => session ? S.rewind(session.id, id, dry) : Promise.resolve({ canRewind: false })} />
              </div>
            </div>
            {!rightCollapsed && <Splitter onStart={() => setDragging(true)} onEnd={() => setDragging(false)} onDrag={(dx) => right.setWidth(right.width - dx)} />}
            {rightCollapsed && (
              <div className="w-9 shrink-0 flex flex-col items-center border-l border-fill/10 bg-surface-1 py-2 gap-1">
                <button className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-fill/10 text-fg-3" onClick={() => setRightCollapsed(false)} title={t('app.expandPanel')}><Icon name="chevronsLeft" /></button>
                {rightTabs.map(([t, label]) => (
                  <button key={t} title={label} onClick={() => { setRightTab(t); setRightCollapsed(false); }}
                    className={`w-7 h-7 rounded text-[10px] ${rightTab === t ? 'bg-fill/15 text-fg' : 'text-fg-4 hover:bg-fill/10'}`}>{label.slice(0, 1)}</button>
                ))}
              </div>
            )}
            <div data-companion-zone="right" data-companion-wall="left" style={{ width: rightCollapsed ? 0 : right.width }} className={`shrink-0 flex flex-col min-w-0 overflow-hidden ${paneTransition}`}>
              <div data-companion-floor="right-tabs" data-companion-edge="bottom" className="h-10 shrink-0 flex items-stretch border-b border-fill/10 text-xs" style={{ minWidth: right.width }}>
                <div className="flex-1 min-w-0 flex items-stretch overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {rightTabs.map(([t, label]) => (
                    <button key={t} className={`shrink-0 px-3 ${rightTab === t ? 'text-fg border-b-2 border-blue-400' : 'text-fg-4 hover:text-fg-2'}`} onClick={() => setRightTab(t)}>{label}</button>
                  ))}
                </div>
                {project && (
                  <button className="shrink-0 self-center mr-1 px-2 py-1 rounded text-fg-3 hover:text-fg hover:bg-fill/5" title={t('app.openProjectIn')}
                    onClick={(e) => menu.open(e, [
                      { label: t('common.openInTerminal'), onClick: () => api.open(project, 'terminal').catch(() => {}) },
                      { label: t('common.revealInFinder'), onClick: () => api.open(project, 'finder').catch(() => {}) },
                      { label: t('common.openInVSCode'), onClick: () => api.open(project, 'vscode').catch(() => {}) },
                      { label: t('common.openInCursor'), onClick: () => api.open(project, 'cursor').catch(() => {}) },
                      { separator: true },
                      { label: t('common.copyPath'), onClick: () => navigator.clipboard.writeText(project) },
                    ])}>{t('app.openMenu')}</button>
                )}
                <button className="shrink-0 self-center w-7 h-7 mr-1 flex items-center justify-center rounded-md hover:bg-fill/10 text-fg-3" onClick={() => setRightCollapsed(true)} title={t('app.collapsePanel')}><Icon name="chevronsRight" /></button>
              </div>
              <div className="flex-1 min-h-0 relative" style={{ minWidth: right.width }}>
                <div className={`absolute inset-0 ${rightTab === 'files' ? '' : 'invisible'}`}>
                  <FileList listing={listing} error={error} isFavorite={isFavorite}
                    onNavigate={navigate} onPreview={(e) => { setSelected(e); setRightTab('preview'); }} onToggleFavorite={toggleFavorite}
                    onRefresh={() => setRefreshTick((t) => t + 1)} onAttach={project ? attach : undefined} />
                </div>
                <div className={`absolute inset-0 ${rightTab === 'preview' ? '' : 'invisible'}`}><Preview entry={selected} /></div>
                <div className={`absolute inset-0 ${rightTab === 'browser' ? '' : 'invisible'}`}><BrowserPanel visible={rightTab === 'browser' && !rightCollapsed} onCapture={(a) => setPendingAttachments((prev) => [...prev, a])} /></div>
                <div className={`absolute inset-0 ${rightTab === 'terminal' ? '' : 'invisible'}`}><TerminalPanel cwd={project} visible={rightTab === 'terminal'} /></div>
                <div className={`absolute inset-0 ${rightTab === 'git' ? '' : 'invisible'}`}><GitPanel cwd={project} visible={rightTab === 'git'} /></div>
              </div>
            </div>
          </main>
          {showTools && <ToolsPanel onClose={() => setShowTools(false)} />}
          {quickOpen && project && (
            <QuickOpen cwd={project} onClose={() => setQuickOpen(false)}
              onOpen={(h) => { if (h.isDir) navigate(h.path); else api.stat(h.path).then((e) => { setSelected(e); setRightTab('preview'); setRightCollapsed(false); }).catch(() => {}); }}
              onAttach={(h) => { if (!h.isDir) attach([{ path: h.path, name: h.rel.split('/').pop() ?? h.rel, isDir: false, size: 0, mtime: 0, ext: '', hidden: false, kind: 'binary' }]); }} />
          )}
        </div>
        )}
      </div>
  );
}

/** Agent mode: free conversation not tied to a project. Left: live sessions; center: chat / all previous conversations. */
function AgentView({ home, S, active, setActive }: { home: string; S: ReturnType<typeof useSessions>; active: string | 'new' | null; setActive: (v: string | 'new' | null) => void }) {
  useLang();
  const menu = useContextMenu();
  const live = sortSessions(Object.values(S.sessions));
  const session = active && active !== 'new' ? S.sessions[active] ?? null : null;
  const start = (c: string, o?: StartOptions) => S.start(c, o).then(setActive).catch((e) => alertDialog(e.message, 'error'));
  return (
    <div className="flex-1 flex min-h-0 relative">
      <aside data-companion-zone="left" data-companion-wall="right" className="w-64 shrink-0 h-full flex flex-col border-r border-fill/10">
        <div className="h-10 flex items-center px-3 text-xs text-fg-4">
          <span className="font-medium text-fg-3">{t('app.agent')}</span>
          <div className="flex-1" />
          <button className="px-2 py-1 rounded hover:bg-fill/10 text-fg-2" onClick={() => setActive('new')} title={t('app.newConversation')}>{t('app.newBtn')}</button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-1">
          <div className="px-2 mb-1 text-[11px] uppercase tracking-wider text-fg-4">{t('app.openSessions')}</div>
          {live.length === 0 && <div className="px-2 text-xs text-fg-5">{t('app.nothingOpen')}</div>}
          {live.map((s) => (
            <div key={s.id} onClick={() => setActive(s.id)}
              onContextMenu={(e) => menu.open(e, sessionMenu(s, S.setPinned, async () => {
                if ((s.status === 'running' || s.status === 'compacting') && !(await confirmDialog(t('app.confirmCloseRunning'), { ok: t('common.close') }))) return;
                S.close(s.id); if (session?.id === s.id) setActive(null);
              }))}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer ${session?.id === s.id ? 'bg-fill/10 text-fg' : 'text-fg-2 hover:bg-fill/5'}`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.status === 'running' || s.status === 'compacting' ? 'bg-amber-400 animate-pulse' : s.status === 'closed' ? 'bg-fg-5' : 'bg-emerald-400'}`} />
              <AgentIcon agent={s.agent} size={16} />
              {s.pinned && <span className="text-[10px]" title={t('common.pin')}>📌</span>}
              <span className="truncate flex-1">{displayTitle(s, 40) ?? t('common.new')}</span>
              <AttentionBadge s={s} />
              <span className="text-[10px] text-fg-5 truncate max-w-[70px]" title={s.cwd}>{s.cwd.split('/').pop()}</span>
            </div>
          ))}
        </div>
        <div data-companion-floor="agent-list-bottom" className="h-px shrink-0 bg-fill/10 mb-4" />
      </aside>
      <div className="flex-1 min-w-0 bg-surface-0">
        <ChatPanel cwd={home} scope="all" session={session}
          onStart={start}
          onSend={(t, a) => session && S.send(session.id, t, a)}
          onApprove={(r, d, m) => session && S.approve(session.id, r, d, m)}
          onAnswer={(r, a) => session && S.answer(session.id, r, a)}
          onInterrupt={() => session && S.interrupt(session.id)}
          onMode={(m) => session && S.setMode(session.id, m)}
          onModel={(m) => session && S.setModel(session.id, m)}
          onClose={() => { if (session) { S.close(session.id); setActive(null); } }}
          background={backgroundSessions(S.sessions, session?.id)} onFocusSession={setActive}
          onRewind={(id, dry) => session ? S.rewind(session.id, id, dry) : Promise.resolve({ canRewind: false })} />
      </div>
    </div>
  );
}

/** Every other live session that is working or waiting, for the chips beside the composer's "Attach". */
function backgroundSessions(sessions: Record<string, ChatSession>, currentId?: string): BackgroundSession[] {
  const out: BackgroundSession[] = [];
  for (const s of Object.values(sessions)) {
    if (s.id === currentId) continue;
    const state = backgroundState(s);
    if (state) out.push({ id: s.id, name: displayTitle(s, 18) ?? s.cwd.split('/').pop() ?? t('common.new'), state });
  }
  // Sessions that stopped to ask something come first: they block until the user answers.
  return out.sort((a, b) => (a.state === b.state ? 0 : a.state === 'waiting' ? -1 : 1));
}

/** Amber count on a session tab while its turn is blocked on approvals or questions. */
function AttentionBadge({ s }: { s: ChatSession }) {
  const n = pendingRequests(s);
  if (!n) return null;
  return <span className="min-w-4 h-4 px-1 rounded-full bg-amber-400 text-[10px] font-semibold leading-4 text-center text-black shrink-0" title={t('app.waitingRequests', { n })}>{n}</span>;
}

/** Right-click menu shared by project tabs and the Agent view list. */
function sessionMenu(s: ChatSession, setPinned: (id: string, pinned: boolean) => void, close: () => void): MenuItem[] {
  return [
    { label: t(s.pinned ? 'common.unpin' : 'common.pin'), onClick: () => setPinned(s.id, !s.pinned) },
    { separator: true },
    { label: t('app.closeSession'), shortcut: '⌘W', danger: true, onClick: close },
  ];
}
