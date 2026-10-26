import { useMemo, useState } from 'react';
import { contrastRatio, formatColor, parseColor, shades, toHex, type Rgba } from '../../lib/toolbox/color';
import { t } from '../../lib/i18n';
import { CopyButton, Rows, Section, errText, input, mono, usePersisted } from './ui';

export default function ColorTool() {
  const [text, setText] = usePersisted('color.input', '#7aa2f7');
  const [other, setOther] = usePersisted('color.other', '#0b0d12');
  const [status, setStatus] = useState('');
  const color = useMemo(() => { try { return { ok: true as const, c: parseColor(text) }; } catch (e) { return { ok: false as const, msg: errText(e) }; } }, [text]);
  const otherC = useMemo(() => { try { return parseColor(other); } catch { return null; } }, [other]);
  const c = color.ok ? color.c : null;
  const fmt = c ? formatColor(c) : null;
  const copy = (s: string) => { navigator.clipboard.writeText(s).catch(() => {}); setStatus(t('tb.copiedX', { x: s })); setTimeout(() => setStatus(''), 1500); };
  const white = { r: 255, g: 255, b: 255, a: 1 }, black = { r: 0, g: 0, b: 0, a: 1 };

  return (
    <div className="h-full flex flex-col gap-4 min-h-0 overflow-y-auto pr-1">
      <div className="flex items-center gap-3">
        <label className="relative w-12 h-12 shrink-0 rounded-lg border border-white/15 overflow-hidden cursor-pointer" style={{ background: c ? checker(c) : '#333' }} title={t('tb.color.pick')}>
          <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" value={c ? toHex({ ...c, a: 1 }, false) : '#000000'} onChange={(e) => setText(e.target.value)} />
        </label>
        <input className={`${input} flex-1 text-[14px] ${!color.ok ? 'border-red-500/50' : ''}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="#7aa2f7 · rgb(122 162 247) · hsl(221 89% 72%) · navy" autoFocus spellCheck={false} />
      </div>
      {!color.ok && <div className="text-[11px] text-red-400">{color.msg}</div>}
      {c && fmt && <>
        <Rows rows={[
          { label: 'HEX', value: fmt.hex, hint: c.a < 1 ? toHex(c, false) : undefined },
          { label: 'RGB', value: fmt.rgb, hint: `${c.r}, ${c.g}, ${c.b}` },
          { label: 'HSL', value: fmt.hsl },
          { label: 'HSV', value: fmt.hsv },
          { label: 'CMYK', value: fmt.cmyk },
          { label: 'Swift', value: `Color(red: ${(c.r / 255).toFixed(3)}, green: ${(c.g / 255).toFixed(3)}, blue: ${(c.b / 255).toFixed(3)})` },
          { label: 'Tailwind', value: `[${fmt.hex}]`, hint: `bg-[${fmt.hex}]` },
        ]} />
        <Section title={t('tb.color.shades')}>
          <div className="flex rounded-md overflow-hidden border border-white/10 h-12">
            {shades(c).map((s, i) => {
              const h = toHex(s, false);
              return <button key={i} className="flex-1 relative group" style={{ background: h }} title={h} onClick={() => copy(h)}>
                <span className={`absolute inset-x-0 bottom-0.5 text-center ${mono} text-[10px] opacity-0 group-hover:opacity-100 ${contrastRatio(s, white) > 3 ? 'text-white' : 'text-black'}`}>{h}</span>
              </button>;
            })}
          </div>
        </Section>
        <Section title={t('tb.color.contrast')}>
          <div className="grid grid-cols-3 gap-3">
            <Contrast fg={c} bg={white} label={t('tb.color.onWhite')} />
            <Contrast fg={c} bg={black} label={t('tb.color.onBlack')} />
            <div className="flex flex-col gap-1">
              <input className={`${input} py-0.5 ${other && !otherC ? 'border-red-500/50' : ''}`} value={other} onChange={(e) => setOther(e.target.value)} spellCheck={false} />
              {otherC && <Contrast fg={c} bg={otherC} label={t('tb.color.onCustom')} />}
            </div>
          </div>
        </Section>
      </>}
      <div className="h-4 text-[11px] text-zinc-500 truncate">{status}</div>
    </div>
  );
}

function Contrast({ fg, bg, label }: { fg: Rgba; bg: Rgba; label: string }) {
  const ratio = contrastRatio({ ...fg, a: 1 }, bg);
  const pass = (n: number) => (ratio >= n ? 'text-emerald-300' : 'text-red-300');
  return (
    <div className="rounded-md border border-white/10 overflow-hidden">
      <div className="h-12 flex items-center justify-center text-[15px] font-medium" style={{ background: toHex(bg, false), color: toHex({ ...fg, a: 1 }, false) }}>Aa Text</div>
      <div className="px-2.5 py-1.5 text-[11px] text-zinc-500 flex items-center gap-2">
        <span className="flex-1 truncate">{label}</span>
        <span className={`${mono} text-zinc-200`}>{ratio.toFixed(2)}:1</span>
        <span className={pass(4.5)} title="AA normal text ≥ 4.5">AA</span>
        <span className={pass(7)} title="AAA normal text ≥ 7">AAA</span>
        <CopyButton text={ratio.toFixed(2)} />
      </div>
    </div>
  );
}

/** A checkerboard under translucent colors so alpha is visible. */
function checker(c: Rgba): string {
  const h = toHex(c);
  return `linear-gradient(${h}, ${h}), repeating-conic-gradient(#888 0 25%, #ccc 0 50%) 0 0 / 12px 12px`;
}
