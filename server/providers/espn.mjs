// ESPN public JSON (site.api.espn.com): real NBA box scores with no API key.
// It is unofficial, so nba_api (stats.nba.com) and balldontlie stay available as alternatives.
//
// Cost: one scoreboard call per date plus one summary (box score) per game. A full past season
// is ~175 + ~1,230 requests, fetched once and cached forever per date / per game, so an
// interrupted pull resumes where it stopped. The current season only fetches new days.
import { fetchJson } from '../http.mjs';
import { cached } from '../cache.mjs';
import { teamAbbr } from '../teams.mjs';
import { addDays, parseMinutes, seasonStartYear, todayET } from '../util.mjs';
import { config } from '../env.mjs';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const get = (path) => fetchJson(`${BASE}${path}`, { minGapMs: 150, timeoutMs: 20000 }).then((r) => r.json);
const ymd = (d) => d.replaceAll('-', '');

/** Events on one ET calendar date. Past dates never change, so they're cached forever. */
async function scoreboard(date, today) {
  const ttl = date < addDays(today, -1) ? Infinity : date < today ? 3 * 3600 : 600;
  return cached(`espn:scoreboard:${date}`, ttl, async () => {
    const json = await get(`/scoreboard?dates=${ymd(date)}&limit=100`);
    return (json.events || []).map((e) => {
      const c = e.competitions?.[0] || {};
      const side = (ha) => c.competitors?.find((x) => x.homeAway === ha);
      return {
        gameId: String(e.id),
        date,
        tipoff: e.date,
        seasonType: e.season?.type,
        final: e.status?.type?.completed === true,
        status: e.status?.type?.shortDetail || e.status?.type?.description || '',
        home: teamAbbr(side('home')?.team?.abbreviation),
        away: teamAbbr(side('away')?.team?.abbreviation),
      };
    });
  });
}

/** Box score of one finished game -> { rows, dnps, players }. */
export function normaliseSummary(json, game) {
  const rows = [], dnps = [], players = [];
  for (const t of json.boxscore?.players || []) {
    const team = teamAbbr(t.team?.abbreviation);
    const home = team === game.home;
    const opp = home ? game.away : game.home;
    const block = t.statistics?.[0];
    if (!block) continue;
    const idx = Object.fromEntries((block.keys || []).map((k, i) => [k, i]));
    const pair = (k, s) => { const v = s[idx[k]]; const [a, b] = String(v ?? '0-0').split('-'); return [Number(a) || 0, Number(b) || 0]; };
    const num = (k, s) => Number(s[idx[k]]) || 0;
    for (const a of block.athletes || []) {
      const ath = a.athlete || {};
      const id = String(ath.id);
      players.push({ id, name: ath.displayName, team, pos: ath.position?.abbreviation || '' });
      const s = a.stats || [];
      const min = parseMinutes(s[idx.minutes]);
      if (a.didNotPlay || !s.length || min === 0) {
        dnps.push({ playerId: id, gameId: game.gameId, date: game.date, team, reason: a.reason || '' });
        continue;
      }
      const [fgm, fga] = pair('fieldGoalsMade-fieldGoalsAttempted', s);
      const [fg3m, fg3a] = pair('threePointFieldGoalsMade-threePointFieldGoalsAttempted', s);
      const [ftm, fta] = pair('freeThrowsMade-freeThrowsAttempted', s);
      rows.push({
        playerId: id, gameId: game.gameId, date: game.date, team, opp, home, starter: Boolean(a.starter),
        min, pts: num('points', s), reb: num('rebounds', s), ast: num('assists', s),
        fg3m, fg3a, fgm, fga, ftm, fta,
        oreb: num('offensiveRebounds', s), dreb: num('defensiveRebounds', s),
        tov: num('turnovers', s), stl: num('steals', s), blk: num('blocks', s), pf: num('fouls', s),
        pm: Number(String(s[idx.plusMinus] ?? '0').replace('+', '')) || 0,
      });
    }
  }
  return { rows, dnps, players };
}

const boxscore = (game) => cached(`espn:summary:${game.gameId}`, Infinity, async () => normaliseSummary(await get(`/summary?event=${game.gameId}`), game));

export const espnProvider = {
  name: 'ESPN',

  async loadSeason(season) {
    const today = todayET(config.today);
    const y = seasonStartYear(season);
    const end = [`${y + 1}-04-20`, addDays(today, -1)].sort()[0];
    const games = [];
    for (let d = `${y}-10-01`; d <= end; d = addDays(d, 1)) {
      for (const g of await scoreboard(d, today)) if (g.seasonType === 2 && g.final && g.home && g.away) games.push(g);
    }
    const rows = [], dnps = [];
    const players = new Map();
    let done = 0;
    for (const g of games) {
      const box = await boxscore(g);
      rows.push(...box.rows);
      dnps.push(...box.dnps);
      for (const p of box.players) players.set(p.id, { ...players.get(p.id), ...p, pos: p.pos || players.get(p.id)?.pos || '' });
      if (++done % 100 === 0) console.log(`[espn] ${season}: ${done}/${games.length} box scores`);
    }
    return { season, source: this.name, players: [...players.values()], games: rows, dnps };
  },

  async schedule(date) {
    const today = todayET(config.today);
    return (await scoreboard(date, today)).filter((g) => g.home && g.away).map(({ gameId, tipoff, status, home, away }) => ({ gameId, date, tipoff, status, home, away }));
  },
};
