import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

const asset = (v: string) => [{ name: `Vibrato-${v}-arm64-mac.zip`, browser_download_url: 'x', size: 1 }, { name: `Vibrato-${v}-x64-mac.zip`, browser_download_url: 'x', size: 1 }, { name: 'SHA256SUMS.txt', browser_download_url: 'x', size: 1 }];

test('recent releases: newest installable ones, drafts, prereleases and asset-less ones skipped', async () => {
  const releases = [
    { tag_name: 'v2.2.0', name: 'v2.2.0', draft: true, assets: asset('2.2.0') },
    { tag_name: 'v2.1.1', name: 'Fixes', body: 'notes', published_at: '2026-10-27T00:00:00Z', assets: asset('2.1.1') },
    { tag_name: 'v2.1.0-rc1', prerelease: true, assets: asset('2.1.0-rc1') },
    { tag_name: 'v2.1.0', assets: [] },
    { tag_name: 'v2.0.1', assets: asset('2.0.1') },
    { tag_name: 'v2.0.0', assets: asset('2.0.0') },
    { tag_name: 'v1.0.11', assets: asset('1.0.11') },
  ];
  let asked = '';
  const server = http.createServer((req, res) => { asked = req.url ?? ''; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(releases)); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.VIBRATO_UPDATE_FEED = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const { recentReleases } = await import('../server/releaseUpdate');
    const list = await recentReleases(3);
    assert.match(asked, /^\/releases\?per_page=/);
    assert.deepEqual(list.map((r) => r.version), ['2.1.1', '2.0.1', '2.0.0']);
    assert.deepEqual(list[0], { version: '2.1.1', tag: 'v2.1.1', name: 'Fixes', publishedAt: '2026-10-27T00:00:00Z', notes: 'notes' });
  } finally { server.close(); }
});

test('update dialog lists releases with install / roll back by version order', async () => {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { RecentReleases } = await import('../web/src/components/UpdatePanel');
  const html = renderToStaticMarkup(React.createElement(RecentReleases, {
    installed: '2.0.1', disabled: false, onInstall: () => {},
    releases: [{ version: '2.1.1', tag: 'v2.1.1', name: 'v2.1.1', publishedAt: null, notes: '' }, { version: '2.0.1', tag: 'v2.0.1', name: 'v2.0.1', publishedAt: null, notes: '' }, { version: '2.0.0', tag: 'v2.0.0', name: 'v2.0.0', publishedAt: null, notes: '' }],
  }));
  const order = ['v2.1.1', 'Install', 'v2.0.1', 'Installed', 'v2.0.0', 'Roll back to this'].map((s) => html.indexOf(s));
  assert.ok(order.every((n, i) => n >= 0 && (i === 0 || n > order[i - 1])), html);
});
