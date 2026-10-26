import { useMemo, useState } from 'react';
import { CASE_STYLES, convertCase, LINE_OPS, lineOp, LOREM, textStats, type CaseStyle, type LineOp } from '../../lib/toolbox/text';
import { t } from '../../lib/i18n';
import { Area, btn, usePersisted } from './ui';

const CASE_LABEL: Record<CaseStyle, string> = { camel: 'camelCase', pascal: 'PascalCase', snake: 'snake_case', kebab: 'kebab-case', constant: 'CONSTANT_CASE', dot: 'dot.case', path: 'path/case', title: 'Title Case', sentence: 'Sentence case', upper: 'UPPER', lower: 'lower' };

export default function TextTool() {
  const [text, setText] = usePersisted('text.input', '');
  const [out, setOut] = useState('');
  const [label, setLabel] = useState('');
  const stats = useMemo(() => textStats(text), [text]);
  const apply = (name: string, f: (s: string) => string) => { setOut(f(text)); setLabel(name); };
  const lorem = (n: number) => { setOut(Array.from({ length: n }, () => LOREM).join('\n\n')); setLabel(`Lorem ×${n}`); };
  const chips: [string, number | string][] = [
    [t('tb.text.chars'), stats.chars], [t('tb.text.noSpace'), stats.charsNoSpace], [t('tb.text.bytes'), stats.bytes],
    [t('tb.text.words'), stats.words], [t('tb.text.lines'), stats.lines], [t('tb.text.sentences'), stats.sentences], [t('tb.text.paragraphs'), stats.paragraphs],
  ];
  return (
    <div className="h-full grid grid-cols-2 gap-3 min-h-0">
      <div className="flex flex-col gap-2 min-h-0">
        <Area className="flex-1" label={t('tb.input')} value={text} onChange={setText} autoFocus actions={text ? <button className={btn} onClick={() => setText('')}>{t('tb.clear')}</button> : null} />
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500 tabular-nums">
          {chips.map(([k, v]) => <span key={k}>{k} <span className="text-zinc-200">{v.toLocaleString()}</span></span>)}
        </div>
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 pt-1">{t('tb.text.case')}</div>
        <div className="flex flex-wrap gap-1">
          {CASE_STYLES.map((c) => <button key={c} className={`${btn} font-mono`} disabled={!text} onClick={() => apply(CASE_LABEL[c], (s) => convertCase(s, c))}>{CASE_LABEL[c]}</button>)}
        </div>
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 pt-1">{t('tb.text.lineOps')}</div>
        <div className="flex flex-wrap gap-1">
          {LINE_OPS.map((op) => <button key={op} className={btn} disabled={!text} onClick={() => apply(t(`tb.text.op.${op}`), (s) => lineOp(s, op as LineOp))}>{t(`tb.text.op.${op}`)}</button>)}
          <button className={btn} disabled={!text} onClick={() => apply('JSON string', (s) => JSON.stringify(s))}>{t('tb.text.jsonString')}</button>
          <button className={btn} disabled={!text} onClick={() => apply(t('tb.text.stripMarkdown'), stripMarkdown)}>{t('tb.text.stripMarkdown')}</button>
        </div>
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 pt-1">Lorem ipsum</div>
        <div className="flex flex-wrap gap-1">{[1, 3, 5].map((n) => <button key={n} className={btn} onClick={() => lorem(n)}>{t('tb.text.paragraphsN', { n })}</button>)}</div>
      </div>
      <Area label={<span>{t('tb.output')}{label && <span className="text-zinc-600"> · {label}</span>}</span>} value={out} onChange={setOut}
        actions={out ? <button className={btn} onClick={() => { setText(out); setOut(''); setLabel(''); }}>{t('tb.useAsInput')}</button> : null} />
    </div>
  );
}

function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '');
}
