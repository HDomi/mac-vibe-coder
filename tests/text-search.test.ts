import assert from 'node:assert/strict';
import test from 'node:test';
import { matchOffsets } from '../web/src/lib/textSearch';

test('chat search finds every case-insensitive occurrence without overlaps', () => {
  assert.deepEqual(matchOffsets('Fix the fix, then FIX', 'fix'), [0, 8, 18]);
  assert.deepEqual(matchOffsets('aaaa', 'aa'), [0, 2]);
  assert.deepEqual(matchOffsets('백그라운드 세션 표시, 세션', '세션'), [6, 13]);
  assert.deepEqual(matchOffsets('anything', '   '), []);
  assert.deepEqual(matchOffsets('', 'x'), []);
});
