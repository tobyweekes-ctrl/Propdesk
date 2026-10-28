// Stat projection = per-minute rate x projected minutes, then a count distribution around it.
//
// Per-minute rate for each base stat (pts, reb, ast, fg3m):
//   season rate  = w * this season + (1 - w) * last season,  w = n / (n + k)
//   base rate    = recency.season * season rate + recency.last10 * L10 rate + recency.last5 * L5 rate
//   x home/away x back-to-back x matchup pace x opponent defence vs position x head-to-head
//   x teammates out (share of the production they leave) x opponent players out (rebounds)
// Combos (PRA, P+R, ...) sum their components' means; their spread is fitted on the combo itself.
import { STATS, statValue } from '../stats.mjs';
import { mixturePmf } from './distributions.mjs';
import { seasonWeight, blendTeam, shrinkRatio, clamp } from './blend.mjs';
import { projectMinutes } from './minutes.mjs';

const BASE_STATS = ['pts', 'reb', 'ast', 'fg3m'];

function rate(rows, s) {
  let x = 0, m = 0;
  for (const r of rows) { x += r[s]; m += r.min; }
  return m >= 30 ? x / m : null;
}

function componentRate(ctx, s, cfg, minutes) {
  const A = cfg.adjust;
  const factors = [];
  // a new role makes last season's rate less relevant: a new team, or (same team) minutes 20%+ different
  const minNow = ctx.curRows.length >= 3 ? ctx.curRows.reduce((a, r) => a + r.min, 0) / ctx.curRows.length : null;
  const minThen = ctx.prevRows.length >= 10 ? ctx.prevRows.reduce((a, r) => a + r.min, 0) / ctx.prevRows.length : null;
  const roleChanged = !ctx.traded && minNow != null && minThen && Math.abs(minNow / minThen - 1) >= (cfg.blend.roleChangeMin ?? 0.2);
  const k = (s === 'fg3m' ? cfg.blend.fg3mRateK : cfg.blend.rateK)
    * (ctx.traded ? cfg.blend.tradedRateScale ?? 1 : roleChanged ? cfg.blend.roleChangeRateScale ?? 1 : 1);
  const rc = rate(ctx.curRows, s), rp = rate(ctx.prevRows, s);
  const w = rp == null ? 1 : rc == null ? 0 : seasonWeight(ctx.curRows.length, k);
  let seasonRate = rc == null && rp == null ? rate(ctx.logs, s) : w * (rc ?? 0) + (1 - w) * (rp ?? 0);
  if (seasonRate == null) return null;
  // thin samples (injuries, rookies, short stints) lean on a typical rotation player at his position
  const prior = ctx.priorRate(s);
  const n = ctx.logs.length;
  if (prior != null && cfg.blend.priorGames > 0) seasonRate = (n * seasonRate + cfg.blend.priorGames * prior) / (n + cfg.blend.priorGames);

  // recent-form windows only count once there are more games than the window itself
  // changed team: form windows can use only games for the new team (cfg.blend.tradedFormNewTeamOnly)
  const form = ctx.traded && cfg.blend.tradedFormNewTeamOnly ? ctx.teamRows : ctx.logs;
  const fn = form.length;
  const parts = [[cfg.recency.season, seasonRate], [fn > 10 ? cfg.recency.last10 : 0, rate(form.slice(-10), s)], [fn > 5 ? cfg.recency.last5 : 0, rate(form.slice(-5), s)]]
    .filter(([, v]) => v != null);
  const wsum = parts.reduce((a, [wt]) => a + wt, 0);
  const base = parts.reduce((a, [wt, v]) => a + wt * v, 0) / wsum;

  // home / away: the player's own split, shrunk toward the league-wide effect
  // (all games, old team included: a new-team-only split made the backtest worse)
  const venue = ctx.logs.filter((r) => r.home === ctx.game.home);
  const own = rate(venue, s) != null && rate(ctx.logs, s) ? rate(venue, s) / rate(ctx.logs, s) : 1;
  const sv = seasonWeight(venue.length, A.personalHomeK);
  const lg = ctx.game.home ? A.home : A.away;
  factors.push({ key: 'venue', label: ctx.game.home ? 'Home' : 'Away', value: 1 + (own - 1) * sv + (lg - 1) * (1 - sv) });

  if (ctx.restDays === 0) factors.push({ key: 'b2b', label: 'Back-to-back', value: A.b2b[s] });

  const tk = cfg.blend.teamK;
  const tPace = blendTeam(ctx.team, 'pace', tk), oPace = blendTeam(ctx.opp, 'pace', tk);
  const lgPace = blendTeam({ cur: ctx.league.cur && { ...ctx.league.cur, games: ctx.team.cur?.games || 0 }, prev: ctx.league.prev }, 'pace', tk);
  if (tPace && oPace && lgPace) {
    const gamePace = tPace + oPace - lgPace;
    factors.push({ key: 'pace', label: 'Matchup pace', value: 1 + A.paceElasticity[s] * (gamePace / tPace - 1), note: `${gamePace.toFixed(1)} vs his team's ${tPace.toFixed(1)}` });
  }

  const pd = ctx.posDef(ctx.game.opp, ctx.group);
  const fc = pd.cur?.[s], fp = pd.prev?.[s];
  if (fc != null || fp != null) {
    const wd = fp == null ? 1 : fc == null ? 0 : seasonWeight(pd.curGames, tk);
    const f = wd * (fc ?? 1) + (1 - wd) * (fp ?? 1);
    factors.push({ key: 'defence', label: `${ctx.game.opp} vs ${ctx.group === 'G' ? 'guards' : ctx.group === 'C' ? 'centres' : 'forwards'}`, value: 1 + A.defWeight * (f - 1), note: `allows ${((f - 1) * 100).toFixed(0)}% vs avg` });
  }

  const h = ctx.h2hRows;
  const rh = rate(h, s), rAll = rate(ctx.logs, s);
  if (rh != null && rAll && h.length >= A.h2hMinGames) {
    const v = clamp(shrinkRatio(rh / rAll, h.length, A.h2hK), 1 - A.h2hCap, 1 + A.h2hCap);
    factors.push({ key: 'h2h', label: `vs ${ctx.game.opp} history`, value: v, note: `${h.length}g, weight ${Math.round(seasonWeight(h.length, A.h2hK) * 100)}%` });
  }

  // Teammates out: part of what they produced (rebounds, assists, shots) goes to the players left,
  // more to the same position. Minutes already moved in the minutes step; this is the per-minute share.
  const myGame = base * Math.max(1, minutes.proj); // tonight's production before this step
  // what a missing player produced above a typical replacement at his position in the same minutes
  // (losing a 10-rebound centre frees boards; losing a 3-rebound guard frees almost nothing)
  const excess = (m) => {
    if (A.absorbFrom[s] && !A.absorbFrom[s].includes(m.group)) return 0;
    const typical = ctx.groupRate(m.group, s);
    const repl = typical != null ? A.replacementLevel * typical * (m.avg?.min || m.min) : 0;
    return Math.max(0, (m.avg?.[s] || 0) - repl);
  };
  const absorb = A.absorb[s] || 0;
  if (absorb > 0 && myGame > 0) {
    const w = (x, g, m) => x * (g === m.group ? A.absorbSameGroup : 1);
    // his share of what m leaves, among the given teammates plus himself
    const shareOf = (m, mates) => {
      const pool = mates.reduce((a, x) => a + w(x.avg?.[s] || 0, x.group, m), 0) + w(myGame, ctx.group, m);
      return pool > 0 ? w(myGame, ctx.group, m) / pool : 0;
    };
    let tonight = 0, vacated = 0;
    for (const m of ctx.teammatesOut) { const v = excess(m); vacated += v; tonight += absorb * v * shareOf(m, ctx.availableMates); }
    // relative to the absences his recent numbers already include (cfg.adjust.absorbRelative): a night with
    // more out than usual adds, a night with everyone back takes away
    let usual = 0;
    if (A.absorbRelative) {
      const all = [...ctx.availableMates, ...ctx.teammatesOut];
      for (const m of all) if (m.missRate) usual += m.missRate * absorb * excess(m) * shareOf(m, all.filter((x) => x !== m));
    }
    const diff = tonight - usual;
    const f = clamp(1 + diff / myGame, A.absorbRelative ? 1 - A.absorbCap : 1, 1 + A.absorbCap);
    if (Math.abs(f - 1) >= 0.005) { // smaller moves are noise, not worth a line in the breakdown
      factors.push({ key: 'mates', label: diff >= 0 ? 'Teammates out' : 'Teammates back', value: f,
        note: A.absorbRelative
          ? `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} ${s}: ${tonight.toFixed(1)} from tonight's absences (${vacated.toFixed(1)} above a replacement) against ${usual.toFixed(1)} his recent games already include`
          : `+${tonight.toFixed(1)} of the ${vacated.toFixed(1)} ${s} a game they produce above a replacement` });
    }
  }

  // Opponent missing rebounders: their replacements recover most boards, the rest go to this team.
  const oppShare = A.oppMissing[s] || 0;
  if (ctx.oppOut.length && oppShare > 0 && myGame > 0) {
    let mine = 0, lost = 0;
    for (const m of ctx.oppOut) {
      const v = excess(m);
      if (!v) continue;
      lost += v;
      // the boards go mostly to the players matched up with him: same position weighted up
      const w = (x, g) => x * (g === m.group ? A.absorbSameGroup : 1);
      const pool = ctx.availableMates.reduce((a, x) => a + w(x.avg?.[s] || 0, x.group), 0) + w(myGame, ctx.group);
      if (pool > 0) mine += oppShare * v * (w(myGame, ctx.group) / pool);
    }
    if (mine > 0) {
      const f = clamp(1 + mine / myGame, 1, 1 + A.absorbCap);
      if (f > 1.001) factors.push({ key: 'oppout', label: `${ctx.game.opp} missing players`, value: f, note: `+${mine.toFixed(1)}: ${ctx.oppOut.map((m) => m.name.split(' ').at(-1)).join(', ')} out (${lost.toFixed(1)} ${s} a game above a replacement)` });
    }
  }

  const rateAdj = factors.reduce((a, f) => a * f.value, base);
  return { seasonRate, base, rate: rateAdj, factors, w };
}

