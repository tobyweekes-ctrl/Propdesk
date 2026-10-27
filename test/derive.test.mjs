import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posGroup, teamGames, absenceInfo, restDays, positionDefense } from '../server/data/derive.mjs';

test('posGroup', () => {
  assert.equal(posGroup('G'), 'G');
  assert.equal(posGroup('G-F'), 'G');
  assert.equal(posGroup('F-C'), 'F');
  assert.equal(posGroup('C-F'), 'C');
  assert.equal(posGroup('Center'), 'C');
  assert.equal(posGroup(''), 'F');
});

const row = (playerId, gameId, date, team, opp, extra = {}) => ({ playerId, gameId, date, team, opp, home: true, min: 24, pts: 10, reb: 5, ast: 3, fg3m: 1, fg3a: 3, fgm: 4, fga: 9, ftm: 1, fta: 2, oreb: 1, dreb: 4, tov: 1, ...extra });

test('teamGames aggregates and computes pace with opponent', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push(row(`a${i}`, 'g1', '2026-10-22', 'AAA', 'BBB'), row(`b${i}`, 'g1', '2026-10-22', 'BBB', 'AAA', { home: false }));
  const [t] = teamGames(rows);
  assert.equal(t.pts, 100);
  assert.equal(t.oppPts, 100);
  assert.equal(t.min, 240);
  // poss per team = 90 + 0.44*20 - 10 + 10 = 98.8
  assert.ok(Math.abs(t.pace - 98.8) < 1e-9);
});

test('absenceInfo: absent, returned, active', () => {
  const tg = ['01', '03', '05', '07', '09', '11'].map((d, i) => ({ gameId: `g${i}`, date: `2026-11-${d}`, team: 'T' }));
  const r = (i) => ({ gameId: `g${i}`, date: tg[i].date, team: 'T', min: 20 + i });
  assert.equal(absenceInfo([0, 1, 2, 3, 4, 5].map(r), tg, '2026-11-20').status, 'active');
  const absent = absenceInfo([0, 1, 2].map(r), tg, '2026-11-20');
  assert.deepEqual([absent.status, absent.gamesMissed], ['absent', 3]);
  const back = absenceInfo([0, 1, 4, 5].map(r), tg, '2026-11-20');
  assert.deepEqual([back.status, back.gamesMissed, back.gamesSinceReturn, back.minutesSinceReturn], ['returned', 2, 2, [24, 25]]);
});

test('restDays', () => {
  assert.equal(restDays(['2026-11-01', '2026-11-03'], '2026-11-04'), 0);
  assert.equal(restDays(['2026-11-01'], '2026-11-04'), 2);
  assert.equal(restDays([], '2026-11-04'), null);
});

test('positionDefense shrinks toward 1 and spots a soft defence', () => {
  const rows = [];
  for (let g = 0; g < 40; g++) {
    rows.push(row('c1', `g${g}`, '2026-11-01', 'X', 'SOFT', { min: 30, pts: 20 }));
    rows.push(row('c2', `h${g}`, '2026-11-01', 'Y', 'HARD', { min: 30, pts: 10 }));
  }
  const pd = positionDefense(rows, () => 'C', { priorMin: 600 });
  assert.ok(pd.SOFT.C.pts > 1.1 && pd.SOFT.C.pts < 4 / 3);
  assert.ok(pd.HARD.C.pts < 0.9 && pd.HARD.C.pts > 2 / 3);
});

test('absenceInfo: a player who changed team is not "missing" his new team\'s old games', () => {
  const oldTeam = [{ gameId: 'o1', date: '2026-03-01' }, { gameId: 'o2', date: '2026-03-03' }];
  const newTeam = [{ gameId: 'n0', date: '2026-03-02' }, { gameId: 'n00', date: '2026-03-04' }, // before he arrived
    { gameId: 'n1', date: '2026-10-21' }, { gameId: 'n2', date: '2026-10-23' }, { gameId: 'n3', date: '2026-10-25' }];
  for (const g of oldTeam) g.team = 'OLD';
  for (const g of newTeam) g.team = 'NEW';
  // his old team also played his new team once (shared game id 'n0')
  const rows = [{ ...newTeam[0], team: 'OLD' }, ...oldTeam, ...newTeam.slice(2)].map((g, i) => ({ gameId: g.gameId, date: g.date, team: g.team, min: 30 + i }))
    .sort((a, b) => a.date.localeCompare(b.date));
  assert.equal(absenceInfo(rows, newTeam, '2026-10-27').status, 'active');
  // a real absence with the new team still shows up
  const missed = rows.filter((r) => r.gameId !== 'n2');
  const a = absenceInfo(missed, newTeam, '2026-10-27');
  assert.deepEqual([a.status, a.gamesMissed, a.gamesSinceReturn], ['returned', 1, 1]);
});
