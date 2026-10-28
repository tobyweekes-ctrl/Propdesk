// Build the static site for GitHub Pages into dist/:
//   - the frontend (web/) with a flag that switches it to in-browser mode
//   - the pure modules it needs (model, routes, league...), found by walking imports from
//     server/routes.mjs; the build fails if any of them reaches a Node-only module
//   - data files: two seasons of real box scores, the slate, injuries, and prop lines when
//     ODDS_API_KEY is set (the key stays in the build environment, never in dist/)
//
//   node scripts/build-static.mjs            (FETCH_ODDS=false skips the Odds API call)
import { mkdirSync, rmSync, readFileSync, writeFileSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { ROOT, config } from '../server/env.mjs';
import { loadSeason, getSlate, getInjuries, eventProps, today, getLeague, linesFor, injuryFor, averages } from '../server/data/store.mjs';
import { analyse, DEFAULTS } from '../server/model/index.mjs';
import { absenceImpact } from '../server/model/impact.mjs';
import { mergePicks, gradeRecord } from '../server/model/record.mjs';
import { quota } from '../server/providers/oddsApi.mjs';
import { STATS } from '../server/stats.mjs';
import { seasonOf, prevSeason, addDays } from '../server/util.mjs';

const DIST = join(ROOT, 'dist');
const t0 = Date.now();
rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, 'data'), { recursive: true });

// ---------- frontend ----------
cpSync(join(ROOT, 'web'), DIST, { recursive: true });
const html = readFileSync(join(DIST, 'index.html'), 'utf8')
  .replace('<script type="module"', '<script>window.PROPDESK_STATIC = true;</script>\n<script type="module"');
writeFileSync(join(DIST, 'index.html'), html);
writeFileSync(join(DIST, '.nojekyll'), '');

// ---------- pure modules (import closure of routes.mjs) ----------
const seen = new Set();
function copyClosure(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gm)) {
    const spec = m[1];
    if (!spec.startsWith('.')) throw new Error(`${relative(ROOT, file)} imports "${spec}": not allowed in the browser build`);
    copyClosure(resolve(dirname(file), spec));
  }
  const out = join(DIST, relative(ROOT, file));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, src);
}
copyClosure(join(ROOT, 'server/routes.mjs'));
copyClosure(join(ROOT, 'server/teams.mjs')); // used by the stale-data slate fallback
for (const f of seen) if (/env\.mjs|cache\.mjs|store\.mjs|userdata\.mjs/.test(f)) throw new Error(`Node-only module in browser build: ${f}`);
console.log(`modules: ${seen.size} copied`);

// ---------- data ----------
const day = today();
const cur = seasonOf(day), prev = prevSeason(cur);
const COLS = ['playerId', 'gameId', 'date', 'team', 'opp', 'home', 'starter', 'min', 'pts', 'reb', 'ast', 'fg3m', 'fg3a', 'fgm', 'fga', 'ftm', 'fta', 'oreb', 'dreb', 'tov', 'stl', 'blk', 'pf', 'pm'];
const compact = (S) => ({
  season: S.season,
  source: S.source,
  players: S.players.map((p) => [p.id, p.name, p.team, p.pos || '']),
  cols: COLS,
  rows: S.games.map((g) => COLS.map((c) => (typeof g[c] === 'boolean' ? (g[c] ? 1 : 0) : g[c] ?? 0))),
});
const seasons = {};
for (const s of [prev, cur]) {
  const S = await loadSeason(s);
  writeFileSync(join(DIST, 'data', `season-${s}.json`), JSON.stringify(compact(S)));
  seasons[s] = { rows: S.games.length, players: S.players.length, lastDate: S.games.at(-1)?.date ?? null };
  console.log(`season ${s}: ${S.games.length} rows`);
}

const slates = {};
for (const d of [day, addDays(day, 1)]) slates[d] = await getSlate(d).catch(() => []);
writeFileSync(join(DIST, 'data', 'slate.json'), JSON.stringify(slates));

const injuries = await getInjuries().catch((e) => (console.warn('injuries:', e.message), []));
writeFileSync(join(DIST, 'data', 'injuries.json'), JSON.stringify(injuries));

