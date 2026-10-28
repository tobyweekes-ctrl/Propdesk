// Gathers every input the model needs for one player in one game, using only data from before
// the game date. The same function feeds the live API and the backtest.
import { seasonOf, prevSeason, normName, mean } from '../util.mjs';
import { absenceInfo, restDays } from '../data/derive.mjs';

const OUT_STATUSES = /^(out|doubtful|suspended)/i;

/** Date of the team's first game in `season` (team games carry no season tag, so find it via seasonOf). */
function seasonStartOf(games, season) {
  // games are date-ascending; scan back from the end while still in this season
  let start = '9999';
  for (let i = games.length - 1; i >= 0 && seasonOf(games[i].date) === season; i--) start = games[i].date;
  return start;
}

/**
 * @param L  indexed league holding the box scores (rows on/after game.date are ignored)
 * @param playerId
 * @param game { date, team, opp, home }
 * @param opts.T  league snapshot to read team-level stats from (backtest: a weekly snapshot). Defaults to L.
 * @param opts.injuries  injury report rows (live)
 * @param opts.teammatesOut  explicit list of teammate ids out (backtest); overrides injuries
 * @param opts.oppOut  explicit list of opponent ids out (backtest); overrides injuries
 * @param opts.spread  game spread from this team's perspective (negative = favourite), optional
 * @param opts.minutesOverride  user-entered minutes projection
 */
export function buildContext(L, playerId, game, opts = {}) {
  const T = opts.T || L;
  const player = L.players.get(playerId);
  const cur = seasonOf(game.date);
  const prev = prevSeason(cur);
  const logs = L.playerLogs(playerId).filter((r) => r.date < game.date);
  const curRows = logs.filter((r) => r.season === cur);
  const prevRows = logs.filter((r) => r.season === prev);
  const teamRows = curRows.filter((r) => r.team === game.team);
  // changed team since last season, or during this one
  const traded = (prevRows.length > 0 && prevRows.at(-1).team !== game.team) || curRows.some((r) => r.team !== game.team);

  const teamGamesBefore = (team) => (L.teamGameList.get(team) || []).filter((g) => g.date < game.date);
  const myTeamGames = teamGamesBefore(game.team);

  // A team's rotation lately (so an absence tonight is new information), with each player's recent
  // per-game numbers. Look only at this season once it has games: someone injured since the opener
  // is already reflected in this season's numbers, so his absence is not new information.
  const rotationOf = (team, skipId) => {
    const tg = teamGamesBefore(team);
    const seasonStart = seasonStartOf(tg, cur);
    const thisSeason = tg.filter((g) => g.date >= seasonStart);
    const recent = (thisSeason.length >= 2 ? thisSeason : tg).slice(-4);
    const needApps = Math.min(2, recent.length);
    const seen = new Map(); // id -> {apps, min}
    for (const g of recent) {
      for (const id of g.players) {
        if (id === skipId) continue;
        const r = L.playerLogs(id).find((x) => x.gameId === g.gameId);
        const e = seen.get(id) || { apps: 0, min: 0 };
        e.apps++; e.min += r?.min || 0;
        seen.set(id, e);
      }
    }
    return [...seen.entries()]
      .filter(([, e]) => e.apps >= needApps && e.min / e.apps >= 15)
      .map(([id, e]) => ({ id, name: L.players.get(id)?.name, group: L.groupOf(id), min: e.min / e.apps, avg: recentAvg(id, team) }));
  };
  // per-game averages over the last 10 games for this team (stat production a teammate leaves behind)
  const recentAvg = (id, team) => {
    const rows = L.playerLogs(id).filter((r) => r.date < game.date && r.team === team && r.min > 0).slice(-10);
    const out = { games: rows.length };
    for (const k of ['min', 'pts', 'reb', 'ast', 'fg3m']) out[k] = rows.length ? mean(rows.map((r) => r[k])) : 0;
    return out;
  };
  const outFrom = (rotation, team, ids) => {
    if (ids) { const set = new Set(ids); return rotation.filter((m) => set.has(m.id)); }
    const outNames = new Set((opts.injuries || []).filter((i) => i.team === team && OUT_STATUSES.test(i.status)).map((i) => normName(i.name)));
    return rotation.filter((m) => outNames.has(normName(m.name)));
  };

  const activeMates = rotationOf(game.team, playerId);
  const teammatesOut = outFrom(activeMates, game.team, opts.teammatesOut);
  const outIds = new Set(teammatesOut.map((m) => m.id));
  const availableMates = activeMates.filter((m) => !outIds.has(m.id));
  const oppRotation = rotationOf(game.opp, null);
  const oppOut = outFrom(oppRotation, game.opp, opts.oppOut);
  const oppOutIds = new Set(oppOut.map((m) => m.id));
  const oppAvailable = oppRotation.filter((m) => !oppOutIds.has(m.id));

  // team-level numbers, last season blended into this season by games played
  const teamStat = (team) => {
    const c = T.bySeason[cur]?.summary.teams[team];
    const p = T.bySeason[prev]?.summary.teams[team];
    return { cur: c || null, prev: p || null };
  };
  const leagueStat = { cur: T.bySeason[cur]?.summary.league || null, prev: T.bySeason[prev]?.summary.league || null };
  const posDef = (team, group) => ({
    cur: T.bySeason[cur]?.posDef[team]?.[group] || null,
    prev: T.bySeason[prev]?.posDef[team]?.[group] || null,
    curGames: T.bySeason[cur]?.summary.teams[team]?.games || 0,
  });

  // final margin of each of the player's past games (for blowout minutes)
  const marginOf = (r) => {
    const t = L.tgIndex.get(`${r.gameId}|${r.team}`);
    return t && t.oppPts != null ? t.pts - t.oppPts : null;
  };

  return {
    player, game, cur, prev, logs, curRows, prevRows, teamRows, traded,
    group: L.groupOf(playerId),
    restDays: restDays(myTeamGames.map((g) => g.date), game.date),
    oppRestDays: restDays(teamGamesBefore(game.opp).map((g) => g.date), game.date),
    absence: absenceInfo(logs, myTeamGames, game.date),
    teammatesOut, availableMates, oppOut, oppAvailable,
    selfAvg: recentAvg(playerId, game.team),
    h2hRows: logs.filter((r) => r.opp === game.opp),
    team: teamStat(game.team), opp: teamStat(game.opp), league: leagueStat,
    posDef, marginOf,
    // every team's summary (league ranks for the context notes)
    teams: { cur: T.bySeason[cur]?.summary.teams || {}, prev: T.bySeason[prev]?.summary.teams || {} },
    ownInjury: (opts.injuries || []).find((i) => i.team === game.team && normName(i.name) === normName(player?.name || '')) || null,
    priorRate: (s) => T.priorRate?.(L.groupOf(playerId), s) ?? null,
    groupRate: (g, s) => T.priorRate?.(g, s) ?? null,
    lineup: (r) => L.lineup(r.gameId, r.team),
    mateSeasons: (id) => new Set(L.playerLogs(id).filter((r) => r.date < game.date).map((r) => `${r.season}|${r.team}`)),
    spread: opts.spread ?? null,
    minutesOverride: opts.minutesOverride ?? null,
    recentMinutes: mean(teamRows.slice(-5).map((r) => r.min)),
  };
}
