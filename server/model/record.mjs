// Public track record: every pick the model publishes is archived with the price at the time and the
// closing price, then graded from box scores. Pure functions; the build script does the I/O.
import { statValue } from '../stats.mjs';
import { noVig } from './odds.mjs';

export const pickKey = (p) => `${p.playerId}|${p.stat}|${p.book}|${p.line}`;

/**
 * Merge this build's picks into the day's archive. A pick is saved once, with its first-seen price (what a
 * reader could have bet), and never changes. Its `close` is updated on every later build before tip-off from
 * `prices`, every line this build priced, whether or not the model still recommends it: updating only lines
 * still picked froze the close of exactly the picks the market moved against.
 */
export function mergePicks(archive = {}, fresh = [], nowIso, prices = fresh) {
  const out = { ...archive };
  for (const p of fresh) {
    const k = pickKey(p);
    if (!out[k]) out[k] = { ...p, firstSeen: nowIso, close: { over: p.over, under: p.under, at: nowIso } };
  }
  for (const p of [...fresh, ...prices]) {
    const k = pickKey(p);
    const prev = out[k];
    if (prev && prev.firstSeen !== nowIso && (!p.tipoff || nowIso < p.tipoff)) out[k] = { ...prev, close: { over: p.over, under: p.under, at: nowIso } };
  }
  return out;
}

/** A pick the site recommends: medium confidence or better and 3%+ expected return (the home page's rule),
 * locked when it was saved (older archives, saved before the flag, are judged by the same rule). */
export const isRecommended = (p) => p.recommended ?? ((p.confidence === 'MEDIUM' || p.confidence === 'HIGH') && (p.ev ?? 0) >= 0.03);

/** Fair probability of the picked side from a two-way price, or null. */
const fairSide = (side, over, under) => {
  const f = noVig(over, under);
  return f && !f.estimated ? (side === 'over' ? f.over : f.under) : null;
};

/**
 * Grade archived picks.
 * @param L league with box scores
 * @param days { 'YYYY-MM-DD': { key: pick } }
 * @returns summary, by-confidence, calibration buckets, CLV and the graded list
 */
/**
 * One pick per player per game: the first one saved (best value among those saved together). Picks on the same
 * player rise and fall together, so counting each would make the record look bigger and steadier than it is,
 * and choosing among them later, with later prices, would be hindsight.
 */
export function countedPicks(picks) {
  const first = new Map();
  const better = (p, cur) => (p.firstSeen || '') < (cur.firstSeen || '') || ((p.firstSeen || '') === (cur.firstSeen || '') && (p.ev ?? 0) > (cur.ev ?? 0));
  for (const p of Object.values(picks)) {
    if (!p.side) continue; // only published picks count, not passes
    const cur = first.get(p.playerId);
    if (!cur || better(p, cur)) first.set(p.playerId, p);
  }
  return [...first.values()];
}

