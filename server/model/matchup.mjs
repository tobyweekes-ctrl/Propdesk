// Tonight's opponent against this player's position: points, rebounds, assists and threes allowed per minute to
// guards, forwards or centres, relative to the league, with a rank out of every team. The same numbers the model
// uses (at half weight, see config.adjust.defWeight) and the context notes describe; this shapes them for a card.
import { seasonWeight } from './blend.mjs';
import { statValue } from '../stats.mjs';

const STAT = ['pts', 'reb', 'ast', 'fg3m'];
const GROUP = { G: 'guards', F: 'forwards', C: 'centres' };

/**
 * @returns { opp, group, groupLabel, games, basis, stats: [{ stat, factor, rank, of }], all: { stat: [[team, factor]] } }
 *   factor 1.10 = allows 10% more than the league per minute to this position; rank 1 = allows the most.
 */
export function defenceCard(ctx, cfg) {
  const group = ctx.group;
  const blend = (team, s) => {
    const pd = ctx.posDef(team, group);
    const fc = pd.cur?.[s], fp = pd.prev?.[s];
    if (fc == null && fp == null) return null;
    const w = fp == null ? 1 : fc == null ? 0 : seasonWeight(pd.curGames, cfg.blend.teamK);
    return w * (fc ?? 1) + (1 - w) * (fp ?? 1);
  };
  const teams = Object.keys({ ...ctx.teams.cur, ...ctx.teams.prev });
  const all = {};
  const stats = [];
  for (const s of STAT) {
    all[s] = teams.map((t) => [t, blend(t, s)]).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]);
    const i = all[s].findIndex(([t]) => t === ctx.game.opp);
    if (i >= 0) stats.push({ stat: s, factor: all[s][i][1], rank: i + 1, of: all[s].length });
  }
  const games = ctx.posDef(ctx.game.opp, group).curGames;
  const basis = !Object.keys(ctx.teams.prev).length ? 'this season'
    : games ? `this season (${games} game${games === 1 ? '' : 's'}) blended with last season` : 'last season';
  return { opp: ctx.game.opp, group, groupLabel: GROUP[group], games, basis, stats, all };
}

/**
 * How tonight's opponent has treated players like this one lately: same-position rotation players' games against
 * them (20+ minutes, in the opponent's last 15 games), each against that player's own average that season with the
 * game left out. The 10 most like this player (last 20 games) are kept, newest first: matched on the stat's average,
 * except points, matched on shots attempted and points per game together (a volume shooter and an efficient
 * finisher can score the same), rebounds, matched on minutes and rebounds per game together (a starter and a
 * high-rate backup can average the same), assists, matched on usage and assists per game together (how much of
 * the offence runs through him, not just the total), and threes, matched on three-point attempts and minutes together
 * (volume drives makes; a centre who never shoots them tells nothing, so players under 1 attempt a game are left out). Every measure must be within half of
 * his, so the list can be shorter than 10.
 * One game per row, so it is noisy: background beside the model, not part of it.
 * @returns { opp, group, current, matchOn, myAtt, myAvg, myMin, rows: [{ id, name, team, date, season, min, value, avg, att, minAvg }], avgDelta }
 */
export function similarVsOpp(L, playerId, opp, stat, { limit = 10, oppGames = 15 } = {}) {
  const group = L.groupOf(playerId);
  const matchOn = { fg3m: 'fg3a+min', pts: 'fga+pts', reb: 'min+reb', ast: 'usg+ast' }[stat] || stat;
  // what "similar" is measured on: one or two per-game averages; the attempts one (if any) is shown on the card
  const keysOf = (r) => (matchOn === 'fg3a+min' ? [r.fg3a || 0, r.min || 0] : matchOn === 'fga+pts' ? [r.fga || 0, statValue(r, 'pts')]
    : matchOn === 'min+reb' ? [r.min || 0, statValue(r, 'reb')] : matchOn === 'usg+ast' ? [r.usg || 0, statValue(r, 'ast')] : [statValue(r, stat)]);
  const avgKeys = (rows) => {
    const sums = rows.reduce((acc, r) => keysOf(r).map((v, i) => (acc[i] || 0) + v), []);
    return sums.map((v) => (rows.length ? v / rows.length : 0));
  };
  const myKey = avgKeys(L.playerLogs(playerId).slice(-20));
  // relative gap on each measure, added up, so shots and points count equally
  const dist = (k) => k.reduce((a, v, i) => a + Math.abs(v - myKey[i]) / Math.max(1, myKey[i]), 0);
  const attOf = (k) => (k.length > 1 ? k[0] : undefined);
  const recent = new Set((L.teamGameList.get(opp) || []).slice(-oppGames).map((g) => g.gameId));
  const rows = [];
  for (const p of L.players.values()) {
    if (p.id === playerId || L.groupOf(p.id) !== group) continue;
    const logs = L.playerLogs(p.id);
    for (const g of logs) {
      if (g.opp !== opp || !recent.has(g.gameId) || g.min < 20) continue;
      const same = logs.filter((r) => r.season === g.season && r.gameId !== g.gameId);
      if (same.length < 3) continue;
      const avgMin = same.reduce((a, r) => a + r.min, 0) / same.length;
      if (avgMin < 20) continue;
      const avg = same.reduce((a, r) => a + statValue(r, stat), 0) / same.length;
      const key = avgKeys(same);
      if (matchOn === 'fg3a+min' && key[0] < 1) continue;
      // similar means close on every measure (within half of his), not just the nearest of whoever played them
      if (key.some((v, i) => Math.abs(v - myKey[i]) > 0.5 * Math.max(1, myKey[i]))) continue;
      rows.push({ id: p.id, name: p.name, team: g.team, date: g.date, season: g.season, min: Math.round(g.min), value: statValue(g, stat), avg, att: attOf(key), minAvg: matchOn === 'fg3a+min' ? key[1] : undefined, d: dist(key) });
    }
  }
  const near = rows.sort((a, b) => a.d - b.d).slice(0, limit)
    .sort((a, b) => b.date.localeCompare(a.date)).map(({ d, ...x }) => x);
  return { opp, group, current: L.current, matchOn, myAtt: attOf(myKey), myAvg: myKey.at(-1), myMin: matchOn === 'fg3a+min' ? myKey[1] : undefined, rows: near, avgDelta: near.length ? near.reduce((a, x) => a + (x.value - x.avg), 0) / near.length : null };
}
