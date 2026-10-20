import type { Attachment } from './agent';

export interface Draft { text: string; attachments: Attachment[] }
const EMPTY: Draft = { text: '', attachments: [] };
export const draftKey = (id: string) => `vibe.draft.${id}`;

/** Unsent composer text survives view switches and restarts until the user actually sends it. */
export function readDraft(key: string | null, storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Draft {
  if (!key || !storage) return EMPTY;
  try {
    const saved = JSON.parse(storage.getItem(key) ?? 'null') as { text?: unknown; attachments?: unknown } | null;
    return { text: typeof saved?.text === 'string' ? saved.text : '', attachments: Array.isArray(saved?.attachments) ? saved.attachments as Attachment[] : [] };
  } catch { return EMPTY; }
}
export function writeDraft(key: string | null, draft: Draft, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = globalThis.localStorage) {
  if (!key || !storage) return;
  try { if (!draft.text && draft.attachments.length === 0) storage.removeItem(key); else storage.setItem(key, JSON.stringify(draft)); } catch { /* ignore */ }
}
