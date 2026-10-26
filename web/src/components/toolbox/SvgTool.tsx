import { useMemo, useState } from 'react';
import { byteLength, optimizeSvg, svgBase64Uri, svgDataUri, svgToReact, type SvgOptions } from '../../lib/toolbox/svg';
import { t } from '../../lib/i18n';
import { Area, Check, Code, DropZone, Rows, Seg, btn, errText, fmtBytes, input, usePersisted } from './ui';

type Out = 'svg' | 'react' | 'uri';
const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: Adobe Illustrator 27.0 -->
<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px"
	 width="24px" height="24px" viewBox="0 0 24 24" enable-background="new 0 0 24 24" xml:space="preserve">
<title>check</title>
<g>
	<g>
		<path fill="#2563EB" d="M9.000000,16.170000 L4.830000,12.000000 L3.410000,13.410000 L9.000000,19.000000 L21.000000,7.000000 L19.590000,5.590000 Z"/>
	</g>
</g>
</svg>`;

export default function SvgTool() {
  const [text, setText] = usePersisted('svg.text', '');
  const [o, setO] = usePersisted<SvgOptions>('svg.opts', { precision: 2, removeDimensions: false, keepTitle: false, currentColor: false, pretty: false });
  const [out, setOut] = usePersisted<Out>('svg.out', 'svg');
  const [name, setName] = usePersisted('svg.name', 'Icon');
  const [bg, setBg] = useState<'checker' | 'dark' | 'light'>('checker');
  const res = useMemo(() => {
    if (!text.trim()) return null;
    try { return { ok: true as const, svg: optimizeSvg(text, o) }; } catch (e) { return { ok: false as const, msg: errText(e) }; }
  }, [text, o]);
  const svg = res?.ok ? res.svg : '';
  const before = byteLength(text), after = byteLength(svg);
  const react = useMemo(() => { if (!svg || out !== 'react') return ''; try { return svgToReact(svg, /^[A-Z][A-Za-z0-9]*$/.test(name) ? name : 'Icon'); } catch (e) { return errText(e); } }, [svg, out, name]);
  const set = <K extends keyof SvgOptions>(k: K, v: SvgOptions[K]) => setO((p) => ({ ...p, [k]: v }));
  const uri = svg ? svgDataUri(svg) : '';
  const bgClass = bg === 'dark' ? 'bg-[#0b0d12]' : bg === 'light' ? 'bg-white' : 'bg-[repeating-conic-gradient(#2a2a2a_0_25%,#1f1f1f_0_50%)] bg-[length:16px_16px]';

  return (
    <div className="h-full grid grid-cols-2 gap-4 min-h-0">
      <div className="flex flex-col gap-3 min-h-0">
        <Area className="flex-1" label={t('tb.input')} value={text} onChange={setText} placeholder={t('tb.svg.placeholder')} error={res && !res.ok ? res.msg : null}
          actions={<>
            {!text && <button className={btn} onClick={() => setText(SAMPLE)}>{t('tb.sample')}</button>}
            {text && <button className={btn} onClick={() => setText('')}>{t('tb.clear')}</button>}
          </>} />
        <DropZone accept=".svg,image/svg+xml" onFile={(f) => f.text().then(setText)} className="h-12 shrink-0">{t('tb.svg.drop')}</DropZone>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-zinc-500">
          <label className="flex items-center gap-2">{t('tb.svg.precision')}<input type="number" min={0} max={6} className={`${input} w-14`} value={o.precision} onChange={(e) => set('precision', Math.min(6, Math.max(0, Number(e.target.value) || 0)))} /></label>
          <Check label={t('tb.svg.removeDims')} checked={o.removeDimensions} onChange={(v) => set('removeDimensions', v)} />
          <Check label={t('tb.svg.currentColor')} checked={o.currentColor} onChange={(v) => set('currentColor', v)} />
          <Check label={t('tb.svg.keepTitle')} checked={o.keepTitle} onChange={(v) => set('keepTitle', v)} />
          <Check label={t('tb.svg.pretty')} checked={o.pretty} onChange={(v) => set('pretty', v)} />
        </div>
      </div>
      <div className="flex flex-col gap-3 min-h-0">
        <div className="h-[38%] min-h-[140px] flex flex-col gap-2">
          <div className="flex items-center gap-3 text-[11px] text-zinc-500">
            <span className="flex-1">{svg ? <>{fmtBytes(before)} → <span className="text-emerald-300">{fmtBytes(after)}</span> {before > 0 && <span>(−{Math.max(0, Math.round((1 - after / before) * 100))}%)</span>}</> : t('tb.svg.preview')}</span>
            <Seg value={bg} onChange={setBg} options={[{ value: 'checker', label: '▦' }, { value: 'dark', label: t('tb.svg.dark') }, { value: 'light', label: t('tb.svg.light') }]} />
          </div>
          <div className={`flex-1 min-h-0 rounded-md border border-white/10 flex items-center justify-center p-4 ${bgClass} ${o.currentColor ? (bg === 'light' ? 'text-zinc-900' : 'text-zinc-100') : ''}`}>
            {/* Rendered through <img>, so scripts or external refs inside the SVG never run. */}
            {svg && <img src={o.currentColor ? svgDataUri(svg.replace(/currentColor/g, bg === 'light' ? '#18181b' : '#f4f4f5')) : uri} alt="" className="max-w-full max-h-full min-w-[48px] min-h-[48px] object-contain" />}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Seg value={out} onChange={setOut} options={[{ value: 'svg', label: 'SVG' }, { value: 'react', label: 'React' }, { value: 'uri', label: 'Data URI · CSS' }]} />
          {out === 'react' && <label className="flex items-center gap-2 text-[11px] text-zinc-500">{t('tb.svg.component')}<input className={`${input} w-32`} value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} /></label>}
        </div>
        {out === 'uri' ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <Rows rows={svg ? [
              { label: 'URL-encoded', value: uri, hint: fmtBytes(uri.length) },
              { label: 'Base64', value: svgBase64Uri(svg), hint: fmtBytes(svgBase64Uri(svg).length) },
              { label: 'CSS', value: `background-image: url("${uri}");` },
              { label: 'CSS mask', value: `mask: url("${uri}") center / contain no-repeat;` },
              { label: '<img>', value: `<img src="${uri}" alt="">` },
            ] : []} />
          </div>
        ) : <Code className="flex-1 min-h-0" code={out === 'react' ? react : svg} lang={out === 'react' ? 'typescript' : 'xml'} wrap={out === 'svg' && !o.pretty} />}
      </div>
    </div>
  );
}
