import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkWorktree, createWorktree, mergeWorktree, removeWorktree, sanitizeBranch, worktreeStatus } from '../server/worktree';

test('worktree sessions: create next to the repo, refuse dirty merge, merge with a merge commit, clean up', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'mvc-wt-')));
  const repo = join(base, 'proj');
  mkdirSync(join(repo, 'node_modules', 'dep'), { recursive: true });
  const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { stdio: 'pipe' }).toString().trim();
  try {
    git(base, 'init', '-q', '-b', 'main', repo); git(repo, 'config', 'user.email', 't@t'); git(repo, 'config', 'user.name', 't');
    writeFileSync(join(repo, '.gitignore'), 'node_modules/\n');
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init');

    const wt = await createWorktree(repo, 'feat/x y');
    assert.equal(wt.branch, 'feat/x-y');
    assert.equal(wt.path, join(base, 'proj-wt', 'feat-x-y'));
    assert.equal(wt.baseBranch, 'main');
    assert.ok(lstatSync(join(wt.path, 'node_modules')).isSymbolicLink());
    assert.deepEqual(checkWorktree(wt), wt);
    assert.throws(() => checkWorktree({ ...wt, path: '/etc' }), /Not a worktree/);
    const again = await createWorktree(repo, 'feat/x y');
    assert.equal(again.branch, 'feat/x-y-2');
    assert.equal((await removeWorktree(again, false)).ok, true);

    writeFileSync(join(wt.path, 'a.txt'), 'two\n');
    assert.deepEqual((await worktreeStatus(wt)).dirty, ['a.txt'], 'the node_modules symlink is not reported');
    const refused = await mergeWorktree(wt);
    assert.equal(refused.ok, false);
    assert.match(refused.message, /Uncommitted/);

    git(wt.path, 'commit', '-qam', 'change');
    const done = await mergeWorktree(wt);
    assert.equal(done.ok, true, done.message);
    assert.equal(done.merged, true);
    assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'two\n');
    assert.match(git(repo, 'log', '-1', '--format=%s'), /^Merge branch 'feat\/x-y'/);
    assert.equal(existsSync(wt.path), false);
    assert.ok(existsSync(join(repo, 'node_modules', 'dep')), 'the shared node_modules survives');
    assert.equal(git(repo, 'branch', '--list', 'feat/x-y'), '');

    // Conflicting work is aborted, leaving main untouched.
    const c = await createWorktree(repo, 'clash');
    writeFileSync(join(c.path, 'a.txt'), 'three\n'); git(c.path, 'commit', '-qam', 'wt');
    writeFileSync(join(repo, 'a.txt'), 'four\n'); git(repo, 'commit', '-qam', 'main');
    const clash = await mergeWorktree(c);
    assert.equal(clash.ok, false);
    assert.deepEqual(clash.conflicts, ['a.txt']);
    assert.equal(git(repo, 'status', '--porcelain'), '');
    assert.equal((await removeWorktree(c, true)).ok, true);
    assert.equal(sanitizeBranch(' ../a b..c/ '), 'a-b.c');
  } finally { rmSync(base, { recursive: true, force: true }); }
});
