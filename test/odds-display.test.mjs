// Fractional odds display (web/js/ui.js): offered prices never rounded in the bettor's favour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toFrac } from '../web/js/ui.js';

test('offered prices round down to the next standard fraction', () => {
  assert.equal(toFrac(2.06), '21/20');      // was shown as 11/10 (2.10)
  assert.equal(toFrac(2.1), '11/10');       // exact stays exact
  assert.equal(toFrac(1.909), '10/11');     // -110 converted
  assert.equal(toFrac(2.0), 'EVS');
  assert.equal(toFrac(1.025), '1/40');
  assert.equal(toFrac(6.4), '5/1');         // 5.4/1 is not 11/2
  assert.equal(toFrac(1.95), '20/21');
});

test('thresholds round up: the price you need at least', () => {
  assert.equal(toFrac(2.06, 'up'), '11/10');
  assert.equal(toFrac(1.909, 'up'), '10/11');
  assert.equal(toFrac(6.4, 'up'), '11/2');
  assert.equal(toFrac(2.0, 'up'), 'EVS');
});

test('beyond the ladder, long and short prices still follow the direction', () => {
  assert.equal(toFrac(250, 'down'), '200/1');
  assert.equal(toFrac(1.004, 'down'), '1/250');
  assert.equal(toFrac(1, 'down'), '–');
});

test('the model snaps feed prices to the same fraction the page shows (so EV is at the price on screen)', async () => {
  const { snapDown } = await import('../server/model/odds.mjs');
  const fracToDec = (f) => (f === 'EVS' ? 2 : 1 + Number(f.split('/')[0]) / Number(f.split('/')[1]));
  for (let d = 1.01; d < 60; d = Math.round((d * 1.013 + 0.001) * 1000) / 1000) {
    assert.ok(Math.abs(snapDown(d) - fracToDec(toFrac(d))) < 1e-9, `${d}: snap ${snapDown(d)} vs shown ${toFrac(d)}`);
  }
  assert.ok(Math.abs(snapDown(1.66) - (1 + 8 / 13)) < 1e-9); // the review's case: 8/13 shown, 8/13 used
});

test('league lines carry snapped prices; the ladder check runs on the raw ones', async () => {
  const { linesFor, ladderFor } = await import('../server/data/league.mjs');
  const p = { id: '1', name: 'A B' };
  const rows = [
    { stat: 'reb', kind: 'ou', playerId: '1', book: 'dk', bookTitle: 'DraftKings', line: 2.5, over: 2.3, under: 1.66 },
    { stat: 'reb', kind: 'ms', playerId: '1', book: 'dk', bookTitle: 'DraftKings', line: 3, over: 2.06 },
    { stat: 'reb', kind: 'ms', playerId: '1', book: 'dk', bookTitle: 'DraftKings', line: 4, over: 2.08 }, // same fraction once snapped
  ];
  const [l] = linesFor(rows, p, 'reb');
  assert.ok(Math.abs(l.under - (1 + 8 / 13)) < 1e-9);
  assert.equal(l.rawUnder, 1.66);
  const lad = ladderFor(rows, p, 'reb');
  assert.equal(lad.length, 2);
  assert.ok(Math.abs(lad[0].price - 2.05) < 1e-9);
});

test('tip-off times read as a UK user expects: 24-hour clock, after-midnight games belong to the night before', async () => {
  const { tipLabel } = await import('../web/js/ui.js');
  process.env.TZ = 'UTC'; // London is on GMT in late October
  const now = Date.parse('2026-10-29T13:00:00Z'); // Thursday afternoon
  assert.equal(tipLabel('2026-10-30T00:00:00Z', now), 'Thu night · 00:00 · in 11h');
  assert.equal(tipLabel('2026-10-29T23:30:00Z', now), 'Thu · 23:30 · in 10h 30m');
  assert.equal(tipLabel('2026-10-30T02:30:00Z', now), 'Thu night · 02:30 · in 13h 30m');
  assert.equal(tipLabel('2026-10-29T12:30:00Z', now), 'Thu · 12:30 · started');
});
