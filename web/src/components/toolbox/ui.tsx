import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../../lib/i18n';

const LS = 'vibe.toolbox.';
const PERSIST_MAX = 200_000;

/**
 * Tool inputs survive mode switches and restarts. Values over 200 KB and anything secret
 * (keys, passphrases, plaintext to encrypt) must stay in plain useState instead.
 */
export function usePersisted<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(LS + key); return s === null ? initial : JSON.parse(s) as T; } catch { return initial; }
  });
  const timer = useRef(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      try {
        const s = JSON.stringify(v);
        if (s.length > PERSIST_MAX) localStorage.removeItem(LS + key); else localStorage.setItem(LS + key, s);
      } catch { /* quota exceeded: this value just will not be remembered */ }
    }, 300);
    return () => window.clearTimeout(timer.current);
  }, [key, v]);
  return [v, setV];
}

export const btn = 'shrink-0 px-2 py-1 rounded-md text-[11px] bg-white/10 hover:bg-white/15 text-zinc-200 disabled:opacity-40 disabled:hover:bg-white/10 disabled:cursor-default';
export const btnPrimary = 'shrink-0 px-2.5 py-1 rounded-md text-[11px] font-medium bg-blue-500/80 hover:bg-blue-500 text-white disabled:opacity-40 disabled:hover:bg-blue-500/80 disabled:cursor-default';
export const input = 'min-w-0 bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-blue-400/50 font-mono placeholder:text-zinc-600';
export const select = 'bg-white/5 border border-white/10 rounded-md px-1.5 py-1 text-[11px] text-zinc-200 outline-none';
export const mono = 'font-mono text-[12.5px] leading-relaxed';

export function CopyButton({ text, label, className = '' }: { text: string; label?: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button className={`${btn} ${className}`} disabled={!text} title={t('common.copy')}
      onClick={() => navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1200); }).catch(() => {})}>
      {ok ? t('common.copied') : (label ?? t('common.copy'))}
    </button>
  );
}

interface AreaProps {
  label?: ReactNode; value: string; onChange?: (v: string) => void; placeholder?: string; readOnly?: boolean; error?: string | null;
  actions?: ReactNode; className?: string; minRows?: number; autoFocus?: boolean; spell?: boolean; copy?: boolean;
}

/** Labeled monospace textarea with a copy button; the one block every tool is built from. */
export function Area({ label, value, onChange, placeholder, readOnly, error, actions, className = '', minRows = 4, autoFocus, spell = false, copy = true }: AreaProps) {
  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      {(label || actions || copy) && (
        <div className="h-7 shrink-0 mb-1 flex items-center gap-2 text-[11px] text-zinc-500">
          <span className="flex-1 truncate">{label}</span>
          {actions}
          {copy && <CopyButton text={value} />}
        </div>
      )}
      <textarea spellCheck={spell} value={value} onChange={(e) => onChange?.(e.target.value)} readOnly={readOnly} placeholder={placeholder} autoFocus={autoFocus}
        style={{ minHeight: `${minRows * 1.5 + 1.2}em` }}
        className={`flex-1 w-full resize-none rounded-md border px-2.5 py-2 ${mono} outline-none bg-white/[.03] text-zinc-200 placeholder:text-zinc-600 ${readOnly ? 'text-zinc-300' : ''} ${error ? 'border-red-500/50' : 'border-white/10 focus:border-blue-400/50'}`} />
      {error && <div className="mt-1 shrink-0 text-[11px] text-red-400 whitespace-pre-wrap break-all">{error}</div>}
    </div>
  );
}

export function Seg<T extends string>({ value, onChange, options, className = '' }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string }) {
  return (
    <div className={`inline-flex items-center rounded-md bg-white/5 p-0.5 ${className}`}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`px-2 py-0.5 rounded text-[11px] whitespace-nowrap ${value === o.value ? 'bg-white/15 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>{o.label}</button>
      ))}
    </div>
  );
}

export function Field({ label, children, className = '' }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`flex items-center gap-2 text-[11px] text-zinc-500 min-w-0 ${className}`}>
      <span className="shrink-0">{label}</span>
      {children}
    </label>
  );
}

export function Check({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Key/value rows with a copy button per value. */
export function Rows({ rows }: { rows: { label: ReactNode; value: string; hint?: ReactNode }[] }) {
  return (
    <div className="rounded-md border border-white/10 divide-y divide-white/5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 text-[12px]">
          <span className="w-28 shrink-0 text-zinc-500 text-[11px]">{r.label}</span>
          <span className={`flex-1 min-w-0 truncate ${mono} text-zinc-200`} title={r.value}>{r.value}</span>
          {r.hint && <span className="shrink-0 text-[11px] text-zinc-500">{r.hint}</span>}
          <CopyButton text={r.value} />
        </div>
      ))}
    </div>
  );
}

export function Section({ title, children, className = '', actions }: { title: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-500">
        <span>{title}</span>
        <div className="flex-1" />
        {actions}
      </div>
      {children}
    </section>
  );
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
