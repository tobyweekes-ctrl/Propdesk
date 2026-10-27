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
import { espnOddsProvider } from '../providers/espnOdds.mjs';
import { demoProvider, demoInjuries, demoEventProps } from '../providers/demo.mjs';
import { seasonOf, prevSeason, todayET, normName } from '../util.mjs';
import { checkLines } from './checks.mjs';
import { recordOddsSnapshot } from './userdata.mjs';
import { indexLeague, searchPlayers, averages, injuryFor, linesFor, ladderFor } from './league.mjs';

export { indexLeague, searchPlayers, averages, injuryFor, linesFor, ladderFor };

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

const snapshot = (game, rows, source) => {
  try {
    recordOddsSnapshot({ date: game.date, eventId: game.eventId || game.gameId, gameId: game.gameId, tipoff: game.tipoff, home: game.home, away: game.away, source, rows });
  } catch (err) {
    console.warn('[userdata] snapshot not saved:', err.message);
  }
};

/**
 * { rows, homeSpread, sources } for a game, merging every line source:
 *   - DraftKings via ESPN (free; needs ESPN game ids, i.e. STATS_PROVIDER=espn)
 *   - The Odds API (needs ODDS_API_KEY; skipped when opts.oddsApi === false to save credits)
 * Every live fetch is also saved as a snapshot for the real-line backtest.
 */
export async function eventProps(game, opts = {}) {
  if (!game) return { rows: [], homeSpread: null, sources: [] };
  if (game.eventId?.startsWith('demo:')) return { rows: demoEventProps(game.gameId, game.date), homeSpread: null, sources: ['demo'] };
  const ttl = config.oddsTtlMin * 60;
  const [dk, oa] = await Promise.all([
    config.statsProvider === 'espn' && config.espnProps
      ? cached(`odds:espn:${game.gameId}`, ttl, async () => {
        const res = await espnOddsProvider.eventProps(game.gameId);
        snapshot(game, res.rows, 'draftkings-espn');
        return res;
      }).catch((e) => (console.warn(`[espn odds] ${game.away}@${game.home}:`, e.message), null))
      : null,
    game.eventId && oddsApiProvider.enabled() && opts.oddsApi !== false
      ? cached(`odds:props:${game.eventId}`, ttl, async () => {
        const res = await oddsApiProvider.eventProps(game.eventId);
        snapshot(game, res.rows, 'the-odds-api');
        return res;
      }).catch((e) => (console.warn(`[odds api] ${game.away}@${game.home}:`, e.message), null))
      : null,
  ]);
  // validate before anything uses the lines (see data/checks.mjs)
  const L = await getLeague();
  const nameTeam = new Map([...L.players.values()].map((p) => [normName(p.name), p.team]));
  const { rows, issues } = checkLines([...(dk?.rows || []), ...(oa?.rows || [])], {
    fetchedAt: dk?.fetchedAt || new Date().toISOString(),
    teams: [game.home, game.away],
    teamOf: (r) => (r.playerId ? L.players.get(r.playerId)?.team : nameTeam.get(normName(r.player || ''))) ?? null,
  });
  return {
    rows,
    homeSpread: oa?.homeSpread ?? null,
    sources: [dk?.rows?.length && 'DraftKings (ESPN)', oa?.rows?.length && 'The Odds API'].filter(Boolean),
    check: dk?.check ? { ...dk.check, ...issues } : issues,
    fetchedAt: dk?.fetchedAt || null,
  };
}

/** Bookmaker O/U lines (best prices flagged) and milestone ladders for one player + stat tonight. */
export async function getPlayerLines(player, stat, date = today()) {
  const game = await gameFor(player.team, date);
  if (!game) return { game: null, lines: [], ladder: [], source: null };
  const { rows, homeSpread, sources } = await eventProps(game);
  const lines = linesFor(rows, player, stat);
  const ladder = ladderFor(rows, player, stat);
  const spread = homeSpread == null ? null : game.home === player.team ? homeSpread : -homeSpread;
  const age = cacheAge(`odds:espn:${game.gameId}`) ?? (game.eventId ? cacheAge(`odds:props:${game.eventId}`) : null);
  return { game, lines, ladder, source: sources.join(' + ') || null, spread, cacheAgeSec: age };
}

export function status() {
  return {
    today: today(),
    statsProvider: statsProvider().name,
    injuryProvider: demo() ? 'demo' : config.injuryProvider,
    odds: demo() ? 'demo' : [config.statsProvider === 'espn' && config.espnProps && 'DraftKings (ESPN)', oddsApiProvider.enabled() && 'The Odds API'].filter(Boolean).join(' + ') || 'none',
    oddsSpreads: config.oddsFetchSpreads,
    oddsQuota: quota,
    keys: { balldontlie: Boolean(config.balldontlieKey), oddsApi: Boolean(config.oddsKey) },
  };
}
