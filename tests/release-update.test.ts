import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleOf, bundleProblem, parseSums, pickAssets, type Release } from '../server/releaseUpdate';

test('the standalone bundle is found from the server root; a checkout has none', () => {
  assert.equal(bundleOf('/Applications/Vibrato.app/Contents/Resources/app'), '/Applications/Vibrato.app');
  assert.equal(bundleOf('/Users/me/Apps/Vibrato.app/Contents/Resources/app/dist/server'), '/Users/me/Apps/Vibrato.app');
  assert.equal(bundleOf('/Users/me/Desktop/Dev/vibrato'), null);
});

test('translocated or mounted copies cannot update themselves', () => {
  assert.equal(bundleProblem('/Applications/Vibrato.app'), null);
  assert.ok(bundleProblem('/private/var/folders/x/AppTranslocation/ABC/d/Vibrato.app'));
  assert.ok(bundleProblem('/Volumes/Vibrato 1.0.12/Vibrato.app'));
});

test('the zip for this architecture and the checksum list are picked from the release', () => {
  const asset = (name: string) => ({ name, browser_download_url: `https://example.test/${name}`, size: 1 });
  const release: Release = { tag_name: 'v1.0.12', assets: [asset('Vibrato-1.0.12-arm64.dmg'), asset('Vibrato-1.0.12-arm64-mac.zip'), asset('SHA256SUMS.txt')] };
  assert.equal(pickAssets(release, 'arm64').zip?.name, 'Vibrato-1.0.12-arm64-mac.zip');
  assert.equal(pickAssets(release, 'arm64').sums?.name, 'SHA256SUMS.txt');
  assert.equal(pickAssets(release, 'x64').zip, null);
});

test('shasum output is parsed by file name', () => {
  const a = 'a'.repeat(64); const b = 'B'.repeat(64);
  const sums = parseSums(`${a}  Vibrato-1.0.12-arm64.dmg\n${b} *Vibrato-1.0.12-arm64-mac.zip\nnot a line\n`);
  assert.equal(sums.get('Vibrato-1.0.12-arm64.dmg'), a);
  assert.equal(sums.get('Vibrato-1.0.12-arm64-mac.zip'), 'b'.repeat(64));
  assert.equal(sums.size, 2);
});

test('the Atom feed is parsed: tag from the link, notes flattened from escaped HTML', async () => {
  const { parseAtom } = await import('../server/releaseUpdate');
  const xml = `<feed><entry><updated>2026-10-29T04:23:53Z</updated><link rel="alternate" type="text/html" href="https://github.com/HDomi/vibrato/releases/tag/v3.3.1"/><title>Vibrato v3.3.1</title><content type="html">&lt;p&gt;misc: 재릴리스 (v3.3.1)&lt;/p&gt;&lt;ul&gt;&lt;li&gt;a &amp;amp; b&lt;/li&gt;&lt;/ul&gt;</content></entry><entry><title>no link</title></entry></feed>`;
  assert.deepEqual(parseAtom(xml), [{ tag: 'v3.3.1', name: 'Vibrato v3.3.1', publishedAt: '2026-10-29T04:23:53Z', notes: 'misc: 재릴리스 (v3.3.1)\na & b' }]);
});
