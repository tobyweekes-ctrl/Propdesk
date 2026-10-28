// Price parsing, implied probability, vig removal, expected value.

/** Accepts decimal "1.91", fractional "10/11", American "-110"/"+150", "evens". Returns decimal or null. */
export function parsePrice(input) {
  if (input == null || input === '') return null;
  if (typeof input === 'number') return input > 1 ? input : null;
  const s = String(input).trim().toLowerCase();
  if (s === 'evens' || s === 'evs' || s === 'even') return 2;
  let m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (m) return Number(m[2]) > 0 ? 1 + Number(m[1]) / Number(m[2]) : null;
  m = s.match(/^([+-])(\d+(?:\.\d+)?)$/);
  if (m) {
    const n = Number(m[2]);
    if (n < 100) return null;
    return m[1] === '+' ? 1 + n / 100 : 1 + 100 / n;
  }
  const d = Number(s);
  return Number.isFinite(d) && d > 1 ? d : null;
}

export const implied = (dec) => (dec ? 1 / dec : null);

/**
 * Fair (no-vig) probabilities for a two-way market.
 * With only one price, the margin is assumed (`assumedMargin`) and the result is flagged.
 */
export function noVig(over, under, { method = 'multiplicative', assumedMargin = 0.05 } = {}) {
  const io = implied(over), iu = implied(under);
  if (io && iu) {
    const overround = io + iu;
    if (method === 'power') {
      // solve io^k + iu^k = 1 for k by bisection
      let lo = 0.5, hi = 2;
      for (let i = 0; i < 60; i++) {
        const k = (lo + hi) / 2;
        if (io ** k + iu ** k > 1) lo = k; else hi = k;
      }
      const k = (lo + hi) / 2;
      return { over: io ** k, under: iu ** k, margin: overround - 1, estimated: false };
    }
    return { over: io / overround, under: iu / overround, margin: overround - 1, estimated: false };
  }
  if (io) return { over: Math.min(0.99, io / (1 + assumedMargin)), under: null, margin: assumedMargin, estimated: true };
  if (iu) return { over: null, under: Math.min(0.99, iu / (1 + assumedMargin)), margin: assumedMargin, estimated: true };
  return null;
}

/** Expected profit per 1 unit staked. Push returns the stake. */
export function expectedValue(pWin, pPush, decimal) {
  if (!decimal || pWin == null) return null;
  const pLose = 1 - pWin - (pPush || 0);
  return pWin * (decimal - 1) - pLose;
}

// The standard UK fractional ladder. Prices on offer are snapped DOWN to it before anything is worked out,
// so the edge, EV and verdict are for the price the page shows (web/js/ui.js toFrac uses the same ladder and
// tolerance; a test holds the two together).
const LADDER = [[1, 250], [1, 200], [1, 100], [1, 66], [1, 50], [1, 40], [1, 33], [1, 25], [1, 20], [1, 16], [1, 14], [1, 12], [1, 11], [1, 10], [1, 9], [1, 8],
  [2, 15], [1, 7], [1, 6], [2, 11], [1, 5], [2, 9], [1, 4], [2, 7], [3, 10], [1, 3], [4, 11], [2, 5], [4, 9], [1, 2], [8, 15], [4, 7], [8, 13], [4, 6],
  [8, 11], [4, 5], [5, 6], [10, 11], [20, 21], [1, 1], [21, 20], [11, 10], [6, 5], [5, 4], [11, 8], [6, 4], [13, 8], [7, 4], [15, 8], [2, 1], [85, 40],
  [9, 4], [5, 2], [11, 4], [3, 1], [10, 3], [7, 2], [4, 1], [9, 2], [5, 1], [11, 2], [6, 1], [13, 2], [7, 1], [15, 2], [8, 1], [17, 2], [9, 1], [10, 1],
  [11, 1], [12, 1], [14, 1], [16, 1], [18, 1], [20, 1], [22, 1], [25, 1], [28, 1], [33, 1], [40, 1], [50, 1], [66, 1], [80, 1], [100, 1], [150, 1], [200, 1]];
// feeds give decimals to 2 places (10/11 arrives as 1.91): within that rounding counts as on the fraction
const eps = (v) => Math.min(0.005, v * 0.02);

/** Decimal price -> the decimal of the largest standard fraction that doesn't pay more. */
export function snapDown(dec) {
  if (!dec || dec <= 1) return dec;
  const v = dec - 1;
  let f = null;
  for (const x of LADDER) if (x[0] / x[1] <= v + eps(v)) f = x;
  return f ? 1 + f[0] / f[1] : 1 + 1 / Math.ceil(1 / v - 1e-9);
}
