// Generated slips from tonight's priced lines (one game or the whole slate).
//   singles: the best expected-value picks as separate bets (one per player, at most 2 per game across the slate)
//   acca:    a small accumulator, one value pick from each of up to 3 different games (the likeliest in each)
// Long accumulators are left out on purpose: ten 55% legs land together about 1 time in 400, every leg's model
// error and bookmaker margin multiply, and legs from the same game move together, which the acca maths can't fully
// price. No lines the model flags CHECK, no stale prices, and only picks the model publishes.

export const AUTO_MODES = {
  singles: { label: 'Best singles', blurb: 'separate bets, best value first' },
  acca: { label: 'Small acca', blurb: 'one pick from each of up to 3 games' },
};

/** Chance every leg lands, treating legs from different games as independent. */
export const slipChance = (legs) => legs.reduce((a, x) => a * x.pLean, 1);

/**
 * @param pool  priced lines: {gameId, playerId, name, team, stat, line, over, under, book, side, leanSide, pLean, evLean, verdict, stale}
 * @param mode  'singles' | 'acca'
 * @param opts.legs     singles: most legs (default 6)
 * @param opts.perGame  singles: most legs from one game (default 2)
 */
export function autoSlip(pool, mode, { legs = 6, perGame = 2 } = {}) {
  const ok = pool.filter((x) => !x.stale && x.verdict !== 'CHECK' && x.side);
  const seen = new Set();
  const games = new Map();
  const out = [];
  if (mode === 'acca') {
    // the likeliest value pick in each game, then the 3 likeliest games
    for (const x of ok.sort((a, b) => b.pLean - a.pLean || b.evLean - a.evLean)) if (!games.has(x.gameId)) games.set(x.gameId, x);
    const s = [...games.values()].slice(0, 3);
    return s.length >= 2 ? s : [];
  }
  for (const x of ok.sort((a, b) => b.evLean - a.evLean)) {
    if (seen.has(x.playerId) || (games.get(x.gameId) || 0) >= perGame) continue;
    seen.add(x.playerId);
    games.set(x.gameId, (games.get(x.gameId) || 0) + 1);
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
