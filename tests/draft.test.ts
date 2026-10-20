import assert from 'node:assert/strict';
import test from 'node:test';
import { draftKey, readDraft, writeDraft } from '../web/src/lib/draft';

test('composer drafts persist per session until sent and ignore broken entries', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  const key = draftKey('s1');
  assert.equal(key, 'vibe.draft.s1');
  writeDraft(key, { text: 'half-typed question', attachments: [{ path: '/tmp/a.png', name: 'a.png', kind: 'image' }] }, storage);
  assert.deepEqual(readDraft(key, storage), { text: 'half-typed question', attachments: [{ path: '/tmp/a.png', name: 'a.png', kind: 'image' }] });
  assert.deepEqual(readDraft(draftKey('other'), storage), { text: '', attachments: [] });
  assert.deepEqual(readDraft(null, storage), { text: '', attachments: [] });
  store.set(draftKey('broken'), '{not json');
  assert.deepEqual(readDraft(draftKey('broken'), storage), { text: '', attachments: [] });
  store.set(draftKey('shape'), JSON.stringify({ text: 5, attachments: 'x' }));
  assert.deepEqual(readDraft(draftKey('shape'), storage), { text: '', attachments: [] });
  writeDraft(key, { text: '', attachments: [] }, storage);
  assert.equal(store.has(key), false);
  writeDraft(null, { text: 'x', attachments: [] }, storage);
  assert.equal(store.size, 2);
});
