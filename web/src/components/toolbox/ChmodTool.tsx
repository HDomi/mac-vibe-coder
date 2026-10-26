import { useEffect, useState } from 'react';
import { applyExpr, COMMON_MODES, fromOctal, fromSymbolic, toOctal, toSymbolic, type Mode, type Perm } from '../../lib/toolbox/chmod';
import { t } from '../../lib/i18n';
import { Check, Rows, Section, btn, errText, input, mono, usePersisted } from './ui';

export default function ChmodTool() {
  const [octal, setOctal] = usePersisted('chmod.octal', '755');
  const [file, setFile] = usePersisted('chmod.file', 'script.sh');
  const mode = (() => { try { return fromOctal(octal); } catch { return fromOctal('000'); } })();
  const [octText, setOctText] = useState(octal);
  const [symText, setSymText] = useState(toSymbolic(mode));
  const [expr, setExpr] = useState('');
  const [err, setErr] = useState<{ field: 'oct' | 'sym' | 'expr'; msg: string } | null>(null);
  useEffect(() => { setOctText(octal); setSymText(toSymbolic(fromOctal(octal))); }, [octal]);

  const commit = (m: Mode) => { setOctal(toOctal(m)); setErr(null); };
  const onOct = (v: string) => { setOctText(v); try { commit(fromOctal(v)); } catch (e) { setErr({ field: 'oct', msg: errText(e) }); } };
  const onSym = (v: string) => { setSymText(v); try { commit(fromSymbolic(v)); } catch (e) { setErr({ field: 'sym', msg: errText(e) }); } };
  const applyE = () => { try { commit(applyExpr(mode, expr)); setExpr(''); } catch (e) { setErr({ field: 'expr', msg: errText(e) }); } };
  const toggle = (who: 'user' | 'group' | 'other', bit: keyof Perm) => commit({ ...mode, [who]: { ...mode[who], [bit]: !mode[who][bit] } });
  const sym = toSymbolic(mode);
  const symbolicCmd = (['user', 'group', 'other'] as const).map((w) => `${w[0]}=${(['r', 'w', 'x'] as const).filter((b) => mode[w][b]).join('')}`).join(',');

  return (
    <div className="h-full flex flex-col gap-5 min-h-0 overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-[11px] text-zinc-500">{t('tb.chmod.octal')}
          <input className={`${input} text-[20px] py-2 tracking-[.2em] ${err?.field === 'oct' ? 'border-red-500/50' : ''}`} value={octText} onChange={(e) => onOct(e.target.value)} spellCheck={false} autoFocus />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-zinc-500">{t('tb.chmod.symbolic')}
          <input className={`${input} text-[20px] py-2 tracking-[.12em] ${err?.field === 'sym' ? 'border-red-500/50' : ''}`} value={symText} onChange={(e) => onSym(e.target.value)} spellCheck={false} placeholder="-rwxr-xr-x" />
        </label>
      </div>
      {err && <div className="text-[11px] text-red-400 -mt-3">{err.msg}</div>}
      <div className="rounded-md border border-white/10 overflow-hidden text-[12px]">
        <div className="grid grid-cols-[1fr_repeat(3,72px)_64px] bg-white/[.03] text-[11px] text-zinc-500 px-3 py-1.5">
          <span /><span className="text-center">{t('tb.chmod.read')}</span><span className="text-center">{t('tb.chmod.write')}</span><span className="text-center">{t('tb.chmod.exec')}</span><span className="text-center">{t('tb.chmod.value')}</span>
        </div>
        {(['user', 'group', 'other'] as const).map((w) => (
          <div key={w} className="grid grid-cols-[1fr_repeat(3,72px)_64px] items-center px-3 py-1.5 border-t border-white/5">
            <span className="text-zinc-300">{t(`tb.chmod.${w}`)}</span>
            {(['r', 'w', 'x'] as const).map((b) => <span key={b} className="flex justify-center"><input type="checkbox" checked={mode[w][b]} onChange={() => toggle(w, b)} /></span>)}
            <span className={`text-center ${mono} text-zinc-200`}>{(mode[w].r ? 4 : 0) + (mode[w].w ? 2 : 0) + (mode[w].x ? 1 : 0)}</span>
          </div>
        ))}
        <div className="flex items-center gap-4 px-3 py-2 border-t border-white/10 bg-white/[.02]">
          <Check label="setuid (4)" checked={mode.setuid} onChange={(v) => commit({ ...mode, setuid: v })} />
          <Check label="setgid (2)" checked={mode.setgid} onChange={(v) => commit({ ...mode, setgid: v })} />
          <Check label="sticky (1)" checked={mode.sticky} onChange={(v) => commit({ ...mode, sticky: v })} />
        </div>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-zinc-500">
        <span className="shrink-0">{t('tb.chmod.file')}</span>
        <input className={`${input} w-48`} value={file} onChange={(e) => setFile(e.target.value)} spellCheck={false} />
        <span className="shrink-0 ml-3">{t('tb.chmod.apply')}</span>
        <input className={`${input} flex-1 ${err?.field === 'expr' ? 'border-red-500/50' : ''}`} value={expr} onChange={(e) => setExpr(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyE(); }} placeholder="u+x,go-w · a=r · +X" spellCheck={false} />
        <button className={btn} disabled={!expr.trim()} onClick={applyE}>{t('tb.chmod.applyBtn')}</button>
      </div>
      <Rows rows={[
        { label: t('tb.chmod.cmdOctal'), value: `chmod ${toOctal(mode)} ${file || 'file'}` },
        { label: t('tb.chmod.cmdSymbolic'), value: `chmod ${symbolicCmd} ${file || 'file'}` },
        { label: 'ls -l', value: `-${sym}` },
        { label: t('tb.chmod.recursive'), value: `chmod -R ${toOctal(mode)} ${file || 'dir'}` },
      ]} />
      <Section title={t('tb.chmod.common')}>
        <div className="grid grid-cols-2 gap-2">
          {COMMON_MODES.map((c) => (
            <button key={c.octal} onClick={() => setOctal(c.octal)} className={`flex items-center gap-3 rounded-md border px-3 py-1.5 text-left ${octal === c.octal ? 'border-blue-400/50 bg-blue-500/10' : 'border-white/10 hover:bg-white/5'}`}>
              <span className={`${mono} w-12 text-zinc-100`}>{c.octal}</span>
              <span className={`${mono} w-24 text-zinc-500`}>{toSymbolic(fromOctal(c.octal))}</span>
              <span className="text-[11.5px] text-zinc-400 truncate">{t(`tb.chmod.mode.${c.key}`)}</span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}
