import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const cfg = mkdtempSync(join(tmpdir(), 'mvc-cfg-'));
process.env.MVC_CONFIG_DIR = cfg;

test('a worktree session verifies with the settings of the repository it came from', async () => {
  const { updateProjectSettings, verifySettings } = await import('../server/verify');
  const { createWorktree, removeWorktree } = await import('../server/worktree');
  const base = mkdtempSync(join(tmpdir(), 'mvc-vw-'));
  const repo = join(base, 'p');
  const git = (...a: string[]) => execFileSync('git', a, { stdio: 'pipe' });
  try {
    git('init', '-q', repo); git('-C', repo, 'config', 'user.email', 't@t'); git('-C', repo, 'config', 'user.name', 't');
    writeFileSync(join(repo, 'a'), '1'); git('-C', repo, 'add', '-A'); git('-C', repo, 'commit', '-qm', 'i');
    // Saved under the /tmp spelling, looked up from the worktree's /private/tmp real path.
    await updateProjectSettings(repo, (p) => ({ ...p, verify: { command: 'npm test', auto: true } }));
    const wt = await createWorktree(repo, 'v');
    assert.deepEqual(await verifySettings(wt.path), { command: 'npm test', auto: true });
    assert.equal(await verifySettings(base), null);
    await removeWorktree(wt, true);
  } finally { rmSync(base, { recursive: true, force: true }); rmSync(cfg, { recursive: true, force: true }); }
});
