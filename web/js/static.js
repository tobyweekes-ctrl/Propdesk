// In-browser backend for the static (GitHub Pages) build. Runs the same routes as the Node
// server (server/routes.mjs) over prebuilt data files (refreshed by the scheduled GitHub Action),
// and keeps manual lines + the bet log in this browser's storage. If the data is from an earlier
// day, tonight's slate is fetched from ESPN directly as a fallback.
import { createRoutes, dispatch } from '../server/routes.mjs';
import { indexLeague, linesFor, ladderFor } from '../server/data/league.mjs';
import { teamAbbr } from '../server/teams.mjs';
import { todayET } from '../server/util.mjs';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const KEY = 'propdesk.entries.v1';
const getJson = async (url) => { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };

let ready;
function load() {
  ready ||= (async () => {
    const meta = await getJson('data/meta.json');
    const v = encodeURIComponent(meta.generated);
    const [s0, s1, slates, injuries, odds] = await Promise.all([
      getJson(`data/season-${meta.previous}.json?v=${v}`), getJson(`data/season-${meta.current}.json?v=${v}`),
      getJson(`data/slate.json?v=${v}`), getJson(`data/injuries.json?v=${v}`), getJson(`data/odds.json?v=${v}`),
    ]);
    const expand = (S) => ({
      season: S.season, source: S.source,
      players: S.players.map(([id, name, team, pos]) => ({ id, name, team, pos })),
      games: S.rows.map((r) => {
        const o = Object.fromEntries(S.cols.map((c, i) => [c, r[i]]));
        o.home = o.home === 1; o.starter = o.starter === 1;
        return o;
      }),
    });
    const today = todayET();
    const L = indexLeague({ current: meta.current, previous: meta.previous, seasons: { [meta.current]: expand(s1), [meta.previous]: expand(s0) }, today, source: s1.source });
    return { meta, L, today, slates, injuries, odds, live: { slate: null } };
  })();
  return ready;
}

// ---------- live refresh (ESPN allows browser requests) ----------
async function liveSlate(D) {
  if (D.slates[D.today]?.length && D.meta.today === D.today) return D.slates[D.today];
  if (D.live.slate) return D.live.slate;
  try {
    const json = await getJson(`${ESPN}/scoreboard?dates=${D.today.replaceAll('-', '')}`);
    D.live.slate = (json.events || []).map((e) => {
      const c = e.competitions?.[0] || {};
      const side = (ha) => teamAbbr(c.competitors?.find((x) => x.homeAway === ha)?.team?.abbreviation);
      return { gameId: String(e.id), date: D.today, tipoff: e.date, status: e.status?.type?.shortDetail || '', home: side('home'), away: side('away') };
    }).filter((g) => g.home && g.away);
  } catch {
    D.live.slate = D.slates[D.today] || [];
  }
  return D.live.slate;
}

// ---------- browser storage for manual lines + bets ----------
const store = {
  read() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } },
  write(all) { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { throw Object.assign(new Error(`could not save in this browser: ${e.message}`), { status: 500 }); } },
};
const entries = {
  list: () => store.read(),
  add(e) {
    const all = store.read();
    const entry = { id: crypto.randomUUID?.() || String(Date.now() + Math.random()), createdAt: new Date().toISOString(), bet: null, ...e };
    all.push(entry); store.write(all); return entry;
  },
  update(id, patch) {
    const all = store.read(); const i = all.findIndex((x) => x.id === id);
    if (i < 0) return null;
    all[i] = { ...all[i], ...patch, id }; store.write(all); return all[i];
  },
  remove(id) { const all = store.read(); const next = all.filter((x) => x.id !== id); store.write(next); return next.length !== all.length; },
};
export const exportEntries = () => JSON.stringify(store.read(), null, 1);
export function importEntries(text) {
  const incoming = JSON.parse(text);
  if (!Array.isArray(incoming)) throw new Error('not a Prop Desk export');
  const all = store.read();
  const ids = new Set(all.map((e) => e.id));
  const added = incoming.filter((e) => e && e.id && e.playerId && !ids.has(e.id));
  store.write([...all, ...added]);
  return added.length;
}

// ---------- backend ----------
let routes;
async function backend() {
  const D = await load();
  const B = {
    getLeague: async () => D.L,
    today: () => D.today,
    getSlate: async (date = D.today) => (date === D.today ? liveSlate(D) : D.slates[date] || []),
    gameFor: async (team) => (await B.getSlate()).find((g) => g.home === team || g.away === team) || null,
    getInjuries: async () => D.injuries,
    async getPlayerLines(player, stat) {
      const game = await B.gameFor(player.team);
      if (!game) return { game: null, lines: [], ladder: [], source: null };
      const o = D.odds.games?.[game.gameId];
      const lines = o ? linesFor(o.rows, player, stat) : [];
      const ladder = o ? ladderFor(o.rows, player, stat) : [];
      const spread = o?.homeSpread == null ? null : game.home === player.team ? o.homeSpread : -o.homeSpread;
      return { game, lines, ladder, source: o?.sources?.join(' + ') || null, spread, cacheAgeSec: D.odds.fetchedAt ? Math.round((Date.now() - Date.parse(D.odds.fetchedAt)) / 1000) : null };
    },
    status: () => ({
      today: D.today, static: true, dataAsOf: D.meta.generated,
      statsProvider: D.meta.statsSource, injuryProvider: 'ESPN',
      odds: D.meta.odds.sources?.length ? D.meta.odds.sources.join(' + ') : 'none',
      oddsQuota: D.meta.odds.quota || {}, keys: { oddsApi: D.meta.odds.enabled },
      stale: D.meta.today !== D.today,
    }),
    entries,
  };
  routes ||= createRoutes(B);
  return routes;
}

// ---------- light routes: answered from small files, without downloading the season data ----------
let metaP;
const meta = () => (metaP ||= getJson('data/meta.json'));
const light = {
  '/api/stats': async () => (await meta()).stats,
  '/api/health': async () => {
    const m = await meta();
    return { ok: true, static: true, today: todayET(), dataAsOf: m.generated, statsProvider: m.statsSource, injuryProvider: 'ESPN',
      odds: m.odds.sources?.length ? m.odds.sources.join(' + ') : 'none', oddsQuota: m.odds.quota || {}, stale: m.today !== todayET() };
  },
  '/api/slate/players': async () => {
    const m = await meta();
    const l = await getJson(`data/landing.json?v=${encodeURIComponent(m.generated)}`);
    return l.date === todayET() ? Object.assign(l.games, { best: l.best, pool: l.pool || [], benefits: l.benefits || [] }) : null; // a day old: fall through to the full data
  },
  '/api/record': async () => getJson(`data/record.json?v=${encodeURIComponent((await meta()).generated)}`),
};

/** Same contract as fetch('/api/...'): resolves with the JSON result or throws Error(message). */
export async function staticApi(path, method = 'GET', body) {
  const url = new URL(path, location.href);
  const pathname = url.pathname.slice(url.pathname.indexOf('/api/'));
  if (method === 'GET' && light[pathname]) {
    const r = await light[pathname]().catch(() => null);
    if (r != null) return r;
  }
  return dispatch(await backend(), method, pathname, url.searchParams, body ? JSON.parse(JSON.stringify(body)) : {});
}
