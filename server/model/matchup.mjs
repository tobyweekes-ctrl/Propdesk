// Tonight's opponent against this player's position: points, rebounds, assists and threes allowed per minute to
// guards, forwards or centres, relative to the league, with a rank out of every team. The same numbers the model
// uses (at half weight, see config.adjust.defWeight) and the context notes describe; this shapes them for a card.
import { seasonWeight } from './blend.mjs';

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
