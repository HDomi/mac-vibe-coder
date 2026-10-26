import { useEffect, useMemo, useState } from 'react';
import { svgDataUri } from '../../lib/toolbox/svg';
import { t } from '../../lib/i18n';
import { Area, DropZone, Rows, Section, Seg, blobToBase64, btn, errText, fmtBytes, saveBytes } from './ui';

interface Loaded { name: string; type: string; size: number; base64: string; svgText?: string }

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'application/pdf': 'pdf', 'font/woff2': 'woff2', 'font/woff': 'woff', 'audio/mpeg': 'mp3', 'text/plain': 'txt' };

export default function DataUriTool() {
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <Seg value={mode} onChange={setMode} className="self-start" options={[{ value: 'encode', label: t('tb.datauri.fileToUri') }, { value: 'decode', label: t('tb.datauri.uriToFile') }]} />
      <div className="flex-1 min-h-0">{mode === 'encode' ? <Encode /> : <Decode />}</div>
    </div>
  );
}

function Encode() {
  const [file, setFile] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = async (f: File) => {
    try {
      const type = f.type || (f.name.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream');
      setFile({ name: f.name, type, size: f.size, base64: await blobToBase64(f), svgText: type === 'image/svg+xml' ? await f.text() : undefined });
      setErr(null);
    } catch (e) { setErr(errText(e)); }
  };
  const uri = file ? `data:${file.type};base64,${file.base64}` : '';
  const small = file?.svgText ? svgDataUri(file.svgText) : '';
  const best = small && small.length < uri.length ? small : uri;
  const isImage = file?.type.startsWith('image/');
  return (
    <div className="h-full grid grid-cols-[minmax(240px,34%)_1fr] gap-4 min-h-0">
      <div className="flex flex-col gap-3 min-h-0">
        <DropZone onFile={load} className="flex-1 min-h-[160px] p-4">
          {file && isImage ? <img src={best} alt="" className="max-w-full max-h-full object-contain" /> : <span>{t('tb.datauri.drop')}</span>}
        </DropZone>
        {file && <div className="text-[11px] text-zinc-500 break-all">{file.name} · {file.type} · {fmtBytes(file.size)}</div>}
        {err && <div className="text-[11px] text-red-400">{err}</div>}
      </div>
      <div className="flex flex-col gap-3 min-h-0 overflow-y-auto">
        {file ? <>
          {file.size > 100 * 1024 && <div className="text-[11px] text-amber-400">{t('tb.datauri.big', { size: fmtBytes(uri.length) })}</div>}
          <Rows rows={[
            { label: 'Data URI', value: uri, hint: fmtBytes(uri.length) },
            ...(small ? [{ label: 'SVG URL-encoded', value: small, hint: fmtBytes(small.length) }] : []),
            { label: 'Base64', value: file.base64 },
            ...(isImage ? [
              { label: 'CSS', value: `background-image: url("${best}");` },
              { label: 'HTML', value: `<img src="${best}" alt="">` },
              { label: 'Markdown', value: `![${file.name.replace(/\.[^.]+$/, '')}](${best})` },
            ] : []),
            ...(file.type.startsWith('font/') ? [{ label: '@font-face', value: `src: url("${uri}") format("${EXT[file.type] ?? 'woff2'}");` }] : []),
          ]} />
        </> : <div className="text-[12px] text-zinc-600">{t('tb.datauri.hint')}</div>}
      </div>
    </div>
  );
}

function Decode() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const parsed = useMemo(() => {
    const s = text.trim().replace(/^url\((['"]?)(.*)\1\)$/, '$2');
    if (!s) return null;
    const m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,(.*)$/s.exec(s);
    if (!m) return { ok: false as const, msg: t('tb.datauri.notUri') };
    const type = m[1] || 'text/plain';
    try {
      const base64 = m[3] ? m[4].replace(/\s/g, '') : btoa(Array.from(new TextEncoder().encode(decodeURIComponent(m[4])), (b) => String.fromCharCode(b)).join(''));
      const size = Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
      return { ok: true as const, type, base64, size, src: s };
    } catch (e) { return { ok: false as const, msg: errText(e) }; }
  }, [text]);
  useEffect(() => { if (!status) return; const id = setTimeout(() => setStatus(''), 2500); return () => clearTimeout(id); }, [status]);
  const save = async () => {
    if (!parsed?.ok) return;
    try { const p = await saveBytes(`file.${EXT[parsed.type] ?? 'bin'}`, parsed.base64); if (p) setStatus(t('tb.savedTo', { path: p })); } catch (e) { setStatus(errText(e)); }
  };
  return (
    <div className="h-full grid grid-cols-2 gap-4 min-h-0">
      <Area label="Data URI" value={text} onChange={setText} placeholder="data:image/png;base64,iVBORw0KGgo…" error={parsed && !parsed.ok ? parsed.msg : null} autoFocus />
      <Section title={parsed?.ok ? `${parsed.type} · ${fmtBytes(parsed.size)}` : t('tb.svg.preview')} className="min-h-0"
        actions={parsed?.ok ? <><button className={btn} onClick={save}>{t('tb.datauri.save')}</button><span className="text-[11px] text-zinc-500">{status}</span></> : null}>
        <div className="flex-1 min-h-[200px] rounded-md border border-white/10 flex items-center justify-center p-4 bg-[repeating-conic-gradient(#2a2a2a_0_25%,#1f1f1f_0_50%)] bg-[length:16px_16px]">
          {parsed?.ok && parsed.type.startsWith('image/') ? <img src={parsed.src} alt="" className="max-w-full max-h-full object-contain" /> : parsed?.ok ? <span className="text-[12px] text-zinc-400">{t('tb.datauri.noPreview')}</span> : null}
        </div>
      </Section>
    </div>
  );
}
