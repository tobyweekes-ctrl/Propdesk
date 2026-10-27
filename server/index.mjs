// HTTP server: JSON API under /api (routes.mjs), static frontend from /web. No dependencies.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { config, ROOT } from './env.mjs';
import { cacheInfo } from './cache.mjs';
import { getLeague, getSlate, gameFor, getInjuries, getPlayerLines, status, today } from './data/store.mjs';
import { listEntries, addEntry, updateEntry, deleteEntry } from './data/userdata.mjs';
import { createRoutes, dispatch } from './routes.mjs';

const WEB = join(ROOT, 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const routes = createRoutes({
  getLeague, getSlate, gameFor, getInjuries, getPlayerLines, today,
  status: () => ({ ...status(), cache: cacheInfo() }),
  entries: { list: listEntries, add: addEntry, update: updateEntry, remove: deleteEntry },
});
const fail = (status, msg) => { throw Object.assign(new Error(msg), { status }); };


async function readBody(req) {
  if (req.method === 'GET' || req.method === 'DELETE') return {};
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e5) fail(413, 'body too large');
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { fail(400, 'invalid JSON'); }
}

async function serveStatic(pathname, res) {
  const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(WEB, rel);
  if (!file.startsWith(WEB)) return false;
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const t0 = Date.now();
    try {
      const data = await dispatch(routes, req.method, url.pathname, url.searchParams, await readBody(req));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Server-Timing': `app;dur=${Date.now() - t0}` });
      res.end(JSON.stringify(data));
    } catch (err) {
      const code = err.status || 502;
      if (code >= 500) console.error(`[api] ${url.pathname}:`, err.message);
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  if (!(await serveStatic(url.pathname, res))) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
});

server.listen(config.port, () => {
  const s = status();
  console.log(`nba-props on http://localhost:${config.port}  stats=${s.statsProvider} odds=${s.odds} injuries=${s.injuryProvider} today=${s.today}`);
  // warm the league in the background so the first search is instant
  getLeague().then((L) => console.log(`league ready: ${L.players.size} players, ${L.bySeason[L.current].rows.length + L.bySeason[L.previous].rows.length} box scores`))
    .catch((e) => console.error('league load failed:', e.message));
});
