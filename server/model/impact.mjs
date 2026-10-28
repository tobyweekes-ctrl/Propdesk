// Who gains from tonight's absences: one player's projection with the injury report as it stands,
// against the same projection with no teammate out. Feeds "Who benefits tonight" on the landing page.
import { buildContext } from './context.mjs';
import { projectPlayer, projectStat } from './projection.mjs';

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
