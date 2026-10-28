// Unpacking of the compact season files the Pages build writes (pure: also tested under Node).

/** Compact season file (column names + row arrays) -> box-score objects. A plain loop: this runs over
 * ~30,000 rows on a phone, where building each row with Object.fromEntries cost several times more. */
export function expandSeason(S) {
  const cols = S.cols, n = cols.length;
  const games = new Array(S.rows.length);
  for (let j = 0; j < S.rows.length; j++) {
    const r = S.rows[j], o = {};
    for (let i = 0; i < n; i++) o[cols[i]] = r[i];
    o.home = o.home === 1; o.starter = o.starter === 1;
    o.season = S.season; // tagged here so indexLeague uses the row as it is instead of copying it
    games[j] = o;
  }
  return { season: S.season, source: S.source, players: S.players.map(([id, name, team, pos]) => ({ id, name, team, pos })), games };
}
