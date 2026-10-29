/**
 * "Send as form": a structured prompt built from fields, shaped by a form type (feature, bug fix, ...).
 * Types are editable in Settings and stored server-side (config.formTypes); this module has no imports so
 * the server can use the same validation.
 */

/** Optional fields, in the order the form shows them. The goal is always there. */
export const FORM_FIELDS = ['context', 'files', 'repro', 'actual', 'expected', 'logs', 'requirements', 'constraints', 'done', 'approach', 'output', 'attachments', 'notes'] as const;
export type FormField = typeof FORM_FIELDS[number];
export type Approach = 'direct' | 'plan' | 'ask';
export const APPROACHES: Approach[] = ['direct', 'plan', 'ask'];

export interface FormType {
  id: string;
  name: string;
  /** Put at the top of every prompt of this type. */
  instruction: string;
  fields: FormField[];
  /** Chips checked by default. */
  constraints: string[];
  done: string[];
  /** "Project verification command passes" checked by default (only shown when the project has one). */
  verify: boolean;
  output: string[];
  approach: Approach;
}

export interface FormState {
  typeId: string;
  goal: string;
  context: string;
  files: string[];
  repro: string;
  actual: string;
  expected: string;
  logs: string;
  requirements: string[];
  constraints: string[];
  done: string[];
  verify: boolean;
  output: string[];
  approach: Approach;
  notes: string;
}

/** Headings and fixed sentences of the assembled prompt, in the UI language. `verify` contains "{cmd}". */
export type FormLabels = Record<'goal' | Exclude<FormField, 'attachments'>, string> & { verify: string; approachText: Record<Approach, string> };

/** Built-in types; `tr` turns "form.default.*" keys into the UI language. */
export function defaultFormTypes(tr: (key: string) => string): FormType[] {
  const c = (k: string) => tr(`form.chip.${k}`);
  const type = (id: string, fields: FormField[], o: Partial<FormType> = {}): FormType => ({
    id, name: tr(`form.default.${id}`), instruction: o.instruction ?? '', fields, constraints: o.constraints ?? [], done: o.done ?? [], verify: o.verify ?? false, output: o.output ?? [], approach: o.approach ?? 'direct',
  });
  return [
    type('feature', ['context', 'files', 'requirements', 'constraints', 'done', 'approach', 'output', 'attachments', 'notes'],
      { constraints: [c('keepStyle'), c('noDeps')], done: [c('tests')], verify: true, output: [c('changedFiles')] }),
    type('bugfix', ['files', 'repro', 'actual', 'expected', 'logs', 'constraints', 'done', 'approach', 'output', 'attachments', 'notes'],
      { instruction: tr('form.default.bugfix.instruction'), constraints: [c('minimal')], done: [c('regressionTest')], verify: true, output: [c('rootCause'), c('changedFiles')] }),
    type('refactor', ['context', 'files', 'requirements', 'constraints', 'done', 'approach', 'output', 'notes'],
      { constraints: [c('keepBehavior'), c('keepApi')], verify: true, output: [c('changedFiles')] }),
    type('review', ['context', 'files', 'requirements', 'constraints', 'output', 'attachments', 'notes'],
      { instruction: tr('form.default.review.instruction'), constraints: [c('noEdit')], output: [c('bySeverity')] }),
    type('research', ['context', 'files', 'requirements', 'output', 'attachments', 'notes'],
      { constraints: [c('noEdit')], output: [c('short')] }),
    type('test', ['context', 'files', 'requirements', 'constraints', 'done', 'output', 'notes'],
      { instruction: tr('form.default.test.instruction'), constraints: [c('noProdChange')], verify: true, output: [c('changedFiles')] }),
  ];
}

/** Chips offered in every type besides its own defaults. */
export function chipPresets(tr: (key: string) => string): Record<'constraints' | 'done' | 'output', string[]> {
  const c = (...k: string[]) => k.map((x) => tr(`form.chip.${x}`));
  return {
    constraints: c('noDeps', 'keepApi', 'keepStyle', 'keepBehavior', 'minimal', 'noFormat', 'noEdit', 'noProdChange'),
    done: c('tests', 'regressionTest', 'noBreak', 'commit'),
    output: c('changedFiles', 'rootCause', 'nextSteps', 'reasons', 'bySeverity', 'short'),
  };
}

