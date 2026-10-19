import { useCallback, useEffect, useRef, useState } from 'react';
import { api, formatSize, type Entry, type Listing } from '../lib/api';
import { useContextMenu, type MenuItem } from './ContextMenu';

interface Props {
  listing: Listing | null;
  error: { code: string; message: string } | null;
  isFavorite: boolean;
  onNavigate: (path: string) => void;
  onPreview: (entry: Entry) => void;
  onToggleFavorite: () => void;
  onRefresh: () => void;
  onAttach?: (entries: Entry[]) => void;
}

const ICON: Record<string, string> = { markdown: '📝', image: '🖼️', video: '🎬', audio: '🎵', pdf: '📄', text: '📃', binary: '📦' };

interface Clipboard { paths: string[]; cut: boolean }
let clipboard: Clipboard | null = null; // module-level so it survives re-renders and folder changes

export default function FileList({ listing, error, isFavorite, onNavigate, onPreview, onToggleFavorite, onRefresh, onAttach }: Props) {
  const menu = useContextMenu();
  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const entries = (listing?.entries ?? []).filter((e) => showHidden || !e.hidden);
  const selectedEntries = entries.filter((e) => selected.has(e.path));
  const crumbs = listing ? listing.path.split('/').filter(Boolean) : [];

  useEffect(() => { setSelected(new Set()); setAnchor(null); setRenaming(null); }, [listing?.path]);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 3000); return () => clearTimeout(t); }, [note]);

  const fail = (e: unknown) => setNote((e as Error).message ?? String(e));

  const select = (e: Entry, ev: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
    setSelected((prev) => {
      const next = new Set(ev.metaKey || ev.ctrlKey ? prev : []);
      if (ev.shiftKey && anchor) {
        const a = entries.findIndex((x) => x.path === anchor); const b = entries.findIndex((x) => x.path === e.path);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) next.add(entries[i].path);
        return next;
      }
      if ((ev.metaKey || ev.ctrlKey) && prev.has(e.path)) next.delete(e.path); else next.add(e.path);
      return next;
    });
    if (!ev.shiftKey) setAnchor(e.path);
  };

  const open = (e: Entry) => (e.isDir ? onNavigate(e.path) : onPreview(e));

  const copy = (cut: boolean) => {
    if (!selectedEntries.length) return;
    clipboard = { paths: selectedEntries.map((e) => e.path), cut };
    void navigator.clipboard.writeText(clipboard.paths.join('\n'));
    setNote(`${cut ? 'Cut' : 'Copied'} ${clipboard.paths.length} item(s)`);
  };
  const paste = () => {
    if (!clipboard || !listing) return;
    const c = clipboard;
    (c.cut ? api.fsMove(c.paths, listing.path) : api.fsCopy(c.paths, listing.path)).then(() => { if (c.cut) clipboard = null; onRefresh(); }).catch(fail);
  };
  const trash = () => {
    if (!selectedEntries.length) return;
    api.fsTrash(selectedEntries.map((e) => e.path)).then(() => { setSelected(new Set()); onRefresh(); }).catch(fail);
  };
  const startRename = () => { const e = selectedEntries[0]; if (e) { setRenaming(e.path); setDraft(e.name); } };
  const commitRename = () => {
    const target = renaming; setRenaming(null);
    if (!target) return;
    const cur = entries.find((e) => e.path === target);
    if (!cur || draft === cur.name || !draft.trim()) return;
    api.fsRename(target, draft.trim()).then(onRefresh).catch(fail);
  };
  const createFolder = () => {
    setCreating(false);
    if (!listing || !draft.trim()) return;
    api.fsMkdir(listing.path, draft.trim()).then(onRefresh).catch(fail);
  };
  const duplicate = () => { const e = selectedEntries[0]; if (e) api.fsDuplicate(e.path).then(onRefresh).catch(fail); };

  const onKey = useCallback((ev: React.KeyboardEvent) => {
    if (renaming || creating) return;
    const mod = ev.metaKey || ev.ctrlKey;
    const idx = anchor ? entries.findIndex((e) => e.path === anchor) : -1;
    const moveTo = (i: number) => { const e = entries[Math.max(0, Math.min(entries.length - 1, i))]; if (e) { setSelected(new Set([e.path])); setAnchor(e.path); } };
    if (ev.key === 'ArrowDown') { ev.preventDefault(); moveTo(idx + 1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); moveTo(idx - 1); }
    else if (ev.key === 'Enter') { ev.preventDefault(); if (selectedEntries.length === 1) startRename(); }
    else if (mod && ev.key === 'ArrowDown') { ev.preventDefault(); const e = selectedEntries[0]; if (e) open(e); }
    else if (mod && ev.key === 'ArrowUp') { ev.preventDefault(); if (listing?.parent) onNavigate(listing.parent); }
    else if (ev.key === ' ') { ev.preventDefault(); const e = selectedEntries[0]; if (e && !e.isDir) onPreview(e); }
    else if (mod && ev.key.toLowerCase() === 'a') { ev.preventDefault(); setSelected(new Set(entries.map((e) => e.path))); }
    else if (mod && ev.key.toLowerCase() === 'c') { ev.preventDefault(); copy(false); }
    else if (mod && ev.key.toLowerCase() === 'x') { ev.preventDefault(); copy(true); }
    else if (mod && ev.key.toLowerCase() === 'v') { ev.preventDefault(); paste(); }
    else if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); duplicate(); }
    else if (mod && ev.key === 'Backspace') { ev.preventDefault(); trash(); }
    else if (ev.key === 'Backspace' && !mod) { ev.preventDefault(); if (listing?.parent) onNavigate(listing.parent); }
    else if (mod && ev.shiftKey && ev.key.toLowerCase() === 'n') { ev.preventDefault(); setDraft('untitled folder'); setCreating(true); }
    else if (ev.key === 'Escape') setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, anchor, selectedEntries, listing, renaming, creating]);

  const itemMenu = (e: Entry): MenuItem[] => {
    const sel = selected.has(e.path) ? selectedEntries : [e];
    if (!selected.has(e.path)) { setSelected(new Set([e.path])); setAnchor(e.path); }
    const many = sel.length > 1;
    return [
      { label: e.isDir ? 'Open' : 'Preview', onClick: () => open(e) },
      ...(onAttach ? [{ label: many ? `Attach ${sel.length} to Chat` : 'Attach to Chat', onClick: () => onAttach(sel) }] : []),
      { separator: true },
      { label: 'Reveal in Finder', onClick: () => api.open(e.path, 'finder').catch(fail) },
      ...(e.isDir ? [{ label: 'Open in Terminal', onClick: () => api.open(e.path, 'terminal').catch(fail) }] : []),
      { label: many ? 'Copy Paths' : 'Copy Path', onClick: () => navigator.clipboard.writeText(sel.map((x) => x.path).join('\n')) },
      { separator: true },
      { label: 'Copy', shortcut: '⌘C', onClick: () => { clipboard = { paths: sel.map((x) => x.path), cut: false }; setNote(`Copied ${sel.length}`); } },
      { label: 'Cut', shortcut: '⌘X', onClick: () => { clipboard = { paths: sel.map((x) => x.path), cut: true }; setNote(`Cut ${sel.length}`); } },
      { label: 'Paste', shortcut: '⌘V', disabled: !clipboard, onClick: paste },
      { label: 'Duplicate', shortcut: '⌘D', disabled: many, onClick: () => api.fsDuplicate(e.path).then(onRefresh).catch(fail) },
      { label: 'Rename', shortcut: '⏎', disabled: many, onClick: () => { setRenaming(e.path); setDraft(e.name); } },
      { separator: true },
      { label: 'Move to Trash', shortcut: '⌘⌫', danger: true, onClick: () => api.fsTrash(sel.map((x) => x.path)).then(() => { setSelected(new Set()); onRefresh(); }).catch(fail) },
    ];
  };
  const bgMenu = (): MenuItem[] => [
    { label: 'New Folder', shortcut: '⇧⌘N', onClick: () => { setDraft('untitled folder'); setCreating(true); } },
    { label: 'Paste', shortcut: '⌘V', disabled: !clipboard, onClick: paste },
    { separator: true },
    { label: 'Open in Terminal', onClick: () => listing && api.open(listing.path, 'terminal').catch(fail) },
    { label: 'Reveal in Finder', onClick: () => listing && api.open(listing.path, 'finder').catch(fail) },
    { label: 'Copy Path', onClick: () => listing && navigator.clipboard.writeText(listing.path) },
    { separator: true },
    { label: isFavorite ? 'Remove from Favorites' : 'Add to Favorites', onClick: onToggleFavorite },
    { label: showHidden ? 'Hide Hidden Files' : 'Show Hidden Files', onClick: () => setShowHidden((v) => !v) },
    { label: 'Refresh', onClick: onRefresh },
  ];

  return (
    <div ref={root} tabIndex={0} onKeyDown={onKey} className="flex flex-col h-full min-w-0 outline-none">
      <div className="h-10 flex items-center gap-2 px-3 border-b border-white/10 text-sm">
        <button className="px-2 py-1 rounded hover:bg-white/10 disabled:opacity-30" disabled={!listing?.parent} onClick={() => listing?.parent && onNavigate(listing.parent)} title="Parent folder (⌫)">↑</button>
        <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap text-zinc-400">
          <span className="cursor-pointer hover:text-white" onClick={() => onNavigate('/')}>/</span>
          {crumbs.map((c, i) => {
            const p = '/' + crumbs.slice(0, i + 1).join('/');
            return <span key={p} className="flex items-center gap-1"><span className="text-zinc-600">›</span><span className={`cursor-pointer hover:text-white ${i === crumbs.length - 1 ? 'text-white' : ''}`} onClick={() => onNavigate(p)}>{c}</span></span>;
          })}
        </div>
        <div className="flex-1" />
        {note && <span className="text-[11px] text-amber-300 truncate max-w-[160px]" title={note}>{note}</span>}
        <button className="px-2 py-1 rounded hover:bg-white/10 text-zinc-400" onClick={() => { setDraft('untitled folder'); setCreating(true); }} title="New folder (⇧⌘N)">＋</button>
        <button className="px-2 py-1 rounded hover:bg-white/10" onClick={onToggleFavorite} title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}>{isFavorite ? '★' : '☆'}</button>
      </div>

      <div className="flex-1 overflow-y-auto" onContextMenu={(e) => menu.open(e, bgMenu())} onClick={(e) => { if (e.target === e.currentTarget) setSelected(new Set()); }}>
        {error && (
          <div className="m-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm">
            <div className="font-medium text-red-300">{error.code}</div>
            <div className="text-zinc-300 mt-1 whitespace-pre-wrap">{error.message}</div>
            {error.code === 'EACCES' && <a className="inline-block mt-3 text-xs underline text-blue-300" href="x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles">Open Full Disk Access settings</a>}
          </div>
        )}
        {listing && (
          <table className="w-full text-sm">
            <tbody>
              {creating && (
                <tr className="bg-blue-500/10"><td className="w-9 pl-3 pr-2 py-1.5">📁</td>
                  <td colSpan={3} className="py-1 pr-3"><input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={createFolder} onKeyDown={(e) => { if (e.key === 'Enter') createFolder(); if (e.key === 'Escape') setCreating(false); }} className="w-full bg-black/40 rounded px-2 py-0.5 outline-none border border-blue-400/50" /></td></tr>
              )}
              {entries.map((e) => (
                <tr key={e.path}
                  className={`cursor-default border-b border-white/5 ${selected.has(e.path) ? 'bg-blue-500/25' : 'hover:bg-white/5'} ${e.hidden ? 'opacity-50' : ''}`}
                  onClick={(ev) => select(e, ev)} onDoubleClick={() => open(e)} onContextMenu={(ev) => menu.open(ev, itemMenu(e))}
                  draggable
                  onDragStart={(ev) => { const paths = selected.has(e.path) ? selectedEntries.map((x) => x.path) : [e.path]; ev.dataTransfer.setData('text/plain', paths.join('\n')); ev.dataTransfer.setData('application/x-vibe-path', paths.join('\n')); }}
                >
                  <td className="w-9 pl-3 pr-2 py-1.5">{e.isDir ? '📁' : ICON[e.kind]}</td>
                  <td className="py-1.5 pl-1 truncate max-w-0 w-full">
                    {renaming === e.path
                      ? <input autoFocus value={draft} onChange={(ev) => setDraft(ev.target.value)} onBlur={commitRename} onClick={(ev) => ev.stopPropagation()} onDoubleClick={(ev) => ev.stopPropagation()}
                          onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === 'Enter') commitRename(); if (ev.key === 'Escape') setRenaming(null); }}
                          className="w-full bg-black/40 rounded px-2 py-0.5 outline-none border border-blue-400/50" />
                      : e.name}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-zinc-500 whitespace-nowrap">{e.isDir ? '' : formatSize(e.size)}</td>
                  <td className="py-1.5 pr-3 text-right text-zinc-600 whitespace-nowrap hidden lg:table-cell">{new Date(e.mtime).toLocaleDateString()}</td>
                </tr>
              ))}
              {entries.length === 0 && !creating && <tr><td className="p-6 text-center text-zinc-600" colSpan={4}>Empty folder</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      <div className="h-6 shrink-0 flex items-center px-3 text-[10px] text-zinc-600 border-t border-white/5">
        {selected.size > 0 ? `${selected.size} selected` : `${entries.length} items`} · double-click to open · ⌘C/⌘X/⌘V · ⌘⌫ trash · ⏎ rename
      </div>
    </div>
  );
}
