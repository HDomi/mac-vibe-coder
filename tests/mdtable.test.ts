import assert from 'node:assert/strict';
import test from 'node:test';
import { displayWidth, findTables, formatAllTables, formatTable, parseDelimited, replaceRange, splitRow, toCsv, toHtml } from '../web/src/lib/mdtable';

const DOC = `# Title

| 이름 | Age |  Note |
|:--|--:|:-:|
| 홍길동 | 30 | a \\| b |
| Ann | 7 |
| x | y | z | extra |

\`\`\`
| not | a |
|-----|---|
\`\`\`

Text | with | pipes but no delimiter row

a | b
--- | ---
1 | 2
`;

test('md table: find tables, skip code fences, read alignment and escaped pipes', () => {
  const ts = findTables(DOC);
  assert.equal(ts.length, 2);
  assert.deepEqual([ts[0].start, ts[0].end], [2, 6]);
  assert.deepEqual(ts[0].header, ['이름', 'Age', 'Note']);
  assert.deepEqual(ts[0].align, ['left', 'right', 'center']);
  assert.deepEqual(ts[0].rows, [['홍길동', '30', 'a | b'], ['Ann', '7', ''], ['x', 'y', 'z']]);
  assert.deepEqual([ts[1].start, ts[1].header, ts[1].rows], [15, ['a', 'b'], [['1', '2']]]);
  assert.deepEqual(splitRow('| a | `x \\| y` |'), ['a', '`x | y`']);
});

test('md table: format pads by display width (Hangul counts 2) and keeps alignment', () => {
  assert.equal(displayWidth('홍길동a'), 7);
  assert.equal(formatTable(findTables(DOC)[0]), [
    '| 이름   | Age |  Note  |',
    '| :----- | --: | :----: |',
    '| 홍길동 |  30 | a \\| b |',
    '| Ann    |   7 |        |',
    '| x      |   y |   z    |',
  ].join('\n'));
  const all = formatAllTables(DOC.replace(/\n/g, '\r\n'));
  assert.ok(all.includes('\r\n| a   | b   |\r\n| --- | --- |\r\n| 1   | 2   |\r\n'));
  assert.ok(all.includes('| not | a |'), 'fenced table untouched');
  assert.equal(replaceRange('a\nb\nc', 1, 1, 'X\nY'), 'a\nX\nY\nc');
});

test('md table: spreadsheet paste and exports', () => {
  assert.deepEqual(parseDelimited('a\tb\n1\t2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseDelimited('name,note\n"Ann, Jr.","say ""hi""\nthere"'), [['name', 'note'], ['Ann, Jr.', 'say "hi"\nthere']]);
  const t = { header: ['a', 'b'], align: [null, 'right' as const], rows: [['x,y', '<1>']] };
  assert.equal(toCsv(t), 'a,b\n"x,y",<1>');
  assert.equal(toHtml(t), '<table>\n  <thead>\n    <tr><th>a</th><th style="text-align:right">b</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>x,y</td><td style="text-align:right">&lt;1&gt;</td></tr>\n  </tbody>\n</table>');
});

test('md table: saving drafts rewrites only edited tables, deletes, appends new ones', async () => {
  const { applyDrafts } = await import('../web/src/components/MdTableEditor');
  const doc = 'intro\r\n\r\n|a|b|\r\n|-|-|\r\n|1|2|\r\n\r\nmid\r\n\r\n|x|\r\n|-|\r\n|y|\r\n';
  const [t1, t2] = findTables(doc);
  const g1 = { header: t1.header, align: t1.align, rows: [['1', '22']] };
  const out = applyDrafts(doc, [
    { grid: g1, origin: { start: t1.start, end: t1.end }, deleted: false, dirty: true },
    { grid: t2, origin: { start: t2.start, end: t2.end }, deleted: true, dirty: false },
    { grid: { header: ['n'], align: [null], rows: [['v']] }, origin: null, deleted: false, dirty: true },
  ]);
  assert.equal(out, 'intro\r\n\r\n| a   | b   |\r\n| --- | --- |\r\n| 1   | 22  |\r\n\r\nmid\r\n\r\n| n   |\r\n| --- |\r\n| v   |\r\n');
});
