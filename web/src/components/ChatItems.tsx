import { useState } from 'react';
import MarkdownView, { CopyButton } from './MarkdownView';
import type { ChatItem } from '../lib/chatStore';
import { api } from '../lib/api';

function summarizeInput(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'Bash': return String(i.command ?? '');
    case 'Read': case 'Write': case 'Edit': return String(i.file_path ?? '');
    case 'Glob': case 'Grep': return `${i.pattern ?? ''} ${i.path ?? ''}`.trim();
    case 'WebFetch': return String(i.url ?? '');
    case 'WebSearch': return String(i.query ?? '');
    case 'Agent': case 'Task': return String(i.description ?? i.prompt ?? '').slice(0, 120);
    case 'FileChange': return ((i.changes as Array<{ path: string }> | undefined) ?? []).map((c) => c.path).join(', ');
    case 'Permissions': return String(i.reason ?? JSON.stringify(i.permissions ?? {}));
    default: { const s = JSON.stringify(i); return s.length > 140 ? s.slice(0, 140) + '…' : s; }
  }
}

export function UserItem({ item }: { item: Extract<ChatItem, { kind: 'user' }> }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-blue-500/20 px-4 py-2.5 text-[14px] whitespace-pre-wrap">
        {item.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {item.attachments.map((a) => a.kind === 'image'
              ? <img key={a.path} src={api.rawUrl(a.path)} alt={a.name} className="h-20 rounded-md object-cover" title={a.path} />
              : <span key={a.path} className="text-xs bg-white/10 rounded px-2 py-1" title={a.path}>📎 {a.name}</span>)}
          </div>
        )}
        {item.text}
      </div>
    </div>
  );
}

export function AssistantItem({ item, baseDir }: { item: Extract<ChatItem, { kind: 'assistant' }>; baseDir?: string }) {
  const [showThinking, setShowThinking] = useState(false);
  return (
    <div className={`group/msg relative ${item.parent ? 'ml-6 border-l border-white/10 pl-3' : ''}`}>
      {item.text && !item.streaming && <CopyButton text={item.text} className="absolute -top-2 right-0 opacity-0 group-hover/msg:opacity-100" />}
      {item.thinking && (
        <div className="mb-1">
          <button className="text-[11px] text-zinc-500 hover:text-zinc-300" onClick={() => setShowThinking((v) => !v)}>
            {showThinking ? '▾' : '▸'} Thinking{item.streaming && !item.text ? '…' : ''}
          </button>
          {showThinking && <div className="mt-1 text-xs text-zinc-500 whitespace-pre-wrap border-l-2 border-white/10 pl-2">{item.thinking}</div>}
        </div>
      )}
      {item.text && (
        <div className="prose-md text-[14px] max-w-none">
          <MarkdownView text={item.text} baseDir={baseDir} />
          {item.streaming && <span className="inline-block w-1.5 h-4 bg-zinc-400 animate-pulse align-middle ml-0.5" />}
        </div>
      )}
    </div>
  );
}

export function ToolItem({ item, children }: { item: Extract<ChatItem, { kind: 'tool' }>; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const summary = summarizeInput(item.name, item.input);
  return (
    <div className={`rounded-lg border ${item.isError ? 'border-red-500/30' : 'border-white/10'} bg-white/[0.03] text-[13px] ${item.parent ? 'ml-6' : ''}`}>
      <button className="w-full flex items-center gap-2 px-3 py-1.5 text-left" onClick={() => setOpen((v) => !v)}>
        <span className={`w-1.5 h-1.5 rounded-full ${item.done ? (item.isError ? 'bg-red-400' : 'bg-emerald-400') : 'bg-amber-400 animate-pulse'}`} />
        <span className="font-medium text-zinc-200">{item.name}</span>
        <span className="truncate text-zinc-400 font-mono text-[12px] flex-1">{summary}</span>
        {!item.done && item.elapsed > 0 && <span className="text-zinc-500 text-[11px]">{Math.round(item.elapsed)}s</span>}
        <span className="text-zinc-600">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="border-t border-white/10 px-3 py-2 space-y-2">
          <pre className="text-[12px] text-zinc-400 whitespace-pre-wrap break-all max-h-48 overflow-auto">{JSON.stringify(item.input, null, 2)}</pre>
          {item.output !== null && (
            <pre className={`text-[12px] whitespace-pre-wrap break-all max-h-72 overflow-auto rounded bg-black/40 p-2 ${item.isError ? 'text-red-300' : 'text-zinc-300'}`}>{item.output.slice(0, 20000)}{item.output.length > 20000 ? '\n…' : ''}</pre>
          )}
        </div>
      )}
      {children && <div className="border-t border-white/10 px-2 py-2 space-y-2">{children}</div>}
    </div>
  );
}

