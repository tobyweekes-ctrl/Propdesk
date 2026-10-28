// The browser backend's data unpacking (web/js/expand.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandSeason } from '../web/js/expand.js';

test('expandSeason turns compact rows into box-score objects (booleans restored)', () => {
  const S = {
    season: '2025-26', source: 'ESPN', cols: ['playerId', 'date', 'home', 'starter', 'pts'],
    players: [['1', 'A B', 'BOS', 'G']],
    rows: [['1', '2025-11-01', 1, 0, 22], ['1', '2025-11-03', 0, 1, 9]],
  };
  const e = expandSeason(S);
  assert.deepEqual(e.players, [{ id: '1', name: 'A B', team: 'BOS', pos: 'G' }]);
  assert.deepEqual(e.games, [
    { playerId: '1', date: '2025-11-01', home: true, starter: false, pts: 22, season: '2025-26' },
    { playerId: '1', date: '2025-11-03', home: false, starter: true, pts: 9, season: '2025-26' },
  ]);
  assert.equal(e.season, '2025-26');
});

test('rows tagged with their season index the same as untagged ones, and are used as they are', async () => {
  const { indexLeague } = await import('../server/data/league.mjs');
  const S = (season) => ({
    season, source: 'ESPN', cols: ['playerId', 'gameId', 'date', 'team', 'opp', 'home', 'starter', 'min', 'pts', 'reb', 'ast', 'fg3m', 'fga', 'fta', 'tov', 'oreb'],
    players: [['1', 'A B', 'BOS', 'G'], ['2', 'C D', 'NYK', 'C']],
    rows: [['1', 'g1', '2025-11-01', 'BOS', 'NYK', 1, 1, 30, 20, 5, 4, 2, 15, 4, 2, 1], ['2', 'g1', '2025-11-01', 'NYK', 'BOS', 0, 1, 32, 18, 11, 2, 0, 14, 6, 3, 4]],
  });
  const plain = (s) => { const e = expandSeason(s); for (const g of e.games) delete g.season; return e; };
  const args = (f) => ({ current: '2026-27', previous: '2025-26', seasons: { '2026-27': f({ ...S('2026-27'), rows: [] }), '2025-26': f(S('2025-26')) }, today: '2026-10-28', source: 'ESPN' });
  const tagged = args(expandSeason);
  const a = indexLeague(tagged), b = indexLeague(args(plain));
  assert.deepEqual(a.playerLogs('1'), b.playerLogs('1'));
  assert.equal(a.playerLogs('1')[0].season, '2025-26');
  assert.equal(a.playerLogs('1')[0], tagged.seasons['2025-26'].games[0]); // no copy
});
