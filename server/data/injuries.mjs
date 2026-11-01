// ESPN's NBA injury report: the parser, and a live source for the browser build. No Node APIs, so the
// Pages build can ship it (ESPN's API allows cross-site requests).
import { teamAbbr } from '../teams.mjs';

export const INJURY_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries';

export function normaliseInjuries(json) {
  const out = [];
  for (const t of json.injuries || []) {
    for (const i of t.injuries || []) {
      const a = i.athlete || {};
      const d = i.details || {};
      out.push({
        name: a.displayName,
        team: teamAbbr(a.team?.abbreviation) ?? teamAbbr(t.displayName),
        status: i.status || d.fantasyStatus?.description || 'Unknown', // Out | Day-To-Day | Questionable ...
        injury: [d.side && d.side !== 'Not Specified' ? d.side : null, d.type, d.detail].filter(Boolean).join(' '),
        returnDate: d.returnDate || null,
        updated: i.date || null,
        note: i.shortComment || '',
        source: 'ESPN',
      });
    }
  }
  return out;
}

/**
 * The injury report as of now: fetched from ESPN and kept for `ttlMs`, so a page that asks several times makes
 * one request. If ESPN fails or returns nothing, the report saved by the last build (`fallback`) is used.
 */
export function liveInjuries({ fetchJson, fallback, ttlMs = 5 * 60e3, retryMs = 60e3, now = Date.now }) {
  let at = -Infinity, last = null, failedAt = -Infinity, pending = null;
  const load = async () => {
    try {
      const list = normaliseInjuries(await fetchJson(INJURY_URL));
      if (list.length) { last = list; at = now(); return list; }
    } catch { /* offline or blocked: the saved report below */ }
    failedAt = now();
    return last || fallback();
  };
  return async () => {
    if (last && now() - at < ttlMs) return last;
    if (now() - failedAt < retryMs) return last || fallback(); // ESPN just failed: don't ask again on every call
    // calls made while a request is out wait for it rather than sending their own
    pending ||= load().finally(() => { pending = null; });
    return pending;
  };
}
