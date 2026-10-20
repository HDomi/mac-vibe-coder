import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_FILE_ICON, DEFAULT_FOLDER_ICON, fileIconId, fileIconSvg } from '../web/src/lib/fileIcons';

test('file icons resolve by exact name before extension', () => {
  assert.equal(fileIconId('package.json', false), 'nodejs');
  assert.equal(fileIconId('Dockerfile', false), 'docker');
  assert.equal(fileIconId('.gitignore', false), 'git');
});

test('file icons prefer the longest multi-dot extension', () => {
  assert.equal(fileIconId('main.ts', false), 'typescript');
  assert.equal(fileIconId('app.test.ts', false), 'test-ts');
  assert.equal(fileIconId('bundle.js.map', false), 'javascript-map');
  assert.equal(fileIconId('NOTES.MD', false), 'markdown');
  assert.equal(fileIconId('README.md', false), 'readme');
});

test('unknown names fall back to the theme defaults', () => {
  assert.equal(fileIconId('weird.zzzqqq', false), DEFAULT_FILE_ICON);
  assert.equal(fileIconId('noext', false), DEFAULT_FILE_ICON);
  assert.equal(fileIconId('zzqq-unknown', true), DEFAULT_FOLDER_ICON);
  assert.equal(fileIconId('src', true), 'folder-src');
  assert.equal(fileIconId('node_modules', true), 'folder-node');
});

test('icon ids map to shipped svg file names', () => {
  assert.equal(fileIconSvg('typescript'), 'typescript.svg');
  assert.equal(fileIconSvg('nope-not-an-icon'), null);
});

import { backgroundState, displayTitle, pendingRequests, type ChatSession } from '../web/src/lib/chatStore';

test('background state tells a working session from one waiting on the user', () => {
  const base: ChatSession = { id: 's', agent: 'claude', cwd: '/p', permissionMode: 'default', status: 'idle', totalCostUsd: 0, lastSeq: 0, items: [] };
  assert.equal(backgroundState(base), null);
  assert.equal(backgroundState({ ...base, status: 'closed' }), null);
  assert.equal(backgroundState({ ...base, status: 'running' }), 'running');
  assert.equal(backgroundState({ ...base, status: 'compacting' }), 'running');
  const approval = { kind: 'approval', id: 'a1', toolName: 'Bash', input: {}, canAlwaysAllow: true, decision: null } as const;
  assert.equal(backgroundState({ ...base, status: 'running', items: [approval] }), 'waiting');
  assert.equal(backgroundState({ ...base, status: 'running', items: [{ ...approval, decision: 'allow' }] }), 'running');
  // An unanswered request before the latest user message is stale; the turn moved on.
  assert.equal(backgroundState({ ...base, status: 'running', items: [approval, { kind: 'user', id: 'u', text: 'go', attachments: [] } as never] }), 'running');
});

test('tab title prefers the CLI session title over the first prompt', () => {
  const base: ChatSession = { id: 's', agent: 'claude', cwd: '/p', permissionMode: 'default', status: 'idle', totalCostUsd: 0, lastSeq: 0,
    items: [{ kind: 'user', id: 'u1', text: '커밋은 일단 나눠서 해봐', attachments: [] } as never] };
  assert.equal(displayTitle(base), '커밋은 일단 나눠서 해봐');
  assert.equal(displayTitle({ ...base, title: '어드민 백엔드 변경사항 프론트 반영 확인' }, 12), '어드민 백엔드 변경사항');
  assert.equal(displayTitle({ ...base, title: '   ' }), '커밋은 일단 나눠서 해봐');
});

test('tab badge counts approvals and questions of the current turn only', () => {
  const approval = { kind: 'approval', id: 'a1', toolName: 'Bash', input: {}, canAlwaysAllow: true, decision: null } as const;
  const question = { kind: 'question', id: 'q1', questions: [], resolved: false } as const;
  const base: ChatSession = { id: 's', agent: 'claude', cwd: '/p', permissionMode: 'default', status: 'running', totalCostUsd: 0, lastSeq: 0, items: [approval, question] };
  assert.equal(pendingRequests(base), 2);
  assert.equal(pendingRequests({ ...base, status: 'idle' }), 0);
  assert.equal(pendingRequests({ ...base, items: [approval, { kind: 'user', id: 'u', text: 'go', attachments: [] } as never, question] }), 1);
});
