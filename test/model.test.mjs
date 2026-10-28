import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countPmf, mixturePmf, lineProbs, normCdf } from '../server/model/distributions.mjs';
import { parsePrice, noVig, expectedValue } from '../server/model/odds.mjs';
import { evaluateLine, hitRates } from '../server/model/evaluate.mjs';
import { DEFAULTS, mergeConfig, parseOverride } from '../server/model/config.mjs';
import { seasonWeight } from '../server/model/blend.mjs';

const sum = (a) => a.reduce((x, y) => x + y, 0);

test('count pmfs sum to 1 with the right mean and variance', () => {
  const pois = countPmf(4, 0, 60);
  assert.ok(Math.abs(sum(pois) - 1) < 1e-9);
  assert.ok(Math.abs(sum(pois.map((p, x) => p * x)) - 4) < 1e-9);
  const nb = countPmf(20, 0.05, 200); // var = mu + mu^2/k = 20 + 400*0.05 = 40
  const m = sum(nb.map((p, x) => p * x));
  const v = sum(nb.map((p, x) => p * (x - m) ** 2));
  assert.ok(Math.abs(m - 20) < 1e-6 && Math.abs(v - 40) < 1e-4);
});

test('minutes mixture: mean = rate x minutes, wider than fixed minutes', () => {
  const fixed = mixturePmf({ ratePerMin: 0.6, minMean: 32, minSd: 0.001, invK: 0.03 });
  const mixed = mixturePmf({ ratePerMin: 0.6, minMean: 32, minSd: 6, invK: 0.03 });
  assert.ok(Math.abs(fixed.mean - 19.2) < 0.01);
  assert.ok(Math.abs(mixed.mean - 19.2) < 0.1);
  assert.ok(mixed.sd > fixed.sd);
});

test('line probabilities: half lines have no push, integer lines do', () => {
  const pmf = countPmf(10, 0, 60);
  const h = lineProbs(pmf, 9.5);
  assert.equal(h.push, 0);
  assert.ok(Math.abs(h.over + h.under - 1) < 1e-9);
  const i = lineProbs(pmf, 10);
  assert.ok(i.push > 0.1 && Math.abs(i.over + i.under + i.push - 1) < 1e-9);
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-7 && Math.abs(normCdf(1.96) - 0.975) < 1e-3);
});

test('price parsing: decimal, fractional, American, evens', () => {
  assert.equal(parsePrice('1.91'), 1.91);
  assert.ok(Math.abs(parsePrice('10/11') - 1.90909) < 1e-4);
  assert.equal(parsePrice('5/4'), 2.25);
  assert.ok(Math.abs(parsePrice('-110') - 1.90909) < 1e-4);
  assert.equal(parsePrice('+150'), 2.5);
  assert.equal(parsePrice('evens'), 2);
  assert.equal(parsePrice('0.9'), null);
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice('abc'), null);
});

test('no-vig removes the margin; one-sided uses the assumed margin', () => {
  const f = noVig(1.91, 1.91);
  assert.ok(Math.abs(f.over - 0.5) < 1e-9 && f.margin > 0.04);
  const p = noVig(1.5, 2.6, { method: 'power' });
  assert.ok(Math.abs(p.over + p.under - 1) < 1e-6);
  const one = noVig(2.0, null, { assumedMargin: 0.05 });
  assert.ok(one.estimated && Math.abs(one.over - 0.5 / 1.05) < 1e-9 && one.under === null);
  assert.ok(Math.abs(expectedValue(0.55, 0, 1.91) - (0.55 * 0.91 - 0.45)) < 1e-12);
});

test('verdict respects the threshold and EV; confidence scales with edge', () => {
  const sp = { pmf: countPmf(25, 0.03, 120) }; // mean 25
  const q = { score: 1, notes: [] };
  const cfg = DEFAULTS;
  // an edge over the 8% disagreement bar against a fair two-sided market is a warning, not a pick
  const huge = evaluateLine(sp, { line: 20.5, over: 1.91, under: 1.91 }, q, cfg);
  assert.deepEqual([huge.verdict, huge.side, huge.disagree], ['CHECK', null, true]);
  // between the threshold and the disagreement bar it is a pick
  const loose = mergeConfig(cfg, { marketDisagreement: 0.5 });
  const over = evaluateLine(sp, { line: 22.5, over: 1.91, under: 1.91 }, q, loose);
  assert.equal(over.verdict, 'OVER');
  assert.equal(over.confidence, 'HIGH');
  // a stale price is never the pick
  assert.equal(evaluateLine(sp, { line: 22.5, over: 1.91, under: 1.91, stale: true }, q, loose).side, null);
  const pass = evaluateLine(sp, { line: 24.5, over: 1.91, under: 1.91 }, q, cfg);
  assert.equal(pass.verdict, 'PASS');
  const under = evaluateLine(sp, { line: 30.5, over: '10/11', under: '10/11' }, q, loose);
  assert.equal(under.verdict, 'UNDER');
  // big edge vs no-vig but a huge margin (1.25 both sides) -> EV < 0 -> no bet
  const bad = evaluateLine(sp, { line: 20.5, over: 1.25, under: 1.25 }, q, loose);
  assert.ok(bad.edge.over > 0.04 && bad.ev.over < 0);
  assert.equal(bad.verdict, 'PASS');
  // higher threshold turns a bet into a pass
  assert.equal(evaluateLine(sp, { line: 22.5, over: 1.91, under: 1.91 }, q, mergeConfig(loose, { threshold: 0.5 })).verdict, 'PASS');
});

