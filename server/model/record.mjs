// Public track record: every pick the model publishes is archived with the price at the time and the
// closing price, then graded from box scores. Pure functions; the build script does the I/O.
import { statValue } from '../stats.mjs';
import { noVig } from './odds.mjs';

export const pickKey = (p) => `${p.playerId}|${p.stat}|${p.book}|${p.line}`;

/**
 * Merge this build's picks into the day's archive. A pick keeps its first-seen price (what a reader
 * could have bet) and updates `close` on every later build before tip-off (the closing line).
 */
export function mergePicks(archive = {}, fresh = [], nowIso) {
  const out = { ...archive };
  for (const p of fresh) {
    const k = pickKey(p);
    const prev = out[k];
    const beforeTip = !p.tipoff || nowIso < p.tipoff;
    if (!prev) out[k] = { ...p, firstSeen: nowIso, close: { over: p.over, under: p.under, at: nowIso } };
    else if (beforeTip) out[k] = { ...prev, close: { over: p.over, under: p.under, at: nowIso } };
  }
  return out;
}

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
export function gradeRecord(L, days) {
  const graded = [];
  for (const [date, picks] of Object.entries(days)) {
    if (date >= L.today) continue;
    for (const p of Object.values(picks)) {
      if (!p.side) continue; // only published picks count, not passes
      const row = L.playerLogs(p.playerId).find((r) => r.date === date);
      const teamPlayed = (L.teamDates.get(p.team) || []).includes(date);
      if (!row) { if (teamPlayed) graded.push({ ...p, date, result: 'void' }); continue; }
      const actual = statValue(row, p.stat);
      const outcome = actual > p.line ? 'over' : actual < p.line ? 'under' : 'push';
      const result = outcome === 'push' ? 'push' : outcome === p.side ? 'win' : 'loss';
      const price = p.side === 'over' ? p.over : p.under;
      const pickFair = fairSide(p.side, p.over, p.under);
      const closeFair = p.close ? fairSide(p.side, p.close.over, p.close.under) : null;
      graded.push({
        ...p, date, actual, result, price,
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
      roi: s.length ? sum(s, (g) => g.profit) / s.length : null,
    };
  };
  const buckets = [];
  for (const [lo, hi] of [[0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.7], [0.7, 1.01]]) {
    const xs = settled.filter((g) => g.pWin >= lo && g.pWin < hi);
    if (xs.length) buckets.push({ range: `${Math.round(lo * 100)}–${Math.min(100, Math.round(hi * 100))}%`, n: xs.length, predicted: sum(xs, (g) => g.pWin) / xs.length, actual: xs.filter((g) => g.result === 'win').length / xs.length });
  }
  const withClv = graded.filter((g) => g.clv != null && g.close && g.close.at !== g.firstSeen);
  return {
    since: Object.keys(days).sort()[0] || null,
    overall: summarise(graded),
    byConfidence: Object.fromEntries(['HIGH', 'MEDIUM', 'LOW'].map((c) => [c, summarise(graded.filter((g) => g.confidence === c))])),
    calibration: buckets,
    clv: { n: withClv.length, avg: withClv.length ? sum(withClv, (g) => g.clv) / withClv.length : null, positive: withClv.length ? withClv.filter((g) => g.clv > 0).length / withClv.length : null },
    pending: Object.entries(days).filter(([d]) => d >= L.today).reduce((a, [, ps]) => a + Object.values(ps).filter((p) => p.side).length, 0),
    recent: graded.slice(0, 150),
  };
}
