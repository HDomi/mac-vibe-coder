/** Lets routes ask for a clean exit (sessions and shells closed) without importing the server entry. */
type Handler = (reason: string, code?: number) => void;
let handler: Handler | null = null;

export function setShutdownHandler(h: Handler) { handler = h; }

/** Close everything and exit with `code`. Falls back to a plain exit when no server registered a handler. */
export function requestShutdown(reason: string, code = 0) {
  if (handler) handler(reason, code);
  else process.exit(code);
}
