import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { t, useLang } from '../../lib/i18n';
import { usePersisted } from './ui';

export type ToolId = 'json' | 'jwt' | 'crypto' | 'encode' | 'time' | 'regex' | 'diff' | 'random' | 'text' | 'color';

/** Each tool is its own chunk, so opening the tab loads only the one on screen. */
const TOOLS: { id: ToolId; badge: string; Comp: ComponentType }[] = [
  { id: 'json', badge: '{ }', Comp: lazy(() => import('./JsonTool')) },
  { id: 'jwt', badge: 'JWT', Comp: lazy(() => import('./JwtTool')) },
  { id: 'crypto', badge: 'AES', Comp: lazy(() => import('./CryptoTool')) },
  { id: 'encode', badge: 'b64', Comp: lazy(() => import('./EncodeTool')) },
  { id: 'time', badge: 'UTC', Comp: lazy(() => import('./TimeTool')) },
  { id: 'regex', badge: '.*', Comp: lazy(() => import('./RegexTool')) },
  { id: 'diff', badge: '±', Comp: lazy(() => import('./DiffTool')) },
  { id: 'random', badge: '#', Comp: lazy(() => import('./RandomTool')) },
  { id: 'text', badge: 'Aa', Comp: lazy(() => import('./TextTool')) },
  { id: 'color', badge: 'RGB', Comp: lazy(() => import('./ColorTool')) },
];

/** Tools mode: a list of local, offline utilities. Nothing here talks to the server or an agent. */
export default function ToolboxView() {
  useLang();
  const [active, setActive] = usePersisted<ToolId>('tool', 'json');
  const tool = TOOLS.find((x) => x.id === active) ?? TOOLS[0];
  // ⌘1-9 and ⌘0 jump between tools; App skips its own number shortcuts while this view is up.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const i = e.key === '0' ? 9 : Number(e.key) - 1;
      if (!/^[0-9]$/.test(e.key) || !TOOLS[i]) return;
      e.preventDefault(); setActive(TOOLS[i].id);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [setActive]);
  return (
    <div className="flex-1 flex min-h-0">
      <aside data-companion-zone="left" data-companion-wall="right" className="w-56 shrink-0 h-full flex flex-col border-r border-white/10 bg-[#0e1117]">
        <div className="h-10 flex items-center px-3 text-xs text-zinc-500"><span className="font-medium text-zinc-400">{t('tb.title')}</span></div>
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {TOOLS.map((x, i) => (
            <button key={x.id} onClick={() => setActive(x.id)}
              className={`w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm ${active === x.id ? 'bg-white/10 text-white' : 'text-zinc-300 hover:bg-white/5'}`}>
              <span className={`w-9 h-6 shrink-0 flex items-center justify-center rounded font-mono text-[10px] ${active === x.id ? 'bg-blue-500/30 text-blue-200' : 'bg-white/5 text-zinc-500'}`}>{x.badge}</span>
              <span className="flex-1 min-w-0">
                <span className="block truncate leading-tight">{t(`tb.${x.id}.name`)}</span>
                <span className="block truncate text-[10.5px] text-zinc-500 leading-tight">{t(`tb.${x.id}.desc`)}</span>
              </span>
              <span className="text-[10px] text-zinc-600 shrink-0">⌘{(i + 1) % 10}</span>
            </button>
          ))}
        </div>
        <div data-companion-floor="tools-list-bottom" className="h-px shrink-0 bg-white/10 mb-4" />
      </aside>
      <div data-companion-zone="prompt" className="flex-1 min-w-0 flex flex-col min-h-0">
        <div data-companion-floor="tool-header" data-companion-edge="bottom" className="h-10 shrink-0 flex items-center gap-3 px-4 border-b border-white/10 text-xs">
          <span className="font-medium text-zinc-200">{t(`tb.${tool.id}.name`)}</span>
          <span className="text-zinc-500 truncate">{t(`tb.${tool.id}.desc`)}</span>
          <div className="flex-1" />
          <span className="text-[10.5px] text-zinc-600">{t('tb.offline')}</span>
        </div>
        <div className="flex-1 min-h-0 p-4">
          <Suspense fallback={<div className="text-sm text-zinc-500">{t('common.loading')}</div>}>
            <tool.Comp key={tool.id} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
