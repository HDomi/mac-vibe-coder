import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Attachment, PermissionModeId } from '../lib/agent';

interface Props {
  disabled: boolean;
  running: boolean;
  mode: PermissionModeId;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  onMode: (m: PermissionModeId) => void;
  /** Attachments pushed from outside (file browser "Attach to Chat"). */
  pendingAttachments?: Attachment[];
  onConsumeAttachments?: () => void;
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic)$/i;
const MODES: { id: PermissionModeId; label: string; hint: string }[] = [
  { id: 'default', label: 'Default', hint: 'Ask before each tool' },
  { id: 'acceptEdits', label: 'Auto-edit', hint: 'File edits are auto-approved' },
  { id: 'plan', label: 'Plan', hint: 'Read-only, plan first' },
  { id: 'bypassPermissions', label: 'Allow all', hint: 'Run without approvals (careful)' },
];

function toAttachment(path: string, name?: string): Attachment {
  const n = name ?? path.split('/').pop() ?? path;
  return { path, name: n, kind: IMAGE_RE.test(n) ? 'image' : 'file' };
}

export default function Composer({ disabled, running, mode, onSend, onStop, onMode, pendingAttachments, onConsumeAttachments }: Props) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ta.current; if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(240, el.scrollHeight) + 'px';
  }, [text]);

  useEffect(() => {
    if (!pendingAttachments?.length) return;
    setAttachments((a) => [...a, ...pendingAttachments].filter((x, i, arr) => arr.findIndex((y) => y.path === x.path) === i));
    onConsumeAttachments?.();
    ta.current?.focus();
  }, [pendingAttachments, onConsumeAttachments]);

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    // Electron: resolve real paths without copying. Browser: upload to the attachments folder.
    const direct: Attachment[] = [];
    const toUpload: File[] = [];
    for (const f of files) {
      const p = window.vibe?.getPathForFile?.(f);
      if (p) direct.push(toAttachment(p, f.name)); else toUpload.push(f);
    }
    let uploaded: Attachment[] = [];
    if (toUpload.length) {
      setUploading(true);
      try { uploaded = await api.attach(toUpload); } finally { setUploading(false); }
    }
    setAttachments((a) => [...a, ...direct, ...uploaded].filter((x, i, arr) => arr.findIndex((y) => y.path === x.path) === i));
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const vibePaths = e.dataTransfer.getData('application/x-vibe-path');
    if (vibePaths) {
      const list = vibePaths.split('\n').filter(Boolean).map((p) => toAttachment(p));
      setAttachments((a) => [...a, ...list].filter((x, i, arr) => arr.findIndex((y) => y.path === x.path) === i));
      return;
    }
    void addFiles(Array.from(e.dataTransfer.files));
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length) { e.preventDefault(); void addFiles(files); }
  };

  const submit = () => {
    const t = text.trim();
    if (!t && attachments.length === 0) return;
    onSend(t, attachments);
    setText(''); setAttachments([]);
  };

  return (
    <div className={`border-t border-white/10 p-3 ${dragging ? 'bg-blue-500/10' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((a) => (
            <div key={a.path} className="relative group" title={a.path}>
              {a.kind === 'image'
                ? <img src={api.rawUrl(a.path)} alt={a.name} className="h-16 w-16 object-cover rounded-md border border-white/10" />
                : <div className="h-16 px-3 flex items-center text-xs bg-white/5 rounded-md border border-white/10 max-w-[200px] truncate">📎 {a.name}</div>}
              <button className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-zinc-800 border border-white/20 text-[10px] opacity-0 group-hover:opacity-100"
                onClick={() => setAttachments((l) => l.filter((x) => x.path !== a.path))}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-xl border border-white/15 bg-[#12151c] focus-within:border-white/30">
        <textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)} onPaste={onPaste}
          disabled={disabled}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          placeholder={disabled ? 'Start a session first' : 'Message… (Enter to send, Shift+Enter for newline, drop or paste files)'}
          className="w-full bg-transparent px-4 pt-3 pb-2 text-[14px] outline-none resize-none min-h-[44px]" rows={1} />
        <div className="flex items-center gap-2 px-2 pb-2">
          <select value={mode} onChange={(e) => onMode(e.target.value as PermissionModeId)} disabled={disabled}
            className="bg-white/5 rounded-md text-xs px-2 py-1 outline-none" title={MODES.find((m) => m.id === mode)?.hint}>
            {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <label className="text-xs text-zinc-400 hover:text-white cursor-pointer px-2">
            📎 Attach
            <input type="file" multiple className="hidden" onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
          </label>
          {uploading && <span className="text-xs text-zinc-500">Uploading…</span>}
          <div className="flex-1" />
          {running
            ? <button className="rounded-md bg-red-500/20 hover:bg-red-500/30 text-red-200 text-xs px-3 py-1.5" onClick={onStop}>■ Stop</button>
            : <button className="rounded-md bg-blue-500/30 hover:bg-blue-500/40 text-xs px-3 py-1.5 disabled:opacity-40" disabled={disabled || (!text.trim() && !attachments.length)} onClick={submit}>Send ⏎</button>}
        </div>
      </div>
    </div>
  );
}
