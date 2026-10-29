import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFile, FsError, readText, writeText } from '../server/fs';

async function scratch() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'vibrato-edit-'));
}

test('readText reports mtime, BOM, binary and invalid UTF-8', async () => {
  const dir = await scratch();
  const bom = path.join(dir, 'bom.txt');
  await fs.writeFile(bom, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('héllo\r\n')]));
  const r = await readText(bom);
  assert.equal(r.content, 'héllo\r\n');
  assert.equal(r.bom, true);
  assert.equal(r.binary, false);
  assert.equal(r.lossy, false);
  assert.equal(r.mtime, (await fs.stat(bom)).mtimeMs);

  const bin = path.join(dir, 'a.bin');
  await fs.writeFile(bin, Buffer.from([0x50, 0x4b, 0x00, 0x01]));
  assert.equal((await readText(bin)).binary, true);

  const latin = path.join(dir, 'latin1.txt');
  await fs.writeFile(latin, Buffer.from([0x63, 0x61, 0x66, 0xe9]));
  assert.equal((await readText(latin)).lossy, true);
});

test('writeText keeps the BOM, refuses a stale buffer and follows symlinks', async () => {
  const dir = await scratch();
  const file = path.join(dir, 'a.ts');
  await fs.writeFile(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one')]));
  const loaded = await readText(file);
  const saved = await writeText(file, 'two\r\n', { baseMtime: loaded.mtime, bom: loaded.bom });
  assert.deepEqual(await fs.readFile(file), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('two\r\n')]));
  assert.equal(saved.mtime, (await fs.stat(file)).mtimeMs);

  // Someone else wrote after we loaded: the old mtime must be rejected, force overrides.
  await fs.utimes(file, new Date(), new Date(Date.now() + 5000));
  await assert.rejects(writeText(file, 'three', { baseMtime: saved.mtime }), (e: unknown) => e instanceof FsError && e.status === 409);
  assert.equal((await readText(file)).content, 'two\r\n');
  await writeText(file, 'three', { baseMtime: saved.mtime, force: true });
  assert.equal((await readText(file)).content, 'three');

  // Deleted underneath the editor: a plain save is a conflict, not a silent recreate.
  const gone = path.join(dir, 'gone.txt');
  await fs.writeFile(gone, 'x');
  const g = await readText(gone);
  await fs.rm(gone);
  await assert.rejects(writeText(gone, 'y', { baseMtime: g.mtime }), (e: unknown) => e instanceof FsError && e.status === 409);

  const target = path.join(dir, 'real.txt');
  const link = path.join(dir, 'link.txt');
  await fs.writeFile(target, 'a');
  await fs.symlink(target, link);
  await writeText(link, 'b', { baseMtime: (await readText(link)).mtime });
  assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
  assert.equal(await fs.readFile(target, 'utf8'), 'b');
});

test('createFile makes an empty file and never overwrites', async () => {
  const dir = await scratch();
  const p = await createFile(dir, 'new.yaml');
  assert.equal(await fs.readFile(p, 'utf8'), '');
  await fs.writeFile(p, 'keep');
  await assert.rejects(createFile(dir, 'new.yaml'), (e: unknown) => e instanceof FsError && e.status === 409);
  assert.equal(await fs.readFile(p, 'utf8'), 'keep');
  await assert.rejects(createFile(dir, '../x'), (e: unknown) => e instanceof FsError && e.status === 400);
});
