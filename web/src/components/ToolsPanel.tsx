import { useEffect, useRef, useState } from 'react';
import { api, type ToolsInfo, type ToolStatus } from '../lib/api';
import { LANGS, setLang, t, useLang, type Lang } from '../lib/i18n';
import { keepAwakeEnabled, setKeepAwakeEnabled } from '../lib/power';
import Icon from './Icon';

interface Props { onClose: () => void }

function methodLabel(m: string): string {
  if (m === 'official') return t('settings.method.official');
  if (m === 'brew') return 'Homebrew';
  return m;
}

function methodsFor(tool: ToolStatus, inst: ToolsInfo['installers']): string[] {
  const m: string[] = [];
  if (tool.id === 'claude') m.push('official');
  if (inst.brew) m.push('brew');
  if (inst.npm) m.push('npm');
  return m;
}

function GeneralSettings() {
  const lang = useLang();
  const [login, setLogin] = useState<boolean | null>(null);
  const [awake, setAwake] = useState(keepAwakeEnabled);
  useEffect(() => { window.vibe?.loginItem?.(null).then(setLogin).catch(() => {}); }, []);
  return (
    <div className="rounded-lg border border-fill/10 p-4 space-y-3">
      <div className="font-medium">{t('settings.general')}</div>
      <label className="flex items-center gap-3 text-sm">
        <span className="w-28 text-fg-3">{t('settings.language')}</span>
        <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="bg-fill/5 rounded-md text-xs px-2 py-1.5 outline-none">
          {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </label>
      {window.vibe?.isElectron ? (
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={!!login} disabled={login === null} onChange={(e) => window.vibe!.loginItem(e.target.checked).then(setLogin)} />
          {t('settings.openAtLogin')}
        </label>
      ) : <div className="text-xs text-fg-4">{t('settings.browserNote')}</div>}
      {window.vibe?.keepAwake && (
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={awake} onChange={(e) => { setAwake(e.target.checked); setKeepAwakeEnabled(e.target.checked); }} />
            {t('settings.keepAwake')}
          </label>
          <div className="text-xs text-fg-4 leading-relaxed pl-6">{t('settings.keepAwakeNote')}</div>
        </div>
      )}
      {window.vibe?.openNotificationSettings && (
        <div className="flex items-start gap-3 text-xs">
          <span className="text-fg-4 leading-relaxed flex-1">{t('settings.notificationStyle')}</span>
          <button className="shrink-0 rounded-md bg-fill/10 hover:bg-fill/15 px-2.5 py-1.5 text-fg-1" onClick={() => window.vibe!.openNotificationSettings!()}>{t('settings.openNotificationSettings')}</button>
        </div>
      )}
      <div className="text-xs text-fg-4 leading-relaxed">{t('settings.shortcuts')}</div>
    </div>
  );
}

export default function ToolsPanel({ onClose }: Props) {
  useLang();
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
      setLog((l) => [...l, { line: t('settings.exitCode', { code: (e as MessageEvent).data }), err: (e as MessageEvent).data !== '0' }]);
      es.close(); setRunning(null); refresh();
    });
    es.onerror = () => { es.close(); setRunning(null); refresh(); };
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="w-[720px] max-w-[92vw] max-h-[85vh] rounded-xl bg-surface-2 border border-fill/10 shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center px-5 h-12 border-b border-fill/10">
          <div className="font-medium">{t('settings.title')}</div>
          <div className="flex-1" />
          <button className="text-xs text-fg-3 hover:text-fg mr-3" onClick={refresh}>{t('settings.redetect')}</button>
          <button className="w-7 h-7 flex items-center justify-center rounded-md text-fg-3 hover:text-fg hover:bg-fill/10" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <GeneralSettings />
          {!info && <div className="text-sm text-fg-4">{t('settings.detecting')}</div>}
          {info?.tools.map((tool) => (
            <div key={tool.id} className="rounded-lg border border-fill/10 p-4">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${tool.installed ? (tool.loggedIn ? 'bg-green-400' : 'bg-amber-400') : 'bg-fg-5'}`} />
                <div className="font-medium">{tool.name}</div>
                {tool.installed ? (
                  <span className="text-xs text-fg-3">{tool.version} · {tool.path}</span>
                ) : (
                  <span className="text-xs text-fg-4">{t('settings.notInstalled')}</span>
                )}
                <div className="flex-1" />
                {tool.installed && (
                  <button disabled={!!running} className="text-xs rounded bg-fill/5 hover:bg-fill/10 px-2 py-1 disabled:opacity-40"
                    onClick={() => run(tool.id, 'update')}>{t('settings.update')}</button>
                )}
              </div>
              {tool.installed && (
                <div className="mt-2 text-xs text-fg-3">
                  {tool.loggedIn === true && <>{t('settings.loggedIn')} · {tool.authInfo}</>}
                  {tool.loggedIn === false && <span className="text-amber-300">{t('settings.loginRequired', { cmd: tool.id === 'claude' ? 'claude → /login' : 'codex login' })}</span>}
                  {tool.loggedIn === null && t('settings.loginUnknown')}
                </div>
              )}
              {!tool.installed && (
                <div className="mt-3 flex gap-2 flex-wrap">
                  {methodsFor(tool, info.installers).map((m) => (
                    <button key={m} disabled={!!running}
                      className="text-xs rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 px-3 py-1.5 disabled:opacity-40"
                      onClick={() => run(tool.id, m)}>{t('settings.installVia', { method: methodLabel(m) })}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {info && (
            <div className="text-xs text-fg-4">
              {t('settings.installers')}: brew {info.installers.brew ? '✓' : '✗'} · npm {info.installers.npm ? '✓' : '✗'} · node {info.installers.node ? '✓' : '✗'}
            </div>
          )}
          {log.length > 0 && (
            <div ref={logRef} className="rounded-lg bg-black/50 p-3 font-mono text-[12px] max-h-64 overflow-auto">
              {log.map((l, i) => <div key={i} className={l.err ? 'text-amber-200' : 'text-fg-2'}>{l.line}</div>)}
              {running && <div className="text-fg-4 animate-pulse">{t('settings.running')}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
