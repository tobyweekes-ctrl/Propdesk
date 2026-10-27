// Data service: picks providers from config, caches their responses, and builds an indexed
// League (two seasons of box scores + derived team/position/usage data). Everything the API,
// model and backtest need comes through here.
import { config } from '../env.mjs';
import { cached, cacheAge } from '../cache.mjs';
import { nbaStatsProvider } from '../providers/nbaStats.mjs';
import { balldontlieProvider } from '../providers/balldontlie.mjs';
import { espnProvider } from '../providers/espn.mjs';
import { espnInjuryProvider } from '../providers/espnInjuries.mjs';
import { oddsApiProvider, quota } from '../providers/oddsApi.mjs';
import { demoProvider, demoInjuries, demoEventProps } from '../providers/demo.mjs';
import { seasonOf, prevSeason, todayET } from '../util.mjs';
import { recordOddsSnapshot } from './userdata.mjs';
import { indexLeague, searchPlayers, averages, injuryFor, linesFor } from './league.mjs';

export { indexLeague, searchPlayers, averages, injuryFor, linesFor };

const HOUR = 3600;
export const today = () => todayET(config.today);
const demo = () => config.statsProvider === 'demo';

function statsProvider() {
  if (demo()) return demoProvider(today());
  if (config.statsProvider === 'balldontlie') return balldontlieProvider;
  if (config.statsProvider === 'nba') return nbaStatsProvider;
  return espnProvider;
}

// ---------- seasons ----------
export async function loadSeason(season) {
  const p = statsProvider();
  if (p.name === 'demo') return p.loadSeason(season);
  const key = `season:${p.name}:${season}`;
  const isCurrent = season === seasonOf(today());
  if (!isCurrent) return cached(key, Infinity, () => p.loadSeason(season));
  if (p.name === 'balldontlie') {
    // incremental top-up: keep cached rows, fetch only from the last cached date onward
    return cached(key, 3 * HOUR, async () => {
      const prev = await cached(`${key}:base`, Infinity, () => p.loadSeason(season));
      const since = prev.games.at(-1)?.date;
      if (!since) return p.loadSeason(season);
      const fresh = await p.loadSeason(season, since);
      const seen = new Set(fresh.games.map((g) => `${g.playerId}|${g.gameId}`));
      const games = [...prev.games.filter((g) => !seen.has(`${g.playerId}|${g.gameId}`)), ...fresh.games];
      const players = new Map([...prev.players, ...fresh.players].map((x) => [x.id, x]));
      return { ...prev, games, players: [...players.values()] };
    });
  }
  return cached(key, 3 * HOUR, () => p.loadSeason(season));
}

// ---------- league ----------
let leaguePromise = null;
let leagueBuiltFor = null;

/** Two seasons, indexed. Rebuilt when the date changes or the current-season cache expires. */
export async function getLeague() {
  const stamp = `${today()}|${Math.floor(Date.now() / (3 * HOUR * 1000))}`;
  if (!leaguePromise || leagueBuiltFor !== stamp) {
    leagueBuiltFor = stamp;
    leaguePromise = buildLeague().catch((e) => { leaguePromise = null; throw e; });
  }
  return leaguePromise;
}

async function buildLeague() {
  const cur = seasonOf(today());
  const prev = prevSeason(cur);
  const [S1, S0] = await Promise.all([loadSeason(cur), loadSeason(prev)]);
  return indexLeague({ current: cur, previous: prev, seasons: { [cur]: S1, [prev]: S0 }, today: today(), source: S1.source });
}

// ---------- schedule ----------
export async function getSlate(date = today()) {
  const p = statsProvider();
  const games = p.name === 'demo'
    ? await p.schedule(date)
    : await cached(`schedule:${p.name}:${date}`, HOUR, () => p.schedule(date));
  if (oddsApiProvider.enabled()) {
    try {
      const events = await getOddsEvents();
      for (const g of games) {
        // tipoff is UTC, so an evening ET game can fall on the next UTC day: match within ~18h of 7pm ET
        const e = events.find((x) => x.home === g.home && x.away === g.away
          && Math.abs(Date.parse(x.tipoff) - Date.parse(`${date}T23:00:00Z`)) < 18 * HOUR * 1000);
        if (e) { g.eventId = e.eventId; g.tipoff ||= e.tipoff; }
      }
    } catch (err) {
      console.warn('[odds] events unavailable:', err.message);
    }
  } else if (demo()) {
    for (const g of games) g.eventId = `demo:${g.gameId}`;
  }
  return games;
}

export async function gameFor(team, date = today()) {
  const slate = await getSlate(date);
  return slate.find((g) => g.home === team || g.away === team) || null;
}

// ---------- injuries ----------
export async function getInjuries() {
  if (demo() || config.injuryProvider === 'demo') return demoInjuries();
  return cached('injuries:espn', 30 * 60, () => espnInjuryProvider.load());
}

// ---------- odds ----------
async function getOddsEvents() {
  return cached('odds:events', 30 * 60, () => oddsApiProvider.events());
}

/** { rows, homeSpread } for a game. Live fetches are also saved as snapshots for the real-line backtest. */
export async function eventProps(game) {
  if (!game?.eventId) return { rows: [], homeSpread: null };
  if (game.eventId.startsWith('demo:')) return { rows: demoEventProps(game.gameId, game.date), homeSpread: null };
  return cached(`odds:props:${game.eventId}`, config.oddsTtlMin * 60, async () => {
    const res = await oddsApiProvider.eventProps(game.eventId);
    try {
      recordOddsSnapshot({ date: game.date, eventId: game.eventId, gameId: game.gameId, tipoff: game.tipoff, home: game.home, away: game.away, rows: res.rows });
    } catch (err) {
      console.warn('[userdata] snapshot not saved:', err.message);
    }
    return res;
  });
}

/** All bookmaker lines for one player + stat in tonight's game (best prices flagged, see linesFor). */
export async function getPlayerLines(player, stat, date = today()) {
  const game = await gameFor(player.team, date);
  if (!game) return { game: null, lines: [], source: null };
  const { rows, homeSpread } = await eventProps(game);
  const lines = linesFor(rows, player, stat);
  const source = game.eventId?.startsWith('demo:') ? 'demo' : oddsApiProvider.enabled() ? 'The Odds API' : null;
  const spread = homeSpread == null ? null : game.home === player.team ? homeSpread : -homeSpread;
  return { game, lines, source, spread, cacheAgeSec: game.eventId ? cacheAge(`odds:props:${game.eventId}`) : null };
}

export function status() {
  return {
    today: today(),
    statsProvider: statsProvider().name,
    injuryProvider: demo() ? 'demo' : config.injuryProvider,
    odds: demo() ? 'demo' : oddsApiProvider.enabled() ? 'The Odds API' : 'disabled (no ODDS_API_KEY)',
    oddsSpreads: config.oddsFetchSpreads,
    oddsQuota: quota,
    keys: { balldontlie: Boolean(config.balldontlieKey), oddsApi: Boolean(config.oddsKey) },
  };
}
