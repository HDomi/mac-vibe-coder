/**
 * Hand-off between tools ("open this request in HTTP", "use this IP in QR"). The payload waits in
 * memory until the target tool mounts and takes it, so it survives the lazy chunk load.
 */
const pending = new Map<string, unknown>();

export function openTool(id: string, payload?: unknown) {
  if (payload !== undefined) pending.set(id, payload);
  window.dispatchEvent(new CustomEvent('vibe:toolbox-open', { detail: { id } }));
}

/** Called once by a tool on mount; returns and clears whatever was sent to it. */
export function takePayload<T>(id: string): T | undefined {
  const v = pending.get(id) as T | undefined;
  pending.delete(id);
  return v;
}
