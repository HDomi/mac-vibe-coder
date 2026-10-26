import { useMemo, useRef, useState } from 'react';
import { calcLines, cssLengths, DATA_UNITS, dataSizes, formatNumber, LENGTH_UNITS, transferSeconds, type DataUnit, type LengthUnit } from '../../lib/toolbox/calc';
import { formatDuration } from '../../lib/toolbox/time';
import { t } from '../../lib/i18n';
import { CopyButton, Section, input, mono, select, usePersisted } from './ui';

const SAMPLE = `# variables carry over to later lines
price = 12_000
qty = 3
subtotal = price * qty
subtotal * 1.1   // VAT
0xff + 0b1010
sqrt(2) ^ 2
gib = 1024 ^ 3
ans / 1e9`;

export default function CalcTool() {
  const [text, setText] = usePersisted('calc.text', SAMPLE);
  const lines = useMemo(() => calcLines(text), [text]);
  const results = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const copy = (i: number, v: string) => { navigator.clipboard.writeText(v).catch(() => {}); setCopied(i); setTimeout(() => setCopied(null), 1000); };
  const last = [...lines].reverse().find((l) => l.value !== undefined)?.value;
  return (
    <div className="h-full flex flex-col gap-5 min-h-0 overflow-y-auto pr-1">
      <Section title={t('tb.calc.title')} actions={last !== undefined ? <CopyButton text={String(last)} label={`= ${formatNumber(last)}`} /> : null}>
        <div className="grid grid-cols-[1fr_minmax(180px,40%)] rounded-md border border-white/10 overflow-hidden h-64 shrink-0">
          <textarea value={text} onChange={(e) => setText(e.target.value)} wrap="off" spellCheck={false} autoFocus
            onScroll={(e) => { if (results.current) results.current.scrollTop = e.currentTarget.scrollTop; }}
            style={{ lineHeight: '24px' }} className="resize-none bg-white/[.03] px-3 py-2 font-mono text-[12.5px] text-zinc-200 outline-none overflow-auto" />
          <div ref={results} style={{ lineHeight: '24px' }} className="overflow-hidden border-l border-white/10 px-3 py-2 font-mono text-[12.5px] text-right">
            {lines.map((l, i) => (
              <div key={i} className="h-[24px] truncate">
                {l.error ? <span className="text-red-400/80 text-[11px]" title={l.error}>{l.error}</span>
                  : l.value !== undefined ? <button className="text-emerald-300 hover:underline" title={Number.isInteger(l.value) ? `0x${l.value.toString(16)} · 0b${l.value.toString(2)}` : String(l.value)} onClick={() => copy(i, String(l.value))}>
                    {copied === i ? t('common.copied') : <>{l.name && <span className="text-zinc-500">{l.name} = </span>}{formatNumber(l.value)}</>}
                  </button> : null}
              </div>
            ))}
          </div>
        </div>
        <div className="text-[11px] text-zinc-500 leading-relaxed">{t('tb.calc.help')}</div>
      </Section>
      <CssUnits />
      <DataUnits />
    </div>
  );
}

function CssUnits() {
  const [v, setV] = usePersisted('calc.cssValue', '24');
  const [unit, setUnit] = usePersisted<LengthUnit>('calc.cssUnit', 'px');
  const [base, setBase] = usePersisted('calc.cssBase', 16);
  const [vw, setVw] = usePersisted('calc.vw', 1440);
  const [vh, setVh] = usePersisted('calc.vh', 900);
  const n = Number(v);
  const out = Number.isFinite(n) ? cssLengths(n, unit, { base, vw, vh }) : null;
  const fmt = (x: number) => String(Number(x.toFixed(4)));
  return (
    <Section title={t('tb.calc.css')}>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
        <input className={`${input} w-28`} value={v} onChange={(e) => setV(e.target.value)} />
        <select className={select} value={unit} onChange={(e) => setUnit(e.target.value as LengthUnit)}>{LENGTH_UNITS.map((u) => <option key={u}>{u}</option>)}</select>
        <label className="flex items-center gap-2">{t('tb.calc.base')}<input type="number" className={`${input} w-16`} value={base} onChange={(e) => setBase(Number(e.target.value) || 16)} />px</label>
        <label className="flex items-center gap-2">{t('tb.calc.viewport')}<input type="number" className={`${input} w-20`} value={vw} onChange={(e) => setVw(Number(e.target.value) || 1)} />×<input type="number" className={`${input} w-20`} value={vh} onChange={(e) => setVh(Number(e.target.value) || 1)} /></label>
      </div>
      {out && (
        <div className="grid grid-cols-4 gap-2">
          {LENGTH_UNITS.filter((u) => u !== unit).map((u) => (
            <div key={u} className="flex items-center gap-2 rounded-md border border-white/10 px-2.5 py-1.5">
              <span className={`flex-1 ${mono} text-zinc-200 truncate`}>{fmt(out[u])}<span className="text-zinc-500">{u}</span></span>
              <CopyButton text={`${fmt(out[u])}${u}`} />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function DataUnits() {
  const [v, setV] = usePersisted('calc.dataValue', '1.5');
  const [unit, setUnit] = usePersisted<DataUnit>('calc.dataUnit', 'GB');
  const n = Number(v);
  const out = Number.isFinite(n) ? dataSizes(n, unit) : null;
  const bytes = out?.B ?? 0;
  return (
    <Section title={t('tb.calc.data')}>
      <div className="flex items-center gap-3">
        <input className={`${input} w-28`} value={v} onChange={(e) => setV(e.target.value)} />
        <select className={select} value={unit} onChange={(e) => setUnit(e.target.value as DataUnit)}>{DATA_UNITS.map((u) => <option key={u}>{u}</option>)}</select>
      </div>
      {out && <>
        <div className="grid grid-cols-4 gap-2">
          {DATA_UNITS.filter((u) => u !== unit).map((u) => (
            <div key={u} className="flex items-center gap-2 rounded-md border border-white/10 px-2.5 py-1.5">
              <span className={`flex-1 ${mono} text-zinc-200 truncate`} title={String(out[u])}>{formatNumber(out[u])} <span className="text-zinc-500">{u}</span></span>
              <CopyButton text={String(out[u])} />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-zinc-500">
          {[10, 100, 1000].map((mbps) => <span key={mbps}>{t('tb.calc.transfer', { speed: mbps >= 1000 ? `${mbps / 1000} Gbps` : `${mbps} Mbps` })} <span className="text-zinc-300">{formatDuration(transferSeconds(bytes, mbps) * 1000)}</span></span>)}
        </div>
      </>}
    </Section>
  );
}
