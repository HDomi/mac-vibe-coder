import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gitLog } from '../server/git';
import { layoutGitGraph } from '../web/src/lib/gitGraph';

const commit = (hash: string, ...parents: string[]) => ({ hash, parents });

test('graph connections reach their real parents across merges, lane shifts and separate roots', () => {
  const commits = [
    commit('merge', 'main', 'feature', 'third'),
    commit('main', 'base'),
    commit('other-tip', 'feature'),
    commit('feature', 'base'),
    commit('third', 'base'),
    commit('base'),
    commit('separate-root'),
  ];
  const { rows } = layoutGitGraph(commits);
  commits.forEach((entry, i) => {
    const outgoing = rows[i].edges.filter((edge) => edge.half === 'bottom');
    assert.equal(outgoing.length, entry.parents.length);
    entry.parents.forEach((parent, p) => {
      const parentRow = commits.findIndex((c) => c.hash === parent);
      let lane = outgoing[p].to;
      for (let j = i + 1; j < parentRow; j++) {
        const through = rows[j].edges.find((edge) => !edge.half && edge.from === lane);
        assert.ok(through, `${entry.hash} -> ${parent} interrupted at ${commits[j].hash}`);
        lane = through.to;
      }
      assert.equal(lane, rows[parentRow].lane);
      assert.ok(rows[parentRow].edges.some((edge) => edge.half === 'top' && edge.from === lane));
    });
  });
  assert.equal(rows[2].edges.some((edge) => edge.half === 'top'), false);
  assert.equal(rows.at(-1)!.edges.length, 0);
  assert.deepEqual(layoutGitGraph(commits.slice(0, 3)).rows, rows.slice(0, 3));
});

test('git log includes branch tips, merge parents, tags, detached HEAD and consistent pages', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'vibe-git-graph-'));
  const git = (...args: string[]) => execFileSync('git', [
    '-C', cwd, '-c', 'user.name=Graph Test', '-c', 'user.email=graph@example.test',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '-b', 'main');
    assert.deepEqual(await gitLog(cwd), { commits: [], hasMore: false });
    git('commit', '--allow-empty', '-m', 'root');
    git('checkout', '-b', 'feature');
    git('commit', '--allow-empty', '-m', 'feature work');
    git('checkout', 'main');
    git('commit', '--allow-empty', '-m', 'main work');
    git('merge', '--no-ff', 'feature', '-m', 'merge feature');
    git('tag', 'v1');
    git('checkout', '-b', 'unmerged');
    git('commit', '--allow-empty', '-m', 'branch tip');
    git('checkout', 'main');

    const all = await gitLog(cwd, 0, 30);
    assert.equal(all.commits.length, 5);
    assert.equal(all.hasMore, false);
    const merge = all.commits.find((c) => c.subject === 'merge feature')!;
    assert.equal(merge.hash.length, 40);
    assert.equal(merge.parents.length, 2);
    assert.ok(merge.refs.includes('HEAD -> main'));
    assert.ok(merge.refs.includes('tag: v1'));
    assert.ok(all.commits.some((c) => c.refs.includes('unmerged')));
    for (const entry of all.commits) {
      for (const parent of entry.parents) {
        assert.ok(all.commits.findIndex((c) => c.hash === parent) > all.commits.indexOf(entry));
      }
    }
    const first = await gitLog(cwd, 0, 2);
    const rest = await gitLog(cwd, 2, 30);
    assert.equal(first.hasMore, true);
    assert.deepEqual([...first.commits, ...rest.commits], all.commits);

    git('checkout', '--detach', 'feature');
    git('commit', '--allow-empty', '-m', 'detached work');
    const detached = await gitLog(cwd);
    assert.ok(detached.commits.some((c) => c.subject === 'detached work' && c.refs.includes('HEAD')));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
