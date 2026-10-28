// Generated slips from tonight's priced lines (one game or the whole slate).
//   value:  the best expected-value picks the model publishes
//   likely: the legs the model thinks most likely to land, at fair prices or better
// One leg per player (PRA, P+A and points on the same player rise and fall together), no lines the
// model flags CHECK (it disagrees with the market by more than the bar) and no stale prices.

export const AUTO_MODES = {
  value: { label: 'Value slip', blurb: 'best expected value' },
  likely: { label: 'Top 10 most likely', blurb: 'highest model chance' },
};

/**
 * @param pool  priced lines: {playerId, name, team, stat, line, over, under, book, side, leanSide, pLean, evLean, verdict, stale}
 * @param mode  'value' | 'likely'
 * @param opts.legs  max legs (default 10)
 * @param opts.minEv  'likely' only: lowest EV allowed (default 0: no legs the model expects to lose on)
 */
export function autoSlip(pool, mode, { legs = 10, minEv = 0 } = {}) {
  const ok = pool.filter((x) => !x.stale && x.verdict !== 'CHECK' && x.leanSide);
  const ranked = mode === 'value'
    ? ok.filter((x) => x.side).sort((a, b) => b.evLean - a.evLean)
    : ok.filter((x) => x.evLean >= minEv).sort((a, b) => b.pLean - a.pLean || b.evLean - a.evLean);
  const seen = new Set();
  const out = [];
  for (const x of ranked) {
    if (seen.has(x.playerId)) continue;
    seen.add(x.playerId);
    out.push(x);
    if (out.length >= legs) break;
  }
  return out;
}

/** Slip leg (same shape the betslip uses) for a pool entry. */
export const legFromPool = (x) => ({
  playerId: x.playerId, playerName: x.name, team: x.team, stat: x.stat, kind: 'ou', side: x.leanSide, line: x.line,
  price: x.leanSide === 'over' ? x.over : x.under, otherPrice: x.leanSide === 'over' ? x.under : x.over, book: x.book,
});
