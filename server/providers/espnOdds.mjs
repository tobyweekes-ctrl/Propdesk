// DraftKings player prop lines as published in ESPN's public odds API (no key).
// Over/under markets ("Total Points") come as two unlabelled prices per player and line. The
// over is identified by matching the one-sided "Milestones" market at line + 0.5 (e.g. "12+
// points" is exactly over 11.5); when no milestone exists, the feed's order (over first) is used,
// which matched the milestone check on every pair tested. Each build logs how many pairs were
// confirmed, so a change in the feed shows up.
import { fetchJson } from '../http.mjs';

const CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';
const PROVIDER_ID = 100; // DraftKings in ESPN's odds API

const TOTALS = {
  'Total Points': 'pts', 'Total Rebounds': 'reb', 'Total Assists': 'ast', 'Total 3-Point Field Goals': 'fg3m',
  'Total Points, Rebounds, and Assists': 'pra', 'Total Points and Rebounds': 'pr', 'Total Points and Assists': 'pa',
  'Total Assists and Rebounds': 'ra',
};
const MILESTONES = {
  'Points Milestones': 'pts', 'Rebounds Milestones': 'reb', 'Assists Milestones': 'ast', '3-Point Field Goals Milestones': 'fg3m',
  'Points + Assists + Rebounds Milestones': 'pra', 'Points + Rebounds Milestones': 'pr', 'Points + Assists Milestones': 'pa',
};

const athleteId = (x) => x.athlete?.$ref?.match(/athletes\/(\d+)/)?.[1] ?? null;
const dec = (x) => Number(x.odds?.decimal?.value) || null;
const am = (x) => Number(x.odds?.american?.value);

/**
 * Normalise ESPN propBets items into rows:
 *   O/U:       { playerId, stat, kind: 'ou', line, over, under, open, book, bookTitle }
 *   milestone: { playerId, stat, kind: 'ms', line: k (k or more), over: price, under: null, ... }
 * Returns { rows, check: { pairs, confirmed, contradicted } }.
 */
export function normalisePropBets(items, updated = null) {
  const book = 'draftkings', bookTitle = 'DraftKings';
  const ms = new Map(); // `${id}|${stat}|${k}` -> item
  const rows = [];
  for (const x of items) {
    const stat = MILESTONES[x.type?.name];
    const id = athleteId(x);
    const k = x.current?.target?.value;
    if (!stat || !id || k == null || !dec(x)) continue;
    ms.set(`${id}|${stat}|${k}`, x);
    rows.push({ playerId: id, stat, kind: 'ms', line: k, over: dec(x), under: null, book, bookTitle, updated: x.lastUpdated || updated });
  }
  const groups = new Map();
  for (const x of items) {
    const stat = TOTALS[x.type?.name];
    const id = athleteId(x);
    const line = x.current?.target?.value;
    if (!stat || !id || line == null) continue;
    const key = `${id}|${stat}|${line}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  }
  const check = { pairs: 0, confirmed: 0, contradicted: 0 };
  for (const [key, xs] of groups) {
    if (xs.length !== 2 || !dec(xs[0]) || !dec(xs[1])) continue;
    const [id, stat, lineStr] = key.split('|');
    const line = Number(lineStr);
    let [o, u] = xs;
    check.pairs++;
    const m = ms.get(`${id}|${stat}|${line + 0.5}`);
    if (m) {
      const d0 = Math.abs(am(xs[0]) - am(m)), d1 = Math.abs(am(xs[1]) - am(m));
      if (d1 < d0) { [o, u] = [xs[1], xs[0]]; check.contradicted++; } else check.confirmed++;
    }
    rows.push({
      playerId: id, stat, kind: 'ou', line, over: dec(o), under: dec(u),
      open: { line: o.open?.target?.value ?? null, over: Number(o.odds?.decimal?.open) || null, under: Number(u.odds?.decimal?.open) || null },
      book, bookTitle, updated: o.lastUpdated || updated,
    });
  }
  return { rows, check };
}

export const espnOddsProvider = {
  name: 'DraftKings via ESPN',
  /** All prop markets for one ESPN event (two pages of ~1,000 items). */
  async eventProps(eventId) {
    const url = (page) => `${CORE}/events/${eventId}/competitions/${eventId}/odds/${PROVIDER_ID}/propBets?lang=en&region=us&limit=1000&page=${page}`;
    const first = (await fetchJson(url(1), { minGapMs: 200 })).json;
    const items = [...(first.items || [])];
    for (let p = 2; p <= (first.pageCount || 1); p++) items.push(...((await fetchJson(url(p), { minGapMs: 200 })).json.items || []));
    return normalisePropBets(items);
  },
};
