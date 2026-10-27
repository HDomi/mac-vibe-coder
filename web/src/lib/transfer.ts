import type { Attachment } from './agent';
import { draftKey, readDraft, writeDraft } from './draft';
import type { MenuItem } from '../components/ContextMenu';
import { t } from './i18n';

/**
 * Moving chat content between sessions: a message, a selection or an attachment dragged onto another
 * session's tab (or sent from the right-click menu) lands in that session's message box, unsent.
 */

export const TRANSFER_MIME = 'application/x-vibe-transfer';
export interface Transfer { text: string; attachments: Attachment[] }
export interface TransferTarget { id: string; name: string; agent: string }

let targets: () => TransferTarget[] = () => [];
/** The app registers how to list the open sessions (the current one excluded). */
export function setTransferTargets(fn: () => TransferTarget[]) { targets = fn; }

export function setDragTransfer(e: React.DragEvent, payload: Transfer) {
  e.dataTransfer.setData(TRANSFER_MIME, JSON.stringify(payload));
  if (payload.text) e.dataTransfer.setData('text/plain', payload.text);
  e.dataTransfer.effectAllowed = 'copy';
}

export function hasTransfer(e: React.DragEvent): boolean { return e.dataTransfer.types.includes(TRANSFER_MIME); }

export function readTransfer(e: React.DragEvent): Transfer | null {
  try {
    const v = JSON.parse(e.dataTransfer.getData(TRANSFER_MIME)) as Partial<Transfer>;
    return { text: typeof v.text === 'string' ? v.text : '', attachments: Array.isArray(v.attachments) ? v.attachments : [] };
  } catch { return null; }
}

/** Append to a session's saved draft: text after a blank line, attachments without duplicates. */
export function mergeDraft(draft: Transfer, add: Transfer): Transfer {
  const text = [draft.text.trimEnd(), add.text.trim()].filter(Boolean).join('\n\n');
  const seen = new Set(draft.attachments.map((a) => a.path));
  return { text, attachments: [...draft.attachments, ...add.attachments.filter((a) => !seen.has(a.path) && (seen.add(a.path), true))] };
}

/** Put the payload into the target session's message box and bring that session on screen. */
export function sendTransfer(sessionId: string, payload: Transfer) {
  const key = draftKey(sessionId);
  writeDraft(key, mergeDraft(readDraft(key), payload));
  window.dispatchEvent(new CustomEvent('vibe:transfer-done', { detail: { sessionId } }));
}

/** Right-click entries: copy, then one "send to" row per other open session. */
export function transferMenu(payload: Transfer, copyText?: string): MenuItem[] {
  const list = targets();
  const items: MenuItem[] = [];
  if (copyText) items.push({ label: t('common.copy'), onClick: () => void navigator.clipboard.writeText(copyText) });
  if (!list.length) return [...items, { label: t('transfer.noTargets'), disabled: true }];
  if (items.length) items.push({ separator: true });
  items.push({ label: t('transfer.sendTo'), disabled: true });
  for (const s of list.slice(0, 12)) items.push({ label: `   ${s.agent === 'codex' ? '◆' : '✳'} ${s.name}`, onClick: () => sendTransfer(s.id, payload) });
  return items;
}