export function gradeRecord(L, days) {
  const graded = [];
  for (const [date, picks] of Object.entries(days)) {
    if (date >= L.today) continue;
    for (const p of countedPicks(picks)) {
      const row = L.playerLogs(p.playerId).find((r) => r.date === date);
      const teamPlayed = (L.teamDates.get(p.team) || []).includes(date);
      if (!row) { if (teamPlayed) graded.push({ ...p, date, result: 'void' }); continue; }
      const actual = statValue(row, p.stat);
      const outcome = actual > p.line ? 'over' : actual < p.line ? 'under' : 'push';
      const result = outcome === 'push' ? 'push' : outcome === p.side ? 'win' : 'loss';
      const price = p.side === 'over' ? p.over : p.under;
      const pickFair = fairSide(p.side, p.over, p.under);
      const closeFair = p.close && p.close.at !== p.firstSeen ? fairSide(p.side, p.close.over, p.close.under) : null;
      graded.push({
        ...p, date, actual, result, price, outcome,
        // the bookmaker's own chance for this side at the price when tracked, margin removed
        marketP: pickFair ?? (price ? 1 / price : null),
        profit: result === 'win' ? price - 1 : result === 'loss' ? -1 : 0,
        // closing-line value: how far the market moved toward our side by tip-off (fair-probability points)
        clv: pickFair != null && closeFair != null ? closeFair - pickFair : null,
      });
    }
  }
  graded.sort((a, b) => b.date.localeCompare(a.date) || (b.ev ?? 0) - (a.ev ?? 0));
  const settled = graded.filter((g) => g.result === 'win' || g.result === 'loss');
  const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
  const summarise = (xs) => {
    const s = xs.filter((g) => g.result === 'win' || g.result === 'loss');
    return {
      picks: xs.length, settled: s.length, won: s.filter((g) => g.result === 'win').length,
      hitRate: s.length ? s.filter((g) => g.result === 'win').length / s.length : null,
      expectedHitRate: s.length ? sum(s, (g) => g.pWin) / s.length : null,
      marketHitRate: s.length ? sum(s, (g) => g.marketP ?? 0.5) / s.length : null,
      roi: s.length ? sum(s, (g) => g.profit) / s.length : null,
    };
  };
  const buckets = [];
  // every settled pick lands in a bucket, plus-money ones (under 50%) included
  for (const [lo, hi] of [[0, 0.4], [0.4, 0.5], [0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.7], [0.7, 1.01]]) {
    const xs = settled.filter((g) => g.pWin >= lo && g.pWin < hi);
    if (xs.length) buckets.push({ range: `${Math.round(lo * 100)}–${Math.min(100, Math.round(hi * 100))}%`, n: xs.length, predicted: sum(xs, (g) => g.pWin) / xs.length, actual: xs.filter((g) => g.result === 'win').length / xs.length });
  }
  const withClv = settled.filter((g) => g.clv != null);
  // how long before tip-off the closing price was taken (an hourly snapshot is not quite the close)
  const leads = withClv.map((g) => (g.tipoff ? (Date.parse(g.tipoff) - Date.parse(g.close.at)) / 60000 : null)).filter((x) => x != null && x >= 0);
  // baselines on the same lines: back every under, or always the favourite (the shorter price)
  const base = (pickSide) => {
    const xs = settled.filter((g) => g.outcome !== 'push' && g.over && g.under);
    const profit = sum(xs, (g) => { const side = pickSide(g); return g.outcome === side ? (side === 'over' ? g.over : g.under) - 1 : -1; });
    const won = xs.filter((g) => g.outcome === pickSide(g)).length;
    return { settled: xs.length, won, roi: xs.length ? profit / xs.length : null };
  };
  const SAME = 0.005; // under half a point of fair probability: the line didn't really move
  const groupBy = (key) => {
    const m = new Map();
    for (const g of graded) { const k = key(g); if (k != null) (m.get(k) || m.set(k, []).get(k)).push(g); }
    return m;
  };
  const byStat = Object.fromEntries([...groupBy((g) => g.stat)].map(([k, xs]) => [k, summarise(xs)]));
  const bySide = Object.fromEntries([...groupBy((g) => g.side)].map(([k, xs]) => [k, summarise(xs)]));
  // a game is one date and matchup, labelled AWAY @ HOME like the rest of the site
  const byGame = [...groupBy((g) => (g.opp ? `${g.date}|${g.home ? `${g.opp} @ ${g.team}` : `${g.team} @ ${g.opp}`}` : null))]
    .map(([k, xs]) => ({ date: k.slice(0, 10), label: k.slice(11), ...summarise(xs), profit: sum(xs, (g) => g.profit || 0) }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.picks - a.picks);
  let run = 0;
  const byDay = [...groupBy((g) => g.date)].sort(([a], [b]) => a.localeCompare(b)).map(([date, xs]) => {
    const profit = sum(xs, (g) => g.profit || 0);
    run += profit;
    return { date, ...summarise(xs), profit, cumProfit: run };
  });
  return {
    since: Object.keys(days).sort()[0] || null,
    overall: summarise(graded),
    byConfidence: Object.fromEntries(['HIGH', 'MEDIUM', 'LOW'].map((c) => [c, summarise(graded.filter((g) => g.confidence === c))])),
    calibration: buckets,
    byStat, bySide, byGame, byDay,
    clv: {
      n: withClv.length, avg: withClv.length ? sum(withClv, (g) => g.clv) / withClv.length : null,
      positive: withClv.length ? withClv.filter((g) => g.clv > 0).length / withClv.length : null,
      beat: withClv.filter((g) => g.clv >= SAME).length, same: withClv.filter((g) => Math.abs(g.clv) < SAME).length, worse: withClv.filter((g) => g.clv <= -SAME).length,
      noClose: settled.length - withClv.length, // never repriced before tip-off, or a one-sided price
      leadMin: leads.length ? Math.round(leads.reduce((a, b) => a + b, 0) / leads.length) : null,
    },
    recommended: summarise(graded.filter(isRecommended)),
    leans: summarise(graded.filter((g) => !isRecommended(g))),
    baselines: { allUnders: base(() => 'under'), favourites: base((g) => (g.under < g.over ? 'under' : 'over')) },
    pending: Object.entries(days).filter(([d]) => d >= L.today).reduce((a, [, ps]) => a + countedPicks(ps).length, 0),
    nights: new Set(graded.filter((g) => g.result === 'win' || g.result === 'loss').map((g) => g.date)).size,
    recent: graded.slice(0, 150),
    // picks waiting on tonight's games, best value first
    upcoming: Object.entries(days).filter(([d]) => d >= L.today)
      .flatMap(([date, ps]) => countedPicks(ps).map((p) => ({ ...p, date })))
      .sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0)).slice(0, 60),
  };
}
