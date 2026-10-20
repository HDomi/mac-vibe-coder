/** Start offsets of every case-insensitive, non-overlapping occurrence of `query` in `text`. */
export function matchOffsets(text: string, query: string): number[] {
  const q = query.toLocaleLowerCase();
  if (!q.trim() || !text) return [];
  const hay = text.toLocaleLowerCase();
  // Lowercasing can change length for a few scripts; fall back to exact matching then so offsets stay valid.
  const exact = hay.length !== text.length;
  const source = exact ? text : hay, needle = exact ? query : q;
  const out: number[] = [];
  for (let i = source.indexOf(needle); i >= 0; i = source.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}

/**
 * Terminal text as a fenced block for the chat. The fence grows past any backtick run inside
 * the text so pasted markdown cannot close it early.
 */
export function fencedTerminalText(text: string, label?: string): string {
  const body = text.replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '');
  let fence = '```';
  while (body.includes(fence)) fence += '`';
  return `${label ? `${label}\n` : ''}${fence}\n${body}\n${fence}`;
}
