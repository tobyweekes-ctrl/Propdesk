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
