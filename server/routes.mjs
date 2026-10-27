// API routes, written once for both runtimes:
//   Node server (server/index.mjs)  -> backend fetches live data and stores entries in files
//   static site (web/js/static.js)  -> backend reads prebuilt data files, stores entries in the browser
// Handlers receive (params, URLSearchParams, body) and return JSON-able values.
import { STATS } from './stats.mjs';
import { round } from './util.mjs';
import { searchPlayers, averages, injuryFor } from './data/league.mjs';
import { grade, summariseBets } from './data/entries.mjs';
import { analyse } from './model/index.mjs';
import { computeSplits } from './data/splits.mjs';
import { parsePrice } from './model/odds.mjs';

const fail = (status, msg) => { throw Object.assign(new Error(msg), { status }); };

/**
 * @param B backend: { getLeague, getSlate, gameFor, getInjuries, getPlayerLines, status, today,
 *                     entries: { list, add, update, remove } }
 * @returns [{ method, re, handler }]
 */
export function createRoutes(B) {
  const routes = [];
  const route = (method) => (pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });
  const get = route('GET'), post = route('POST'), patch = route('PATCH'), del = route('DELETE');


  get('/api/health', async () => ({ ok: true, ...(await B.status()) }));

  get('/api/stats', async () => STATS);

  get('/api/players/search', async (_p, q) => {
    const L = await B.getLeague();
    return searchPlayers(L, q.get('q') || '', Number(q.get('limit') || 10));
  });

  get('/api/slate', async (_p, q) => B.getSlate(q.get('date') || B.today()));

  get('/api/injuries', async () => B.getInjuries());

  // tonight's games with each side's main players (by recent minutes), for the landing page
  get('/api/slate/players', async () => {
    const L = await B.getLeague();
    const [games, injuries] = await Promise.all([B.getSlate(), B.getInjuries().catch(() => [])]);
    const top = (team) => [...L.players.values()]
      .filter((p) => p.team === team)
      .map((p) => {
        const recent = L.playerLogs(p.id).filter((r) => r.team === team).slice(-10);
        return { p, recent, min: recent.reduce((a, r) => a + r.min, 0) / Math.max(1, recent.length) };
      })
      .filter((x) => x.recent.length >= 3)
      .sort((a, b) => b.min - a.min)
      .slice(0, 5)
      .map(({ p, recent, min }) => {
        const a = averages(recent);
        return { id: p.id, name: p.name, pos: p.pos, min: round(min), pts: a.pts, reb: a.reb, ast: a.ast, injury: injuryFor(injuries, p)?.status || null };
      });
    return games.map((g) => ({ ...g, homePlayers: top(g.home), awayPlayers: top(g.away) }));
  });

  get('/api/teams', async () => {
    const L = await B.getLeague();
    const cur = L.bySeason[L.current], prev = L.bySeason[L.previous];
    return {
      current: L.current, previous: L.previous,
      league: { [L.current]: cur.summary.league, [L.previous]: prev.summary.league },
      teams: Object.fromEntries(Object.keys(prev.summary.teams).concat(Object.keys(cur.summary.teams)).map((t) => [t, {
        [L.current]: cur.summary.teams[t] || null,
        [L.previous]: prev.summary.teams[t] || null,
        posDef: { [L.current]: cur.posDef[t] || null, [L.previous]: prev.posDef[t] || null },
      }])),
    };
  });

  get('/api/player/:id', async ({ id }) => {
    const L = await B.getLeague();
    const p = L.players.get(id);
    if (!p) throw Object.assign(new Error('player not found'), { status: 404 });
    const logs = L.playerLogs(id);
    const cur = logs.filter((r) => r.season === L.current);
    const prev = logs.filter((r) => r.season === L.previous);
    const [game, injuries] = await Promise.all([B.gameFor(p.team), B.getInjuries().catch(() => [])]);
    const opp = game ? (game.home === p.team ? game.away : game.home) : null;
    return {
      player: { ...p },
      game: game && { ...game, opp, home: game.home === p.team, restDays: L.restDays(p.team, L.today), oppRestDays: L.restDays(opp, L.today) },
      injury: injuryFor(injuries, p),
      absence: L.absence(id),
      averages: {
        [L.current]: averages(cur),
        [L.previous]: averages(prev),
        last5: averages(logs.slice(-5)),
        last10: averages(logs.slice(-10)),
      },
      logs: logs.slice(-40).reverse().map((r) => ({ ...r, usg: round(r.usg) })),
    };
  });

  get('/api/player/:id/splits', async ({ id }, q) => {
    const L = await B.getLeague();
    const p = L.players.get(id) || fail(404, 'player not found');
    const stat = q.get('stat') || 'pts';
    if (!STATS[stat]) fail(400, `unknown stat ${stat}`);
    const [g, injuries] = await Promise.all([B.gameFor(p.team), B.getInjuries().catch(() => [])]);
    const opp = g ? (g.home === p.team ? g.away : g.home) : null;
    return computeSplits(L, id, stat, { opp, injuries });
  });

  get('/api/player/:id/lines', async ({ id }, q) => {
    const L = await B.getLeague();
    const p = L.players.get(id);
    if (!p) throw Object.assign(new Error('player not found'), { status: 404 });
    const stat = q.get('stat') || 'pts';
    if (!STATS[stat]) throw Object.assign(new Error(`unknown stat ${stat}`), { status: 400 });
    return B.getPlayerLines(p, stat);
  });

  // ---------- model ----------
  async function playerAndGame(id) {
    const L = await B.getLeague();
    const p = L.players.get(id) || fail(404, 'player not found');
    const g = await B.gameFor(p.team);
    const game = g && { date: L.today, gameId: g.gameId, team: p.team, opp: g.home === p.team ? g.away : g.home, home: g.home === p.team, tipoff: g.tipoff };
    return { L, p, game };
  }

  /** Run the model on every line we have for this player + stat: books, saved manual lines, a preview line. */
  async function runAnalysis(id, stat, { preview = null, minutesOverride = null } = {}) {
    if (!STATS[stat]) fail(400, `unknown stat ${stat}`);
    const { L, p, game } = await playerAndGame(id);
    if (!game) return { player: p, game: null, analysis: null };
    const [feed, injuries] = await Promise.all([B.getPlayerLines(p, stat), B.getInjuries().catch(() => [])]);
    const manual = (await B.entries.list()).filter((e) => e.source === 'manual' && e.playerId === id && e.stat === stat && e.date === L.today);
    const lines = [
      ...feed.lines.map((l) => ({ ...l, id: `api:${l.book}:${l.line}`, source: feed.source })),
      ...manual.map((e) => ({ id: e.id, book: e.book, bookTitle: e.book, line: e.line, over: e.over, under: e.under, source: 'manual' })),
      ...(preview ? [{ ...preview, id: 'preview', bookTitle: preview.book || 'Preview', source: 'preview' }] : []),
    ];
    const analysis = analyse({ L, playerId: id, game, stat, lines, opts: { injuries, spread: feed.spread, minutesOverride } });
    return { player: p, game: { ...game, spread: feed.spread }, linesSource: feed.source, oddsAgeSec: feed.cacheAgeSec, analysis, manual };
  }

  get('/api/player/:id/analysis', async ({ id }, q) => {
    const num = (k) => (q.get(k) != null && q.get(k) !== '' ? Number(q.get(k)) : null);
    const preview = num('line') != null ? { line: num('line'), over: q.get('over'), under: q.get('under'), book: q.get('book') || 'Preview' } : null;
    return runAnalysis(id, q.get('stat') || 'pts', { preview, minutesOverride: num('min') });
  });

  // ---------- manual lines + bet log ----------
  function validBet(bet, over, under) {
    if (!bet) return null;
    if (!['over', 'under'].includes(bet.side)) fail(400, 'bet.side must be over or under');
    const price = parsePrice(bet.price ?? (bet.side === 'over' ? over : under)) || fail(400, 'bet needs a price');
    const stake = Number(bet.stake ?? 1);
    if (!(stake > 0)) fail(400, 'stake must be positive');
    return { side: bet.side, stake, price, takenAt: new Date().toISOString() };
  }

  post('/api/entries', async (_p, _q, body) => {
    const { playerId, stat, book, source = 'manual' } = body;
    const line = Number(body.line);
    if (!STATS[stat]) fail(400, `unknown stat ${stat}`);
    if (!Number.isFinite(line) || line < 0) fail(400, 'line must be a number');
    const over = parsePrice(body.over), under = parsePrice(body.under);
    if (!over && !under) fail(400, 'enter at least one price (decimal 1.91, fractional 10/11 or American -110)');
    if (!book || !String(book).trim()) fail(400, 'bookie name required');
    const { p, game } = await playerAndGame(playerId);
    if (!game) fail(400, `${p.name} has no game today`);
    const res = await runAnalysis(playerId, stat, { preview: { line, over, under, book } });
    const e = res.analysis?.evals.find((x) => x.id === 'preview');
    return B.entries.add({
      source: source === 'api' ? 'api' : 'manual',
      date: game.date, gameId: game.gameId, playerId, playerName: p.name, team: p.team, opp: game.opp, home: game.home,
      stat, line, over, under, book: String(book).trim().slice(0, 40),
      model: e && {
        pOver: e.model.over, pUnder: e.model.under, edgeOver: e.edge.over, edgeUnder: e.edge.under,
        evOver: e.ev.over, evUnder: e.ev.under, verdict: e.verdict, confidence: e.confidence,
        mean: res.analysis.projection.mean, minutes: res.analysis.projection.minutes.proj,
      },
      bet: validBet(body.bet, over, under),
    });
  });

  patch('/api/entries/:id', async ({ id }, _q, body) => {
    const e = (await B.entries.list()).find((x) => x.id === id) || fail(404, 'entry not found');
    const out = await B.entries.update(id, { bet: body.bet === null ? null : validBet(body.bet, e.over, e.under) });
    return out;
  });

  del('/api/entries/:id', async ({ id }) => ({ deleted: await B.entries.remove(id) }));

  get('/api/entries', async (_p, q) => {
    const L = await B.getLeague();
    return (await B.entries.list())
      .filter((e) => (!q.get('date') || e.date === q.get('date')) && (!q.get('playerId') || e.playerId === q.get('playerId')) && (!q.get('stat') || e.stat === q.get('stat')))
      .map((e) => ({ ...e, result: grade(L, e) }));
  });

  get('/api/bets', async () => summariseBets(await B.getLeague(), await B.entries.list()));

  return routes;
}

/** Find and run the route for a request. Throws {status} errors like the handlers do. */
export async function dispatch(routes, method, pathname, searchParams, body = {}) {
  const r = routes.find((x) => x.method === method && x.re.test(pathname));
  if (!r) fail(404, 'not found');
  const params = Object.fromEntries(Object.entries(pathname.match(r.re).groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
  return r.handler(params, searchParams, body);
}
