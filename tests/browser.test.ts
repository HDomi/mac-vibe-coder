import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserBridge, browserAgentHint, isUserPage, normalizeUrl } from '../server/browser';
import { keyEventFor, mouseModifiers, normalizeAddress, virtualKeyCode } from '../web/src/lib/browserInput';

test('address bar input becomes a URL or a search', () => {
  assert.equal(normalizeUrl('localhost:3000/landing'), 'http://localhost:3000/landing');
  assert.equal(normalizeUrl(':3003'), 'http://localhost:3003');
  assert.equal(normalizeUrl('127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(normalizeUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(normalizeUrl('example.com'), 'https://example.com');
  assert.equal(normalizeUrl('about:blank'), 'about:blank');
  assert.equal(normalizeUrl('러시아 랜딩'), 'https://www.google.com/search?q=%EB%9F%AC%EC%8B%9C%EC%95%84%20%EB%9E%9C%EB%94%A9');
  assert.equal(normalizeUrl('  '), 'about:blank');
});

test('only user pages are offered as browser tabs', () => {
  assert.ok(isUserPage({ type: 'page', url: 'http://localhost:3000/' }));
  assert.ok(isUserPage({ type: 'page', url: 'about:blank' }));
  for (const t of [{ type: 'page', url: 'devtools://devtools/bundled/x' }, { type: 'page', url: 'chrome://newtab/' }, { type: 'browser_ui', url: 'chrome://omnibox-popup.top-chrome/' }, { type: 'service_worker', url: 'chrome-extension://x/bg.js' }]) {
    assert.equal(isUserPage(t), false, t.url);
  }
});

test('keys map to CDP key events with text only where the page should get input', () => {
  const plain = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
  assert.deepEqual(keyEventFor({ ...plain, key: 'a', code: 'KeyA' }, 'keyDown'), { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 0, location: 0, text: 'a', unmodifiedText: 'a' });
  assert.equal(keyEventFor({ ...plain, key: 'Enter', code: 'Enter' }, 'keyDown').text, '\r');
  assert.equal(keyEventFor({ ...plain, key: 'Backspace', code: 'Backspace' }, 'keyDown').type, 'rawKeyDown');
  assert.equal(keyEventFor({ ...plain, key: 'a', code: 'KeyA' }, 'keyUp').text, undefined);
  assert.equal(virtualKeyCode('ArrowLeft'), 37);
  assert.equal(virtualKeyCode('7', 'Digit7'), 55);
  assert.equal(mouseModifiers({ altKey: true, ctrlKey: false, metaKey: true, shiftKey: true }), 13);
});

test('in-app agents are pointed at the panel page, not a new browser', () => {
  const hint = browserAgentHint(11398);
  assert.match(hint, /http:\/\/127\.0\.0\.1:11398\/api\/browser\/target/);
  assert.match(hint, /debugweb/);
  // Its own port: the user's debugweb Chrome on 9222 is never the in-app target.
  assert.match(hint, /9323/);
  assert.match(hint, /do not use port 9222/);
  assert.match(hint, /never attach to or act on any target other than targetId/);
});

test('the Electron panel view is reported to agents and bad reports are ignored', () => {
  const b = new BrowserBridge();
  assert.equal(b.info(), null);
  b.reportNative({ targetId: 'ABCDEF0123456789ABCDEF0123456789', url: 'http://localhost:3000/', title: 'App', cdpPort: 9323 });
  assert.equal(b.info()?.webSocketDebuggerUrl, 'ws://127.0.0.1:9323/devtools/page/ABCDEF0123456789ABCDEF0123456789');
  b.reportNative({ targetId: '../../etc', cdpPort: 9323 });
  assert.equal(b.info(), null);
});

test('the native panel address bar follows the same URL rules as the server', () => {
  for (const input of ['localhost:3000/landing', ':3003', '127.0.0.1:8080', 'https://example.com/a', 'example.com', 'about:blank', '러시아 랜딩', '  ']) {
    assert.equal(normalizeAddress(input), normalizeUrl(input), input);
  }
});
