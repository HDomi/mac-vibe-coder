import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { buildIcns, buildIco, faviconHtml, webManifest } from '../../lib/toolbox/icons';
import { bytesToBase64 } from '../../lib/toolbox/bytes';
import { t } from '../../lib/i18n';
import { Check, Code, DropZone, Section, btnPrimary, errText, fmtBytes, input, usePersisted } from './ui';

const SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024];
interface Source { name: string; url: string; svg: string | null; w: number; h: number }
interface Opts { padding: number; radius: number; fill: boolean; color: string; appleFill: boolean }

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Cannot decode this image')); img.src = url; });
}

/**
 * Draws the source into a square of `size`, contained and centered. Raster sources are halved step by
 * step so small sizes stay sharp instead of aliasing; SVG is drawn straight at the target size.
 */
async function render(src: Source, img: HTMLImageElement, size: number, o: Opts, forceFill: boolean): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  if (o.fill || forceFill) {
    g.fillStyle = o.color;
    const r = (o.radius / 100) * size;
    g.beginPath(); g.roundRect(0, 0, size, size, r); g.fill();
  }
  const inner = size * (1 - (2 * o.padding) / 100);
  const k = Math.min(inner / src.w, inner / src.h);
  const w = src.w * k, h = src.h * k;
  let source: CanvasImageSource = img;
  if (!src.svg) {
    let cw = src.w, ch = src.h;
    while (cw / 2 > w) {
      const step = document.createElement('canvas');
      step.width = Math.round(cw / 2); step.height = Math.round(ch / 2);
      const sg = step.getContext('2d')!;
      sg.imageSmoothingQuality = 'high';
      sg.drawImage(source, 0, 0, step.width, step.height);
      source = step; cw = step.width; ch = step.height;
    }
  }
  g.drawImage(source, (size - w) / 2, (size - h) / 2, w, h);
  return c;
}

const toPng = (c: HTMLCanvasElement) => new Promise<Uint8Array>((resolve, reject) => c.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a))) : reject(new Error('PNG encode failed'))), 'image/png'));

interface Output { name: string; data: Uint8Array; preview?: string }

