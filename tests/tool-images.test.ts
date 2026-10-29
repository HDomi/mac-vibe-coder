import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'vibrato-toolimg-'));
process.env.VIBRATO_CONFIG_DIR = dir;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('tool images: saved once by content hash, unusable input rejected', async () => {
  const { saveToolImage } = await import('../server/attachments');
  try {
    const a = saveToolImage(PNG.toString('base64'), 'image/png');
    assert.ok(a && a.startsWith(join(dir, 'attachments', 'tool-images')) && a.endsWith('.png'));
    assert.deepEqual(readFileSync(a!), PNG);
    assert.equal(saveToolImage(PNG.toString('base64'), 'image/png'), a);
    assert.equal(saveToolImage('', 'image/png'), null);
    assert.equal(saveToolImage(PNG.toString('base64'), 'application/pdf'), null);
    assert.ok(existsSync(a!));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tool images reach chat items live and from saved history', async () => {
  const { reduceEvent, itemsFromHistory } = await import('../web/src/lib/chatStore');
  let s = { id: 's', agent: 'claude' as const, cwd: '/x', permissionMode: 'default' as const, status: 'running' as const, items: [], totalCostUsd: 0, lastSeq: 0 };
  s = reduceEvent(s, { kind: 'tool.start', toolUseId: 't1', name: 'Read', input: { file_path: '/x/a.png' }, parent: null }, 1) as typeof s;
  s = reduceEvent(s, { kind: 'tool.result', toolUseId: 't1', content: '[image]', isError: false, parent: null, images: ['/cfg/a.png'] }, 2) as typeof s;
  assert.deepEqual((s.items[0] as { images?: string[] }).images, ['/cfg/a.png']);

  const items = itemsFromHistory([
    { type: 'assistant', uuid: 'a', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/x/b.png' } }] } },
    { type: 'user', uuid: 'u', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } }] }] } },
  ]);
  const tool = items.find((i) => i.kind === 'tool') as { images?: string[]; output: string };
  assert.deepEqual(tool.images, ['data:image/png;base64,AAA']);
  assert.equal(tool.output, '[image]');
});
