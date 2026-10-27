// Build the static site for GitHub Pages into dist/:
//   - the frontend (web/) with a flag that switches it to in-browser mode
//   - the pure modules it needs (model, routes, league...), found by walking imports from
//     server/routes.mjs; the build fails if any of them reaches a Node-only module
//   - data files: two seasons of real box scores, the slate, injuries, and prop lines when
//     ODDS_API_KEY is set (the key stays in the build environment, never in dist/)
//
//   node scripts/build-static.mjs            (FETCH_ODDS=false skips the Odds API call)
import { mkdirSync, rmSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { ROOT, config } from '../server/env.mjs';
import { loadSeason, getSlate, getInjuries, eventProps, today } from '../server/data/store.mjs';
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

const meta = {
  generated: new Date().toISOString(),
  today: day, current: cur, previous: prev,
  statsSource: config.statsProvider === 'demo' ? 'demo' : 'ESPN',
  seasons, stats: STATS,
  odds: { sources: odds.sources, fetchedAt: odds.fetchedAt, games: Object.keys(odds.games).length, quota: odds.quota || null, checks },
};
writeFileSync(join(DIST, 'data', 'meta.json'), JSON.stringify(meta, null, 1));
console.log(`built dist/ for ${day} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