// Prop lines: DraftKings via ESPN on every build (free); The Odds API only when FETCH_ODDS allows (credits)
const useOddsApi = Boolean(config.oddsKey) && process.env.FETCH_ODDS !== 'false';
const odds = { fetchedAt: new Date().toISOString(), sources: [], games: {} };
const sources = new Set();
const checks = { games: 0, teamMismatch: 0, duplicates: 0, nonMonotone: 0, futureTimestamps: 0, stale: 0, ladderDropped: 0, sidesSwapped: 0, sidePairs: 0 };
for (const g of slates[day]) {
  const r = await eventProps({ ...g, date: day }, { oddsApi: useOddsApi });
  if (!r.rows.length) continue;
  odds.games[g.gameId] = { rows: r.rows, homeSpread: r.homeSpread, sources: r.sources, fetchedAt: r.fetchedAt };
  r.sources.forEach((x) => sources.add(x));
  const c = r.check || {};
  checks.games++;
  for (const k of ['teamMismatch', 'duplicates', 'nonMonotone', 'futureTimestamps', 'stale', 'ladderDropped']) checks[k] += c[k] || 0;
  checks.sidesSwapped += c.contradicted || 0; checks.sidePairs += c.pairs || 0;
  const ou = r.rows.filter((x) => x.kind !== 'ms').length;
  console.log(`lines ${g.away}@${g.home}: ${ou} O/U, ${r.rows.length - ou} ladder | checks ${JSON.stringify(c)}`);
}
console.log('line checks:', JSON.stringify(checks));
odds.sources = [...sources];
if (useOddsApi) odds.quota = { ...quota };
writeFileSync(join(DIST, 'data', 'odds.json'), JSON.stringify(odds));

// ---------- tonight's picks (feeds "best value", the landing cards and the public record) ----------
const L = await getLeague();
const OUT = /^(out|suspended)/i;
const picks = [];
const pool = []; // every priced line with the model's lean (generated slips)
const minutesFor = new Map(); // playerId -> projected minutes
for (const g of slates[day]) {
  const o = odds.games[g.gameId];
  if (!o) continue;
  const byPlayer = new Map();
  for (const r of o.rows) if (r.kind === 'ou' && r.playerId) byPlayer.set(r.playerId, true);
  for (const id of byPlayer.keys()) {
    const p = L.players.get(id);
    if (!p || (p.team !== g.home && p.team !== g.away) || OUT.test(injuryFor(injuries, p)?.status || '')) continue;
    const game = { date: day, gameId: g.gameId, team: p.team, opp: p.team === g.home ? g.away : g.home, home: p.team === g.home, tipoff: g.tipoff };
    for (const stat of Object.keys(STATS)) {
      const lines = linesFor(o.rows, p, stat).map((l) => ({ ...l, id: `dk:${l.line}`, source: 'DraftKings' }));
      if (!lines.length) continue;
      const a = analyse({ L, playerId: id, game, stat, lines, opts: { injuries } });
      if (a.error) continue;
      minutesFor.set(id, a.projection.minutes.proj);
      const h = a.headline;
      if (!h || h.stale) continue;
      const side = h.side;
      const ls = side || h.leanSide;
      if (ls) {
        pool.push({
          gameId: g.gameId, playerId: id, name: p.name, team: p.team, stat, line: h.line, book: h.bookTitle, over: h.over, under: h.under,
          side, leanSide: ls, pLean: h.model[ls], evLean: h.ev[ls], verdict: h.verdict, stale: false,
        });
      }
      picks.push({
        date: day, gameId: g.gameId, tipoff: g.tipoff, playerId: id, name: p.name, team: p.team, opp: game.opp, home: game.home,
        stat, line: h.line, book: h.bookTitle, over: h.over, under: h.under, side,
        verdict: h.verdict, confidence: h.confidence, pWin: side ? h.model[side] : null,
        edge: h.leanEdge, ev: side ? h.ev[side] : null, minutes: a.projection.minutes.proj, projection: a.projection.mean,
      });
    }
  }
}
const best = picks.filter((x) => x.side).sort((a, b) => b.ev - a.ev).slice(0, 12);
console.log(`picks: ${picks.filter((x) => x.side).length} published (${picks.length} lines priced), ${picks.filter((x) => x.verdict === 'CHECK').length} flagged CHECK`);

// ---------- archive + public record ----------
// ARCHIVE_DIR is the checked-out "data" branch in CI; each day's picks keep their first price and closing price
const ARCHIVE = process.env.ARCHIVE_DIR ? resolve(process.env.ARCHIVE_DIR) : null;
const days = {};
if (ARCHIVE) {
  mkdirSync(join(ARCHIVE, 'picks'), { recursive: true });
  for (const f of readdirSync(join(ARCHIVE, 'picks')).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
    days[f.slice(0, 10)] = JSON.parse(readFileSync(join(ARCHIVE, 'picks', f), 'utf8'));
  }
  days[day] = mergePicks(days[day], picks.filter((x) => x.side), new Date().toISOString());
  writeFileSync(join(ARCHIVE, 'picks', `${day}.json`), JSON.stringify(days[day], null, 1));
}
const record = gradeRecord(L, days);
writeFileSync(join(DIST, 'data', 'record.json'), JSON.stringify({ ...record, archived: Boolean(ARCHIVE), generated: new Date().toISOString() }));
console.log(`record: ${record.overall.settled} settled picks since ${record.since || 'n/a'}, hit ${record.overall.hitRate == null ? '–' : (record.overall.hitRate * 100).toFixed(1) + '%'}`);

