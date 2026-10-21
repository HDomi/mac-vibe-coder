import { t } from './i18n';

/*
 * Confirmations and notices. Under Electron they are macOS sheets attached to the window
 * (dialog.showMessageBox); in a browser they fall back to window.confirm / window.alert.
 * Texts from i18n use the first line as the bold message and the rest as the detail paragraph.
 */
function split(text: string): { message: string; detail?: string } {
  const i = text.indexOf('\n');
  if (i === -1) return { message: text };
  const detail = text.slice(i + 1).trim();
  return { message: text.slice(0, i), detail: detail || undefined };
}

/** Resolves true when the user picks the confirming button (`ok`, default "OK"). `danger` shows the warning icon. */
export async function confirmDialog(text: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  if (window.vibe?.confirm) return window.vibe.confirm({ ...split(text), ok: opts.ok ?? t('common.ok'), cancel: t('common.cancel'), danger: !!opts.danger });
  return window.confirm(text);
}

export async function alertDialog(text: string, kind: 'info' | 'error' = 'info'): Promise<void> {
  if (window.vibe?.alert) { await window.vibe.alert({ ...split(text), kind, ok: t('common.ok') }); return; }
  window.alert(text);
}
