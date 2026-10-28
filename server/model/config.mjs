// Every tunable weight of the model in one place. Override per call (deep-merged) or from the
// backtest CLI:  node scripts/backtest.mjs --set recency.last5=0.3 --set threshold=0.05
export const DEFAULTS = {
  // Verdict
  threshold: 0.04,           // min edge (model prob − no-vig market prob) to recommend a side
  requirePositiveEV: true,   // also require EV > 0 at the offered price
  devig: 'multiplicative',   // 'multiplicative' | 'power'
  assumedMargin: 0.05,       // bookmaker margin assumed when only one side's price is known
  // An edge this big against a two-sided no-vig price usually means the model is missing news (role,
  // injury, minutes) rather than the bookmaker being wrong. Above it the line is flagged and never
  // presented as the pick.
  marketDisagreement: 0.08,

  // Last season vs this season: weight on this season = n / (n + k), n = games this season
  blend: {
    rateK: 12,               // per-minute production (pts, reb, ast)
    fg3mRateK: 20,           // 3PM is noisier, so it needs more games
    // Changed team: multiplies rateK / fg3mRateK, so the new team's per-minute numbers count sooner (a new
    // team often means a new role). Backtest 2025-26, first 10 games with a new team: P+R error 6.037 ->
    // 6.002; players whose new-team rate ran 20%+ above last season went over an estimated line 58-63% of
    // the time while the model said 51% (now 54-55%); everyone else unchanged.
    tradedRateScale: 0.2,
    // Changed team: last-5 / last-10 form from new-team games only (old-team games mixed into the windows
    // dragged a new role back toward the old one). Backtest 2025-26, first 10 games with a new team, on top
    // of tradedRateScale: P+R error 6.002 -> 5.979, PRA 6.641 -> 6.598, points 5.110 -> 5.084, rebounds
    // 1.931 -> 1.915; overall a hair better on every stat.
    tradedFormNewTeamOnly: true,
    // Same team but a new role (minutes 20%+ different from last season): multiplies rateK. Backtest 2025-26,
    // those players in their first 20 games (n 796) were projected low (P+R bias -0.50): P+R error 5.691 ->
    // 5.687, PRA 6.251 -> 6.235, points level, rebounds 1.941 -> 1.951; overall unchanged or better.
    roleChangeRateScale: 0.5,
    roleChangeMin: 0.2,
    minutesK: 5,             // role shows up quickly
    minutesKTraded: 2,       // changed team: last season's minutes barely count
    teamK: 15,               // team pace / defence, in team games
    priorGames: 4,           // weight (in games) of a typical rotation player at his position; only matters for very thin samples
  },

  // Recent form on top of the season blend (weights sum to 1). Tuned on real 2025-26 games
  // (Dec-Jan) and checked on Oct-Nov and Feb-Apr: real roles shift, so recent games matter.
  recency: { season: 0.55, last10: 0.3, last5: 0.15 },

  minutes: {
    halfLife: 6,             // games; recency weighting of this season's minutes
    max: 42,
    sdFloor: 3,
    b2bFactor: 0.97,
    // Teammates out: with/without samples are small and confounded (rest days, rotation changes),
    // and the full-strength version made real-data projections worse, so it is applied gently.
    teammateK: 25,           // shrinkage (games) for with/without-teammate minutes
    redistributeShare: 0.25, // share of an absent teammate's minutes credited to this player's group
    sameGroupWeight: 1.6,    // same position group absorbs more of those minutes
    restriction: { minMissed: 5, window: 5, firstGameFactor: 0.75, rampPerGame: 1.5, sdBoost: 2.5 },
    // ratingShrink: raw net-rating gaps overstate real margins; spreads rarely exceed ~15 points
    blowout: { margin: 18, marginSd: 12.5, homeAdv: 1.5, starterRatio: 0.86, benchRatio: 1.12, k: 15, starterMin: 28, ratingShrink: 0.6, maxMargin: 15 },
    // Real minutes regress toward the middle (foul trouble, blowouts, rest, early exits). Final
    // projection = anchor + keep x (projection - anchor), fitted on real games by the backtest.
    regress: { anchor: 25, keep: 1 },
  },

  adjust: {
    home: 1.015, away: 0.985,
    personalHomeK: 40,       // shrinkage of a player's own home/away split
    b2b: { pts: 0.98, reb: 0.99, ast: 0.99, fg3m: 0.97 },
    paceElasticity: { pts: 1.0, reb: 0.7, ast: 0.9, fg3m: 0.9 },
    defWeight: 0.5,          // how much of the opponent-vs-position factor to apply (estimates are noisy)
    h2hK: 15,                // head-to-head shrinkage in games (3 games -> 17% weight)
    h2hCap: 0.1,             // max ±10% from head-to-head
    h2hMinGames: 3,          // fewer games than this vs the opponent: no head-to-head adjustment
    // Teammates out: share of the production they leave (per game, last 10) that the remaining
    // rotation picks up per minute, split by each player's own production, same position weighted up.
    // Backtest 2025-26: with 40+ pts of teammates out, points bias -1.23 -> -0.67; centres with another
    // centre out, rebounds -0.56 -> -0.23; overall accuracy unchanged or slightly better.
    absorb: { pts: 0.2, reb: 0.25, ast: 0.2, fg3m: 0 },
    absorbSameGroup: 4,
    replacementLevel: 0.85,  // a replacement produces this share of a typical player at the position
    absorbFrom: { reb: ['C'] }, // rebounds only shift when a centre is missing (forwards: no effect in the backtest)
    absorbCap: 0.25,         // max +25% per-minute from absences
    // Opponent players out: share of what they produced (above a replacement) that goes to this team.
    // Off: for rebounds it moved centres' bias the right way (-0.19 -> -0.11) but made accuracy
    // slightly worse in the 2025-26 backtest. The Context panel still reports opponent absences.
    oppMissing: { pts: 0, reb: 0, ast: 0, fg3m: 0 },
  },

  dispersion: {
    // prior for 1/k of the negative binomial (0 = Poisson), per stat
    prior: { pts: 0.03, reb: 0.02, ast: 0.05, fg3m: 0.03, pra: 0.02, pr: 0.025, pa: 0.025, ra: 0.015 },
    k: 20,                   // games of evidence needed to move halfway from the prior
    window: 60,
    // Uncertainty in the projected mean itself, added on top of game-to-game noise:
    //   sampling error of the rate (shrinks as games accumulate) + modelCv^2 for adjustment error.
    // Calibrated per stat on real 2025-26 games so the backtest's "spread" column sits near 1.00
    // (a single 0.16 made combos and rebounds too wide, which skewed them toward unders).
    modelCv: { pts: 0.14, reb: 0.05, ast: 0.10, fg3m: 0.22, pra: 0.07, pr: 0.09, pa: 0.10, ra: 0.05 },
    maxGamesForSampling: 40,
  },
};

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
export function mergeConfig(base, over = {}) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = base?.[k];
    out[k] = isObj(v) && (isObj(b) || Array.isArray(b)) ? mergeConfig(b, v) : v;
  }
  return out;
}

/** "recency.last5=0.3" -> { recency: { last5: 0.3 } } */
export function parseOverride(s) {
  const [path, raw] = s.split('=');
  const val = raw === 'true' ? true : raw === 'false' ? false : Number.isNaN(Number(raw)) ? raw : Number(raw);
  return path.split('.').reduceRight((acc, key) => ({ [key]: acc }), val);
}
