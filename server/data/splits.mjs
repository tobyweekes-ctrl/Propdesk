// Splits for one player + stat: season, venue, opponent, rest, with/without key teammates.
// Each row carries the per-game values (oldest first) so the client can work out the hit rate
// against whichever line is selected without another request.
import { statValue } from '../stats.mjs';
import { mean, normName, round } from '../util.mjs';

const OUT = /^(out|doubtful|suspended)/i;

function row(group, key, label, rows, stat, extra = {}) {
  const values = rows.map((r) => statValue(r, stat));
  return {
    group, key, label, n: rows.length,
    avg: round(mean(values)), min: round(mean(rows.map((r) => r.min))),
    values, ...extra,
  };
}

/**
 * @param L league
 * @param playerId
 * @param stat
 * @param opts.opp  tonight's opponent (for the vs-opponent row)
 * @param opts.injuries  injury report (flags teammates out tonight)
 * @param opts.maxMates  how many key teammates to split on
 */
export function computeSplits(L, playerId, stat, { opp = null, injuries = [], maxMates = 4 } = {}) {
  const p = L.players.get(playerId);
  const logs = L.playerLogs(playerId);
  const cur = logs.filter((r) => r.season === L.current);
  const prev = logs.filter((r) => r.season === L.previous);
  const out = [];

  out.push(row('Season', 'cur', `This season`, cur, stat));
  out.push(row('Season', 'prev', `Last season`, prev, stat));
  // a player who changed team: home/away and rest from games with his current team only (a home game for
  // the old team says little about this one)
  const mineAll = logs.filter((r) => r.team === p.team);
  const moved = mineAll.length < logs.length;
  const scope = moved ? mineAll : logs;
  const tag = moved ? ` (${p.team})` : '';
  out.push(row('Venue', 'home', `Home${tag}`, scope.filter((r) => r.home), stat));
  out.push(row('Venue', 'away', `Away${tag}`, scope.filter((r) => !r.home), stat));
  if (opp) out.push(row('Opponent', 'opp', `vs ${opp}`, logs.filter((r) => r.opp === opp), stat, { dates: logs.filter((r) => r.opp === opp).map((r) => r.date) }));

  const rest = (r) => L.restDays(r.team, r.date);
  out.push(row('Rest', 'b2b', `Back-to-back${tag}`, scope.filter((r) => rest(r) === 0), stat));
  out.push(row('Rest', 'rest1', `1 day rest${tag}`, scope.filter((r) => rest(r) === 1), stat));
  out.push(row('Rest', 'rest2', `2+ days rest${tag}`, scope.filter((r) => rest(r) >= 2), stat));

  // key teammates: most minutes alongside him on his current team lately, plus anyone out tonight
  const teamGames = (L.teamGameList.get(p.team) || []).slice(-15);
  const mins = new Map();
  for (const g of teamGames) {
    for (const id of g.players) {
      if (id === playerId) continue;
      const r = L.playerLogs(id).find((x) => x.gameId === g.gameId);
      mins.set(id, (mins.get(id) || 0) + (r?.min || 0));
    }
  }
  const outTonight = new Set(injuries.filter((i) => i.team === p.team && OUT.test(i.status)).map((i) => normName(i.name)));
  const mates = [...mins.entries()]
    .filter(([id]) => L.players.get(id)?.team === p.team)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => L.players.get(id));
  const chosen = [...mates.slice(0, maxMates), ...mates.slice(maxMates).filter((m) => outTonight.has(normName(m.name)))];

  const mine = mineAll;
  for (const m of chosen) {
    // seasons they shared a team; this season counts if he's on the roster now, even if injured all year
    const seasons = new Set(L.playerLogs(m.id).filter((r) => r.team === p.team).map((r) => r.season));
    if (m.team === p.team) seasons.add(L.current);
    const shared = mine.filter((r) => seasons.has(r.season));
    const withM = shared.filter((r) => L.lineup(r.gameId, r.team).has(m.id));
    const without = shared.filter((r) => !L.lineup(r.gameId, r.team).has(m.id));
    const isOut = outTonight.has(normName(m.name));
    if (!without.length && !isOut) continue; // never apart: the pair would just repeat his average
    if (!withM.length) continue; // never together (e.g. out since he arrived): nothing to compare
    const last = m.name.split(' ').slice(1).join(' ') || m.name;
    out.push(row('Teammates', `with:${m.id}`, `With ${last}`, withM, stat, { mate: m.name, outTonight: isOut }));
    out.push(row('Teammates', `without:${m.id}`, `Without ${last}`, without, stat, { mate: m.name, outTonight: isOut }));
  }
  return out;
}
