// Pure league functions shared by the Node server and the static (GitHub Pages) build:
// indexing two seasons of box scores, player search, averages, injury matching, bookmaker lines.
// No I/O and no Node APIs, so the browser can import this file directly.
import { teamGames, teamSummaries, addUsage, positionDefense, posGroup, absenceInfo, restDays } from './derive.mjs';
import { normName, mean, round } from '../util.mjs';
import { STATS, statValue } from '../stats.mjs';

/** Build indexes from raw season bundles. Exported so the backtest can index a truncated copy. */
export function indexLeague({ current, previous, seasons, today: asOf, source }) {
  const players = new Map();
  for (const s of [previous, current]) {
    for (const p of seasons[s].players) players.set(p.id, { ...players.get(p.id), ...p, pos: p.pos || players.get(p.id)?.pos || '' });
  }
  for (const p of players.values()) p.group = posGroup(p.pos);
  const groupOf = (id) => players.get(id)?.group ?? 'F';

  const bySeason = {};
  const logs = new Map();
  const teamDates = new Map();
  const teamGameList = new Map();
  for (const s of [previous, current]) {
    const rows = seasons[s].games.filter((g) => g.date < asOf).map((g) => ({ ...g, season: s }));
    const tgs = teamGames(rows);
    addUsage(rows, tgs);
    bySeason[s] = { rows, teamGames: tgs, summary: teamSummaries(tgs), posDef: positionDefense(rows, groupOf) };
    for (const r of rows) {
      if (!logs.has(r.playerId)) logs.set(r.playerId, []);
      logs.get(r.playerId).push(r);
    }
    for (const t of tgs) {
      if (!teamDates.has(t.team)) { teamDates.set(t.team, []); teamGameList.set(t.team, []); }
      teamDates.get(t.team).push(t.date);
      teamGameList.get(t.team).push(t);
    }
  }
  for (const l of logs.values()) l.sort((a, b) => a.date.localeCompare(b.date));
  const tgIndex = new Map();
  for (const s of Object.values(bySeason)) for (const t of s.teamGames) tgIndex.set(`${t.gameId}|${t.team}`, t);

  return {
    today: asOf, current, previous, source, players, logs, bySeason, teamDates, teamGameList, tgIndex,
    groupOf,
    playerLogs: (id) => logs.get(id) || [],
    /** players who appeared for `team` in that game (for with/without splits) */
    lineup: (gameId, team) => new Set(tgIndex.get(`${gameId}|${team}`)?.players || []),
    restDays: (team, date) => restDays(teamDates.get(team) || [], date),
    absence: (id) => {
      const p = players.get(id);
      return absenceInfo(logs.get(id) || [], teamGameList.get(p?.team) || [], asOf);
    },
  };
}

export function searchPlayers(L, q, limit = 10) {
  const nq = normName(q);
  if (!nq) return [];
  const terms = nq.split(' ');
  const scored = [];
  for (const p of L.players.values()) {
    const n = normName(p.name);
    if (!terms.every((t) => n.includes(t))) continue;
    const logs = L.playerLogs(p.id);
    const recent = logs.filter((r) => r.season === L.current);
    const basis = recent.length ? recent : logs.filter((r) => r.season === L.previous);
    const words = n.split(' ');
    let score = 0;
    if (n.startsWith(nq)) score += 3;
    if (words.some((w) => w.startsWith(terms[0]))) score += 2;
    score += Math.min(2, mean(basis.map((r) => r.min)) / 18 || 0); // regulars first
    if (!logs.length) score -= 2;
    scored.push({ p, score, basis });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(({ p, basis }) => ({
    id: p.id, name: p.name, team: p.team, pos: p.pos,
    gp: basis.length,
    min: round(mean(basis.map((r) => r.min))),
    pts: round(mean(basis.map((r) => r.pts))),
    reb: round(mean(basis.map((r) => r.reb))),
    ast: round(mean(basis.map((r) => r.ast))),
  }));
}

/** Averages over a set of rows for every stat key, plus minutes and usage. */
export function averages(rows) {
  const o = { gp: rows.length, min: round(mean(rows.map((r) => r.min))), usg: round(mean(rows.map((r) => r.usg).filter((x) => x != null))) };
  for (const k of Object.keys(STATS)) o[k] = round(mean(rows.map((r) => statValue(r, k))));
  return o;
}

export function injuryFor(injuries, player) {
  const n = normName(player.name);
  return injuries.find((i) => normName(i.name) === n && (!i.team || i.team === player.team))
    || injuries.find((i) => normName(i.name) === n) || null;
}

/**
 * Bookmaker rows for one player + stat, sorted, with the best over and under flagged.
 * "Best" for an over = lowest line, then highest price; for an under = highest line, then highest price.
 */
export function linesFor(rows, player, stat) {
  const n = normName(player.name);
  const lines = rows.filter((r) => r.stat === stat && normName(r.player) === n)
    .map((r) => ({ book: r.book, bookTitle: r.bookTitle, line: r.line, over: r.over, under: r.under, updated: r.updated }))
    .sort((a, b) => a.line - b.line || a.bookTitle.localeCompare(b.bookTitle));
  const pick = (cmp) => lines.filter((l) => l.over && l.under).reduce((best, l) => (!best || cmp(l, best) ? l : best), null);
  const bestOver = pick((l, b) => l.line < b.line || (l.line === b.line && l.over > b.over));
  const bestUnder = pick((l, b) => l.line > b.line || (l.line === b.line && l.under > b.under));
  for (const l of lines) { l.bestOver = l === bestOver; l.bestUnder = l === bestUnder; }
  return lines;
}