// ---------- who benefits tonight: absences and the teammates the model projects to gain ----------
const r1 = (x) => Math.round(x * 10) / 10;
const benefits = [];
for (const g of slates[day]) {
  for (const team of [g.away, g.home]) {
    const game = { date: day, gameId: g.gameId, team, opp: team === g.home ? g.away : g.home, home: team === g.home };
    const roster = [...L.players.values()].filter((p) => p.team === team && L.playerLogs(p.id).filter((r) => r.team === team).length >= 3);
    const gainers = [];
    let outs = null;
    for (const p of roster) {
      if (OUT.test(injuryFor(injuries, p)?.status || '')) continue;
      const i = absenceImpact(L, p.id, game, injuries, DEFAULTS);
      if (!i) continue;
      outs ||= i.outs;
      const d = { min: i.minutes.with - i.minutes.without, pts: i.pts.with - i.pts.without, reb: i.reb.with - i.reb.without, ast: i.ast.with - i.ast.without };
      if (d.min >= 1 || d.pts >= 1 || d.reb >= 0.5 || d.ast >= 0.5) {
        gainers.push({ id: p.id, name: p.name, pos: p.pos, minutes: r1(i.minutes.with), d: { min: r1(d.min), pts: r1(d.pts), reb: r1(d.reb), ast: r1(d.ast) }, pts: r1(i.pts.with), reb: r1(i.reb.with), ast: r1(i.ast.with) });
      }
    }
    if (!outs) continue;
    const out = outs.map((o) => {
      const recent = L.playerLogs(o.id).filter((r) => r.team === team).slice(-10);
      const av = averages(recent);
      const inj = injuryFor(injuries, L.players.get(o.id));
      return { id: o.id, name: o.name, status: inj?.status || 'Out', injury: inj?.injury || '', min: r1(av.min), pts: r1(av.pts), reb: r1(av.reb), ast: r1(av.ast) };
    });
    gainers.sort((a, b) => (b.d.pts + b.d.reb + b.d.ast) - (a.d.pts + a.d.reb + a.d.ast));
    benefits.push({ gameId: g.gameId, team, opp: game.opp, home: game.home, tipoff: g.tipoff, out, gainers: gainers.slice(0, 3) });
  }
}
// teams where the absences move projections most come first
const lift = (b) => b.gainers.reduce((a, x) => a + x.d.pts + x.d.reb + x.d.ast, 0);
benefits.sort((a, b) => lift(b) - lift(a));
console.log(`benefits: ${benefits.length} teams with rotation players out, ${benefits.reduce((a, b) => a + b.gainers.length, 0)} gainers`);

// ---------- landing (served without loading the season files, so the first visit is quick) ----------
const top = (team) => [...L.players.values()]
  .filter((p) => p.team === team && !OUT.test(injuryFor(injuries, p)?.status || ''))
  .map((p) => ({ p, recent: L.playerLogs(p.id).filter((r) => r.team === team).slice(-10) }))
  .filter((x) => x.recent.length >= 3)
  .sort((a, b) => (minutesFor.get(b.p.id) ?? b.recent.reduce((s, r) => s + r.min, 0) / b.recent.length) - (minutesFor.get(a.p.id) ?? a.recent.reduce((s, r) => s + r.min, 0) / a.recent.length))
  .slice(0, 5)
  .map(({ p, recent }) => {
    const av = averages(recent);
    return { id: p.id, name: p.name, pos: p.pos, min: av.min, minProj: minutesFor.get(p.id) ?? null, pts: av.pts, reb: av.reb, ast: av.ast, injury: injuryFor(injuries, p)?.status || null };
  });
writeFileSync(join(DIST, 'data', 'landing.json'), JSON.stringify({
  date: day, games: slates[day].map((g) => ({ ...g, awayPlayers: top(g.away), homePlayers: top(g.home) })), best, benefits,
  // compact pool for generated slips, rounded to keep the file small
  // (only lines a generated slip could use: no CHECK, a published pick or a fair-ish price; see web/js/autoslip.js)
  pool: pool.filter((x) => x.verdict !== 'CHECK' && (x.side || x.evLean >= 0))
    .map(({ stale, verdict, ...x }) => ({ ...x, verdict, pLean: Math.round(x.pLean * 1e3) / 1e3, evLean: Math.round(x.evLean * 1e3) / 1e3 })),
}));

const meta = {
  generated: new Date().toISOString(),
  today: day, current: cur, previous: prev,
  statsSource: config.statsProvider === 'demo' ? 'demo' : 'ESPN',
  seasons, stats: STATS,
  odds: { sources: odds.sources, fetchedAt: odds.fetchedAt, games: Object.keys(odds.games).length, quota: odds.quota || null, checks },
};
writeFileSync(join(DIST, 'data', 'meta.json'), JSON.stringify(meta, null, 1));
console.log(`built dist/ for ${day} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
