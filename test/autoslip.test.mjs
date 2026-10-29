import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoSlip, legFromPool, slipChance } from '../web/js/autoslip.js';

const row = (o) => ({ gameId: 'g1', playerId: 'p', name: 'A B', team: 'BOS', stat: 'pts', line: 20.5, over: 1.9, under: 1.9, book: 'DraftKings',
  side: null, leanSide: 'over', pLean: 0.55, evLean: 0.01, verdict: 'PASS', stale: false, ...o });

test('singles: published picks only, best EV first, one per player, no CHECK', () => {
  const pool = [
    row({ playerId: 'a', side: 'over', evLean: 0.05, verdict: 'OVER' }),
    row({ playerId: 'a', stat: 'pra', side: 'under', leanSide: 'under', evLean: 0.09, verdict: 'UNDER', gameId: 'g2' }),
    row({ playerId: 'b', side: 'over', evLean: 0.07, verdict: 'OVER', gameId: 'g3' }),
    row({ playerId: 'c', evLean: 0.2, verdict: 'CHECK' }),
    row({ playerId: 'd', evLean: 0.03 }), // a lean, not a published pick
  ];
  assert.deepEqual(autoSlip(pool, 'singles').map((x) => `${x.playerId}:${x.stat}`), ['a:pra', 'b:pts']);
});

test('singles: at most 2 from one game across the slate, 6 in all; up to 3 when built for one game', () => {
  const pool = Array.from({ length: 12 }, (_, i) => row({ playerId: `p${i}`, gameId: `g${i % 4}`, side: 'over', verdict: 'OVER', evLean: 0.1 - i / 200 }));
  const all = autoSlip(pool, 'singles');
  assert.equal(all.length, 6);
  for (const g of ['g0', 'g1', 'g2', 'g3']) assert.ok(all.filter((x) => x.gameId === g).length <= 2);
  const one = autoSlip(pool.filter((x) => x.gameId === 'g0'), 'singles', { perGame: 3 });
  assert.equal(one.length, 3);
});

test('small acca: one leg per game, 3 legs at most, the likeliest value pick in each game, never one game', () => {
  const pool = [
    row({ playerId: 'a', gameId: 'g1', side: 'over', verdict: 'OVER', pLean: 0.58, evLean: 0.05 }),
    row({ playerId: 'b', gameId: 'g1', side: 'over', verdict: 'OVER', pLean: 0.62, evLean: 0.04 }),
    row({ playerId: 'c', gameId: 'g2', side: 'over', verdict: 'OVER', pLean: 0.57, evLean: 0.06 }),
    row({ playerId: 'd', gameId: 'g3', side: 'over', verdict: 'OVER', pLean: 0.6, evLean: 0.05 }),
    row({ playerId: 'e', gameId: 'g4', side: 'over', verdict: 'OVER', pLean: 0.52, evLean: 0.05 }),
    row({ playerId: 'f', gameId: 'g5', pLean: 0.9, evLean: 0.01 }), // not a published pick
  ];
  const s = autoSlip(pool, 'acca');
  assert.deepEqual(s.map((x) => x.playerId), ['b', 'd', 'c']);
  assert.equal(new Set(s.map((x) => x.gameId)).size, s.length);
  assert.ok(Math.abs(slipChance(s) - 0.62 * 0.6 * 0.57) < 1e-12);
  assert.deepEqual(autoSlip(pool.filter((x) => x.gameId === 'g1'), 'acca'), []); // one game: no acca
});

test('leg uses the lean side and its price', () => {
  const l = legFromPool(row({ leanSide: 'under', over: 1.8, under: 2.05 }));
  assert.equal(l.side, 'under');
  assert.equal(l.price, 2.05);
  assert.equal(l.otherPrice, 1.8);
});
