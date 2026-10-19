import { useEffect, useRef, useState } from 'react';
import { api, type ToolsInfo, type ToolStatus } from '../lib/api';

interface Props { onClose: () => void }

const METHOD_LABEL: Record<string, string> = { official: 'official script', brew: 'Homebrew', npm: 'npm', update: 'update' };

function methodsFor(t: ToolStatus, inst: ToolsInfo['installers']): string[] {
  const m: string[] = [];
  if (t.id === 'claude') m.push('official');
  if (inst.brew) m.push('brew');
  if (inst.npm) m.push('npm');
  return m;
}

function GeneralSettings() {
  const [login, setLogin] = useState<boolean | null>(null);
  useEffect(() => { window.vibe?.loginItem?.(null).then(setLogin).catch(() => {}); }, []);
  return (
    <div className="rounded-lg border border-white/10 p-4 space-y-3">
      <div className="font-medium">General</div>
      {window.vibe?.isElectron ? (
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={!!login} disabled={login === null} onChange={(e) => window.vibe!.loginItem(e.target.checked).then(setLogin)} />
          Open at login
        </label>
      ) : <div className="text-xs text-zinc-500">Running in the browser. Open-at-login is available in the app.</div>}
      <div className="text-xs text-zinc-500 leading-relaxed">
        Shortcuts: ⌘N new session · ⌘W close session · ⌘K focus composer · ⌘P quick open · ⌘B sidebar · ⌘J right panel · ⌘1–4 right tabs · ⌘/ this help
      </div>
    </div>
  );
}

export default function ToolsPanel({ onClose }: Props) {
  const [info, setInfo] = useState<ToolsInfo | null>(null);
  const [log, setLog] = useState<{ line: string; err: boolean }[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const refresh = () => api.tools().then(setInfo).catch((e) => setLog((l) => [...l, { line: e.message, err: true }]));
  useEffect(() => { refresh(); }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [log]);

  const run = (tool: string, method: string) => {
    if (running) return;
    setRunning(`${tool}:${method}`);
    setLog([]);
    const es = new EventSource(api.installUrl(tool, method));
    es.addEventListener('start', (e) => setLog((l) => [...l, { line: `$ ${(e as MessageEvent).data}`, err: false }]));
    es.addEventListener('stdout', (e) => setLog((l) => [...l, { line: (e as MessageEvent).data, err: false }]));
    es.addEventListener('stderr', (e) => setLog((l) => [...l, { line: (e as MessageEvent).data, err: true }]));
    es.addEventListener('done', (e) => {
      setLog((l) => [...l, { line: `exit code ${(e as MessageEvent).data}`, err: (e as MessageEvent).data !== '0' }]);
      es.close(); setRunning(null); refresh();
    });
    es.onerror = () => { es.close(); setRunning(null); refresh(); };
  };

  return (
    <div className="absolute inset-0 z-20 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="w-[720px] max-w-[92vw] max-h-[85vh] rounded-xl bg-[#12151c] border border-white/10 shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center px-5 h-12 border-b border-white/10">
          <div className="font-medium">Settings</div>
          <div className="flex-1" />
          <button className="text-xs text-zinc-400 hover:text-white mr-3" onClick={refresh}>Re-detect</button>
          <button className="text-zinc-400 hover:text-white" onClick={onClose}>✕</button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <GeneralSettings />
          {!info && <div className="text-sm text-zinc-500">Detecting…</div>}
          {info?.tools.map((t) => (
            <div key={t.id} className="rounded-lg border border-white/10 p-4">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${t.installed ? (t.loggedIn ? 'bg-green-400' : 'bg-amber-400') : 'bg-zinc-600'}`} />
                <div className="font-medium">{t.name}</div>
                {t.installed ? (
                  <span className="text-xs text-zinc-400">{t.version} · {t.path}</span>
                ) : (
                  <span className="text-xs text-zinc-500">Not installed</span>
                )}
                <div className="flex-1" />
                {t.installed && (
                  <button disabled={!!running} className="text-xs rounded bg-white/5 hover:bg-white/10 px-2 py-1 disabled:opacity-40"
                    onClick={() => run(t.id, 'update')}>Update</button>
                )}
              </div>
              {t.installed && (
                <div className="mt-2 text-xs text-zinc-400">
                  {t.loggedIn === true && <>Logged in · {t.authInfo}</>}
                  {t.loggedIn === false && <span className="text-amber-300">Login required. Run {t.id === 'claude' ? 'claude → /login' : 'codex login'} in the Terminal tab</span>}
                  {t.loggedIn === null && 'Login status unknown'}
                </div>
              )}
              {!t.installed && (
                <div className="mt-3 flex gap-2 flex-wrap">
                  {methodsFor(t, info.installers).map((m) => (
                    <button key={m} disabled={!!running}
                      className="text-xs rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 px-3 py-1.5 disabled:opacity-40"
                      onClick={() => run(t.id, m)}>Install via {METHOD_LABEL[m]}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {info && (
            <div className="text-xs text-zinc-500">
              Installers: brew {info.installers.brew ? '✓' : '✗'} · npm {info.installers.npm ? '✓' : '✗'} · node {info.installers.node ? '✓' : '✗'}
            </div>
          )}
          {log.length > 0 && (
            <div ref={logRef} className="rounded-lg bg-black/50 p-3 font-mono text-[12px] max-h-64 overflow-auto">
              {log.map((l, i) => <div key={i} className={l.err ? 'text-amber-200' : 'text-zinc-300'}>{l.line}</div>)}
              {running && <div className="text-zinc-500 animate-pulse">Running…</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