/** Per-player work shared by all stats: minutes + component rates. */
export function projectPlayer(ctx, cfg) {
  const minutes = projectMinutes(ctx, cfg);
  const comps = {};
  for (const s of BASE_STATS) comps[s] = componentRate(ctx, s, cfg, minutes);
  return { minutes, comps };
}

/** 1/k for the negative binomial, fitted to game-to-game spread given minutes, shrunk to a prior. */
export function fitDispersion(logs, stat, cfg) {
  const rows = logs.slice(-cfg.dispersion.window).filter((r) => r.min > 0);
  const prior = cfg.dispersion.prior[stat];
  if (rows.length < 5) return prior;
  const xs = rows.map((r) => statValue(r, stat));
  const totMin = rows.reduce((a, r) => a + r.min, 0);
  const rt = xs.reduce((a, b) => a + b, 0) / totMin;
  let num = 0, den = 0;
  rows.forEach((r, i) => { const mu = rt * r.min; num += (xs[i] - mu) ** 2 - mu; den += mu * mu; });
  const hat = den > 0 ? Math.max(0, num / den) : prior;
  const K = cfg.dispersion.k;
  return (rows.length * hat + K * prior) / (rows.length + K);
}

/** (1 - share) x model distribution + share x the empirical distribution of recent values (10+ games). */
export function mixRecent(dist, values, share, minGames = 10) {
  if (!share || values.length < minGames) return dist;
  const len = Math.max(dist.pmf.length, Math.max(...values) + 1);
  const pmf = Array.from({ length: len }, (_, x) => (1 - share) * (dist.pmf[x] || 0));
  for (const v of values) pmf[Math.max(0, Math.round(v))] += share / values.length;
  let mean = 0, m2 = 0;
  pmf.forEach((p, x) => { mean += p * x; m2 += p * x * x; });
  return { pmf, mean, sd: Math.sqrt(Math.max(0, m2 - mean * mean)) };
}