export default function FaviconTool() {
  const [src, setSrc] = useState<Source | null>(null);
  const [o, setO] = usePersisted<Opts>('favicon.opts', { padding: 0, radius: 22, fill: false, color: '#ffffff', appleFill: true });
  const [appName, setAppName] = usePersisted('favicon.name', 'My App');
  const [outs, setOuts] = useState<Output[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const set = <K extends keyof Opts>(k: K, v: Opts[K]) => setO((p) => ({ ...p, [k]: v }));

  const pick = async (f: File) => {
    try {
      const svg = f.type === 'image/svg+xml' || f.name.endsWith('.svg') ? await f.text() : null;
      const url = svg ? `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(svg))}` : URL.createObjectURL(f);
      const img = await loadImage(url);
      setSrc({ name: f.name, url, svg, w: img.naturalWidth || 512, h: img.naturalHeight || 512 });
      setErr(null);
    } catch (e) { setErr(errText(e)); }
  };

  useEffect(() => {
    if (!src) return;
    let alive = true;
    setBusy(true);
    (async () => {
      const img = await loadImage(src.url);
      const png = new Map<number, Uint8Array>();
      const previews = new Map<number, string>();
      for (const s of SIZES) {
        const c = await render(src, img, s, o, false);
        png.set(s, await toPng(c));
        if (s <= 512) previews.set(s, c.toDataURL());
      }
      // iOS shows transparent touch icons on black, so that one is filled unless asked not to.
      const apple = o.appleFill && !o.fill ? await toPng(await render(src, img, 180, { ...o, radius: 0 }, true)) : png.get(180)!;
      const list: Output[] = [
        { name: 'favicon.ico', data: buildIco([16, 32, 48].map((s) => ({ size: s, data: png.get(s)! }))), preview: previews.get(32) },
        { name: 'favicon-16x16.png', data: png.get(16)!, preview: previews.get(16) },
        { name: 'favicon-32x32.png', data: png.get(32)!, preview: previews.get(32) },
        { name: 'apple-touch-icon.png', data: apple, preview: o.appleFill && !o.fill ? `data:image/png;base64,${bytesToBase64(apple)}` : previews.get(180) },
        { name: 'android-chrome-192x192.png', data: png.get(192)!, preview: previews.get(192) },
        { name: 'android-chrome-512x512.png', data: png.get(512)!, preview: previews.get(512) },
        { name: 'icon.icns', data: buildIcns(png), preview: previews.get(128) },
        ...(src.svg ? [{ name: 'favicon.svg', data: new TextEncoder().encode(src.svg) as Uint8Array, preview: src.url }] : []),
      ];
      if (alive) { setOuts(list); setBusy(false); }
    })().catch((e) => { if (alive) { setErr(errText(e)); setBusy(false); } });
    return () => { alive = false; };
  }, [src, o]);

  const manifest = useMemo(() => webManifest(appName, o.fill ? o.color : '#ffffff'), [appName, o]);
  const html = faviconHtml(!!src?.svg);
  const save = async () => {
    const dir = window.vibe?.pickFolder ? await window.vibe.pickFolder() : null;
    if (!dir) return;
    const files = [...outs, { name: 'site.webmanifest', data: new TextEncoder().encode(manifest) as Uint8Array }];
    try {
      const listing = await api.list(dir);
      const clash = files.filter((f) => listing.entries.some((e) => e.name === f.name)).map((f) => f.name);
      if (clash.length && !window.confirm(t('tb.favicon.overwrite', { files: clash.join(', ') }))) return;
      for (const f of files) await api.imageWrite(`${dir}/${f.name}`, bytesToBase64(f.data), true);
      setStatus(t('tb.favicon.saved', { n: files.length, dir }));
    } catch (e) { setStatus(errText(e)); }
  };

  return (
    <div className="h-full grid grid-cols-[minmax(260px,32%)_1fr] gap-4 min-h-0">
      <div className="flex flex-col gap-4 min-h-0 overflow-y-auto pr-1">
        <DropZone accept="image/*,.svg" onFile={pick} className="h-44 shrink-0 p-3">
          {src ? <img src={src.url} alt="" className="max-w-full max-h-full object-contain" /> : <span>{t('tb.favicon.drop')}</span>}
        </DropZone>
        {src && <div className="text-[11px] text-zinc-500 break-all">{src.name} · {src.w}×{src.h}{!src.svg && Math.min(src.w, src.h) < 512 && <span className="text-amber-400"> · {t('tb.favicon.small')}</span>}</div>}
        {err && <div className="text-[11px] text-red-400">{err}</div>}
        <Section title={t('tb.favicon.options')}>
          <div className="flex flex-col gap-3 text-[11px] text-zinc-500">
            <label className="flex items-center gap-3">{t('tb.favicon.padding')}<input type="range" min={0} max={30} value={o.padding} onChange={(e) => set('padding', Number(e.target.value))} className="flex-1" /><span className="w-8 text-zinc-300 tabular-nums">{o.padding}%</span></label>
            <Check label={t('tb.favicon.fill')} checked={o.fill} onChange={(v) => set('fill', v)} />
            <div className="flex items-center gap-3">
              <span>{t('tb.favicon.color')}</span><input type="color" value={o.color} onChange={(e) => set('color', e.target.value)} className="w-7 h-6 bg-transparent" />
              <span className="ml-3">{t('tb.favicon.radius')}</span><input type="range" min={0} max={50} value={o.radius} onChange={(e) => set('radius', Number(e.target.value))} disabled={!o.fill} className="flex-1" /><span className="w-8 text-zinc-300 tabular-nums">{o.radius}%</span>
            </div>
            <Check label={t('tb.favicon.appleFill')} checked={o.appleFill} onChange={(v) => set('appleFill', v)} />
            <label className="flex items-center gap-3">{t('tb.favicon.appName')}<input className={`${input} flex-1`} value={appName} onChange={(e) => setAppName(e.target.value)} /></label>
          </div>
        </Section>
      </div>
      <div className="flex flex-col gap-4 min-h-0 overflow-y-auto pr-1">
        <Section title={t('tb.favicon.files')} actions={<>
          <span className="text-[11px] text-zinc-500 normal-case tracking-normal">{status}</span>
          <button className={btnPrimary} disabled={!outs.length || busy || !window.vibe?.pickFolder} onClick={save}>{t('tb.favicon.saveAll')}</button>
        </>}>
          {!src && <div className="text-[12px] text-zinc-600">{t('tb.favicon.hint')}</div>}
          {busy && <div className="text-[12px] text-zinc-500">{t('common.loading')}</div>}
          <div className="grid grid-cols-4 gap-3">
            {outs.map((f) => (
              <div key={f.name} className="rounded-md border border-white/10 p-2 flex flex-col items-center gap-2">
                <div className="h-20 w-full flex items-center justify-center bg-[repeating-conic-gradient(#2a2a2a_0_25%,#1f1f1f_0_50%)] bg-[length:12px_12px] rounded">
                  {f.preview && <img src={f.preview} alt="" className="max-h-16 max-w-16 [image-rendering:auto]" style={/16x16|favicon\.ico/.test(f.name) ? { width: 32, height: 32, imageRendering: 'pixelated' } : undefined} />}
                </div>
                <div className="w-full text-[11px] text-zinc-300 truncate text-center" title={f.name}>{f.name}</div>
                <div className="text-[10.5px] text-zinc-500">{fmtBytes(f.data.length)}</div>
              </div>
            ))}
          </div>
        </Section>
        {outs.length > 0 && <>
          <Code code={html} lang="xml" label={t('tb.favicon.html')} className="shrink-0" />
          <Code code={manifest} lang="json" label="site.webmanifest" className="shrink-0" />
        </>}
      </div>
    </div>
  );
}
