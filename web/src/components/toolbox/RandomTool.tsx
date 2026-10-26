import { useState } from 'react';
import { randomBytes, randomPassword, uuidV4, uuidV7, type PasswordOptions } from '../../lib/toolbox/crypto';
import { bytesToBase64, bytesToHex } from '../../lib/toolbox/bytes';
import { t } from '../../lib/i18n';
import { Area, Check, CopyButton, Seg, Section, btnPrimary, input, mono, usePersisted } from './ui';

export default function RandomTool() {
  return (
    <div className="h-full flex flex-col gap-5 min-h-0 overflow-y-auto pr-1">
      <Uuid />
      <Password />
      <Bytes />
      <Numbers />
    </div>
  );
}

function Uuid() {
  const [ver, setVer] = usePersisted<'v4' | 'v7'>('random.uuidVer', 'v4');
  const [count, setCount] = usePersisted('random.uuidCount', 5);
  const [upper, setUpper] = usePersisted('random.uuidUpper', false);
  const [dashes, setDashes] = usePersisted('random.uuidDashes', true);
  const [out, setOut] = useState('');
  const gen = () => {
    const n = Math.min(1000, Math.max(1, count));
    let list = Array.from({ length: n }, () => (ver === 'v4' ? uuidV4() : uuidV7()));
    if (!dashes) list = list.map((u) => u.replace(/-/g, ''));
    if (upper) list = list.map((u) => u.toUpperCase());
    setOut(list.join('\n'));
  };
  return (
    <Section title="UUID" actions={<button className={btnPrimary} onClick={gen}>{t('tb.generate')}</button>}>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
        <Seg value={ver} onChange={setVer} options={[{ value: 'v4', label: 'v4' }, { value: 'v7', label: `v7 · ${t('tb.random.timeOrdered')}` }]} />
        <label className="flex items-center gap-2">{t('tb.random.count')}<input type="number" min={1} max={1000} className={`${input} w-16 py-0.5`} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} /></label>
        <Check label={t('tb.random.uppercase')} checked={upper} onChange={setUpper} />
        <Check label={t('tb.random.dashes')} checked={dashes} onChange={setDashes} />
      </div>
      {out && <Area value={out} readOnly minRows={Math.min(8, out.split('\n').length)} />}
    </Section>
  );
}

function Password() {
  const [o, setO] = usePersisted<PasswordOptions>('random.pw', { length: 20, upper: true, lower: true, digits: true, symbols: true });
  const [pw, setPw] = useState(() => randomPassword(o));
  const set = <K extends keyof PasswordOptions>(k: K, v: PasswordOptions[K]) => { const next = { ...o, [k]: v }; setO(next); setPw(randomPassword(next)); };
  const size = (o.upper ? 23 : 0) + (o.lower ? 25 : 0) + (o.digits ? 8 : 0) + (o.symbols ? 24 : 0);
  const bits = size ? Math.round(Math.log2(size) * o.length) : 0;
  return (
    <Section title={t('tb.random.password')} actions={<button className={btnPrimary} onClick={() => setPw(randomPassword(o))}>{t('tb.generate')}</button>}>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
        <label className="flex items-center gap-2">{t('tb.random.length')}<input type="range" min={6} max={64} value={o.length} onChange={(e) => set('length', Number(e.target.value))} /><span className="w-6 tabular-nums text-zinc-300">{o.length}</span></label>
        <Check label="A-Z" checked={o.upper} onChange={(v) => set('upper', v)} />
        <Check label="a-z" checked={o.lower} onChange={(v) => set('lower', v)} />
        <Check label="0-9" checked={o.digits} onChange={(v) => set('digits', v)} />
        <Check label="!@#" checked={o.symbols} onChange={(v) => set('symbols', v)} />
        <span className="text-zinc-600">{t('tb.random.entropy', { n: bits })}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className={`flex-1 min-w-0 break-all rounded-md border border-white/10 bg-white/[.03] px-2.5 py-2 ${mono} text-zinc-100 select-all`}>{pw || <span className="text-zinc-600">{t('tb.random.pickClass')}</span>}</div>
        <CopyButton text={pw} />
      </div>
      <div className="text-[11px] text-zinc-600">{t('tb.random.pwNote')}</div>
    </Section>
  );
}

