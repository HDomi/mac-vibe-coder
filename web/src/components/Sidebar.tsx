import { useEffect, useState } from 'react';
import { api, type Favorite, type FavoriteGroup, type Favorites, type HomeInfo, type RecentSession } from '../lib/api';
import { useContextMenu, type MenuItem } from './ContextMenu';

interface Props {
  home: HomeInfo | null;
  favorites: Favorites;
  recent: string[];
  cwd: string;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: (path: string) => void;
  onFavoritesChange: (f: Favorites) => void;
  onRecentChange: (r: string[]) => void;
  onPickFolder: () => void;
  onOpenSettings: () => void;
  onResumeSession: (s: RecentSession) => void;
}

const DRAG_FAV = 'application/x-vibe-favorite';

function Item({ label, path, active, onClick, onContextMenu, hint, indent, draggable, onDragStart }: {
  label: string; path: string; active: boolean; onClick: () => void; onContextMenu?: (e: React.MouseEvent) => void; hint?: string; indent?: boolean;
  draggable?: boolean; onDragStart?: (e: React.DragEvent) => void;
}) {
  return (
    <div
      className={`group flex items-center gap-2 rounded-md py-1.5 text-sm cursor-pointer select-none ${indent ? 'pl-6 pr-2' : 'px-2'} ${active ? 'bg-white/10 text-white' : 'text-zinc-300 hover:bg-white/5'}`}
      onClick={onClick} onContextMenu={onContextMenu} title={path} draggable={draggable} onDragStart={onDragStart}
    >
      <span className="text-zinc-500">▸</span>
      <span className="truncate flex-1">{label}</span>
      {hint && <span className="text-[10px] text-zinc-600">{hint}</span>}
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="px-2 mb-1 text-[11px] uppercase tracking-wider text-zinc-500 flex items-center">{title}<div className="flex-1" />{right}</div>
      {children}
    </div>
  );
}

function commonItems(path: string): MenuItem[] {
  return [
    { label: 'Open in Terminal', onClick: () => api.open(path, 'terminal').catch(() => {}) },
    { label: 'Open in VS Code', onClick: () => api.open(path, 'vscode').catch(() => {}) },
    { label: 'Open in Cursor', onClick: () => api.open(path, 'cursor').catch(() => {}) },
    { label: 'Reveal in Finder', onClick: () => api.open(path, 'finder').catch(() => {}) },
    { label: 'Copy Path', onClick: () => navigator.clipboard.writeText(path) },
  ];
}

function InlineInput({ value, onCommit, onCancel, className }: { value: string; onCommit: (v: string) => void; onCancel: () => void; className?: string }) {
  const [draft, setDraft] = useState(value);
  return (
    <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => onCommit(draft)}
      onKeyDown={(e) => { if (e.key === 'Enter') onCommit(draft); if (e.key === 'Escape') onCancel(); }}
      onClick={(e) => e.stopPropagation()}
      className={`w-full bg-black/40 rounded px-2 py-1 text-sm outline-none border border-blue-400/50 ${className ?? ''}`} />
  );
}

