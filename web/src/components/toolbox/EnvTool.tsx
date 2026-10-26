import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { compareEnv, maskValue, missingLines, parseEnv, toExample, type EnvStatus } from '../../lib/toolbox/env';
import { bytesToBase64, utf8ToBytes } from '../../lib/toolbox/bytes';
import { t } from '../../lib/i18n';
import { Check, Code, Seg, btn, errText, mono, saveBytes, select, usePersisted } from './ui';

type Filter = 'all' | 'missing' | EnvStatus;
const CHIP: Record<EnvStatus, string> = {
  same: 'text-zinc-500', diff: 'bg-sky-500/15 text-sky-300', onlyA: 'bg-amber-500/15 text-amber-300', onlyB: 'bg-purple-500/15 text-purple-300', empty: 'bg-red-500/15 text-red-300',
};

/**
 * Compares two env files. Texts are kept only in memory (they are usually secrets); only which files
 * were picked is remembered.
 */
export default function EnvTool() {
  const project = (() => { try { return localStorage.getItem('vibe.project'); } catch { return null; } })();
  const [files, setFiles] = useState<{ path: string; rel: string }[]>([]);
  const [pathA, setPathA] = usePersisted<string>('env.a', '');
  const [pathB, setPathB] = usePersisted<string>('env.b', '');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [reveal, setReveal] = useState(false);
  const [filter, setFilter] = useState<Filter>('missing');
  const [out, setOut] = useState<{ title: string; text: string; name: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    api.envFiles(project).then((list) => {
      setFiles(list);
      // First visit: .env against .env.example when both exist.
      if (!pathA && !pathB) {
        const env = list.find((f) => f.rel === '.env' || f.rel === '.env.local');
        const ex = list.find((f) => /^\.env\.(example|sample|template|dist)$/.test(f.rel));
        if (env) setPathA(env.path);
        if (ex) setPathB(ex.path);
      }
    }).catch((e) => setErr(errText(e)));
  }, [project]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback((p: string, set: (s: string) => void) => {
    if (!p) { set(''); return; }
    api.text(p).then((f) => set(f.content)).catch((e) => { set(''); setErr(errText(e)); });
  }, []);
  useEffect(() => load(pathA, setA), [pathA, load]);
  useEffect(() => load(pathB, setB), [pathB, load]);

  const pa = useMemo(() => parseEnv(a), [a]);
  const pb = useMemo(() => parseEnv(b), [b]);
  const rows = useMemo(() => compareEnv(pa, pb), [pa, pb]);
  const counts = useMemo(() => rows.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {} as Record<string, number>), [rows]);
  const shown = rows.filter((r) => filter === 'all' || (filter === 'missing' ? r.status === 'onlyA' || r.status === 'onlyB' : r.status === filter));
  const nameOf = (p: string) => files.find((f) => f.path === p)?.rel ?? (p ? p.split('/').pop()! : '');
  const labelA = nameOf(pathA) || 'A', labelB = nameOf(pathB) || 'B';
  const show = (v?: string) => (v === undefined ? <span className="text-zinc-700">—</span> : v === '' ? <span className="text-zinc-600 italic">{t('tb.env.emptyValue')}</span> : reveal ? v : maskValue(v));

  const pane = (label: string, path: string, setPath: (p: string) => void, text: string, setText: (s: string) => void, info: ReturnType<typeof parseEnv>) => (
    <div className="flex flex-col gap-2 min-h-0">
      <div className="flex items-center gap-3">
        <select className={`${select} flex-1 min-w-0`} value={path} onChange={(e) => setPath(e.target.value)}>
          <option value="">{t('tb.env.paste')}</option>
          {files.map((f) => <option key={f.path} value={f.path}>{f.rel}</option>)}
        </select>
        <span className="text-[11px] text-zinc-500 shrink-0">{t('tb.env.keys', { n: info.entries.length })}</span>
      </div>
      {path && !reveal ? (
        <div className="flex-1 min-h-[120px] rounded-md border border-white/10 bg-white/[.02] px-3 py-2 text-[11.5px] text-zinc-500 overflow-auto">
          <div className="mb-1.5">{t('tb.env.loaded')}</div>
          <div className={`${mono} text-zinc-400 leading-6`}>{info.entries.map((e) => e.key).join('  ')}</div>
        </div>
      ) : (
        <textarea value={text} onChange={(e) => { setText(e.target.value); if (path) setPath(''); }} spellCheck={false} placeholder={`${label}\nKEY=value`}
          className={`flex-1 min-h-[120px] w-full resize-none rounded-md border border-white/10 focus:border-blue-400/50 px-2.5 py-2 ${mono} outline-none bg-white/[.03] text-zinc-200 ${reveal ? '' : '[-webkit-text-security:disc]'}`} />
      )}
      {(info.duplicates.length > 0 || info.errors.length > 0) && (
        <div className="text-[11px] text-amber-400">
          {info.duplicates.length > 0 && <div>{t('tb.env.dups', { keys: info.duplicates.join(', ') })}</div>}
          {info.errors.length > 0 && <div>{t('tb.env.badLines', { lines: info.errors.map((e) => e.line).join(', ') })}</div>}
        </div>
      )}
    </div>
  );

  return (
    <div className="h-full flex flex-col gap-4 min-h-0">
      {!project && <div className="text-[11px] text-zinc-500">{t('tb.env.noProject')}</div>}
      {err && <div className="text-[11px] text-red-400">{err}</div>}
      <div className="h-[34%] min-h-[170px] grid grid-cols-2 gap-4">
        {pane('A', pathA, setPathA, a, setA, pa)}
        {pane('B', pathB, setPathB, b, setB, pb)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Seg value={filter} onChange={setFilter} options={[
          { value: 'missing', label: `${t('tb.env.missing')} ${(counts.onlyA ?? 0) + (counts.onlyB ?? 0)}` },
          { value: 'onlyA', label: `${t('tb.env.onlyIn', { name: labelA })} ${counts.onlyA ?? 0}` },
          { value: 'onlyB', label: `${t('tb.env.onlyIn', { name: labelB })} ${counts.onlyB ?? 0}` },
          { value: 'diff', label: `${t('tb.env.diff')} ${counts.diff ?? 0}` },
          { value: 'empty', label: `${t('tb.env.empty')} ${counts.empty ?? 0}` },
          { value: 'all', label: `${t('tb.env.all')} ${rows.length}` },
        ]} />
        <Check label={t('tb.env.reveal')} checked={reveal} onChange={setReveal} />
        <div className="flex-1" />
        <button className={btn} disabled={!a} onClick={() => setOut({ title: t('tb.env.exampleOf', { name: labelA }), text: toExample(a), name: '.env.example' })}>{t('tb.env.makeExample')}</button>
        <button className={btn} disabled={!counts.onlyA} onClick={() => setOut({ title: t('tb.env.addTo', { name: labelB }), text: missingLines(pb, pa, false), name: labelB.split('/').pop() || '.env' })}>{t('tb.env.missingInB', { name: labelB })}</button>
        <button className={btn} disabled={!counts.onlyB} onClick={() => setOut({ title: t('tb.env.addTo', { name: labelA }), text: missingLines(pa, pb, true), name: labelA.split('/').pop() || '.env' })}>{t('tb.env.missingInA', { name: labelA })}</button>
      </div>
      <div className="flex-1 min-h-0 grid gap-4" style={{ gridTemplateColumns: out ? '1fr minmax(260px, 36%)' : '1fr' }}>
        <div className="min-h-0 overflow-auto rounded-md border border-white/10 text-[12px]">
          <div className="grid grid-cols-[minmax(160px,1fr)_1fr_1fr_150px] gap-3 px-2.5 py-1.5 bg-white/[.03] text-[11px] text-zinc-500 sticky top-0">
            <span>{t('tb.env.key')}</span><span className="truncate">{labelA}</span><span className="truncate">{labelB}</span><span />
          </div>
          {shown.map((r) => (
            <div key={r.key} className="grid grid-cols-[minmax(160px,1fr)_1fr_1fr_150px] gap-3 items-center px-2.5 py-1 border-t border-white/5">
              <span className={`${mono} text-zinc-200 truncate`} title={r.key}>{r.key}</span>
              <span className={`${mono} text-zinc-400 truncate`}>{show(r.a)}</span>
              <span className={`${mono} text-zinc-400 truncate`}>{show(r.b)}</span>
              <span className={`justify-self-end whitespace-nowrap truncate max-w-full rounded px-1.5 py-0.5 text-[10.5px] ${CHIP[r.status]}`}>{r.status === 'onlyA' ? t('tb.env.onlyIn', { name: labelA }) : r.status === 'onlyB' ? t('tb.env.onlyIn', { name: labelB }) : t(`tb.env.status.${r.status}`)}</span>
            </div>
          ))}
          {!shown.length && <div className="px-2.5 py-3 text-zinc-500">{rows.length ? t('tb.env.allGood') : t('tb.env.hint')}</div>}
        </div>
        {out && (
          <div className="flex flex-col gap-2 min-h-0">
            <Code className="flex-1 min-h-0" code={out.text} lang="ini" label={out.title} actions={<>
              <button className={btn} onClick={() => saveBytes(out.name, bytesToBase64(utf8ToBytes(out.text + '\n'))).catch((e) => setErr(errText(e)))}>{t('tb.env.saveAs')}</button>
              <button className={btn} onClick={() => setOut(null)}>×</button>
            </>} />
          </div>
        )}
      </div>
    </div>
  );
}
