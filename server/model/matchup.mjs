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
 * except threes, matched on three-point attempts (volume drives makes; a centre who never shoots them tells nothing,
 * so players under 1 attempt a game are left out).
 * One game per row, so it is noisy: background beside the model, not part of it.
 * @returns { opp, group, current, matchOn, rows: [{ id, name, team, date, season, min, value, avg, att }], avgDelta }
 */
export function similarVsOpp(L, playerId, opp, stat, { limit = 10, oppGames = 15 } = {}) {
  const group = L.groupOf(playerId);
  const matchOn = stat === 'fg3m' ? 'fg3a' : stat;
  const keyOf = (r) => (matchOn === 'fg3a' ? r.fg3a || 0 : statValue(r, stat));
  const mine = L.playerLogs(playerId).slice(-20).map(keyOf);
  const myKey = mine.length ? mine.reduce((a, b) => a + b, 0) / mine.length : 0;
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
      const key = same.reduce((a, r) => a + keyOf(r), 0) / same.length;
      if (matchOn === 'fg3a' && key < 1) continue;
      rows.push({ id: p.id, name: p.name, team: g.team, date: g.date, season: g.season, min: Math.round(g.min), value: statValue(g, stat), avg, att: matchOn === 'fg3a' ? key : undefined, key });
    }
  }
  const near = rows.sort((a, b) => Math.abs(a.key - myKey) - Math.abs(b.key - myKey)).slice(0, limit)
    .sort((a, b) => b.date.localeCompare(a.date)).map(({ key, ...x }) => x);
  return { opp, group, current: L.current, matchOn, myAtt: matchOn === 'fg3a' ? myKey : undefined, rows: near, avgDelta: near.length ? near.reduce((a, x) => a + (x.value - x.avg), 0) / near.length : null };
}
