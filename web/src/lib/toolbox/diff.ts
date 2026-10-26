/** Line diff (Myers O(ND)) for the Diff tool. Good enough for files of a few thousand lines in the renderer. */

export type DiffOp = { type: 'equal' | 'insert' | 'delete'; line: string; a?: number; b?: number };

export function diffLines(oldText: string, newText: string, opts: { ignoreWhitespace?: boolean; ignoreCase?: boolean } = {}): DiffOp[] {
  const A = oldText.split('\n'), B = newText.split('\n');
  const norm = (s: string) => { let x = s; if (opts.ignoreWhitespace) x = x.replace(/\s+/g, ' ').trim(); if (opts.ignoreCase) x = x.toLowerCase(); return x; };
  const a = A.map(norm), b = B.map(norm);
  const N = a.length, M = b.length, MAX = N + M;
  // Trace of V arrays per step, as in the paper; memory is O(D^2) which is fine for typical pastes.
  const trace: Int32Array[] = [];
  let V = new Int32Array(2 * MAX + 2);
  const off = MAX + 1;
  let found = false;
  for (let d = 0; d <= MAX && !found; d++) {
    trace.push(V.slice());
    const next = V.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && V[off + k - 1] < V[off + k + 1])) ? V[off + k + 1] : V[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      next[off + k] = x;
      if (x >= N && y >= M) { found = true; break; }
    }
    V = next;
  }
  // Backtrack.
  const ops: DiffOp[] = [];
  let x = N, y = M;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const v = trace[d];
    const k = x - y;
    const prevK = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? k + 1 : k - 1;
    const prevX = v[off + prevK], prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; ops.push({ type: 'equal', line: A[x], a: x + 1, b: y + 1 }); }
    if (d > 0) {
      if (x === prevX) { y--; ops.push({ type: 'insert', line: B[y], b: y + 1 }); }
      else { x--; ops.push({ type: 'delete', line: A[x], a: x + 1 }); }
    }
  }
  return ops.reverse();
}

export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const o of ops) { if (o.type === 'insert') added++; else if (o.type === 'delete') removed++; }
  return { added, removed };
}

/** Unified-diff text with `context` equal lines around each change. */
export function unifiedDiff(ops: DiffOp[], context = 3, nameA = 'a', nameB = 'b'): string {
  const out = [`--- ${nameA}`, `+++ ${nameB}`];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') { i++; continue; }
    const start = Math.max(0, i - context);
    let end = i;
    while (end < ops.length) {
      if (ops[end].type !== 'equal') { end++; continue; }
      let run = 0;
      while (end + run < ops.length && ops[end + run].type === 'equal') run++;
      if (end + run >= ops.length || run > context * 2) { end = Math.min(ops.length, end + context); break; }
      end += run;
    }
    const slice = ops.slice(start, end);
    const aStart = slice.find((o) => o.a)?.a ?? 1, bStart = slice.find((o) => o.b)?.b ?? 1;
    const aLen = slice.filter((o) => o.type !== 'insert').length, bLen = slice.filter((o) => o.type !== 'delete').length;
    out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (const o of slice) out.push(`${o.type === 'equal' ? ' ' : o.type === 'insert' ? '+' : '-'}${o.line}`);
    i = end;
  }
  return out.join('\n');
}
