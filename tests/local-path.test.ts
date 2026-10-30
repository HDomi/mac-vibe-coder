import assert from 'node:assert/strict';
import test from 'node:test';
import { codePathCandidate, resolveLocal } from '../web/src/lib/localPath';

test('local path: link targets resolve against the file folder, URLs do not', () => {
  assert.equal(resolveLocal('./b.md', '/r/docs'), '/r/docs/b.md');
  assert.equal(resolveLocal('../server/git.ts#L15', '/r/docs'), '/r/server/git.ts');
  assert.equal(resolveLocal('server/git.ts:15', '/r'), '/r/server/git.ts');
  assert.equal(resolveLocal('package.json:12:3', '/r'), '/r/package.json');
  assert.equal(resolveLocal('file:///Users/a/My%20Doc.md', null), '/Users/a/My Doc.md');
  assert.equal(resolveLocal('~/notes/a.md', null), '~/notes/a.md');
  assert.equal(resolveLocal('a.md', null), null);
  assert.equal(resolveLocal('https://x.dev:8080', '/r'), null);
  assert.equal(resolveLocal('#heading', '/r'), null);
  assert.equal(resolveLocal('vscode://file/x', '/r'), null);
});

test('local path: inline code that names a file', () => {
  for (const s of ['server/git.ts', 'server/git.ts:15', './a.md', '~/x/y.json', '/etc/hosts', 'README.md', 'web/src/components/', 'package.json:3:1'])
    assert.equal(codePathCandidate(s), s, s);
  for (const s of ['npm run build', 'foo()', 'and/or', 'read/write', 'v3.4.0', 'https://a.dev/x.md', '--flag', 'a.b(c)', '<div>', '', 'x'])
    assert.equal(codePathCandidate(s), null, s);
});
