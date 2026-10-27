import assert from 'node:assert/strict';
import test from 'node:test';
import { minutesToEmpty } from '../web/src/lib/usageStore';
import { handoffText } from '../web/src/lib/handoff';

test('usage forecast: recent burn rate within the current window', () => {
  const now = 1_000_000_000_000;
  const reset = Math.floor(now / 1000) + 3 * 3600;
  const s = (minAgo: number, used: number, r = reset) => ({ t: now - minAgo * 60000, used, reset: r });
  // 10% in 20 minutes, 60% used: 40% left at 0.5%/min = 80 minutes.
  assert.equal(minutesToEmpty([s(20, 50), s(0, 60)], { usedPct: 60, resetsAt: reset }, now), 80);
  // Will not run out before the reset (in 3h) at 1% per 30 min.
  assert.equal(minutesToEmpty([s(30, 59), s(0, 60)], { usedPct: 60, resetsAt: reset }, now), null);
  // Too short a span, no movement, or samples from the previous window: no forecast.
  assert.equal(minutesToEmpty([s(1, 50), s(0, 60)], { usedPct: 60, resetsAt: reset }, now), null);
  assert.equal(minutesToEmpty([s(20, 60), s(0, 60)], { usedPct: 60, resetsAt: reset }, now), null);
  assert.equal(minutesToEmpty([s(20, 10, reset - 18000), s(0, 60)], { usedPct: 60, resetsAt: reset }, now), null);
  assert.equal(minutesToEmpty([], { usedPct: 100, resetsAt: reset }, now), 0);
});

test('handoff briefing carries asks, last answer, changed files and open todos', () => {
  const text = handoffText({
    id: 's', agent: 'claude', cwd: '/p', permissionMode: 'default', status: 'idle', totalCostUsd: 0, lastSeq: 0, title: 'Login page',
    todos: [{ content: 'write tests', status: 'pending' }, { content: 'done thing', status: 'completed' }],
    items: [
      { kind: 'user', id: 'u1', text: 'Build the login page', attachments: [] },
      { kind: 'assistant', id: 'a1', text: 'Added LoginForm.tsx', thinking: '', parent: null, streaming: false },
      { kind: 'changes', id: 'c', root: '/p', from: 'a'.repeat(40), to: 'b'.repeat(40), files: [{ path: 'src/LoginForm.tsx', status: 'A', additions: 10, deletions: 0, binary: false }] },
    ],
  });
  assert.match(text, /Claude/);
  assert.match(text, /Login page/);
  assert.match(text, /Build the login page/);
  assert.match(text, /Added LoginForm\.tsx/);
  assert.match(text, /A src\/LoginForm\.tsx/);
  assert.match(text, /\[ \] write tests/);
  assert.doesNotMatch(text, /done thing/);
});