/** Full distribution for one stat. */
export function projectStat(pp, ctx, stat, cfg) {
  const parts = STATS[stat].parts;
  const comps = parts.map((p) => pp.comps[p]);
  if (comps.some((c) => !c)) return null;
  const ratePerMin = comps.reduce((a, c) => a + c.rate, 0);
  const baseRate = comps.reduce((a, c) => a + c.base, 0);
  const invK = fitDispersion(ctx.logs, stat, cfg);
  // uncertainty of the mean: sampling error over the games behind the rate + model error
  const D = cfg.dispersion;
  const nEff = Math.max(1, Math.min(D.maxGamesForSampling, ctx.logs.length));
  const perGame = ratePerMin * Math.max(1, pp.minutes.proj);
  const cv = typeof D.modelCv === 'number' ? D.modelCv : D.modelCv[stat] ?? 0.16;
  const meanCv2 = (1 / Math.max(0.5, perGame) + invK) / nEff + cv ** 2;
  const mixed = mixturePmf({ ratePerMin, minMean: pp.minutes.proj, minSd: pp.minutes.sd, invK: invK + meanCv2 });
  // A share of the player's actual last 20 results is mixed in: when recent hit rates and the model disagree,
  // reality landed about a third of the way toward the hit rates in the backtest (see cfg.blend.recentMix)
  // (changed team: his games for the new team only, from cfg.blend.tradedMixMinGames of them)
  const newTeam = ctx.traded && cfg.blend.tradedMixMinGames;
  const mixFrom = newTeam ? ctx.teamRows : ctx.logs;
  const { pmf, mean, sd } = mixRecent(mixed, mixFrom.slice(-20).map((r) => statValue(r, stat)), cfg.blend.recentMix || 0, newTeam ? cfg.blend.tradedMixMinGames : 10);

  // combined factors, weighted by each component's share of the stat
  const byKey = new Map();
  for (const c of comps) {
    for (const f of c.factors) {
      const e = byKey.get(f.key) || { key: f.key, label: f.label, note: f.note, num: 0, den: 0 };
      e.num += c.base * f.value; e.den += c.base;
      byKey.set(f.key, e);
    }
  }
  // (components a factor doesn't apply to count as 1)
  const factors = [...byKey.values()].map((e) => ({ key: e.key, label: e.label, note: e.note, value: (e.num + (baseRate - e.den)) / baseRate }));

  // the model's own line: median of the distribution, as an x.5
  let cum = 0, median = 0;
  for (let x = 0; x < pmf.length; x++) { cum += pmf[x]; if (cum >= 0.5) { median = x; break; } }

  return {
    stat, mean, sd, pmf, invK, meanCv: Math.sqrt(meanCv2),
    family: invK < 0.005 ? 'Poisson' : 'Negative binomial',
    ratePerMin, per36: ratePerMin * 36, basePer36: baseRate * 36,
    minutes: pp.minutes,
    seasonWeight: comps[0].w,
    factors,
    modelLine: median - 0.5,
  };
}
