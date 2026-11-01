// Live injury report in the browser build: fetched from ESPN, cached briefly, the built-in copy as fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseInjuries, liveInjuries } from '../server/data/injuries.mjs';

const espn = { injuries: [{ displayName: 'Indiana Pacers', injuries: [{ athlete: { displayName: 'Obi Toppin', team: { abbreviation: 'IND' } }, status: 'Out', details: { type: 'Ankle' }, date: '2026-11-01T20:00Z' }] }] };

test('live injuries: fresh from ESPN, cached for the ttl, then fetched again', async () => {
  let calls = 0, t = 0;
  const src = liveInjuries({ fetchJson: async () => { calls++; return espn; }, fallback: async () => [], ttlMs: 1000, now: () => t });
  const a = await src();
  assert.equal(a[0].name, 'Obi Toppin');
  assert.equal(a[0].status, 'Out');
  assert.equal(a[0].team, 'IND');
  await src(); assert.equal(calls, 1);
  t = 2000; await src(); assert.equal(calls, 2);
});

test('live injuries: ESPN down or empty -> the built-in report', async () => {
  const baked = [{ name: 'Baked Player', team: 'BOS', status: 'Out' }];
  const down = liveInjuries({ fetchJson: async () => { throw new Error('offline'); }, fallback: async () => baked });
  assert.deepEqual(await down(), baked);
  const empty = liveInjuries({ fetchJson: async () => ({ injuries: [] }), fallback: async () => baked });
  assert.deepEqual(await empty(), baked);
});

test('live injuries: after a failure, no new request until a minute has passed', async () => {
  let calls = 0, t = 0;
  const src = liveInjuries({ fetchJson: async () => { calls++; throw new Error('offline'); }, fallback: async () => [], now: () => t });
  await src(); await src(); await src();
  assert.equal(calls, 1);
  t = 61e3; await src();
  assert.equal(calls, 2);
});

test('normalise keeps the provider shape', () => {
  assert.deepEqual(Object.keys(normaliseInjuries(espn)[0]).sort(), ['injury', 'name', 'note', 'returnDate', 'source', 'status', 'team', 'updated']);
});

test('live injuries: calls made at the same time share one request', async () => {
  let calls = 0;
  const src = liveInjuries({ fetchJson: async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return espn; }, fallback: async () => [] });
  const all = await Promise.all([src(), src(), src()]);
  assert.equal(calls, 1);
  assert.ok(all.every((x) => x[0].name === 'Obi Toppin'));
});