test('hit rates vs exact line', () => {
  const logs = [10, 20, 30, 25, 15, 22].map((pts, i) => ({ pts, season: i < 2 ? '2025-26' : '2026-27' }));
  const h = hitRates(logs, 'pts', 20.5, '2026-27');
  assert.deepEqual([h.last5.n, h.last5.over], [5, 3]);
  assert.deepEqual([h.season.n, h.season.over], [4, 3]);
  assert.deepEqual([h.lastSeason.n, h.lastSeason.over], [2, 0]);
});

test('config overrides and season weight', () => {
  assert.deepEqual(parseOverride('recency.last5=0.3'), { recency: { last5: 0.3 } });
  const c = mergeConfig(DEFAULTS, parseOverride('blend.rateK=6'));
  assert.equal(c.blend.rateK, 6);
  assert.equal(c.blend.minutesK, DEFAULTS.blend.minutesK);
  assert.equal(seasonWeight(0, 12), 0);
  assert.ok(Math.abs(seasonWeight(12, 12) - 0.5) < 1e-12);
});

// ---- integration on the demo league ----
process.env.STATS_PROVIDER = 'demo';
process.env.TODAY = '2026-10-27';
process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'nbacache-'));
process.env.USERDATA_DIR = mkdtempSync(join(tmpdir(), 'nbaud-'));
const store = await import('../server/data/store.mjs');
const { analyse, buildContext, projectPlayer } = await import('../server/model/index.mjs');
const { demoInternals } = await import('../server/providers/demo.mjs');
const L = await store.getLeague();

test('analyse: full output for a player on tonight\'s slate', async () => {
  const slate = await store.getSlate();
  const team = slate[0].home;
  const p = [...L.players.values()].find((x) => x.team === team && L.playerLogs(x.id).length > 40);
  const lines = (await store.getPlayerLines(p, 'pra')).lines;
  const a = analyse({ L, playerId: p.id, game: { date: L.today, team, opp: slate[0].away, home: true }, stat: 'pra', lines });
  assert.ok(a.projection.mean > 5 && a.projection.minutes.proj > 10);
  assert.equal(a.evals.length, lines.length);
  for (const e of a.evals) assert.ok(['OVER', 'UNDER', 'PASS', 'CHECK'].includes(e.verdict));
  assert.ok(a.hitRates.last10.n === 10);
  assert.ok(Math.abs(a.projection.pmf.reduce((x, y) => x + y, 0) - 1) < 0.01);
});

test('minutes: teammate out raises minutes; return ramp lowers them', () => {
  const p = [...L.players.values()].find((x) => L.playerLogs(x.id).length > 60 && L.groupOf(x.id) === 'G');
  const game = { date: L.today, team: p.team, opp: p.team === 'BOS' ? 'NYK' : 'BOS', home: true };
  const base = projectPlayer(buildContext(L, p.id, game), DEFAULTS).minutes.proj;
  const ctx0 = buildContext(L, p.id, game);
  const mate = ctx0.availableMates.sort((a, b) => b.min - a.min)[0];
  const withOut = projectPlayer(buildContext(L, p.id, game, { teammatesOut: [mate.id] }), DEFAULTS).minutes;
  assert.ok(withOut.proj > base, `${withOut.proj} > ${base}`);
  assert.ok(withOut.steps.some((s) => s.key === `mate:${mate.id}`));

  const ret = demoInternals.storyPlayer(demoInternals.STORY.find((s) => s[2] === 'returning'));
  const m = projectPlayer(buildContext(L, ret.id, { date: L.today, team: ret.team, opp: 'BOS', home: true }), DEFAULTS).minutes;
  assert.ok(m.restricted && m.steps.some((s) => s.key === 'restriction'));
});

