import { useEffect, useMemo, useRef, useState } from 'react';
import type { TaskInfo, TaskStatus } from '../lib/agent';
import { liveTasks } from '../lib/chatStore';
import { layoutTaskTree, NODE_H, NODE_W, ROOT_ID, shortTokens, taskKind } from '../lib/taskGraph';
import { t, useLang } from '../lib/i18n';

interface Props {
  tasks: Record<string, TaskInfo> | undefined;
  /** What the root node is called: the session title, else the agent name. */
  rootLabel: string;
  rootSub?: string;
  /** Scroll the transcript to the tool card that started a task. */
  onShowCard?: (toolUseId: string) => void;
}

const STATUS_RING: Record<TaskStatus, string> = {
  running: 'stroke-violet-400',
  completed: 'stroke-emerald-400/70',
  failed: 'stroke-red-400/80',
  stopped: 'stroke-zinc-500',
};
const STATUS_TEXT: Record<TaskStatus, string> = {
  running: 'text-violet-200',
  completed: 'text-emerald-200',
  failed: 'text-red-200',
  stopped: 'text-zinc-400',
};

function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return t('activity.elapsedSeconds', { seconds: s });
  if (s < 3600) return t('activity.elapsedMinutes', { minutes: Math.floor(s / 60), seconds: s % 60 });
  return t('activity.elapsedHours', { hours: Math.floor(s / 3600), minutes: Math.floor(s / 60) % 60, seconds: s % 60 });
}

/**
 * One purple "subagents running" chip in the composer's toolbar while any subagent / background
 * task of this session is working. Clicking it opens the relation graph: this session at the top,
 * every task it spawned below (nested when a subagent spawned its own); a node shows its details.
 */
