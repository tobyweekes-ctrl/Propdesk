// Betslip analysis: per-leg value, singles summary, and the accumulator with correlation.
//
// Leg probabilities come from each stat's distribution (the same numbers as the player page).
// To price combinations, each player's game is simulated jointly: one minutes draw and one
// "form" draw per player, shared by all of his stats, then pts / reb / ast / 3PM given minutes.
// So legs on the same player (e.g. points and PRA) move together, as they do in reality. Legs on
// different players in the same game are treated as independent and flagged.
// A "20+" style leg is stored as over 19.5, so one code path handles both.
import { statValue, STATS } from '../stats.mjs';
import { lineProbs } from './distributions.mjs';
import { noVig, expectedValue, parsePrice } from './odds.mjs';
import { fitDispersion } from './projection.mjs';
import { quality as dataQuality } from './evaluate.mjs';

// ---------- seeded randomness ----------
function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
function gamma(r, shape) {
  if (shape < 1) return gamma(r, shape + 1) * r() ** (1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = normal(r); v = 1 + c * x; } while (v <= 0);
    v = v ** 3;
    if (Math.log(r()) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}
function poisson(r, lam) {
  if (lam <= 0) return 0;
  if (lam > 30) return Math.max(0, Math.round(lam + Math.sqrt(lam) * normal(r)));
  const L = Math.exp(-lam);
  let k = 0, p = 1;
  do { k++; p *= r(); } while (p > L);
  return k - 1;
}
const negbin = (r, mu, invK) => (invK < 1e-6 ? poisson(r, mu) : poisson(r, mu * gamma(r, 1 / invK) * invK));

const BASE = ['pts', 'reb', 'ast', 'fg3m'];
const outcome = (x, side, line) => (x === line ? 'push' : (x > line) === (side === 'over') ? 'win' : 'loss');

/**
 * @param players Map playerId -> { name, team, opp, game, ctx, pp, sp: (stat) => projectStat result }
 * @param legs [{ id, playerId, stat, side, line, price, otherPrice?, book?, stake? }]
 * @param opts { sims, seed, cfg, mode: 'singles'|'acca', accaStake }
 */
export function analyseSlip(players, legs, { sims = 20000, seed = 7, cfg, accaStake = 1 } = {}) {
  // ---------- per leg ----------
  const L = legs.map((leg) => {
    const pl = players.get(leg.playerId);
    const price = parsePrice(leg.price);
    const sp = pl?.sp(leg.stat);
    if (!pl || !sp || !price) return { ...leg, error: !pl ? 'no game today' : !price ? 'needs a price' : 'not enough data' };
    const p = lineProbs(sp.pmf, Number(leg.line));
    const pWin = leg.side === 'over' ? p.over : p.under;
    const other = parsePrice(leg.otherPrice);
    const fair = other ? noVig(leg.side === 'over' ? price : other, leg.side === 'over' ? other : price, { method: cfg.devig }) : null;
    const fairP = fair ? (leg.side === 'over' ? fair.over : fair.under) : null;
    const implied = 1 / price;
    const ev = expectedValue(pWin, p.push, price);
    const q = dataQuality(pl.ctx, pl.pp.minutes);
    const verdict = ev >= 0.05 ? 'VALUE' : ev >= 0 ? 'FAIR' : 'AVOID';
    return {
      ...leg, price, player: pl.name, team: pl.team, opp: pl.opp, gameId: pl.game?.gameId,
      pWin, pPush: p.push, implied, fairP, edge: pWin - (fairP ?? implied), ev, verdict,
      fairPrice: pWin > 0 ? 1 / pWin : null, projection: sp.mean, minutes: pl.pp.minutes.proj,
      restricted: pl.pp.minutes.restricted, quality: q.score, qualityNotes: q.notes,
    };
  });
  const ok = L.filter((l) => !l.error);

  // ---------- joint simulation ----------
  const r = rng(seed);
  const pids = [...new Set(ok.map((l) => l.playerId))];
  const params = new Map(pids.map((id) => {
    const pl = players.get(id);
    const ref = pl.sp('pts');
    return [id, {
      min: pl.pp.minutes.proj, minSd: pl.pp.minutes.sd, cv: ref?.meanCv ?? 0.15,
      rate: Object.fromEntries(BASE.map((s) => [s, pl.pp.comps[s]?.rate ?? 0])),
      invK: Object.fromEntries(BASE.map((s) => [s, fitDispersion(pl.ctx.logs, s, cfg)])),
    }];
  }));
  const winsHist = new Array(ok.length + 1).fill(0);
  const legWin = new Array(ok.length).fill(0), legNotLose = new Array(ok.length).fill(0);
  let accaNoLoss = 0, accaPayout = 0;
  const draw = {};
  for (let i = 0; i < sims; i++) {
    for (const id of pids) {
      const q = params.get(id);
      const m = Math.min(48, Math.max(0, q.min + q.minSd * normal(r)));
      const u = q.cv > 0 ? gamma(r, 1 / q.cv ** 2) * q.cv ** 2 : 1;
      const x = {};
      for (const s of BASE) x[s] = negbin(r, q.rate[s] * m * u, q.invK[s]);
      draw[id] = x;
    }
    let wins = 0, lost = false, pay = 1;
    ok.forEach((l, j) => {
      const res = outcome(statValue(draw[l.playerId], l.stat), l.side, Number(l.line));
      if (res === 'win') { wins++; legWin[j]++; legNotLose[j]++; pay *= l.price; }
      else if (res === 'push') legNotLose[j]++;
      else lost = true;
    });
    winsHist[wins]++;
    if (!lost) { accaNoLoss++; accaPayout += pay; }
  }

  // The simulation supplies the dependence between legs; the per-leg distributions supply the
  // marginals. scale = (analytic chance each leg avoids losing) / (simulated chance), multiplied
  // over legs, maps simulated joint results onto the player-page probabilities.
  const analyticNotLose = ok.reduce((a, l) => a * (l.pWin + l.pPush), 1);
  const simNotLose = legNotLose.reduce((a, n) => a * (n / sims), 1);
  const scale = simNotLose > 0 ? analyticNotLose / simNotLose : 1;
  const corr = simNotLose > 0 ? (accaNoLoss / sims) / simNotLose : 1; // >1: legs tend to land together
  const accaPrice = ok.reduce((a, l) => a * l.price, 1);
  const accaP = (accaNoLoss / sims) * scale;
  const accaEV = ok.length ? (accaPayout / sims) * scale - 1 : null;

  // ---------- flags ----------
  const flags = [];
  const byPlayer = new Map();
  for (const l of ok) byPlayer.set(l.playerId, [...(byPlayer.get(l.playerId) || []), l]);
  for (const [, ls] of byPlayer) {
    if (ls.length > 1) flags.push({ level: 'info', text: `${ls[0].player}: ${ls.length} legs on the same player are correlated; the acca maths accounts for it (${corr >= 1 ? 'they help each other' : 'they work against each other'}).` });
    for (const a of ls) for (const b of ls) {
      if (a.id < b.id && a.stat === b.stat && a.side !== b.side) flags.push({ level: 'warn', text: `${a.player} ${STATS[a.stat].short}: over and under on the same stat largely cancel out.` });
      if (a.id < b.id && a.side !== b.side && a.stat !== b.stat && STATS[a.stat].parts.some((p) => STATS[b.stat].parts.includes(p))) flags.push({ level: 'warn', text: `${a.player}: opposite sides on overlapping stats (${STATS[a.stat].short} / ${STATS[b.stat].short}) pull against each other.` });
      if (a.id < b.id && a.stat === b.stat && a.side === b.side && a.line !== b.line) flags.push({ level: 'warn', text: `${a.player}: ${legLabel(a)} and ${legLabel(b)} overlap (one implies the other). Fine as singles; most bookmakers won't take both in one acca.` });
    }
    if (ls[0].restricted) flags.push({ level: 'warn', text: `${ls[0].player}: recently back from injury; minutes could be limited.` });
    if (ls[0].quality < 0.5) flags.push({ level: 'warn', text: `${ls[0].player}: thin data (${ls[0].qualityNotes.join('; ')}), so treat the model's numbers with caution.` });
  }
  const byGame = new Map();
  for (const l of ok) if (l.gameId) byGame.set(l.gameId, new Set([...(byGame.get(l.gameId) || []), l.playerId]));
  for (const [, set] of byGame) if (set.size > 1) flags.push({ level: 'info', text: `${set.size} players from the same game: game pace and blowouts affect them together, which the acca maths does not model.` });
  for (const l of ok) {
    if (l.fairP != null && l.edge > cfg.marketDisagreement) flags.push({ level: 'warn', text: `${l.player} ${legLabel(l)}: the model is ${Math.round(l.edge * 100)} points away from the bookmaker's fair price. Gaps that big usually mean news the model can't see (role, injury, minutes); check before betting.` });
    if (l.ev < 0) flags.push({ level: 'bad', text: `${l.player} ${l.side === 'over' ? `${legLabel(l)}` : `under ${l.line}`}: negative expected value at ${l.price.toFixed(2)}.` });
  }

  // ---------- singles ----------
  const stakes = ok.map((l) => Number(l.stake) || 1);
  const singles = {
    stake: stakes.reduce((a, b) => a + b, 0),
    expectedProfit: ok.reduce((a, l, j) => a + stakes[j] * l.ev, 0),
    expectedWinners: ok.reduce((a, l) => a + l.pWin, 0),
    pAllLose: winsHist[0] / sims,
    winsDistribution: winsHist.map((n) => n / sims),
  };
  singles.roi = singles.stake ? singles.expectedProfit / singles.stake : null;

  // ---------- acca ----------
  let dropBest = null;
  if (ok.length >= 3) {
    for (const l of ok) {
      const rest = ok.filter((x) => x !== l);
      const ev = rest.reduce((a, x) => a * (x.pWin + x.pPush) * x.price, 1) * corr - 1; // approx: keeps the slip's correlation
      if (accaEV != null && ev > accaEV + 0.02 && (!dropBest || ev > dropBest.ev)) dropBest = { id: l.id, player: l.player, label: legLabel(l), ev };
    }
  }
  const acca = ok.length >= 2 ? {
    price: accaPrice, pWin: accaP, pIndependent: analyticNotLose, correlation: corr,
    impliedP: 1 / accaPrice, ev: accaEV, stake: accaStake, expectedProfit: accaEV * accaStake, dropBest,
  } : null;

  const verdict = !ok.length ? null
    : (acca && acca.ev > 0.05) || singles.roi > 0.05 ? 'POSITIVE'
      : (acca && acca.ev > -0.03) || singles.roi > -0.03 ? 'MARGINAL' : 'NEGATIVE';
  return { legs: L, singles, acca, flags, verdict, sims };
}

export const legLabel = (l) => (l.kind === 'atleast' ? `${Math.round(l.line + 0.5)}+ ${STATS[l.stat].short}` : `${l.side === 'over' ? 'o' : 'u'}${l.line} ${STATS[l.stat].short}`);
