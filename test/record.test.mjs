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
