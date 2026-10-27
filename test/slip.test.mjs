// Slip analysis and acca grading, on the deterministic demo league.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STATS_PROVIDER = 'demo';
process.env.TODAY = '2026-10-27';
process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'nbacache-'));
process.env.USERDATA_DIR = mkdtempSync(join(tmpdir(), 'nbaud-'));
const store = await import('../server/data/store.mjs');
const { createRoutes, dispatch } = await import('../server/routes.mjs');
const { grade } = await import('../server/data/entries.mjs');

const mem = [];
const routes = createRoutes({
  ...store, status: store.status,
  entries: { list: () => mem, add: (e) => { const x = { id: String(mem.length + 1), ...e }; mem.push(x); return x; }, update: () => null, remove: () => false },
});
const api = (method, path, body) => dispatch(routes, method, path, new URLSearchParams(path.split('?')[1] || ''), body);

const L = await store.getLeague();
const slate = await store.getSlate();
const starters = [...L.players.values()].filter((p) => slate.some((g) => g.home === p.team || g.away === p.team) && L.playerLogs(p.id).length > 60)
  .sort((a, b) => L.playerLogs(b.id).at(-1).min - L.playerLogs(a.id).at(-1).min);
const [A, B] = [starters[0], starters.find((p) => p.team !== starters[0].team)];

test('nested legs on one player are positively correlated; acca price multiplies', async () => {
  const legs = [
    { id: 1, playerId: A.id, stat: 'pts', side: 'over', line: 14.5, price: '4/6' },
    { id: 2, playerId: A.id, stat: 'pra', side: 'over', line: 24.5, price: '5/6' },
    { id: 3, playerId: B.id, stat: 'reb', side: 'under', line: 6.5, price: 1.9 },
  ];
  const a = await api('POST', '/api/slip/analyse', { legs });
  assert.equal(a.legs.length, 3);
  for (const l of a.legs) { assert.ok(l.pWin > 0 && l.pWin < 1); assert.ok(['VALUE', 'FAIR', 'AVOID'].includes(l.verdict)); }
  assert.ok(Math.abs(a.acca.price - (1 + 4 / 6) * (1 + 5 / 6) * 1.9) < 1e-9);
  assert.ok(a.acca.correlation > 1.05, `correlation ${a.acca.correlation}`);
  assert.ok(a.acca.pWin > a.acca.pIndependent);
  assert.ok(Math.abs(a.singles.winsDistribution.reduce((x, y) => x + y, 0) - 1) < 1e-9);
  assert.ok(a.flags.some((f) => /same player/.test(f.text)));
});

test('a terrible price is flagged as negative EV and AVOID', async () => {
  const a = await api('POST', '/api/slip/analyse', { legs: [{ id: 1, playerId: A.id, stat: 'pts', side: 'under', line: 0.5, price: 1.5 }] });
  assert.equal(a.legs[0].verdict, 'AVOID');
  assert.ok(a.flags.some((f) => f.level === 'bad'));
  assert.equal(a.acca, null);
});

test('placing an acca logs one bet; it settles from the legs', async () => {
  const legs = [
    { id: 1, playerId: A.id, stat: 'pts', side: 'over', line: 0.5, price: 1.05 },
    { id: 2, playerId: B.id, stat: 'reb', side: 'over', line: 0.5, price: 1.05 },
  ];
  const [e] = await api('POST', '/api/slip/place', { legs, mode: 'acca', accaStake: 10 });
  assert.equal(e.kind, 'acca');
  assert.equal(e.legs.length, 2);
  assert.ok(Math.abs(e.bet.price - 1.05 * 1.05) < 1e-9);
  assert.equal(grade(L, e).status, 'pending'); // tonight's game hasn't happened
  // pretend it was yesterday's game for a player who did play and score
  const played = L.playerLogs(A.id).at(-1);
  const past = { ...e, legs: [{ ...e.legs[0], date: played.date, team: played.team }, { ...e.legs[0], date: played.date, team: played.team }] };
  const r = grade(L, past);
  assert.equal(r.status, 'settled');
  assert.equal(r.betResult, played.pts > 0.5 ? 'win' : 'loss');
});

test('placing singles logs one bet per leg', async () => {
  const before = mem.length;
  await api('POST', '/api/slip/place', { legs: [{ id: 1, playerId: A.id, stat: 'ast', side: 'under', line: 9.5, price: '10/11', stake: 5 }], mode: 'singles' });
  assert.equal(mem.length, before + 1);
  assert.equal(mem.at(-1).bet.stake, 5);
});
