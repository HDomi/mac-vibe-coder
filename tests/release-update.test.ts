import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleOf, bundleProblem, parseSums, pickAssets, type Release } from '../server/releaseUpdate';

test('the standalone bundle is found from the server root; a checkout has none', () => {
  assert.equal(bundleOf('/Applications/Mac Vibe Coder.app/Contents/Resources/app'), '/Applications/Mac Vibe Coder.app');
  assert.equal(bundleOf('/Users/me/Apps/Mac Vibe Coder.app/Contents/Resources/app/dist/server'), '/Users/me/Apps/Mac Vibe Coder.app');
  assert.equal(bundleOf('/Users/me/Desktop/Dev/mac-vibe-coder'), null);
});

test('translocated or mounted copies cannot update themselves', () => {
  assert.equal(bundleProblem('/Applications/Mac Vibe Coder.app'), null);
  assert.ok(bundleProblem('/private/var/folders/x/AppTranslocation/ABC/d/Mac Vibe Coder.app'));
  assert.ok(bundleProblem('/Volumes/Mac Vibe Coder 1.0.12/Mac Vibe Coder.app'));
});

test('the zip for this architecture and the checksum list are picked from the release', () => {
  const asset = (name: string) => ({ name, browser_download_url: `https://example.test/${name}`, size: 1 });
  const release: Release = { tag_name: 'v1.0.12', assets: [asset('Mac-Vibe-Coder-1.0.12-arm64.dmg'), asset('Mac-Vibe-Coder-1.0.12-arm64-mac.zip'), asset('SHA256SUMS.txt')] };
  assert.equal(pickAssets(release, 'arm64').zip?.name, 'Mac-Vibe-Coder-1.0.12-arm64-mac.zip');
  assert.equal(pickAssets(release, 'arm64').sums?.name, 'SHA256SUMS.txt');
  assert.equal(pickAssets(release, 'x64').zip, null);
});

test('shasum output is parsed by file name', () => {
  const a = 'a'.repeat(64); const b = 'B'.repeat(64);
  const sums = parseSums(`${a}  Mac-Vibe-Coder-1.0.12-arm64.dmg\n${b} *Mac-Vibe-Coder-1.0.12-arm64-mac.zip\nnot a line\n`);
  assert.equal(sums.get('Mac-Vibe-Coder-1.0.12-arm64.dmg'), a);
  assert.equal(sums.get('Mac-Vibe-Coder-1.0.12-arm64-mac.zip'), 'b'.repeat(64));
  assert.equal(sums.size, 2);
});
