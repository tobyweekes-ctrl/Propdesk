// Data checks run on bookmaker lines before they are published or used. Pure; shared by the Node
// server and the static build. Each check either fixes the data (drops or flags rows) or reports it.
//   - player must be on one of the two teams in the game
//   - one price per player / stat / book / line (duplicates with different prices are dropped)
//   - "k or more" ladders must get longer as k rises (non-monotone ladders are dropped)
//   - timestamps: future times are invalid (age unknown); prices unchanged for `staleHours` are stale
const STALE_HOURS = 6;

/**
 * @param rows bookmaker rows ({ playerId?, player?, stat, kind, line, over, under, book, updated })
 * @param ctx { fetchedAt: ISO string, teams: [home, away], teamOf: (row) => team abbr | null, staleHours? }
 * @returns { rows, issues: { teamMismatch, duplicates, nonMonotone, futureTimestamps, stale } }
 */
export function checkLines(rows, { fetchedAt, teams = [], teamOf = () => null, staleHours = STALE_HOURS } = {}) {
  const issues = { teamMismatch: 0, duplicates: 0, nonMonotone: 0, futureTimestamps: 0, stale: 0 };
  const fetched = Date.parse(fetchedAt);
  const who = (r) => r.playerId || r.player;

  // 1. player on one of the two teams
  let out = rows.filter((r) => {
    const t = teamOf(r);
    if (t && teams.length && !teams.includes(t)) { issues.teamMismatch++; return false; }
    return true;
  });

  // 2. duplicates: same player / stat / book / kind / line with different prices -> drop all of them
  const seen = new Map();
  for (const r of out) {
    const k = `${who(r)}|${r.stat}|${r.book}|${r.kind}|${r.line}`;
    seen.set(k, [...(seen.get(k) || []), r]);
  }
  const bad = new Set();
  for (const list of seen.values()) {
    if (list.length > 1 && new Set(list.map((r) => `${r.over}|${r.under}`)).size > 1) { list.forEach((r) => bad.add(r)); issues.duplicates += list.length; }
  }
  out = out.filter((r) => !bad.has(r));

  // 3. ladders must rise with k
  const ladders = new Map();
  for (const r of out) if (r.kind === 'ms') ladders.set(`${who(r)}|${r.stat}|${r.book}`, [...(ladders.get(`${who(r)}|${r.stat}|${r.book}`) || []), r]);
  const dropLadder = new Set();
  for (const list of ladders.values()) {
    const s = [...list].sort((a, b) => a.line - b.line);
    if (s.some((r, i) => i > 0 && !(r.over > s[i - 1].over))) { s.forEach((r) => dropLadder.add(r)); issues.nonMonotone++; }
  }
  out = out.filter((r) => !dropLadder.has(r));

  // 4. timestamps
  out = out.map((r) => {
    const t = Date.parse(r.updated);
    if (!Number.isFinite(t) || !Number.isFinite(fetched)) return { ...r, ageMin: null, stale: false };
    if (t > fetched + 10 * 60000) { issues.futureTimestamps++; return { ...r, ageMin: null, stale: false }; }
    const ageMin = Math.round((fetched - t) / 60000);
    const stale = ageMin > staleHours * 60;
    if (stale) issues.stale++;
    return { ...r, ageMin, stale };
  });
  return { rows: out, issues };
}
