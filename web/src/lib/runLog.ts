/** Output of Run panel processes: spotting errors in dev server / build logs. */

export interface LogLine { n: number; text: string; err: boolean }
export interface ErrorBlock { start: number; lines: LogLine[] }

const ERROR_RE = /(\berror\b|\bERR!|failed to compile|\bunhandled\b|\buncaught\b|\bexception\b|\b(?:Type|Reference|Syntax|Range)Error\b|✘|✖|\bpanic:|Traceback \(most recent call last\)|Module not found|Cannot find module|EADDRINUSE|\bFAIL\b)/i;
const NOT_ERROR = /\b0 errors?\b|\bno errors?\b|errors?:\s*0\b|without errors|error\.(?:tsx?|jsx?|css|html)\b|ErrorBoundary|\berrorlevel\b|onerror/i;
const BLOCK_MAX = 24;

export function isErrorLine(text: string): boolean {
  // "> cmd" is npm echoing the script it runs, which often contains words like "error".
  return ERROR_RE.test(text) && !NOT_ERROR.test(text) && !/^> /.test(text);
}

/**
 * Error blocks in the log after line `since`: each starts at an error-looking line and runs on
 * through its stack / code frame until a blank line or BLOCK_MAX lines. Overlapping matches merge.
 */
export function findErrors(lines: LogLine[], since = -1): ErrorBlock[] {
  const out: ErrorBlock[] = [];
  let cur: ErrorBlock | null = null;
  for (const l of lines) {
    if (l.n <= since) continue;
    if (cur) {
      if (!l.text.trim() || cur.lines.length >= BLOCK_MAX) { out.push(cur); cur = null; }
      else { cur.lines.push(l); continue; }
    }
    if (isErrorLine(l.text)) cur = { start: l.n, lines: [l] };
  }
  if (cur) out.push(cur);
  return out;
}