export default function TaskChips({ tasks, rootLabel, rootSub, onShowCard }: Props) {
  useLang();
  const live = useMemo(() => liveTasks({ tasks }), [tasks]);
  const [open, setOpen] = useState<string | null>(null); // selected node id while the graph is open
  if (!live.length) return null;
  return (
    // Not positioned on purpose: the popover's containing block is the composer box, so it pops
    // out above the whole composer instead of being clipped to the chip.
    <div className="flex items-center min-w-0 shrink" data-task-chips="">
      <button type="button" onClick={() => setOpen((cur) => (cur ? null : ROOT_ID))} data-task-chip=""
        title={t('tasks.chipTitle', { n: live.length })}
        className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] min-w-0 shrink hover:bg-violet-500/25 ${open ? 'bg-violet-500/30 text-violet-100' : 'bg-violet-500/15 text-violet-200'}`}>
        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-violet-400 animate-pulse" />
        <span className="truncate">{t('tasks.chip')}</span>
        <span className="shrink-0 text-violet-300/80 tabular-nums">{live.length}</span>
      </button>
      {open && <TaskGraphPopover tasks={tasks ?? {}} selected={open} onSelect={setOpen} onClose={() => setOpen(null)} rootLabel={rootLabel} rootSub={rootSub} onShowCard={onShowCard} />}
    </div>
  );
}

function TaskGraphPopover({ tasks, selected, onSelect, onClose, rootLabel, rootSub, onShowCard }: { tasks: Record<string, TaskInfo>; selected: string; onSelect: (id: string) => void; onClose: () => void; rootLabel: string; rootSub?: string; onShowCard?: (id: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now());
  const list = useMemo(() => Object.values(tasks).filter((x) => !x.ambient), [tasks]);
  const layout = useMemo(() => layoutTaskTree(list), [list]);
  const running = list.filter((x) => x.status === 'running').length;
  // Close on a click outside or Escape; tick once a second for the elapsed times while anything runs.
  useEffect(() => {
    const down = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-task-chips]')) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [onClose]);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const sel = selected === ROOT_ID ? null : tasks[selected] ?? null;
  const PAD = 12;
  const w = layout.width + PAD * 2;
  const h = layout.height + PAD * 2;
  const statusLabel = (s: TaskStatus) => t(`tasks.${s}`);
  const elapsed = (task: TaskInfo) => elapsedLabel(task.status === 'running' ? now - task.startedAt : (task.endedAt ?? task.startedAt) - task.startedAt);

  return (
    <div ref={box} role="dialog" aria-label={t('tasks.title')}
      className="absolute bottom-full left-0 mb-1 w-[640px] max-w-full rounded-lg border border-violet-400/25 bg-[#171a22] shadow-xl z-20 text-[12px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
        <span className="font-medium text-zinc-200">{t('tasks.title')}</span>
        <span className="text-zinc-500">{t('tasks.summaryLive', { running, total: list.length })}</span>
        <div className="flex-1" />
        <button className="text-zinc-500 hover:text-zinc-200 px-1" onClick={onClose} aria-label={t('tasks.close')}>✕</button>
      </div>
      <div className="overflow-auto max-h-[40vh] p-2">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block mx-auto select-none">
          <g transform={`translate(${PAD} ${PAD})`}>
            {layout.edges.map((e) => {
              const a = layout.nodes.find((n) => n.id === e.from)!; const b = layout.nodes.find((n) => n.id === e.to)!;
              const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H, x2 = b.x + NODE_W / 2, y2 = b.y;
              const my = (y1 + y2) / 2;
              const hot = b.task?.status === 'running';
              return <path key={`${e.from}-${e.to}`} d={`M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`} fill="none" strokeWidth={hot ? 1.5 : 1} className={hot ? 'stroke-violet-400/70' : 'stroke-zinc-600'} />;
            })}
            {layout.nodes.map((n) => {
              const task = n.task;
              const isSel = n.id === selected;
              const ring = task ? STATUS_RING[task.status] : 'stroke-blue-400/70';
              const fill = task ? (task.status === 'running' ? 'fill-violet-500/15' : 'fill-white/[0.03]') : 'fill-blue-500/15';
              const title = task ? taskKind(task) : rootLabel;
              const sub = task ? (task.description || statusLabel(task.status)) : (rootSub ?? t('tasks.session'));
              return (
                <g key={n.id} transform={`translate(${n.x} ${n.y})`} className="cursor-pointer" onClick={() => onSelect(n.id)}>
                  <rect width={NODE_W} height={NODE_H} rx={8} strokeWidth={isSel ? 2 : 1} className={`${fill} ${ring} ${isSel ? 'drop-shadow-[0_0_6px_rgba(167,139,250,0.5)]' : ''}`} />
                  {task?.status === 'running' && <circle cx={12} cy={15} r={3} className="fill-violet-400 animate-pulse" />}
                  {task && task.status !== 'running' && <circle cx={12} cy={15} r={3} className={task.status === 'completed' ? 'fill-emerald-400' : task.status === 'failed' ? 'fill-red-400' : 'fill-zinc-500'} />}
                  {!task && <circle cx={12} cy={15} r={3} className="fill-blue-400" />}
                  <text x={22} y={19} className="fill-zinc-100 text-[12px] font-medium" style={{ fontSize: 12 }}>{clip(title, 17)}</text>
                  <text x={12} y={36} className="fill-zinc-400" style={{ fontSize: 10.5 }}>{clip(sub, 24)}</text>
                  <title>{task ? `${taskKind(task)} · ${task.description}\n${statusLabel(task.status)} · ${elapsed(task)}` : `${rootLabel}${rootSub ? ` · ${rootSub}` : ''}`}</title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      {sel && (
        <div className="border-t border-white/10 px-3 py-2 space-y-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-[10px] rounded px-1.5 py-0.5 bg-white/5 ${STATUS_TEXT[sel.status]}`}>{statusLabel(sel.status)}</span>
            <span className="font-medium text-zinc-200 shrink-0">{taskKind(sel)}</span>
            {sel.background && <span className="text-[10px] text-zinc-500">{t('tasks.background')}</span>}
            <span className="text-zinc-500 tabular-nums ml-auto shrink-0">{elapsed(sel)}</span>
          </div>
          <div className="text-zinc-300 whitespace-pre-wrap break-words max-h-20 overflow-auto">{sel.description}</div>
          {sel.summary && <div className="text-zinc-400 italic whitespace-pre-wrap break-words max-h-16 overflow-auto">{sel.summary}</div>}
          {sel.error && <div className="text-red-300 whitespace-pre-wrap break-words max-h-16 overflow-auto">{sel.error}</div>}
          <div className="flex items-center gap-3 text-[11px] text-zinc-500 flex-wrap">
            {sel.parentId && tasks[sel.parentId] && <span>{t('tasks.parent', { name: taskKind(tasks[sel.parentId]) })}</span>}
            {!sel.parentId && <span>{t('tasks.parent', { name: rootLabel })}</span>}
            {sel.usage && <span>{t('tasks.tokens', { n: shortTokens(sel.usage.totalTokens) })}</span>}
            {sel.usage && <span>{t('tasks.toolUses', { n: sel.usage.toolUses })}</span>}
            {sel.lastTool && sel.status === 'running' && <span>{t('tasks.lastTool', { tool: sel.lastTool })}</span>}
            <span className="font-mono text-zinc-600 truncate">{sel.id}</span>
            {sel.toolUseId && onShowCard && <button className="text-violet-300 hover:text-violet-100 ml-auto" onClick={() => { onShowCard(sel.toolUseId!); onClose(); }}>{t('tasks.showCard')}</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function clip(s: string, n: number): string {
  const line = s.split('\n')[0];
  return line.length > n ? line.slice(0, n - 1) + '…' : line;
}