export default function Sidebar(p: Props) {
  const menu = useContextMenu();
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  const [renaming, setRenaming] = useState<{ kind: 'fav' | 'group' | 'session'; id: string } | null>(null);
  const reloadSessions = () => api.historyAll().then(setSessions).catch(() => {});
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const { favorites, groups } = p.favorites;
  const apply = (pr: Promise<Favorites>) => pr.then(p.onFavoritesChange).catch(() => {});

  useEffect(() => {
    const load = () => api.historyAll().then(setSessions).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  if (p.collapsed) {
    return (
      <aside className="w-10 shrink-0 h-full flex flex-col items-center border-r border-white/10 bg-[#0e1117] py-2 gap-2">
        <button className="w-7 h-7 rounded hover:bg-white/10 text-zinc-400" onClick={p.onToggle} title="Expand sidebar">»</button>
        <div className="flex-1 flex flex-col items-center gap-1 overflow-hidden">
          {favorites.slice(0, 12).map((f) => (
            <button key={f.path} title={f.name} onClick={() => p.onNavigate(f.path)}
              className={`w-7 h-7 rounded text-[11px] font-medium ${p.cwd === f.path ? 'bg-white/15 text-white' : 'bg-white/5 text-zinc-400 hover:bg-white/10'}`}>
              {f.name.slice(0, 2).toUpperCase()}
            </button>
          ))}
        </div>
        <button className="w-7 h-7 rounded hover:bg-white/10 text-zinc-400" onClick={p.onPickFolder} title="Open folder">＋</button>
        <button className="w-7 h-7 rounded hover:bg-white/10 text-zinc-400" onClick={p.onOpenSettings} title="Settings">⚙</button>
      </aside>
    );
  }

  const moveItems = (f: Favorite): MenuItem[] => [
    ...groups.filter((g) => g.id !== f.group).map((g) => ({ label: `Move to “${g.name}”`, onClick: () => apply(api.updateFavorite(f.path, { group: g.id })) })),
    ...(f.group ? [{ label: 'Move to top level', onClick: () => apply(api.updateFavorite(f.path, { group: null })) }] : []),
    { label: 'New Group…', onClick: () => setCreatingGroup(true) },
  ];
  const favMenu = (f: Favorite): MenuItem[] => [
    { label: 'Open', onClick: () => p.onNavigate(f.path) },
    { label: 'Rename…', onClick: () => setRenaming({ kind: 'fav', id: f.path }) },
    { separator: true },
    ...moveItems(f),
    { separator: true },
    ...commonItems(f.path),
    { separator: true },
    { label: 'Remove from Favorites', danger: true, onClick: () => apply(api.removeFavorite(f.path)) },
  ];
  const groupMenu = (g: FavoriteGroup): MenuItem[] => [
    { label: g.collapsed ? 'Expand' : 'Collapse', onClick: () => apply(api.updateFavoriteGroup(g.id, { collapsed: !g.collapsed })) },
    { label: 'Rename…', onClick: () => setRenaming({ kind: 'group', id: g.id }) },
    { label: 'New Group…', onClick: () => setCreatingGroup(true) },
    { separator: true },
    { label: 'Delete Group (keep favorites)', danger: true, onClick: () => apply(api.removeFavoriteGroup(g.id)) },
  ];
  const recentMenu = (r: string): MenuItem[] => [
    { label: 'Open', onClick: () => p.onNavigate(r) },
    { label: favorites.some((f) => f.path === r) ? 'Already in Favorites' : 'Add to Favorites', disabled: favorites.some((f) => f.path === r), onClick: () => apply(api.addFavorite(r)) },
    { separator: true },
    ...commonItems(r),
    { separator: true },
    { label: 'Remove from Recent', danger: true, onClick: () => api.removeRecent(r).then(p.onRecentChange).catch(() => {}) },
  ];

  const dropTarget = (groupId: string | null) => ({
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG_FAV)) { e.preventDefault(); setDragOver(groupId ?? '__top__'); } },
    onDragLeave: () => setDragOver(null),
    onDrop: (e: React.DragEvent) => {
      const path = e.dataTransfer.getData(DRAG_FAV);
      setDragOver(null);
      if (path) { e.preventDefault(); apply(api.updateFavorite(path, { group: groupId })); }
    },
  });

  const renderFav = (f: Favorite, indent: boolean) => renaming?.kind === 'fav' && renaming.id === f.path ? (
    <div key={f.path} className={indent ? 'pl-6 pr-2' : 'px-2'}>
      <InlineInput value={f.name} onCancel={() => setRenaming(null)} onCommit={(v) => { setRenaming(null); if (v.trim() && v !== f.name) apply(api.updateFavorite(f.path, { name: v })); }} />
    </div>
  ) : (
    <Item key={f.path} label={f.name} path={f.path} active={p.cwd === f.path} indent={indent} onClick={() => p.onNavigate(f.path)} onContextMenu={(e) => menu.open(e, favMenu(f))}
      draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_FAV, f.path); e.dataTransfer.effectAllowed = 'move'; }} />
  );

  const topLevel = favorites.filter((f) => !f.group || !groups.some((g) => g.id === f.group));

  return (
    <aside className="h-full flex flex-col border-r border-white/10 bg-[#0e1117] min-w-0">
      <div className="h-10 flex items-center px-3 text-xs text-zinc-500">
        <span className="flex-1 pl-1 font-medium text-zinc-400">Mac Vibe Coder</span>
        <button className="w-6 h-6 rounded hover:bg-white/10 text-zinc-400" onClick={p.onToggle} title="Collapse sidebar">«</button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <Section title="Favorites" right={<button className="text-[11px] text-zinc-500 hover:text-zinc-200" title="New group" onClick={() => setCreatingGroup(true)}>＋ group</button>}>
          {creatingGroup && (
            <div className="px-2 mb-1 flex items-center gap-1">
              <span>📁</span>
              <InlineInput value="New Group" onCancel={() => setCreatingGroup(false)} onCommit={(v) => { setCreatingGroup(false); if (v.trim()) apply(api.addFavoriteGroup(v)); }} />
            </div>
          )}
          {groups.map((g) => {
            const items = favorites.filter((f) => f.group === g.id);
            return (
              <div key={g.id} className={`rounded-md ${dragOver === g.id ? 'bg-blue-500/15 ring-1 ring-blue-400/40' : ''}`} {...dropTarget(g.id)}>
                <div className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-zinc-200 cursor-pointer select-none hover:bg-white/5"
                  onClick={() => apply(api.updateFavoriteGroup(g.id, { collapsed: !g.collapsed }))} onContextMenu={(e) => menu.open(e, groupMenu(g))}>
                  <span className="text-[10px] text-zinc-500 w-3">{g.collapsed ? '▸' : '▾'}</span>
                  <span>{g.collapsed ? '📁' : '📂'}</span>
                  {renaming?.kind === 'group' && renaming.id === g.id
                    ? <InlineInput value={g.name} onCancel={() => setRenaming(null)} onCommit={(v) => { setRenaming(null); if (v.trim() && v !== g.name) apply(api.updateFavoriteGroup(g.id, { name: v })); }} />
                    : <span className="truncate flex-1 font-medium">{g.name}</span>}
                  <span className="text-[10px] text-zinc-600">{items.length}</span>
                </div>
                {!g.collapsed && items.map((f) => renderFav(f, true))}
                {!g.collapsed && items.length === 0 && <div className="pl-8 pr-2 py-1 text-[11px] text-zinc-600">Drop favorites here</div>}
              </div>
            );
          })}
          <div className={`rounded-md min-h-[8px] ${dragOver === '__top__' ? 'bg-blue-500/15 ring-1 ring-blue-400/40' : ''}`} {...dropTarget(null)}>
            {topLevel.map((f) => renderFav(f, false))}
          </div>
          {favorites.length === 0 && !creatingGroup && <div className="px-2 text-xs text-zinc-600">Click ☆ in the file browser or right-click a recent folder.</div>}
        </Section>
        {p.recent.length > 0 && (
          <Section title="Recent" right={<button className="text-[10px] text-zinc-600 hover:text-zinc-300" onClick={() => Promise.all(p.recent.map((r) => api.removeRecent(r))).then(() => p.onRecentChange([])).catch(() => {})}>clear</button>}>
            {p.recent.slice(0, 8).map((r) => (
              <Item key={r} label={r.split('/').pop() || r} path={r} active={p.cwd === r} onClick={() => p.onNavigate(r)} onContextMenu={(e) => menu.open(e, recentMenu(r))} />
            ))}
          </Section>
        )}
      </div>
      {/* Recent sessions: pinned to the bottom quarter of the sidebar with its own scroll. */}
      <div className="h-1/4 min-h-[120px] shrink-0 flex flex-col border-t border-white/10 bg-[#0b0d12]">
        <div className="h-8 shrink-0 flex items-center gap-2 px-3 bg-white/[0.04] border-b border-white/5">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
          <span className="text-[11px] font-semibold tracking-wide text-zinc-300">Recent Sessions</span>
          <span className="text-[10px] text-zinc-500 rounded-full bg-white/5 px-1.5">{sessions.length}</span>
          <div className="flex-1" />
          <button className="text-[11px] text-zinc-500 hover:text-zinc-200" onClick={() => api.historyAll().then(setSessions).catch(() => {})} title="Refresh">↻</button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {sessions.length === 0 && <div className="px-2 py-2 text-xs text-zinc-600">No sessions yet</div>}
          {sessions.map((s) => renaming?.kind === 'session' && renaming.id === s.sessionId ? (
            <div key={s.agent + s.sessionId} className="px-2">
              <InlineInput value={s.title} onCancel={() => setRenaming(null)} onCommit={(v) => { setRenaming(null); if (v.trim() && v !== s.title) api.historyRename(s.agent, s.sessionId, v.trim(), s.cwd ?? undefined).then(reloadSessions).catch(() => {}); }} />
            </div>
          ) : (
            <Item key={s.agent + s.sessionId} label={s.title} path={s.cwd ?? s.sessionId} active={false} hint={s.agent === 'codex' ? 'codex' : 'claude'}
              onClick={() => p.onResumeSession(s)}
              onContextMenu={(e) => menu.open(e, [
                { label: 'Resume', onClick: () => p.onResumeSession(s) },
                { label: 'Rename…', onClick: () => setRenaming({ kind: 'session', id: s.sessionId }) },
                { label: 'Copy session id', onClick: () => navigator.clipboard.writeText(s.sessionId) },
                ...(s.cwd ? [{ separator: true }, ...commonItems(s.cwd)] : []),
                { separator: true },
                { label: s.agent === 'codex' ? 'Archive' : 'Delete', danger: true, onClick: () => { if (window.confirm(`${s.agent === 'codex' ? 'Archive' : 'Delete'} session “${s.title}”?`)) api.historyDelete(s.agent, s.sessionId, s.cwd ?? undefined).then(reloadSessions).catch(() => {}); } },
              ])} />
          ))}
        </div>
      </div>
      <div className="p-2 border-t border-white/10 flex gap-2">
        <button className="flex-1 text-sm rounded-md bg-white/5 hover:bg-white/10 py-1.5" onClick={p.onPickFolder}>Open Folder…</button>
        <button className="text-sm rounded-md bg-white/5 hover:bg-white/10 px-3" onClick={p.onOpenSettings} title="Settings">⚙</button>
      </div>
    </aside>
  );
}
