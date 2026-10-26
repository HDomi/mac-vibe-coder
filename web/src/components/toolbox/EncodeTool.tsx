import { useEffect, useMemo, useState } from 'react';
import { base64Decode, base64Encode, bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from '../../lib/toolbox/bytes';
import { convertBase, htmlDecode, htmlEncode, parseQuery, unicodeEscape, unicodeUnescape, urlDecode, urlEncode, type Base } from '../../lib/toolbox/encode';
import { t } from '../../lib/i18n';
import { Area, CopyButton, Rows, Seg, btn, errText, input, mono, usePersisted } from './ui';

type Kind = 'base64' | 'base64url' | 'url' | 'urlFull' | 'html' | 'unicode' | 'hex' | 'binary' | 'query' | 'base';

const PAIRS: Record<Exclude<Kind, 'query' | 'base'>, { enc: (s: string) => string; dec: (s: string) => string }> = {
  base64: { enc: (s) => base64Encode(s), dec: base64Decode },
  base64url: { enc: (s) => base64Encode(s, true), dec: base64Decode },
  url: { enc: (s) => urlEncode(s), dec: urlDecode },
  urlFull: { enc: (s) => urlEncode(s, false), dec: urlDecode },
  html: { enc: htmlEncode, dec: htmlDecode },
  unicode: { enc: unicodeEscape, dec: unicodeUnescape },
  hex: { enc: (s) => bytesToHex(utf8ToBytes(s)), dec: (s) => bytesToUtf8(hexToBytes(s)) },
  binary: {
    enc: (s) => [...utf8ToBytes(s)].map((b) => b.toString(2).padStart(8, '0')).join(' '),
    dec: (s) => { const bits = s.replace(/\s+/g, ''); if (!/^[01]*$/.test(bits) || bits.length % 8) throw new Error('Binary must be 8-bit groups'); return bytesToUtf8(new Uint8Array(bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? [])); },
  },
};

const KINDS: { value: Kind; label: string }[] = [
  { value: 'base64', label: 'Base64' }, { value: 'base64url', label: 'Base64url' }, { value: 'url', label: 'URL' }, { value: 'urlFull', label: 'URL (full)' },
  { value: 'html', label: 'HTML' }, { value: 'unicode', label: 'Unicode' }, { value: 'hex', label: 'Hex' }, { value: 'binary', label: 'Binary' },
  { value: 'query', label: 'Query' }, { value: 'base', label: 'Base' },
];

export default function EncodeTool() {
  const [kind, setKind] = usePersisted<Kind>('encode.kind', 'base64');
  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <Seg value={kind} onChange={setKind} options={KINDS} className="self-start flex-wrap" />
      <div className="flex-1 min-h-0">
        {kind === 'query' ? <Query /> : kind === 'base' ? <BaseConv /> : <Pair kind={kind} />}
      </div>
    </div>
  );
}

/** Two-way: typing on either side converts to the other. The last edited side wins when the kind changes. */
function Pair({ kind }: { kind: Exclude<Kind, 'query' | 'base'> }) {
  const [plain, setPlain] = usePersisted('encode.plain', '');
  const [coded, setCoded] = useState('');
  const [err, setErr] = useState<{ side: 'plain' | 'coded'; msg: string } | null>(null);
  const { enc, dec } = PAIRS[kind];
  useEffect(() => { try { setCoded(enc(plain)); setErr(null); } catch (e) { setErr({ side: 'plain', msg: errText(e) }); } }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const onPlain = (v: string) => { setPlain(v); try { setCoded(enc(v)); setErr(null); } catch (e) { setErr({ side: 'plain', msg: errText(e) }); } };
  const onCoded = (v: string) => { setCoded(v); try { setPlain(dec(v)); setErr(null); } catch (e) { setErr({ side: 'coded', msg: errText(e) }); } };
  const label = KINDS.find((k) => k.value === kind)?.label;
  return (
    <div className="h-full grid grid-cols-2 gap-4 min-h-0">
      <Area label={t('tb.encode.plain')} value={plain} onChange={onPlain} error={err?.side === 'plain' ? err.msg : null} autoFocus
        actions={plain ? <button className={btn} onClick={() => onPlain('')}>{t('tb.clear')}</button> : null} />
      <Area label={label} value={coded} onChange={onCoded} error={err?.side === 'coded' ? err.msg : null} />
    </div>
  );
}

function Query() {
  const [text, setText] = usePersisted('encode.query', '');
  const pairs = useMemo(() => parseQuery(text), [text]);
  const json = useMemo(() => JSON.stringify(Object.fromEntries(pairs), null, 2), [pairs]);
  const url = useMemo(() => { try { return text.includes('://') ? new URL(text.trim()) : null; } catch { return null; } }, [text]);
  return (
    <div className="h-full grid grid-cols-2 gap-4 min-h-0">
      <Area label={t('tb.encode.urlOrQuery')} value={text} onChange={setText} placeholder="https://example.com/path?a=1&b=two+words#frag" autoFocus />
      <div className="flex flex-col gap-2 min-h-0 overflow-y-auto">
        {url && <Rows rows={[
          { label: 'origin', value: url.origin }, { label: 'pathname', value: url.pathname },
          ...(url.hash ? [{ label: 'hash', value: url.hash }] : []),
        ]} />}
        <div className="h-7 mb-1 flex items-center gap-2 text-[11px] text-zinc-500"><span className="flex-1">{t('tb.encode.params', { n: pairs.length })}</span><CopyButton text={json} label="JSON" /></div>
        {pairs.length > 0 && (
          <div className={`rounded-md border border-white/10 divide-y divide-white/5 ${mono}`}>
            {pairs.map(([k, v], i) => (
              <div key={i} className="flex items-start gap-2 px-2.5 py-1.5">
                <span className="w-1/3 shrink-0 text-sky-300 break-all">{k}</span>
                <span className="flex-1 min-w-0 text-zinc-200 break-all whitespace-pre-wrap">{v}</span>
                <CopyButton text={v} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BaseConv() {
  const [text, setText] = usePersisted('encode.base', '');
  const [from, setFrom] = usePersisted<Base>('encode.baseFrom', 10);
  const [err, setErr] = useState<string | null>(null);
  const out = useMemo(() => { if (!text.trim()) { setErr(null); return null; } try { const r = convertBase(text, from); setErr(null); return r; } catch (e) { setErr(errText(e)); return null; } }, [text, from]);
  const group = (s: string, n: number) => { const neg = s.startsWith('-'); const body = neg ? s.slice(1) : s; return (neg ? '-' : '') + body.replace(new RegExp(`\\B(?=(\\w{${n}})+(?!\\w))`, 'g'), ' '); };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Seg value={String(from)} onChange={(v) => setFrom(Number(v) as Base)} options={[{ value: '2', label: 'BIN' }, { value: '8', label: 'OCT' }, { value: '10', label: 'DEC' }, { value: '16', label: 'HEX' }]} />
        <input className={`${input} flex-1`} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('tb.encode.basePlaceholder')} autoFocus spellCheck={false} />
      </div>
      {err && <div className="text-[11px] text-red-400">{err}</div>}
      {out && <Rows rows={[
        { label: 'Binary', value: out[2], hint: group(out[2], 4) },
        { label: 'Octal', value: out[8] },
        { label: 'Decimal', value: out[10], hint: group(out[10], 3) },
        { label: 'Hex', value: out[16], hint: `0x${out[16].replace('-', '')}` },
      ]} />}
    </div>
  );
}
