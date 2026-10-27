// Grading and bet-log summary: pure, shared by the server (file storage) and the static site
// (browser storage).
import { statValue } from '../stats.mjs';

/**
 * Settle a line against the box score.
 * @returns {status:'pending'|'settled'|'void', actual?, outcome?:'over'|'under'|'push', betResult?, profit?}
 */
export function grade(L, e) {
  if (e.kind === 'acca') return gradeAcca(L, e);
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
  // "with the model" = the model priced the bet as positive expected value (or recommended that side)
  const withModel = settled.filter((b) => (b.model?.ev != null ? b.model.ev > 0 : b.model?.verdict?.toLowerCase() === b.bet.side));
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


/** An acca wins if no leg loses; pushed or void legs drop out at price 1. */
function gradeAcca(L, e) {
  const legs = e.legs.map((l) => ({ ...l, result: grade(L, { ...l, bet: { side: l.side, stake: 1, price: l.price } }) }));
  const out = { status: 'pending', legs: legs.map((l) => l.result) };
  if (legs.some((l) => l.result.betResult === 'loss')) Object.assign(out, { status: 'settled', betResult: 'loss', profit: -e.bet.stake });
  else if (legs.every((l) => l.result.status !== 'pending')) {
    const price = legs.reduce((a, l) => a * (l.result.betResult === 'win' ? l.price : 1), 1);
    const allVoid = legs.every((l) => l.result.status === 'void' || l.result.betResult === 'push');
    Object.assign(out, { status: 'settled', betResult: allVoid ? 'push' : 'win', profit: allVoid ? 0 : e.bet.stake * (price - 1) });
  }
  return out;
}
