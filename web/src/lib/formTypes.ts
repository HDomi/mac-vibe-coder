import { useEffect, useState } from 'react';
import { api } from './api';
import { t, useLang } from './i18n';
import { defaultFormTypes, type FormLabels, type FormType } from './promptForm';

/** Saved types (null = built-in set), shared by every open form and the Settings editor. */
let saved: FormType[] | null | undefined;
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function load() {
  loading ??= api.formTypes().then((r) => { saved = r.types; listeners.forEach((f) => f()); }).catch(() => { saved = null; listeners.forEach((f) => f()); }).finally(() => { loading = null; });
  return loading;
}

export async function saveFormTypes(types: FormType[] | null) {
  const r = await api.saveFormTypes(types);
  saved = r.types;
  listeners.forEach((f) => f());
}

/** Form types in effect: the saved ones, or the built-in set in the current language. */
export function useFormTypes(): { types: FormType[]; custom: boolean; ready: boolean } {
  useLang();
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    if (saved === undefined) void load();
    return () => { listeners.delete(f); };
  }, []);
  return { types: saved ?? defaultFormTypes(t), custom: !!saved, ready: saved !== undefined };
}

export function formLabels(): FormLabels {
  const f = (k: string) => t(`form.out.${k}`);
  return {
    goal: f('goal'), context: f('context'), files: f('files'), repro: f('repro'), actual: f('actual'), expected: f('expected'), logs: f('logs'),
    requirements: f('requirements'), constraints: f('constraints'), done: f('done'), approach: f('approach'), output: f('output'), notes: f('notes'),
    verify: f('verify'), approachText: { direct: f('approach.direct'), plan: f('approach.plan'), ask: f('approach.ask') },
  };
}
