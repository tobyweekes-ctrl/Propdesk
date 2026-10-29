// Who gains from tonight's absences: one player's projection with the injury report as it stands,
// against the same projection with no teammate out. Feeds "Who benefits tonight" on the landing page.
import { buildContext } from './context.mjs';
import { projectPlayer, projectStat } from './projection.mjs';
import { injuryFor } from '../data/league.mjs';

const STATS = ['pts', 'reb', 'ast'];

/**
 * @returns null when no rotation teammate is out, else
 *   { outs: [{ id, name }], minutes: { with, without }, pts|reb|ast: { with, without } }
 */
export function absenceImpact(L, playerId, game, injuries, cfg) {
  const ctx = buildContext(L, playerId, game, { injuries });
  if (!ctx.teammatesOut.length) return null;
  const base = buildContext(L, playerId, game, { injuries, teammatesOut: [] });
  const pw = projectPlayer(ctx, cfg), pb = projectPlayer(base, cfg);
  const out = { outs: ctx.teammatesOut.map((m) => ({ id: m.id, name: m.name })), minutes: { with: pw.minutes.proj, without: pb.minutes.proj } };
  for (const s of STATS) {
    const w = projectStat(pw, ctx, s, cfg), b = projectStat(pb, base, s, cfg);
    if (!w || !b) return null;
    out[s] = { with: w.mean, without: b.mean };
  }
  return out;
}

const OUT = /^(out|suspended)/i;
const r1 = (x) => Math.round(x * 10) / 10;

/**
 * A team's main players for the landing game cards: the model's projection for tonight (injury report applied,
 * the same numbers as "Who benefits"), ranked by projected minutes, rotation players only (see inRotation).
 * @param game { date, gameId?, team, opp, home, tipoff? }
 * @returns [{ id, name, pos, min, pts, reb, ast, injury }] best first, at most `limit`
 */
/**
 * Still in the team's rotation: 3+ games for the team, and once the team has played this season, 2+ of them this
 * season (fewer if the team has played fewer). End-of-last-season minutes alone (tanking, resting starters) don't
 * count: those players have often left the rotation or the roster.
 */
export function inRotation(L, p, team) {
  const rows = L.playerLogs(p.id).filter((r) => r.team === team);
  if (rows.length < 3) return false;
  const teamCur = L.bySeason[L.current].teamGames.filter((t) => t.team === team).length;
  return rows.filter((r) => r.season === L.current).length >= Math.min(2, teamCur);
}

export function teamCards(L, game, injuries, cfg, limit = 5) {
  const out = [];
  for (const p of L.players.values()) {
    if (p.team !== game.team) continue;
    const status = injuryFor(injuries, p)?.status || null;
    if (OUT.test(status || '')) continue;
    if (!inRotation(L, p, game.team)) continue;
    const ctx = buildContext(L, p.id, game, { injuries });
    const pp = projectPlayer(ctx, cfg);
    const card = { id: p.id, name: p.name, pos: p.pos, min: r1(pp.minutes.proj), injury: status };
    let ok = true;
    for (const s of STATS) { const sp = projectStat(pp, ctx, s, cfg); if (!sp) { ok = false; break; } card[s] = r1(sp.mean); }
    if (ok) out.push(card);
  }
  return out.sort((a, b) => b.min - a.min).slice(0, limit);
}
