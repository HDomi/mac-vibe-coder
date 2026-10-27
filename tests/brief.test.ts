import assert from 'node:assert/strict';
import test from 'node:test';
import { commitSubjects, sessionBrief } from '../web/src/lib/brief';

test('session brief: files, commits, todos and last answer from a transcript', () => {
  assert.deepEqual(commitSubjects('git add -A && git commit -m "fix: 고침" -m "body"'), ['fix: 고침', 'body']);
  assert.deepEqual(commitSubjects(`git commit -m "$(cat <<'EOF'\nfeat: 추가\n\n본문\nEOF\n)"`), ['feat: 추가']);
  assert.deepEqual(commitSubjects('git status'), []);
  const b = sessionBrief({
    cwd: '/p',
    items: [
      { kind: 'user', id: 'u1', text: 'do it', attachments: [] },
      { kind: 'tool', id: 't1', name: 'Edit', input: { file_path: '/p/src/a.ts' }, output: '', isError: false, parent: null, elapsed: 0, done: true },
      { kind: 'tool', id: 't2', name: 'Write', input: { file_path: '/p/src/a.ts' }, output: '', isError: false, parent: null, elapsed: 0, done: true },
      { kind: 'tool', id: 't3', name: 'Bash', input: { command: "git commit -m 'feat: a'" }, output: '', isError: false, parent: null, elapsed: 0, done: true },
      { kind: 'tool', id: 't4', name: 'TodoWrite', input: { todos: [{ content: 'tests', status: 'pending' }, { content: 'x', status: 'completed' }] }, output: '', isError: false, parent: null, elapsed: 0, done: true },
      { kind: 'assistant', id: 'a', text: 'All done.', thinking: '', parent: null, streaming: false },
    ],
  });
  assert.deepEqual(b, { asks: 1, files: ['src/a.ts'], commits: ['feat: a'], todos: ['tests'], last: 'All done.' });
});

test('transfer: merged into the target draft without duplicate attachments', async () => {
  const { mergeDraft } = await import('../web/src/lib/transfer');
  const a = { path: '/x/a.png', name: 'a.png', kind: 'image' as const };
  const b = { path: '/x/b.txt', name: 'b.txt', kind: 'file' as const };
  assert.deepEqual(mergeDraft({ text: 'draft\n', attachments: [a] }, { text: ' report ', attachments: [a, b] }), { text: 'draft\n\nreport', attachments: [a, b] });
  assert.deepEqual(mergeDraft({ text: '', attachments: [] }, { text: 'x', attachments: [] }), { text: 'x', attachments: [] });
});
