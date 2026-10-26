import { useMemo } from 'react';
import { parseRequest, toAxios, toCurl, toFetch, toPython } from '../../lib/toolbox/curl';
import { t } from '../../lib/i18n';
import { Area, Code, Rows, Seg, btn, errText, usePersisted } from './ui';

type Target = 'fetch' | 'axios' | 'python' | 'curl';
const SAMPLE = `curl 'https://httpbin.org/post?debug=1' \\
  -H 'accept: application/json' \\
  -H 'authorization: Bearer <token>' \\
  -H 'content-type: application/json' \\
  --data-raw '{"name":"Ada","tags":["admin"]}'`;

export default function CurlTool() {
  const [text, setText] = usePersisted('curl.text', '');
  const [target, setTarget] = usePersisted<Target>('curl.target', 'fetch');
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try { return { ok: true as const, req: parseRequest(text) }; } catch (e) { return { ok: false as const, msg: errText(e) }; }
  }, [text]);
  const req = parsed?.ok ? parsed.req : null;
  const out = useMemo(() => {
    if (!req) return '';
    return target === 'fetch' ? toFetch(req) : target === 'axios' ? toAxios(req) : target === 'python' ? toPython(req) : toCurl(req);
  }, [req, target]);
  return (
    <div className="h-full grid grid-cols-2 gap-4 min-h-0">
      <div className="flex flex-col gap-3 min-h-0">
        <Area className="flex-1" label={t('tb.curl.input')} value={text} onChange={setText} placeholder={t('tb.curl.placeholder')} autoFocus
          error={parsed && !parsed.ok ? parsed.msg : null}
          actions={<>
            {!text && <button className={btn} onClick={() => setText(SAMPLE)}>{t('tb.sample')}</button>}
            {text && <button className={btn} onClick={() => setText('')}>{t('tb.clear')}</button>}
          </>} />
        {req && (
          <div className="shrink-0 max-h-[45%] overflow-y-auto">
            <Rows rows={[
              { label: t('tb.curl.method'), value: req.method },
              { label: 'URL', value: req.url },
              ...req.headers.map(([k, v]) => ({ label: k, value: v })),
              ...(req.body !== undefined ? [{ label: t('tb.curl.body'), value: req.body }] : []),
              ...(req.form ?? []).map((f) => ({ label: `form ${f.name}`, value: f.file ? `@${f.value}` : f.value })),
            ]} />
          </div>
        )}
      </div>
      <Code className="min-h-0" code={out} lang={target === 'python' ? 'python' : target === 'curl' ? 'bash' : 'javascript'}
        label={<Seg value={target} onChange={setTarget} options={[{ value: 'fetch', label: 'fetch' }, { value: 'axios', label: 'axios' }, { value: 'python', label: 'Python requests' }, { value: 'curl', label: 'cURL' }]} />} />
    </div>
  );
}
