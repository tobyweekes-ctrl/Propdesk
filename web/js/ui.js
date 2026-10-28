// Shared helpers and state for the frontend.
export const state = { stats: {} };
/** ask the shell to refresh the status bar (e.g. after a call that may spend Odds API credits) */
export const refreshStatus = () => window.dispatchEvent(new Event('status:refresh'));
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmt = (x, d = 1) => (x == null || Number.isNaN(Number(x)) ? '–' : Number(x).toFixed(d));
export const pct = (x, d = 1) => (x == null ? '–' : `${(x * 100).toFixed(d)}%`);
/** signed percentage with pos/neg colouring */
export const edge = (x, d = 1) => (x == null ? '<span class="dim">–</span>' : `<span class="${x > 0 ? 'pos' : x < 0 ? 'neg' : ''}">${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%</span>`);
export const signed = (x, d = 1) => (x == null ? '–' : `${x > 0 ? '+' : ''}${Number(x).toFixed(d)}`);

// thin progress bar under the header while any request is in flight
let inFlight = 0;
const busy = (d) => { inFlight = Math.max(0, inFlight + d); document.body.classList.toggle('loading', inFlight > 0); };

export async function api(path, opts = {}) {
  busy(1);
  try { return await request(path, opts); } finally { busy(-1); }
}

async function request(path, { method = 'GET', body } = {}) {
  if (window.PROPDESK_STATIC) {
    // GitHub Pages build: same routes, run in the browser over prebuilt data
    const { staticApi } = await import('./static.js');
    return staticApi(path, method, body);
  }
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

// ---------- odds display (fractional by default; toggle in the header) ----------
const PREF = 'propdesk.odds';
export const oddsFormat = () => { try { return localStorage.getItem(PREF) || 'frac'; } catch { return 'frac'; } };
export const setOddsFormat = (f) => { try { localStorage.setItem(PREF, f); } catch { /* private mode */ } };

const LADDER = [[1, 50], [1, 33], [1, 25], [1, 20], [1, 16], [1, 14], [1, 12], [1, 11], [1, 10], [1, 9], [1, 8], [1, 7], [1, 6], [1, 5], [2, 9], [1, 4], [2, 7], [3, 10], [1, 3], [4, 11], [2, 5], [4, 9], [1, 2], [8, 15], [4, 7], [8, 13], [4, 6], [8, 11], [4, 5], [5, 6], [10, 11],
  [1, 1], [11, 10], [6, 5], [5, 4], [11, 8], [6, 4], [13, 8], [7, 4], [15, 8], [2, 1], [9, 4], [5, 2], [11, 4], [3, 1], [10, 3], [7, 2], [4, 1], [9, 2], [5, 1], [11, 2], [6, 1], [13, 2], [7, 1], [15, 2],
  [8, 1], [9, 1], [10, 1], [11, 1], [12, 1], [14, 1], [16, 1], [18, 1], [20, 1], [25, 1], [33, 1], [40, 1], [50, 1], [66, 1], [80, 1], [100, 1]];
/** decimal -> nearest bookmaker-style fraction ("5/1", "10/11", "EVS") */
export function toFrac(dec) {
  if (!dec || dec <= 1) return '–';
  const v = dec - 1;
  let best = LADDER[0];
  for (const f of LADDER) if (Math.abs(f[0] / f[1] - v) < Math.abs(best[0] / best[1] - v)) best = f;
  if (Math.abs(best[0] / best[1] - v) / v > 0.06) return v >= 1 ? `${v >= 20 ? Math.round(v) : Math.round(v * 2) / 2}/1` : `1/${Math.round(1 / v)}`;
  return best[0] === best[1] ? 'EVS' : `${best[0]}/${best[1]}`;
}
/** price in the user's chosen format */
export const odds = (dec) => (dec == null ? '–' : oddsFormat() === 'dec' ? Number(dec).toFixed(2) : toFrac(dec));

// ---------- team colours (for accents) ----------
export const TEAM_COLOURS = {
  ATL: '#E03A3E', BOS: '#1E9E5A', BKN: '#9AA0A6', CHA: '#00A3AD', CHI: '#CE1141', CLE: '#B8274F', DAL: '#1D7CD6', DEN: '#FEC524',
  DET: '#D9263B', GSW: '#FFC72C', HOU: '#E0263C', IND: '#FDBB30', LAC: '#E0303C', LAL: '#FDB927', MEM: '#7B93C9', MIA: '#E0234E',
  MIL: '#3E9A4E', MIN: '#78BE20', NOP: '#C6A15B', NYK: '#F58426', OKC: '#1A92DB', ORL: '#1F8FE0', PHI: '#1D7DD6', PHX: '#F06A2A',
  POR: '#E03A3E', SAC: '#8E63C9', SAS: '#C4CED4', TOR: '#D9263B', UTA: '#F9A01B', WAS: '#E8324A',
};
export const teamColour = (t) => TEAM_COLOURS[t] || '#c5f03c';

// ---------- betslip (kept in this browser) ----------
const SLIP = 'propdesk.slip.v1';
export const slip = {
  get() { try { return JSON.parse(localStorage.getItem(SLIP) || '[]'); } catch { return []; } },
  set(legs) { try { localStorage.setItem(SLIP, JSON.stringify(legs)); } catch { /* ignore */ } window.dispatchEvent(new Event('slip:change')); },
  key: (l) => `${l.playerId}|${l.stat}|${l.side}|${l.line}`,
  has(leg) { return slip.get().some((l) => slip.key(l) === slip.key(leg)); },
  add(leg) {
    const legs = slip.get();
    const i = legs.findIndex((l) => slip.key(l) === slip.key(leg));
    if (i >= 0) legs[i] = { ...legs[i], ...leg }; else legs.push({ id: crypto.randomUUID?.() || String(Date.now() + Math.random()), stake: 1, ...leg });
    slip.set(legs);
    return i < 0;
  },
  remove(id) { slip.set(slip.get().filter((l) => l.id !== id)); },
  update(id, patch) { slip.set(slip.get().map((l) => (l.id === id ? { ...l, ...patch } : l))); },
  clear() { slip.set([]); },
};

/** small toast at the bottom of the screen */
export function toast(text) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1800);
}

