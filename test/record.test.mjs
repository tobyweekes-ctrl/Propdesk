import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePicks, gradeRecord, pickKey } from '../server/model/record.mjs';

const pick = (o) => ({ playerId: 'p1', team: 'AAA', stat: 'pts', book: 'DraftKings', line: 20.5, side: 'over', over: 1.91, under: 1.91, pWin: 0.6, ev: 0.1, confidence: 'MEDIUM', tipoff: '2026-11-01T23:30:00Z', ...o });

test('mergePicks keeps the first price and tracks the close until tip-off', () => {
  let day = mergePicks({}, [pick({})], '2026-11-01T13:00:00Z');
  day = mergePicks(day, [pick({ over: 1.8, under: 2.02 })], '2026-11-01T22:00:00Z');
  day = mergePicks(day, [pick({ over: 1.5, under: 2.6 })], '2026-11-02T01:00:00Z'); // after tip: ignored
  const p = day[pickKey(pick({}))];
  assert.equal(p.over, 1.91);
  assert.deepEqual([p.close.over, p.close.under], [1.8, 2.02]);
  assert.equal(p.firstSeen, '2026-11-01T13:00:00Z');
});

test('gradeRecord settles picks, computes hit rate, ROI, calibration and CLV', () => {
  const L = {
    today: '2026-11-03',
    playerLogs: (id) => ({ p1: [{ date: '2026-11-01', pts: 25 }, { date: '2026-11-02', pts: 10 }], p2: [] }[id] || []),
    teamDates: new Map([['AAA', ['2026-11-01', '2026-11-02']], ['BBB', ['2026-11-02']]]),
  };
  const won = { ...pick({}), firstSeen: 'a', close: { over: 1.8, under: 2.02, at: 'b' } };          // market moved our way
  const lost = { ...pick({ line: 15.5 }), firstSeen: 'a', close: { over: 1.91, under: 1.91, at: 'a' } };
  const voidP = { ...pick({ playerId: 'p2', team: 'BBB' }) };
  const pass = { ...pick({ side: null, line: 30.5 }) };
  const future = { ...pick({ line: 18.5 }) };
  const r = gradeRecord(L, {
    '2026-11-01': { a: won, p: pass },
    '2026-11-02': { b: lost, v: voidP },
    '2026-11-03': { f: future },
  });
  assert.equal(r.overall.settled, 2);
  assert.equal(r.overall.won, 1);
  assert.equal(r.overall.hitRate, 0.5);
  assert.ok(Math.abs(r.overall.roi - (0.91 - 1) / 2) < 1e-9);
  assert.equal(r.pending, 1);
  assert.ok(r.recent.some((g) => g.result === 'void'));
  assert.equal(r.clv.n, 1);           // the pick whose close was never updated doesn't count
  assert.ok(r.clv.avg > 0);
  assert.equal(r.calibration.length, 1);
  assert.equal(r.since, '2026-11-01');
});

test('gradeRecord breaks results down by stat, side, game and day, with running profit', () => {
  const L = {
    today: '2026-11-03',
    playerLogs: (id) => [{ date: '2026-11-01', pts: 25, reb: 3 }, { date: '2026-11-02', pts: 10, reb: 9 }],
    teamDates: new Map([['AAA', ['2026-11-01', '2026-11-02']]]),
  };
  const g = { opp: 'BBB', home: true };
  const r = gradeRecord(L, {
    '2026-11-01': { a: pick({ ...g, line: 20.5 }), b: pick({ ...g, playerId: 'p2', stat: 'reb', line: 5.5, side: 'under' }) }, // win, win
    '2026-11-02': { c: pick({ ...g, line: 15.5 }), d: pick({ ...g, playerId: 'p2', stat: 'reb', line: 5.5, side: 'under' }) }, // loss, loss
  });
  assert.deepEqual(r.byStat.pts && [r.byStat.pts.settled, r.byStat.pts.won], [2, 1]);
  assert.deepEqual([r.bySide.over.won, r.bySide.under.won], [1, 1]);
  assert.equal(r.byGame.length, 2);
  assert.equal(r.byGame[0].label, 'BBB @ AAA');
  assert.equal(r.byGame[0].date, '2026-11-02');
  assert.deepEqual(r.byDay.map((d) => [d.date, d.won, d.settled]), [['2026-11-01', 2, 2], ['2026-11-02', 0, 2]]);
  const up = 2 * 0.91;
  assert.ok(Math.abs(r.byDay[0].cumProfit - up) < 1e-9);
  assert.ok(Math.abs(r.byDay[1].cumProfit - (up - 2)) < 1e-9);
});

test('one pick per player per game: the best-value one counts, the rest are not double-counted', () => {
  const L = {
    today: '2026-11-03',
    playerLogs: (id) => ({ p1: [{ date: '2026-11-01', pts: 25, reb: 9 }], p2: [{ date: '2026-11-01', pts: 5 }] }[id] || []),
    teamDates: new Map([['AAA', ['2026-11-01']]]),
  };
  const r = gradeRecord(L, {
    '2026-11-01': {
      a: pick({ line: 20.5, ev: 0.05 }),                            // p1 pts over: win, lower EV
      b: pick({ stat: 'pra', line: 30.5, ev: 0.09, side: 'under' }), // p1 PRA under: loss, best EV -> counts
      c: pick({ playerId: 'p2', line: 9.5, ev: 0.04, side: 'under' }),
    },
    '2026-11-03': { d: pick({ ev: 0.02 }), e: pick({ stat: 'reb', line: 5.5, ev: 0.03 }) },
  });
  assert.equal(r.overall.settled, 2);
  assert.equal(r.overall.won, 1);
  assert.ok(r.recent.find((g) => g.playerId === 'p1').stat === 'pra');
  assert.equal(r.pending, 1);
  assert.equal(r.upcoming.length, 1);
  assert.equal(r.upcoming[0].stat, 'reb');
});

test('closing-line value split into beat, same and worse', () => {
  const L = { today: '2026-11-03', playerLogs: () => [{ date: '2026-11-01', pts: 25 }], teamDates: new Map([['AAA', ['2026-11-01']]]) };
  const mk = (id, closeOver, closeUnder) => ({ ...pick({ playerId: id }), firstSeen: 'a', close: { over: closeOver, under: closeUnder, at: 'b' } });
  const r = gradeRecord(L, { '2026-11-01': { a: mk('p1', 1.8, 2.02), b: mk('p2', 1.91, 1.91), c: mk('p3', 2.02, 1.8) } });
  assert.deepEqual([r.clv.beat, r.clv.same, r.clv.worse], [1, 1, 1]);
});
