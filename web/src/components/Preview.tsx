import { useEffect, useMemo, useState } from 'react';
import ImageConvertDialog from './ImageConvertDialog';
import { highlight, highlightedLines, LANGUAGES, languageFor, rememberLanguage } from '../lib/highlight';
import { CopyButton } from './MarkdownView';
import MarkdownView from './MarkdownView';
import { api, formatSize, imageSrc, type Entry } from '../lib/api';
import { t, useLang } from '../lib/i18n';

interface Props { entry: Entry | null }

/** Syntax-highlighted source view with line numbers and a language picker (remembered per extension). */
function CodeView({ content, name, ext }: { content: string; name: string; ext: string }) {
  useLang();
  const [lang, setLang] = useState(() => languageFor(name, ext));
  useEffect(() => { setLang(languageFor(name, ext)); }, [name, ext]);
  const lines = useMemo(() => highlightedLines(highlight(content, lang)), [content, lang]);
  return (
    <div className="h-full flex flex-col">
      <div data-companion-floor="preview-language" data-companion-edge="bottom" className="h-8 shrink-0 flex items-center gap-2 px-3 border-b border-white/5 text-[11px] text-zinc-500">
        <span>{t('preview.language')}</span>
        <select value={lang} onChange={(e) => { setLang(e.target.value); rememberLanguage(name, ext, e.target.value); }} className="bg-white/5 rounded px-1.5 py-0.5 outline-none text-zinc-300">
          {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <span className="text-zinc-600">{lines.length} {t('preview.lines')}</span>
        <div className="flex-1" />
        <CopyButton text={content} />
      </div>
      <div className="flex-1 overflow-auto">
        <table className="hljs text-[12.5px] leading-[1.55] font-mono border-collapse min-w-full" style={{ background: 'transparent' }}>
          <tbody>
            {lines.map((html, i) => (
              <tr key={i} className="hover:bg-white/[0.03]">
                <td className="select-none text-right pr-3 pl-3 text-zinc-600 align-top w-10 whitespace-nowrap">{i + 1}</td>
                <td className="pr-4 whitespace-pre align-top" dangerouslySetInnerHTML={{ __html: html || ' ' }} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TextView({ path, markdown, name, ext }: { path: string; markdown: boolean; name: string; ext: string }) {
  useLang();
  const [state, setState] = useState<{ content: string; truncated: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setState(null); setErr(null);
    api.text(path).then((r) => alive && setState(r)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [path]);
  if (err) return <div className="p-4 text-red-300 text-sm">{err}</div>;
  if (!state) return <div className="p-4 text-zinc-500 text-sm">{t('common.loading')}</div>;
  if (!markdown) {
    return (
      <div className="h-full flex flex-col">
        {state.truncated && <div className="px-3 py-1 text-xs text-amber-400 border-b border-white/5">{t('preview.truncated')}</div>}
        <div className="flex-1 min-h-0"><CodeView content={state.content} name={name} ext={ext} /></div>
      </div>
    );
  }
  return (
    <div className="p-5">
      {state.truncated && <div className="mb-3 text-xs text-amber-400">{t('preview.truncated')}</div>}
      <MarkdownView text={state.content} baseDir={path.slice(0, path.lastIndexOf('/'))} className="prose-md max-w-3xl text-[15px]" />
    </div>
  );
}

export default function Preview({ entry }: Props) {
  useLang();
  const [converting, setConverting] = useState(false);
  // Bumped after saving over the file on screen, so the <img> refetches.
  const [rev, setRev] = useState(0);
  if (!entry) {
    return <div className="h-full flex items-center justify-center text-zinc-600 text-sm">{t('preview.hint')}</div>;
  }
  const url = api.rawUrl(entry.path);
  return (
    <div className="h-full flex flex-col min-w-0">
      <div data-companion-floor="preview-toolbar" data-companion-edge="bottom" className="h-10 flex items-center gap-3 px-4 border-b border-white/10 text-sm">
        <span className="truncate font-medium">{entry.name}</span>
        <span className="text-zinc-500 text-xs">{formatSize(entry.size)}</span>
        <div className="flex-1" />
        {entry.kind === 'image' && (
          <button className="text-xs px-2 py-1 rounded-md border border-white/10 text-zinc-300 hover:text-white hover:bg-white/10" onClick={() => setConverting(true)}>{t('image.convertButton')}</button>
        )}
        <button className="text-xs text-zinc-400 hover:text-white" onClick={() => navigator.clipboard.writeText(entry.path)} title={entry.path}>{t('preview.copyPath')}</button>
      </div>
      {converting && (
        <ImageConvertDialog entry={entry} onClose={() => setConverting(false)}
          onSaved={(p) => { if (p === entry.path) setRev((r) => r + 1); else window.dispatchEvent(new CustomEvent('vibe:open-file', { detail: { path: p } })); }} />
      )}
      <div className="flex-1 overflow-auto bg-[#0b0d12]">
        {entry.kind === 'markdown' && <TextView path={entry.path} markdown name={entry.name} ext={entry.ext} />}
        {entry.kind === 'text' && <TextView path={entry.path} markdown={false} name={entry.name} ext={entry.ext} />}
        {entry.kind === 'image' && (
          <div className="h-full flex items-center justify-center p-4">
            <img src={imageSrc(entry.path, entry.ext, rev)} alt={entry.name} className="max-w-full max-h-full object-contain rounded" />
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
            <div>{t('preview.noPreview')}</div>
            <div className="text-xs text-zinc-600">{entry.ext || t('preview.noExt')}</div>
          </div>
        )}
      </div>
    </div>
  );
}