test('a teammate out since opening night is not treated as new information', async () => {
  const injuries = await store.getInjuries();
  const outName = injuries.find((i) => i.status === 'Out' && L.playerLogs([...L.players.values()].find((p) => p.name === i.name).id).every((r) => r.season !== L.current))?.name;
  assert.ok(outName, 'demo has a player out all season');
  const mate = [...L.players.values()].find((p) => p.name === outName);
  const star = [...L.players.values()].filter((p) => p.team === mate.team && p.id !== mate.id && L.playerLogs(p.id).filter((r) => r.season === L.current).length >= 2)[0];
  const ctx = buildContext(L, star.id, { date: L.today, team: star.team, opp: 'BOS', home: true }, { injuries });
  assert.ok(!ctx.teammatesOut.some((m) => m.id === mate.id));
});

test('config override can set one element of an array', () => {
  const base = { cap: [0.95, 1.05] };
  const c = mergeConfig(base, parseOverride('cap.1=1.08'));
  assert.ok(Array.isArray(c.cap));
  assert.deepEqual(c.cap, [0.95, 1.08]);
});

test('context notes: every section present, tones valid, matchup facts match the context', () => {
  const p = [...L.players.values()].find((x) => L.playerLogs(x.id).length > 60 && L.groupOf(x.id) === 'C');
  const game = { date: L.today, team: p.team, opp: p.team === 'BOS' ? 'NYK' : 'BOS', home: false };
  const ctx0 = buildContext(L, p.id, game);
  const mate = ctx0.availableMates.sort((a, b) => b.min - a.min)[0];
  const a = analyse({ L, playerId: p.id, game, stat: 'reb', opts: { teammatesOut: [mate.id] } });
  const n = a.notes;
  assert.deepEqual(n.sections.map((s) => s.title), ['Availability', `History vs ${game.opp}`, `${game.opp} defence`, 'Game script']);
  for (const s of n.sections) {
    assert.ok(s.notes.length, `${s.title} has notes`);
    for (const x of s.notes) { assert.ok(['up', 'down', 'flat', 'info'].includes(x.tone)); assert.ok(x.title && x.text && !/undefined|NaN/.test(x.title + x.text), x.text); }
  }
  assert.ok(n.sections[0].notes.some((x) => x.key === `mate:${mate.id}` && x.title.includes(mate.name)));
  const h2h = n.sections[1].notes[0];
  assert.ok(ctx0.h2hRows.length ? h2h.text.startsWith(`${ctx0.h2hRows.length} game`) : h2h.key === 'h2h-none');
  assert.ok(/^Tonight.s context/.test(n.summary.text));
  // an absent player gets a first-game-back note
  const ret = demoInternals.storyPlayer(demoInternals.STORY.find((s) => s[2] === 'returning'));
  const r = analyse({ L, playerId: ret.id, game: { date: L.today, team: ret.team, opp: 'BOS', home: true }, stat: 'pts' });
  assert.ok(r.notes.sections[0].notes.some((x) => x.key === 'returned' || x.key === 'absent'));
});

test('absence impact: a teammate out raises minutes and output against the no-absence projection', async () => {
  const { absenceImpact } = await import('../server/model/impact.mjs');
  const p = [...L.players.values()].find((x) => L.playerLogs(x.id).length > 60 && L.groupOf(x.id) === 'G');
  const game = { date: L.today, team: p.team, opp: p.team === 'BOS' ? 'NYK' : 'BOS', home: true };
  const mate = buildContext(L, p.id, game).availableMates.sort((a, b) => b.min - a.min)[0];
  const injuries = [{ name: mate.name, team: p.team, status: 'Out', injury: 'Knee' }];
  const i = absenceImpact(L, p.id, game, injuries, DEFAULTS);
  assert.deepEqual(i.outs.map((o) => o.id), [mate.id]);
  assert.ok(i.minutes.with > i.minutes.without, `${i.minutes.with} > ${i.minutes.without}`);
  assert.ok(i.pts.with > i.pts.without);
  assert.equal(absenceImpact(L, p.id, game, [], DEFAULTS), null); // nobody out: nothing to report
});

test('recent results mix into the distribution: a share of the last 20, total probability kept', async () => {
  const { mixRecent } = await import('../server/model/projection.mjs');
  const dist = { pmf: [0.5, 0.5], mean: 0.5, sd: 0.5 };
  const m = mixRecent(dist, Array(10).fill(2), 0.2);
  assert.ok(Math.abs(m.pmf.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.deepEqual(m.pmf.map((x) => Math.round(x * 100) / 100), [0.4, 0.4, 0.2]);
  assert.ok(Math.abs(m.mean - 0.8) < 1e-12);
  assert.equal(mixRecent(dist, [1, 2, 3], 0.2), dist); // fewer than 10 games: unchanged
});
