import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runVerify, suggestVerifyCommands } from '../server/verify';

test('verify runner: exit code, output tail without colour codes, cancel', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mvc-verify-'));
  try {
    const ok = await runVerify(dir, 'printf "\\033[32mfine\\033[0m\\n"; pwd').done;
    assert.equal(ok.exitCode, 0);
    assert.match(ok.output, /^fine\n/);
    assert.ok(ok.output.endsWith(dir.split('/').pop()!), ok.output);

    const bad = await runVerify(dir, 'seq 1 1000; echo boom >&2; exit 3').done;
    assert.equal(bad.exitCode, 3);
    assert.ok(bad.output.endsWith('boom'));
    assert.ok(!bad.output.includes('\n1\n'), 'only the tail is kept');

    const slow = runVerify(dir, 'sleep 30');
    setTimeout(slow.cancel, 100);
    const r = await slow.done;
    assert.equal(r.cancelled, true);
    assert.ok(r.durationMs < 10000);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('verify suggestions follow the project kind and package manager', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mvc-verify-'));
  try {
    assert.deepEqual(await suggestVerifyCommands(dir), []);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { typecheck: 'tsc', test: 'node --test', lint: 'eslint .' } }));
    assert.deepEqual((await suggestVerifyCommands(dir)).slice(0, 3), ['npm run typecheck && npm test', 'npm run typecheck', 'npm run lint']);
    await writeFile(join(dir, 'pnpm-lock.yaml'), '');
    assert.equal((await suggestVerifyCommands(dir))[0], 'pnpm typecheck && pnpm test');
    await writeFile(join(dir, 'Cargo.toml'), '');
    assert.ok((await suggestVerifyCommands(dir)).includes('cargo check'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
