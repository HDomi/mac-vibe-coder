import assert from 'node:assert/strict';
import test from 'node:test';
import { itemOutcome, nextItem, EMPTY_BACKLOG } from '../web/src/lib/backlog';
import { cleanBacklog } from '../server/verify';
import type { ChatSession } from '../web/src/lib/chatStore';

const session = (status: ChatSession['status'], items: ChatSession['items'] = []): ChatSession => ({ id: 's', agent: 'claude', cwd: '/x', permissionMode: 'default', status, items, totalCostUsd: 0, lastSeq: 0 });

test('backlog: an item is done only when its session is idle again with a result', () => {
  assert.equal(itemOutcome(undefined), 'stopped');
  assert.equal(itemOutcome(session('starting')), 'running');
  assert.equal(itemOutcome(session('idle')), 'running', 'idle before the first turn is not finished');
  assert.equal(itemOutcome(session('running', [{ kind: 'result', id: 'r', ok: true, text: '', costUsd: 0, numTurns: 1, durationMs: 1 }])), 'running');
  assert.equal(itemOutcome(session('idle', [{ kind: 'result', id: 'r', ok: true, text: '', costUsd: 0, numTurns: 1, durationMs: 1 }])), 'done');
  assert.equal(itemOutcome(session('idle', [{ kind: 'result', id: 'r', ok: false, text: '', costUsd: 0, numTurns: 1, durationMs: 1 }])), 'failed');
  assert.equal(itemOutcome(session('closed')), 'failed');
  assert.equal(itemOutcome(session('idle', [{ kind: 'user', id: 'u', text: 'x', attachments: [] }, { kind: 'system', id: 'revived-s2', text: '' }])), 'stopped', 'cut off by a server restart');
  assert.equal(itemOutcome(session('idle', [{ kind: 'result', id: 'r0', ok: true, text: '', costUsd: 0, numTurns: 1, durationMs: 1 }, { kind: 'user', id: 'u', text: 'x', attachments: [] }])), 'running', 'an older result does not finish a newer turn');

  const b = { ...EMPTY_BACKLOG, items: [{ id: 'a', text: 'x', status: 'done' as const, createdAt: 1 }, { id: 'b', text: 'y', status: 'todo' as const, createdAt: 2 }] };
  assert.equal(nextItem(b)?.id, 'b');
  assert.equal(nextItem({ ...b, items: [...b.items, { id: 'c', text: 'z', status: 'running', createdAt: 3 }] }), null);
});

test('backlog payloads are cleaned on the server', () => {
  const c = cleanBacklog({ items: [{ id: 'a', text: ' do it ', status: 'weird', createdAt: 5, extra: 1 }, { id: 'b', text: '   ' }, null], auto: 1, agent: 'gpt', mode: 'bypassPermissions', worktree: 'yes' });
  assert.deepEqual(c, { items: [{ id: 'a', text: ' do it ', status: 'todo', createdAt: 5 }], auto: true, agent: 'claude', mode: 'bypassPermissions', worktree: true });
});
