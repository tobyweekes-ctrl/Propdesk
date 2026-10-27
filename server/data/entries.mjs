// Grading and bet-log summary: pure, shared by the server (file storage) and the static site
// (browser storage).
import { statValue } from '../stats.mjs';

/**
 * Settle a line against the box score.
 * @returns {status:'pending'|'settled'|'void', actual?, outcome?:'over'|'under'|'push', betResult?, profit?}
 */
export function grade(L, e) {
  if (e.date >= L.today) return { status: 'pending' };
  const row = L.playerLogs(e.playerId).find((r) => r.date === e.date);
  if (!row) {
    const teamPlayed = (L.teamDates.get(e.team) || []).includes(e.date);
    return teamPlayed ? { status: 'void', reason: 'did not play' } : { status: 'pending' };
  }
  const actual = statValue(row, e.stat);
  const outcome = actual > e.line ? 'over' : actual < e.line ? 'under' : 'push';
  const out = { status: 'settled', actual, outcome };
  if (e.bet) {
    const { side, stake = 1, price } = e.bet;
    out.betResult = outcome === 'push' ? 'push' : outcome === side ? 'win' : 'loss';
    out.profit = out.betResult === 'win' ? stake * (price - 1) : out.betResult === 'loss' ? -stake : 0;
  }
  return out;
}

export function summariseBets(L, entries) {
  const bets = entries.filter((e) => e.bet).map((e) => ({ ...e, result: grade(L, e) }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const settled = bets.filter((b) => b.result.status === 'settled');
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const summarise = (xs) => {
    const staked = sum(xs.filter((b) => b.result.betResult !== 'push').map((b) => b.bet.stake || 1));
    const profit = sum(xs.map((b) => b.result.profit));
    return {
      bets: xs.length,
      won: xs.filter((b) => b.result.betResult === 'win').length,
      lost: xs.filter((b) => b.result.betResult === 'loss').length,
      push: xs.filter((b) => b.result.betResult === 'push').length,
      staked, profit, roi: staked ? profit / staked : null,
    };
  };
  const withModel = settled.filter((b) => b.model?.verdict && b.model.verdict.toLowerCase() === b.bet.side);
  const againstModel = settled.filter((b) => !withModel.includes(b));
  return {
    bets,
    summary: {
      total: bets.length,
      pending: bets.filter((b) => b.result.status === 'pending').length,
      void: bets.filter((b) => b.result.status === 'void').length,
      settled: summarise(settled),
      withModel: summarise(withModel),
      againstModel: summarise(againstModel),
    },
  };
}