export function ApprovalItem({ item, onDecide }: { item: Extract<ChatItem, { kind: 'approval' }>; onDecide: (d: 'allow' | 'allow_always' | 'deny', message?: string) => void }) {
  const [msg, setMsg] = useState('');
  const summary = summarizeInput(item.toolName, item.input);
  const i = (item.input ?? {}) as Record<string, unknown>;
  return (
    <div className={`rounded-lg border ${item.decision ? 'border-white/10 opacity-70' : 'border-amber-400/40 bg-amber-400/5'} p-3 text-[13px]`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-amber-300">Approval</span>
        <span className="font-medium">{item.toolName}</span>
        {item.decision && <span className="ml-auto text-xs text-zinc-400">{{ allow: 'Allowed', allow_always: 'Always allowed', deny: 'Denied', cancelled: 'Cancelled' }[item.decision] ?? item.decision}</span>}
      </div>
      <pre className="font-mono text-[12px] text-zinc-200 whitespace-pre-wrap break-all bg-black/30 rounded p-2 max-h-40 overflow-auto">{summary}</pre>
      {item.toolName === 'Edit' && typeof i.old_string === 'string' && (
        <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] font-mono">
          <pre className="bg-red-500/10 text-red-200 rounded p-2 whitespace-pre-wrap max-h-40 overflow-auto">{String(i.old_string)}</pre>
          <pre className="bg-emerald-500/10 text-emerald-200 rounded p-2 whitespace-pre-wrap max-h-40 overflow-auto">{String(i.new_string)}</pre>
        </div>
      )}
      {item.toolName === 'FileChange' && Array.isArray(i.changes) && (
        <div className="mt-2 space-y-2">
          {(i.changes as Array<{ path: string; diff: string }>).map((c) => (
            <div key={c.path}>
              <div className="text-[11px] text-zinc-400 font-mono">{c.path}</div>
              <pre className="text-[12px] font-mono whitespace-pre-wrap max-h-48 overflow-auto rounded bg-black/30 p-2">{c.diff.split('\n').map((l, idx) => <span key={idx} className={l.startsWith('+') ? 'text-emerald-300' : l.startsWith('-') ? 'text-red-300' : 'text-zinc-400'}>{l}{'\n'}</span>)}</pre>
            </div>
          ))}
        </div>
      )}
      {item.toolName === 'Write' && typeof i.content === 'string' && (
        <pre className="mt-2 bg-emerald-500/10 text-emerald-200 rounded p-2 text-[12px] font-mono whitespace-pre-wrap max-h-40 overflow-auto">{String(i.content).slice(0, 4000)}</pre>
      )}
      {!item.decision && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 px-3 py-1" onClick={() => onDecide('allow')}>Allow</button>
          {item.canAlwaysAllow && <button className="rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 px-3 py-1" onClick={() => onDecide('allow_always')}>Always allow</button>}
          <button className="rounded bg-red-500/20 hover:bg-red-500/30 text-red-200 px-3 py-1" onClick={() => onDecide('deny', msg || undefined)}>Deny</button>
          <input className="flex-1 min-w-[160px] bg-black/30 rounded px-2 py-1 text-xs outline-none" placeholder="Reason or alternative (optional)" value={msg} onChange={(e) => setMsg(e.target.value)} />
        </div>
      )}
    </div>
  );
}

export function QuestionItem({ item, onAnswer }: { item: Extract<ChatItem, { kind: 'question' }>; onAnswer: (answers: Record<string, string>) => void }) {
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const toggle = (q: string, label: string, multi: boolean) => {
    setSel((s) => {
      const cur = s[q] ?? [];
      if (!multi) return { ...s, [q]: [label] };
      return { ...s, [q]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] };
    });
  };
  const submit = () => {
    const answers: Record<string, string> = {};
    for (const q of item.questions) {
      const o = other[q.question]?.trim();
      answers[q.question] = o || (sel[q.question] ?? []).join(', ');
    }
    onAnswer(answers);
  };
  const complete = item.questions.every((q) => (sel[q.question]?.length ?? 0) > 0 || other[q.question]?.trim());
  return (
    <div className={`rounded-lg border ${item.resolved ? 'border-white/10 opacity-70' : 'border-blue-400/40 bg-blue-400/5'} p-3 text-[13px] space-y-3`}>
      <div className="text-blue-300">Question</div>
      {item.questions.map((q) => (
        <div key={q.question}>
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">{q.header}</div>
          <div className="font-medium mb-1.5">{q.question}</div>
          <div className="grid gap-1.5">
            {q.options.map((o) => {
              const on = (sel[q.question] ?? []).includes(o.label);
              return (
                <button key={o.label} disabled={item.resolved} onClick={() => toggle(q.question, o.label, q.multiSelect)}
                  className={`text-left rounded-md border px-3 py-1.5 ${on ? 'border-blue-400 bg-blue-400/15' : 'border-white/10 hover:bg-white/5'}`}>
                  <div className="font-medium">{o.label}</div>
                  {o.description && <div className="text-xs text-zinc-400">{o.description}</div>}
                </button>
              );
            })}
            {!item.resolved && (
              <input className="bg-black/30 rounded-md px-3 py-1.5 text-xs outline-none border border-white/10" placeholder="Type your own answer (optional)"
                value={other[q.question] ?? ''} onChange={(e) => setOther((s) => ({ ...s, [q.question]: e.target.value }))} />
            )}
          </div>
        </div>
      ))}
      {!item.resolved && (
        <button disabled={!complete} className="rounded bg-blue-500/30 hover:bg-blue-500/40 px-3 py-1 disabled:opacity-40" onClick={submit}>Send answers</button>
      )}
    </div>
  );
}

export function ResultItem({ item }: { item: Extract<ChatItem, { kind: 'result' }> }) {
  return (
    <div className="text-[11px] text-zinc-500 flex gap-3 justify-end">
      <span>{item.ok ? 'Done' : 'Error'}</span>
      <span>{(item.durationMs / 1000).toFixed(1)}s</span>
      <span>{item.numTurns} turns</span>
      <span>${item.costUsd.toFixed(3)}</span>
    </div>
  );
}
