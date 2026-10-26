import { useEffect, useState } from 'react';
import { escapeAs, ESCAPE_KINDS, unescapeAs, type EscapeKind } from '../../lib/toolbox/escape';
import { t } from '../../lib/i18n';
import { Area, Check, Seg, btn, errText, usePersisted } from './ui';

const LABEL: Record<EscapeKind, string> = {
  json: 'JSON', js: "JS '…'", template: 'JS `…`', shellSingle: "Shell '…'", shellDouble: 'Shell "…"',
  regex: 'RegExp', sql: 'SQL', csv: 'CSV', c: 'C / Java', xml: 'XML',
};

/** Two-way like the Encode tool: typing on either side updates the other. */
export default function EscapeTool() {
  const [kind, setKind] = usePersisted<EscapeKind>('escape.kind', 'json');
  const [ascii, setAscii] = usePersisted('escape.ascii', false);
  const [plain, setPlain] = usePersisted('escape.plain', '');
  const [coded, setCoded] = useState('');
  const [err, setErr] = useState<{ side: 'plain' | 'coded'; msg: string } | null>(null);
  const enc = (s: string) => escapeAs(s, kind, { asciiOnly: ascii });
  useEffect(() => { setCoded(enc(plain)); setErr(null); }, [kind, ascii]); // eslint-disable-line react-hooks/exhaustive-deps
  const onPlain = (v: string) => { setPlain(v); setCoded(enc(v)); setErr(null); };
  const onCoded = (v: string) => { setCoded(v); try { setPlain(unescapeAs(v, kind)); setErr(null); } catch (e) { setErr({ side: 'coded', msg: errText(e) }); } };
  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <div className="flex flex-wrap items-center gap-3">
        <Seg value={kind} onChange={setKind} options={ESCAPE_KINDS.map((k) => ({ value: k, label: LABEL[k] }))} className="flex-wrap" />
        {(kind === 'json' || kind === 'js') && <Check label={t('tb.escape.ascii')} checked={ascii} onChange={setAscii} />}
      </div>
      <div className="text-[11px] text-zinc-500">{t(`tb.escape.hint.${kind}`)}</div>
      <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
        <Area label={t('tb.encode.plain')} value={plain} onChange={onPlain} autoFocus actions={plain ? <button className={btn} onClick={() => onPlain('')}>{t('tb.clear')}</button> : null} />
        <Area label={t('tb.escape.escaped')} value={coded} onChange={onCoded} error={err?.side === 'coded' ? err.msg : null} />
      </div>
    </div>
  );
}
