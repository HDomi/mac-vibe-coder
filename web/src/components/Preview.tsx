import { useEffect, useState } from 'react';
import MarkdownView from './MarkdownView';
import { api, formatSize, type Entry } from '../lib/api';

interface Props { entry: Entry | null }

function TextView({ path, markdown }: { path: string; markdown: boolean }) {
  const [state, setState] = useState<{ content: string; truncated: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setState(null); setErr(null);
    api.text(path).then((r) => alive && setState(r)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [path]);
  if (err) return <div className="p-4 text-red-300 text-sm">{err}</div>;
  if (!state) return <div className="p-4 text-zinc-500 text-sm">Loading…</div>;
  return (
    <div className="p-5">
      {state.truncated && <div className="mb-3 text-xs text-amber-400">Showing first 2 MB</div>}
      {markdown ? (
        <MarkdownView text={state.content} baseDir={path.slice(0, path.lastIndexOf('/'))} className="prose-md max-w-3xl text-[15px]" />
      ) : (
        <pre className="text-[13px] leading-relaxed font-mono whitespace-pre-wrap break-words">{state.content}</pre>
      )}
    </div>
  );
}

export default function Preview({ entry }: Props) {
  if (!entry) {
    return <div className="h-full flex items-center justify-center text-zinc-600 text-sm">Double-click a file to preview it</div>;
  }
  const url = api.rawUrl(entry.path);
  return (
    <div className="h-full flex flex-col min-w-0">
      <div className="h-10 flex items-center gap-3 px-4 border-b border-white/10 text-sm">
        <span className="truncate font-medium">{entry.name}</span>
        <span className="text-zinc-500 text-xs">{formatSize(entry.size)}</span>
        <div className="flex-1" />
        <button className="text-xs text-zinc-400 hover:text-white" onClick={() => navigator.clipboard.writeText(entry.path)} title={entry.path}>Copy path</button>
      </div>
      <div className="flex-1 overflow-auto bg-[#0b0d12]">
        {entry.kind === 'markdown' && <TextView path={entry.path} markdown />}
        {entry.kind === 'text' && <TextView path={entry.path} markdown={false} />}
        {entry.kind === 'image' && (
          <div className="h-full flex items-center justify-center p-4">
            <img src={url} alt={entry.name} className="max-w-full max-h-full object-contain rounded" />
          </div>
        )}
        {entry.kind === 'video' && (
          <div className="h-full flex items-center justify-center p-4 bg-black">
            <video src={url} controls className="max-w-full max-h-full" />
          </div>
        )}
        {entry.kind === 'audio' && (
          <div className="h-full flex items-center justify-center p-4">
            <audio src={url} controls className="w-full max-w-xl" />
          </div>
        )}
        {entry.kind === 'pdf' && <iframe src={url} title={entry.name} className="w-full h-full border-0 bg-white" />}
        {entry.kind === 'binary' && (
          <div className="h-full flex flex-col items-center justify-center text-zinc-500 text-sm gap-2">
            <div>No preview for this file type</div>
            <div className="text-xs text-zinc-600">{entry.ext || 'no extension'}</div>
          </div>
        )}
      </div>
    </div>
  );
}
