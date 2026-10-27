// Server-side user data (gitignored): manual lines, bet log, odds snapshots.
// Demo and live data live in separate folders so demo bets never mix with real ones.
//   userdata/<mode>/entries.json        evaluated lines (manual or from a bookmaker feed), optional bet
//   userdata/<mode>/odds/<date>.jsonl   every Odds API prop fetch, for the real-line backtest
import { mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, ROOT } from '../env.mjs';
import { grade, summariseBets } from './entries.mjs';

const dir = () => {
  const d = join(config.userDataDir || join(ROOT, 'userdata'), config.statsProvider === 'demo' ? 'demo' : 'live');
  mkdirSync(join(d, 'odds'), { recursive: true });
  return d;
};
const entriesFile = () => join(dir(), 'entries.json');

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 1));
  renameSync(tmp, file); // atomic replace, so a crash never leaves a half-written file
}

// ---------- entries (manual lines + bet log) ----------
export const listEntries = () => readJson(entriesFile(), []);

export function addEntry(e) {
  const all = listEntries();
  const entry = { id: randomUUID(), createdAt: new Date().toISOString(), bet: null, ...e };
  all.push(entry);
  writeJson(entriesFile(), all);
  return entry;
}

export function updateEntry(id, patch) {
  const all = listEntries();
  const i = all.findIndex((x) => x.id === id);
  if (i < 0) return null;
  all[i] = { ...all[i], ...patch, id };
  writeJson(entriesFile(), all);
  return all[i];
}

export function deleteEntry(id) {
  const all = listEntries();
  const next = all.filter((x) => x.id !== id);
  writeJson(entriesFile(), next);
  return next.length !== all.length;
}

/** Bet log over the saved entries (grading logic lives in entries.mjs, shared with the browser). */
export const betLog = (L) => summariseBets(L, listEntries());
export { grade };

// ---------- odds snapshots ----------
/** Append one fetch of an event's prop lines (live Odds API only). */
export function recordOddsSnapshot({ date, eventId, gameId, tipoff, home, away, source = null, rows }) {
  const line = JSON.stringify({ fetchedAt: new Date().toISOString(), date, eventId, gameId, tipoff, home, away, source, rows });
  appendFileSync(join(dir(), 'odds', `${date}.jsonl`), line + '\n');
}

/**
 * Latest pre-tipoff price for each (player, stat, book) across all saved snapshots: the closest
 * thing to the closing line we have.
 */
export function loadClosingLines({ from = '0000', to = '9999' } = {}) {
  const d = join(dir(), 'odds');
  if (!existsSync(d)) return [];
  const best = new Map();
  for (const f of readdirSync(d).filter((x) => x.endsWith('.jsonl')).sort()) {
    const date = f.slice(0, 10);
    if (date < from || date > to) continue;
    for (const ln of readFileSync(join(d, f), 'utf8').split('\n')) {
      if (!ln.trim()) continue;
      const snap = JSON.parse(ln);
      if (snap.tipoff && snap.fetchedAt > snap.tipoff) continue;
      for (const r of snap.rows) {
        const key = `${snap.date}|${r.player}|${r.stat}|${r.book}`;
        const prev = best.get(key);
        if (!prev || prev.fetchedAt <= snap.fetchedAt) best.set(key, { ...r, date: snap.date, home: snap.home, away: snap.away, fetchedAt: snap.fetchedAt });
      }
    }
  }
  return [...best.values()];
}