function Bytes() {
  const [len, setLen] = usePersisted('random.bytesLen', 32);
  const [fmt, setFmt] = usePersisted<'hex' | 'base64' | 'base64url'>('random.bytesFmt', 'hex');
  const [out, setOut] = useState('');
  const gen = () => { const b = randomBytes(Math.min(4096, Math.max(1, len))); setOut(fmt === 'hex' ? bytesToHex(b) : bytesToBase64(b, fmt === 'base64url')); };
  return (
    <Section title={t('tb.random.bytes')} actions={<button className={btnPrimary} onClick={gen}>{t('tb.generate')}</button>}>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
        <label className="flex items-center gap-2">{t('tb.random.bytesN')}<input type="number" min={1} max={4096} className={`${input} w-20 py-0.5`} value={len} onChange={(e) => setLen(Number(e.target.value) || 1)} /></label>
        <Seg value={fmt} onChange={setFmt} options={[{ value: 'hex', label: 'Hex' }, { value: 'base64', label: 'Base64' }, { value: 'base64url', label: 'Base64url' }]} />
        <span className="text-zinc-600">{t('tb.random.bytesNote')}</span>
      </div>
      {out && (
        <div className="flex items-start gap-2">
          <div className={`flex-1 min-w-0 break-all rounded-md border border-white/10 bg-white/[.03] px-2.5 py-2 ${mono} text-zinc-200 select-all`}>{out}</div>
          <CopyButton text={out} />
        </div>
      )}
    </Section>
  );
}

function Numbers() {
  const [min, setMin] = usePersisted('random.min', 1);
  const [max, setMax] = usePersisted('random.max', 100);
  const [count, setCount] = usePersisted('random.numCount', 10);
  const [unique, setUnique] = usePersisted('random.unique', false);
  const [out, setOut] = useState('');
  const gen = () => {
    const lo = Math.min(min, max), hi = Math.max(min, max), span = hi - lo + 1;
    const n = Math.min(10000, Math.max(1, count));
    if (unique && span < n) { setOut(t('tb.random.rangeTooSmall')); return; }
    const pick = () => lo + Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * span);
    const vals: number[] = [];
    const seen = new Set<number>();
    while (vals.length < n) { const v = pick(); if (unique) { if (seen.has(v)) continue; seen.add(v); } vals.push(v); }
    setOut(vals.join(', '));
  };
  return (
    <Section title={t('tb.random.numbers')} actions={<button className={btnPrimary} onClick={gen}>{t('tb.generate')}</button>}>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
        <label className="flex items-center gap-2">{t('tb.random.min')}<input type="number" className={`${input} w-24 py-0.5`} value={min} onChange={(e) => setMin(Number(e.target.value) || 0)} /></label>
        <label className="flex items-center gap-2">{t('tb.random.max')}<input type="number" className={`${input} w-24 py-0.5`} value={max} onChange={(e) => setMax(Number(e.target.value) || 0)} /></label>
        <label className="flex items-center gap-2">{t('tb.random.count')}<input type="number" min={1} max={10000} className={`${input} w-20 py-0.5`} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} /></label>
        <Check label={t('tb.random.unique')} checked={unique} onChange={setUnique} />
      </div>
      {out && (
        <div className="flex items-start gap-2">
          <div className={`flex-1 min-w-0 break-words rounded-md border border-white/10 bg-white/[.03] px-2.5 py-2 ${mono} text-zinc-200`}>{out}</div>
          <CopyButton text={out} />
        </div>
      )}
    </Section>
  );
}