export function emptyForm(type: FormType): FormState {
  return { typeId: type.id, goal: '', context: '', files: [], repro: '', actual: '', expected: '', logs: '', requirements: [], ...typeDefaults(type), notes: '' };
}

/** Switching type keeps everything typed and resets the choices to the new type's defaults. */
export function switchType(s: FormState, type: FormType): FormState {
  return { ...s, typeId: type.id, ...typeDefaults(type) };
}

function typeDefaults(t: FormType) {
  return { constraints: [...t.constraints], done: [...t.done], verify: t.verify, output: [...t.output], approach: t.approach };
}

const lines = (items: string[]) => items.map((x) => x.trim()).filter(Boolean).map((x) => `- ${x}`).join('\n');

/** The prompt sent to the agent: Markdown sections for the fields the type shows; empty ones are left out. */
export function assemblePrompt(s: FormState, type: FormType, L: FormLabels, verifyCommand?: string | null): string {
  const has = (f: FormField) => type.fields.includes(f);
  const out: string[] = [];
  const section = (title: string, body: string) => { if (body.trim()) out.push(`## ${title}\n${body.trim()}`); };
  if (type.instruction.trim()) out.push(type.instruction.trim());
  section(L.goal, s.goal);
  if (has('context')) section(L.context, s.context);
  if (has('files')) section(L.files, lines(s.files.map((f) => `\`${f}\``)));
  if (has('repro')) section(L.repro, s.repro);
  if (has('actual')) section(L.actual, s.actual);
  if (has('expected')) section(L.expected, s.expected);
  if (has('logs') && s.logs.trim()) {
    const fence = s.logs.includes('```') ? '~~~' : '```';
    out.push(`## ${L.logs}\n${fence}\n${s.logs.replace(/\s+$/, '')}\n${fence}`);
  }
  if (has('requirements')) section(L.requirements, lines(s.requirements));
  if (has('constraints')) section(L.constraints, lines(s.constraints));
  if (has('done')) section(L.done, lines([...(s.verify && verifyCommand ? [L.verify.replace('{cmd}', `\`${verifyCommand}\``)] : []), ...s.done]));
  if (has('approach')) section(L.approach, L.approachText[s.approach]);
  if (has('output')) section(L.output, lines(s.output));
  if (has('notes')) section(L.notes, s.notes);
  return out.join('\n\n');
}

/** Read a stored form draft, dropping anything malformed. */
export function readFormState(raw: unknown, fallback: FormState): FormState {
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Record<string, unknown>;
  const str = (k: keyof FormState) => (typeof r[k] === 'string' ? r[k] as string : fallback[k] as string);
  const list = (k: keyof FormState) => (Array.isArray(r[k]) ? (r[k] as unknown[]).filter((x): x is string => typeof x === 'string') : fallback[k] as string[]);
  return {
    typeId: str('typeId'), goal: str('goal'), context: str('context'), files: list('files'), repro: str('repro'), actual: str('actual'), expected: str('expected'), logs: str('logs'),
    requirements: list('requirements'), constraints: list('constraints'), done: list('done'), verify: typeof r.verify === 'boolean' ? r.verify : fallback.verify,
    output: list('output'), approach: APPROACHES.includes(r.approach as Approach) ? r.approach as Approach : fallback.approach, notes: str('notes'),
  };
}

export class FormTypeError extends Error {}

/** Validate types saved from Settings. */
export function cleanFormTypes(input: unknown): FormType[] {
  if (!Array.isArray(input)) throw new FormTypeError('Expected a list of form types');
  if (input.length === 0) throw new FormTypeError('Keep at least one form type');
  if (input.length > 30) throw new FormTypeError('At most 30 form types');
  const ids = new Set<string>();
  return input.map((raw, i) => {
    const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const list = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map((x) => text(x, 300)).filter(Boolean))].slice(0, 30);
    let id = text(t.id, 40).replace(/[^\w-]/g, '') || `t${i}`;
    while (ids.has(id)) id = `${id}_`;
    ids.add(id);
    const name = text(t.name, 40);
    if (!name) throw new FormTypeError(`Form type ${i + 1} needs a name`);
    const fields = FORM_FIELDS.filter((f) => Array.isArray(t.fields) && t.fields.includes(f));
    return {
      id, name, instruction: text(t.instruction, 4000), fields, constraints: list(t.constraints), done: list(t.done), verify: t.verify === true, output: list(t.output),
      approach: APPROACHES.includes(t.approach as Approach) ? t.approach as Approach : 'direct',
    };
  });
}
