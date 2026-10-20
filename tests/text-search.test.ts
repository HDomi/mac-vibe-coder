import assert from 'node:assert/strict';
import test from 'node:test';
import { fencedTerminalText, matchOffsets } from '../web/src/lib/textSearch';

test('chat search finds every case-insensitive occurrence without overlaps', () => {
  assert.deepEqual(matchOffsets('Fix the fix, then FIX', 'fix'), [0, 8, 18]);
  assert.deepEqual(matchOffsets('aaaa', 'aa'), [0, 2]);
  assert.deepEqual(matchOffsets('백그라운드 세션 표시, 세션', '세션'), [6, 13]);
  assert.deepEqual(matchOffsets('anything', '   '), []);
  assert.deepEqual(matchOffsets('', 'x'), []);
});

test('terminal output goes to chat as a fence that the output cannot close', () => {
  assert.equal(fencedTerminalText('\n$ npm test  \nFAIL x\n\n', 'out:'), 'out:\n```\n$ npm test\nFAIL x\n```');
  assert.equal(fencedTerminalText('a ``` b'), '````\na ``` b\n````');
});
