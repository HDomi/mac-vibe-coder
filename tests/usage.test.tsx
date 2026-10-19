import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import UsageBar, { Battery } from '../web/src/components/UsageBar';
import { fetchClaudeUsage } from '../server/usage';

test('usage batteries distinguish zero usage, exhausted quota and unavailable data', () => {
  const zero = renderToStaticMarkup(<Battery label="5h" win={{ usedPct: 0, resetsAt: null }} loading={false} />);
  assert.match(zero, /100%/); assert.match(zero, /0% used/);
  const exhausted = renderToStaticMarkup(<Battery label="5h" win={{ usedPct: 100, resetsAt: null }} loading={false} />);
  assert.match(exhausted, />0%</);
  const missing = renderToStaticMarkup(<Battery label="5h" win={null} error="HTTP 429" loading={false} />);
  assert.match(missing, /5h/); assert.match(missing, /—/); assert.match(missing, /HTTP 429/);
  assert.doesNotMatch(missing, /100%/);
  const initial = renderToStaticMarkup(<UsageBar mode="ide" onMode={() => {}} />);
  assert.match(initial, /Claude/); assert.match(initial, /Codex/);
});

test('Claude usage honors Retry-After and recovers with a real zero usage reading', async (context) => {
  let now = 1800000000000;
  let requests = 0;
  context.mock.method(Date, 'now', () => now);
  context.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return requests === 1
      ? new Response('', { status: 429, headers: { 'retry-after': '120' } })
      : Response.json({ five_hour: { utilization: 0, resets_at: null }, seven_day: { utilization: 12 } });
  });
  await assert.rejects(fetchClaudeUsage('fixture-token'), /429/);
  await assert.rejects(fetchClaudeUsage('fixture-token'), /429/);
  assert.equal(requests, 1);
  now += 120001;
  const usage = await fetchClaudeUsage('fixture-token');
  assert.equal(usage.fiveHour?.usedPct, 0);
  assert.equal(usage.weekly?.usedPct, 12);
  assert.equal(requests, 2);
});
