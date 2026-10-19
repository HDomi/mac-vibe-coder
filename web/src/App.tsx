import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Entry, type Favorites, type HomeInfo, type Listing, type RecentSession } from './lib/api';
import type { Attachment } from './lib/agent';
import { requestNotificationPermission, useSessions } from './lib/useSessions';
import Sidebar from './components/Sidebar';
import FileList from './components/FileList';
import Preview from './components/Preview';
import ToolsPanel from './components/ToolsPanel';
import UsageBar from './components/UsageBar';
import ChatPanel, { type StartOptions } from './components/ChatPanel';
import TerminalPanel from './components/TerminalPanel';
import GitPanel from './components/GitPanel';
import Splitter, { usePaneWidth } from './components/Splitter';
import { ContextMenuProvider } from './components/ContextMenu';

const LS_CWD = 'vibe.cwd';
const LS_PROJECT = 'vibe.project';
const LS_SIDEBAR = 'vibe.sidebar.collapsed';
const LS_RIGHT = 'vibe.right.collapsed';

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic)$/i;

export default function App() {
  const [home, setHome] = useState<HomeInfo | null>(null);
  const [favorites, setFavorites] = useState<Favorites>({ favorites: [], groups: [] });
  const [recent, setRecent] = useState<string[]>([]);
  const [cwd, setCwd] = useState<string>(() => { try { return localStorage.getItem(LS_CWD) || '~'; } catch { return '~'; } });
  const [project, setProject] = useState<string | null>(() => { try { return localStorage.getItem(LS_PROJECT); } catch { return null; } });
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [rightTab, setRightTab] = useState<'files' | 'preview' | 'terminal' | 'git'>('files');
  const [activeSession, setActiveSession] = useState<string | 'new' | null>(null);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(LS_SIDEBAR) === '1'; } catch { return false; } });
  const [rightCollapsed, setRightCollapsed] = useState(() => { try { return localStorage.getItem(LS_RIGHT) === '1'; } catch { return false; } });
  const [dragging, setDragging] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const sidebar = usePaneWidth('vibe.w.sidebar', 256, 180, 480);
  const right = usePaneWidth('vibe.w.right', 420, 280, 1200);
  const S = useSessions();

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

  useEffect(() => { try { project ? localStorage.setItem(LS_PROJECT, project) : localStorage.removeItem(LS_PROJECT); } catch { /* ignore */ } }, [project]);
  useEffect(() => { const h = () => requestNotificationPermission(); window.addEventListener('click', h, { once: true }); return () => window.removeEventListener('click', h); }, []);

  const projectSessions = Object.values(S.sessions).filter((s) => s.cwd === project);
  const session = activeSession === 'new' ? null
    : (activeSession && S.sessions[activeSession]?.cwd === project ? S.sessions[activeSession] : projectSessions[projectSessions.length - 1]) ?? null;

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

  const isFavorite = !!listing && favorites.favorites.some((f) => f.path === listing.path);
  const toggleFavorite = () => {
    if (!listing) return;
    (isFavorite ? api.removeFavorite(listing.path) : api.addFavorite(listing.path)).then(setFavorites).catch(() => {});
  };
  const pickFolder = async () => {
    if (window.vibe?.pickFolder) { const p = await window.vibe.pickFolder(); if (p) openProject(p); }
    else { const p = window.prompt('Folder path', listing?.path ?? '~'); if (p) openProject(p); }
  };
  const start = (c: string, o?: StartOptions) => S.start(c, o).then(setActiveSession);
  const resumeSession = (s: RecentSession) => {
    const dir = s.cwd ?? project ?? cwd;
    if (s.cwd && s.cwd !== project) openProject(s.cwd);
    void start(dir, { agent: s.agent, resume: s.sessionId });
  };
  const attach = (entries: Entry[]) => {
    setPendingAttachments((prev) => [...prev, ...entries.filter((e) => !e.isDir).map((e) => ({ path: e.path, name: e.name, kind: IMAGE_RE.test(e.name) ? 'image' as const : 'file' as const }))]);
    if (!session && project) setActiveSession(null);
  };

  const rightTabs = [['files', 'Files'], ['preview', 'Preview'], ['terminal', 'Terminal'], ['git', 'Git']] as const;

  return (
    <ContextMenuProvider>
      <div className="h-full flex flex-col">
        <UsageBar />
        <div className="flex-1 flex min-h-0 relative">
          <div style={{ width: collapsed ? 40 : sidebar.width }} className={`shrink-0 h-full overflow-hidden ${paneTransition}`}>
            <Sidebar home={home} favorites={favorites} recent={recent} cwd={project ?? ''} collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)}
              onNavigate={openProject} onFavoritesChange={setFavorites} onRecentChange={setRecent}
              onPickFolder={pickFolder} onOpenSettings={() => setShowTools(true)} onResumeSession={resumeSession} />
          </div>
          {!collapsed && <Splitter onStart={() => setDragging(true)} onEnd={() => setDragging(false)} onDrag={(dx) => sidebar.setWidth(sidebar.width + dx)} />}
          <main className="flex-1 min-w-0 flex">
            <div className="flex-1 min-w-0 flex flex-col">
              {project && projectSessions.length > 0 && (
                <div className="h-9 shrink-0 flex items-center gap-1 px-2 border-b border-white/10 text-xs overflow-x-auto">
                  {projectSessions.map((s) => (
                    <button key={s.id} onClick={() => setActiveSession(s.id)}
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 whitespace-nowrap ${session?.id === s.id ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${s.status === 'running' || s.status === 'compacting' ? 'bg-amber-400 animate-pulse' : s.status === 'closed' ? 'bg-zinc-600' : 'bg-emerald-400'}`} />
                      {s.agent === 'codex' ? 'Codex' : 'Claude'}
                      <span className="text-zinc-500">{(s.items.find((i) => i.kind === 'user') as { text?: string } | undefined)?.text?.slice(0, 18) ?? 'new'}</span>
                    </button>
                  ))}
                  <button className="px-2 py-1 text-zinc-400 hover:text-white" onClick={() => setActiveSession('new')} title="New session">＋</button>
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
                  pendingAttachments={pendingAttachments} onConsumeAttachments={() => setPendingAttachments([])} />
              </div>
            </div>
            {!rightCollapsed && <Splitter onStart={() => setDragging(true)} onEnd={() => setDragging(false)} onDrag={(dx) => right.setWidth(right.width - dx)} />}
            {rightCollapsed && (
              <div className="w-9 shrink-0 flex flex-col items-center border-l border-white/10 bg-[#0e1117] py-2 gap-1">
                <button className="w-7 h-7 rounded hover:bg-white/10 text-zinc-400" onClick={() => setRightCollapsed(false)} title="Expand panel">«</button>
                {rightTabs.map(([t, label]) => (
                  <button key={t} title={label} onClick={() => { setRightTab(t); setRightCollapsed(false); }}
                    className={`w-7 h-7 rounded text-[10px] ${rightTab === t ? 'bg-white/15 text-white' : 'text-zinc-500 hover:bg-white/10'}`}>{label.slice(0, 1)}</button>
                ))}
              </div>
            )}
            <div style={{ width: rightCollapsed ? 0 : right.width }} className={`shrink-0 flex flex-col min-w-0 overflow-hidden ${paneTransition}`}>
              <div className="h-10 shrink-0 flex items-center border-b border-white/10 text-xs" style={{ minWidth: right.width }}>
                {rightTabs.map(([t, label]) => (
                  <button key={t} className={`px-3 h-full ${rightTab === t ? 'text-white border-b-2 border-blue-400' : 'text-zinc-500 hover:text-zinc-300'}`} onClick={() => setRightTab(t)}>{label}</button>
                ))}
                <div className="flex-1" />
                {project && (
                  <div className="flex items-center gap-1 pr-2">
                    <button className="px-2 py-1 rounded text-zinc-400 hover:text-white hover:bg-white/5" title="Open in Terminal.app" onClick={() => api.open(project, 'terminal').catch(() => {})}>Terminal</button>
                    <button className="px-2 py-1 rounded text-zinc-400 hover:text-white hover:bg-white/5" title="Reveal in Finder" onClick={() => api.open(project, 'finder').catch(() => {})}>Finder</button>
                  </div>
                )}
                <button className="w-7 h-7 mr-1 rounded hover:bg-white/10 text-zinc-400" onClick={() => setRightCollapsed(true)} title="Collapse panel">»</button>
              </div>
              <div className="flex-1 min-h-0 relative" style={{ minWidth: right.width }}>
                <div className={`absolute inset-0 ${rightTab === 'files' ? '' : 'invisible'}`}>
                  <FileList listing={listing} error={error} isFavorite={isFavorite}
                    onNavigate={navigate} onPreview={(e) => { setSelected(e); setRightTab('preview'); }} onToggleFavorite={toggleFavorite}
                    onRefresh={() => setRefreshTick((t) => t + 1)} onAttach={project ? attach : undefined} />
                </div>
                <div className={`absolute inset-0 ${rightTab === 'preview' ? '' : 'invisible'}`}><Preview entry={selected} /></div>
                <div className={`absolute inset-0 ${rightTab === 'terminal' ? '' : 'invisible'}`}><TerminalPanel cwd={project} visible={rightTab === 'terminal'} /></div>
                <div className={`absolute inset-0 ${rightTab === 'git' ? '' : 'invisible'}`}><GitPanel cwd={project} visible={rightTab === 'git'} /></div>
              </div>
            </div>
          </main>
          {showTools && <ToolsPanel onClose={() => setShowTools(false)} />}
        </div>
      </div>
    </ContextMenuProvider>
  );
}
