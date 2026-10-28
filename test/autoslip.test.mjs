import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoSlip, legFromPool } from '../web/js/autoslip.js';

const row = (o) => ({ playerId: 'p', name: 'A B', team: 'BOS', stat: 'pts', line: 20.5, over: 1.9, under: 1.9, book: 'DraftKings',
  side: null, leanSide: 'over', pLean: 0.55, evLean: 0.01, verdict: 'PASS', stale: false, ...o });

test('value slip: published picks only, best EV first, one per player, no CHECK', () => {
  const pool = [
    row({ playerId: 'a', side: 'over', evLean: 0.05, verdict: 'OVER' }),
    row({ playerId: 'a', stat: 'pra', side: 'under', leanSide: 'under', evLean: 0.09, verdict: 'UNDER' }),
    row({ playerId: 'b', side: 'over', evLean: 0.07, verdict: 'OVER' }),
    row({ playerId: 'c', evLean: 0.2, verdict: 'CHECK' }),
    row({ playerId: 'd', evLean: 0.03 }), // a lean, not a published pick
  ];
  const s = autoSlip(pool, 'value');
  assert.deepEqual(s.map((x) => `${x.playerId}:${x.stat}`), ['a:pra', 'b:pts']);
});

test('likely slip: highest model chance, skips poor prices and stale lines, capped at 10', () => {
  const pool = Array.from({ length: 14 }, (_, i) => row({ playerId: `p${i}`, pLean: 0.5 + i / 100, evLean: 0 }));
  pool.push(row({ playerId: 'bad', pLean: 0.95, evLean: -0.1 }), row({ playerId: 'old', pLean: 0.9, stale: true }));
  const s = autoSlip(pool, 'likely');
  assert.equal(s.length, 10);
  assert.equal(s[0].playerId, 'p13');
  assert.ok(!s.some((x) => x.playerId === 'bad' || x.playerId === 'old'));
});

test('leg uses the lean side and its price', () => {
  const l = legFromPool(row({ leanSide: 'under', over: 1.8, under: 2.05 }));
  assert.equal(l.side, 'under');
  assert.equal(l.price, 2.05);
  assert.equal(l.otherPrice, 1.8);
});