/** "5/1" | "6.0" | "+500" | "evens" -> decimal, or null (same rules as server/model/odds.mjs) */
export function parsePrice(input) {
  if (input == null || input === '') return null;
  if (typeof input === 'number') return input > 1 ? input : null;
  const s = String(input).trim().toLowerCase();
  if (['evens', 'evs', 'even'].includes(s)) return 2;
  let m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (m) return Number(m[2]) > 0 ? 1 + Number(m[1]) / Number(m[2]) : null;
  m = s.match(/^([+-])(\d+(?:\.\d+)?)$/);
  if (m) { const n = Number(m[2]); if (n < 100) return null; return m[1] === '+' ? 1 + n / 100 : 1 + 100 / n; }
  const d = Number(s);
  return Number.isFinite(d) && d > 1 ? d : null;
}

/** "Tue 28 Oct 00:00 · in 2h 10m" in the viewer's time zone (or "started" once tip-off has passed) */
export function tipLabel(iso) {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const when = t.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const mins = Math.round((t - Date.now()) / 60000);
  const until = mins <= 0 ? 'started' : mins < 60 ? `in ${mins}m` : mins < 24 * 60 ? `in ${Math.floor(mins / 60)}h ${mins % 60}m` : `in ${Math.round(mins / 1440)}d`;
  return `${when} · ${until}`;
}

/** page for a bad link or an unknown route */
export const notFound = (what) => `<section class="hero"><h1>Not <em>found</em></h1>
  <p>${what} Search a player with the box above (or press <kbd>/</kbd>), or go back to <a href="#/">tonight's games</a>.</p></section>`;

// export reminder for the browser-only bet log
const EXPORTED = 'propdesk.lastExport';
export const lastExport = () => { try { return localStorage.getItem(EXPORTED); } catch { return null; } };
export const markExported = () => { try { localStorage.setItem(EXPORTED, new Date().toISOString()); } catch { /* ignore */ } };
