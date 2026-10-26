import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { qrMatrix, qrSvg, wifiPayload, type Ecc } from '../../lib/toolbox/qr';
import { svgDataUri } from '../../lib/toolbox/svg';
import { t } from '../../lib/i18n';
import { Check, Section, Seg, blobToBase64, btn, btnPrimary, errText, input, saveBytes, usePersisted } from './ui';
import { takePayload } from './bus';

type Kind = 'text' | 'wifi';

/** PNG at `px` pixels (rounded to whole modules so edges stay sharp). */
async function pngBlob(m: boolean[][], fg: string, bg: string, px: number): Promise<Blob> {
  const n = m.length;
  const scale = Math.max(1, Math.round(px / n));
  const c = document.createElement('canvas');
  c.width = c.height = n * scale;
  const g = c.getContext('2d')!;
  if (bg !== 'transparent') { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); }
  g.fillStyle = fg;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) g.fillRect(x * scale, y * scale, scale, scale);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'));
}

export default function QrTool() {
  const [kind, setKind] = usePersisted<Kind>('qr.kind', 'text');
  const [text, setText] = usePersisted('qr.text', '');
  const [wifi, setWifi] = usePersisted<{ ssid: string; auth: 'WPA' | 'WEP' | 'nopass'; hidden: boolean }>('qr.wifi', { ssid: '', auth: 'WPA', hidden: false });
  const [wifiPass, setWifiPass] = useState('');
  const [ecc, setEcc] = usePersisted<Ecc>('qr.ecc', 'M');
  const [margin, setMargin] = usePersisted('qr.margin', 2);
  const [size, setSize] = usePersisted('qr.size', 512);
  const [fg, setFg] = usePersisted('qr.fg', '#000000');
  const [bg, setBg] = usePersisted('qr.bg', '#ffffff');
  const [lan, setLan] = useState<string | null>(null);
  const [port, setPort] = usePersisted('qr.port', '5173');
  const [status, setStatus] = useState('');
  useEffect(() => { api.netInfo().then((i) => setLan(i.lan)).catch(() => {}); }, []);
  useEffect(() => { const p = takePayload<{ text: string }>('qr'); if (p) { setKind('text'); setText(p.text); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!status) return; const id = setTimeout(() => setStatus(''), 2000); return () => clearTimeout(id); }, [status]);

  const payload = kind === 'wifi' ? (wifi.ssid ? wifiPayload(wifi.ssid, wifiPass, wifi.auth, wifi.hidden) : '') : text;
  const res = useMemo(() => {
    if (!payload) return null;
    try { return { ok: true as const, m: qrMatrix(payload, { ecc, margin }) }; } catch (e) { return { ok: false as const, msg: errText(e) }; }
  }, [payload, ecc, margin]);
  const svg = res?.ok ? qrSvg(res.m, { fg, bg: bg === 'transparent' ? '' : bg }, size) : '';
  const act = async (what: 'copyPng' | 'savePng' | 'copySvg' | 'saveSvg') => {
    if (!res?.ok) return;
    try {
      if (what === 'copySvg') { await navigator.clipboard.writeText(svg); setStatus(t('common.copied')); return; }
      if (what === 'saveSvg') { const p = await saveBytes('qr.svg', btoa(svg)); if (p) setStatus(t('tb.savedTo', { path: p })); return; }
      const blob = await pngBlob(res.m, fg, bg, size);
      if (what === 'copyPng') { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); setStatus(t('common.copied')); return; }
      const p = await saveBytes('qr.png', await blobToBase64(blob)); if (p) setStatus(t('tb.savedTo', { path: p }));
    } catch (e) { setStatus(errText(e)); }
  };

  return (
    <div className="h-full grid grid-cols-[1fr_minmax(280px,42%)] gap-4 min-h-0">
      <div className="flex flex-col gap-4 min-h-0 overflow-y-auto pr-1">
        <Seg value={kind} onChange={setKind} className="self-start" options={[{ value: 'text', label: t('tb.qr.textUrl') }, { value: 'wifi', label: 'Wi-Fi' }]} />
        {kind === 'text' ? (
          <div className="flex flex-col gap-3">
            <textarea className={`${input} min-h-[96px] resize-y py-2 text-[13px]`} value={text} onChange={(e) => setText(e.target.value)} placeholder="https://…" spellCheck={false} autoFocus />
            {lan && (
              <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                <span>{t('tb.qr.devServer')}</span>
                <span className="font-mono text-zinc-300">http://{lan}:</span>
                <input className={`${input} w-20`} value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} />
                <button className={btn} onClick={() => setText(`http://${lan}:${port}/`)}>{t('tb.qr.use')}</button>
              </div>
            )}
            <div className="text-[11px] text-zinc-600">{t('tb.qr.devNote')}</div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-[11px] text-zinc-500">
            <label className="flex items-center gap-3">SSID<input className={`${input} flex-1`} value={wifi.ssid} onChange={(e) => setWifi((w) => ({ ...w, ssid: e.target.value }))} spellCheck={false} autoFocus /></label>
            <label className="flex items-center gap-3">{t('tb.qr.password')}<input type="password" className={`${input} flex-1`} value={wifiPass} onChange={(e) => setWifiPass(e.target.value)} disabled={wifi.auth === 'nopass'} /></label>
            <div className="flex items-center gap-4">
              <Seg value={wifi.auth} onChange={(v) => setWifi((w) => ({ ...w, auth: v }))} options={[{ value: 'WPA', label: 'WPA/WPA2/WPA3' }, { value: 'WEP', label: 'WEP' }, { value: 'nopass', label: t('tb.qr.open') }]} />
              <Check label={t('tb.qr.hidden')} checked={wifi.hidden} onChange={(v) => setWifi((w) => ({ ...w, hidden: v }))} />
            </div>
            <div className="text-zinc-600">{t('tb.qr.wifiNote')}</div>
          </div>
        )}
        <Section title={t('tb.qr.style')}>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-[11px] text-zinc-500">
            <span className="flex items-center gap-2">{t('tb.qr.ecc')}<Seg value={ecc} onChange={setEcc} options={(['L', 'M', 'Q', 'H'] as Ecc[]).map((e) => ({ value: e, label: e }))} /></span>
            <label className="flex items-center gap-2">{t('tb.qr.margin')}<input type="number" min={0} max={10} className={`${input} w-14`} value={margin} onChange={(e) => setMargin(Math.min(10, Math.max(0, Number(e.target.value) || 0)))} /></label>
            <label className="flex items-center gap-2">{t('tb.qr.size')}<input type="number" min={64} max={4096} step={64} className={`${input} w-20`} value={size} onChange={(e) => setSize(Math.min(4096, Math.max(64, Number(e.target.value) || 512)))} />px</label>
            <label className="flex items-center gap-2">{t('tb.qr.fg')}<input type="color" value={fg} onChange={(e) => setFg(e.target.value)} className="w-7 h-6 bg-transparent" /></label>
            <label className="flex items-center gap-2">{t('tb.qr.bg')}<input type="color" value={bg === 'transparent' ? '#ffffff' : bg} onChange={(e) => setBg(e.target.value)} className="w-7 h-6 bg-transparent" disabled={bg === 'transparent'} /></label>
            <Check label={t('tb.qr.transparent')} checked={bg === 'transparent'} onChange={(v) => setBg(v ? 'transparent' : '#ffffff')} />
          </div>
          <div className="text-[11px] text-zinc-600">{t('tb.qr.eccNote')}</div>
        </Section>
      </div>
      <div className="flex flex-col gap-3 min-h-0">
        <div className="flex-1 min-h-0 rounded-md border border-white/10 flex items-center justify-center p-4 bg-[repeating-conic-gradient(#2a2a2a_0_25%,#1f1f1f_0_50%)] bg-[length:16px_16px]">
          {res?.ok ? <img src={svgDataUri(svg)} alt="" className="max-w-full max-h-full aspect-square [image-rendering:pixelated]" /> : <span className="text-[12px] text-zinc-500">{res && !res.ok ? res.msg : t('tb.qr.empty')}</span>}
        </div>
        {res?.ok && <div className="text-[11px] text-zinc-500">{t('tb.qr.info', { n: res.m.length - margin * 2, chars: [...payload].length })}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <button className={btnPrimary} disabled={!res?.ok} onClick={() => act('copyPng')}>{t('tb.qr.copyPng')}</button>
          <button className={btn} disabled={!res?.ok} onClick={() => act('savePng')}>{t('tb.qr.savePng')}</button>
          <button className={btn} disabled={!res?.ok} onClick={() => act('copySvg')}>{t('tb.qr.copySvg')}</button>
          <button className={btn} disabled={!res?.ok} onClick={() => act('saveSvg')}>{t('tb.qr.saveSvg')}</button>
          <span className="text-[11px] text-zinc-500 truncate">{status}</span>
        </div>
      </div>
    </div>
  );
}
