import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compareEnv, maskValue, missingLines, parseEnv, quoteValue, toExample } from '../web/src/lib/toolbox/env';
import { findEnvFiles } from '../server/fs';

const A = `# app
export NODE_ENV=production
API_URL=https://api.example.com # prod
SECRET="a b \\"c\\""
MULTI="line1
line2"
EMPTY=
SINGLE='it''s raw $HOME'
DUP=1
DUP=2
bad line here
`;

test('env: parse quotes, export, comments, multi-line, duplicates, errors', () => {
  const p = parseEnv(A);
  const v = Object.fromEntries(p.entries.map((e) => [e.key, e.value]));
  assert.equal(v.NODE_ENV, 'production');
  assert.equal(v.API_URL, 'https://api.example.com');
  assert.equal(v.SECRET, 'a b "c"');
  assert.equal(v.MULTI, 'line1\nline2');
  assert.equal(v.EMPTY, '');
  assert.equal(v.SINGLE, 'it');
  assert.deepEqual(p.duplicates, ['DUP']);
  assert.deepEqual(p.errors.map((e) => e.line), [11]);
  assert.equal(p.entries.find((e) => e.key === 'NODE_ENV')!.exported, true);
});

test('env: compare, example, missing keys, quoting, masking', () => {
  const a = parseEnv('A=1\nB=2\nC=\nD=x');
  const b = parseEnv('A=1\nB=3\nC=set\nE=new');
  assert.deepEqual(compareEnv(a, b).map((r) => `${r.key}:${r.status}`), ['A:same', 'B:diff', 'C:empty', 'D:onlyA', 'E:onlyB']);
  assert.equal(toExample(A), `# app
export NODE_ENV=
API_URL=
SECRET=
MULTI=
EMPTY=
SINGLE=
DUP=
DUP=
bad line here
`);
  assert.equal(missingLines(b, a, false), 'D=');
  assert.equal(missingLines(a, b, true), 'E=new');
  assert.equal(quoteValue('has space'), '"has space"');
  assert.equal(quoteValue('a"b\nc'), '"a\\"b\\nc"');
  assert.equal(quoteValue('plain'), 'plain');
  assert.equal(maskValue('sk-1234567890'), 'sk•••••••••90');
  assert.equal(maskValue('abc'), '•••');
});

test('env files are found in a project, skipping node_modules', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vibe-env-'));
  try {
    await mkdir(join(dir, 'apps/web'), { recursive: true });
    await mkdir(join(dir, 'node_modules/x'), { recursive: true });
    for (const f of ['.env', '.env.example', 'apps/web/.env.local', 'node_modules/x/.env', 'README.md']) await writeFile(join(dir, f), 'A=1');
    assert.deepEqual((await findEnvFiles(dir)).map((f) => f.rel), ['.env', '.env.example', 'apps/web/.env.local']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
