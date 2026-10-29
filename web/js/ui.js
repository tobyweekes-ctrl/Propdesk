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

// the standard UK fractional ladder
const LADDER = [[1, 250], [1, 200], [1, 100], [1, 66], [1, 50], [1, 40], [1, 33], [1, 25], [1, 20], [1, 16], [1, 14], [1, 12], [1, 11], [1, 10], [1, 9], [1, 8],
  [2, 15], [1, 7], [1, 6], [2, 11], [1, 5], [2, 9], [1, 4], [2, 7], [3, 10], [1, 3], [4, 11], [2, 5], [4, 9], [1, 2], [8, 15], [4, 7], [8, 13], [4, 6],
  [8, 11], [4, 5], [5, 6], [10, 11], [20, 21], [1, 1], [21, 20], [11, 10], [6, 5], [5, 4], [11, 8], [6, 4], [13, 8], [7, 4], [15, 8], [2, 1], [85, 40],
  [9, 4], [5, 2], [11, 4], [3, 1], [10, 3], [7, 2], [4, 1], [9, 2], [5, 1], [11, 2], [6, 1], [13, 2], [7, 1], [15, 2], [8, 1], [17, 2], [9, 1], [10, 1],
  [11, 1], [12, 1], [14, 1], [16, 1], [18, 1], [20, 1], [22, 1], [25, 1], [28, 1], [33, 1], [40, 1], [50, 1], [66, 1], [80, 1], [100, 1], [150, 1], [200, 1]];
// feeds give decimals to 2 places (10/11 arrives as 1.91): a price within that rounding counts as on the
// fraction (smaller at very short prices, where 0.005 would span several fractions)
const eps = (v) => Math.min(0.005, v * 0.02);
const fracText = ([a, b]) => (a === b ? 'EVS' : `${a}/${b}`);
/**
 * Decimal odds -> a standard fraction. `down` (the default, for prices on offer) never shows more than
 * the price really pays; `up` (for thresholds such as "bet at 6/5 or bigger" and fair prices) never
 * shows less than is needed.
 */
export function toFrac(dec, dir = 'down') {
  if (!dec || dec <= 1) return '–';
  const v = dec - 1;
  if (dir === 'up') {
    const f = LADDER.find(([a, b]) => a / b >= v - eps(v));
    return f ? fracText(f) : `${Math.ceil(v)}/1`;
  }
  let f = null;
  for (const x of LADDER) if (x[0] / x[1] <= v + eps(v)) f = x;
  return f ? fracText(f) : `1/${Math.ceil(1 / v - 1e-9)}`;
}
/** A price for display: `down` for prices on offer, `up` for thresholds (fair prices, "bet at X+"). */
export const odds = (dec, dir = 'down') => {
  if (dec == null) return '–';
  if (oddsFormat() !== 'dec') return toFrac(dec, dir);
  const x = (dir === 'up' ? Math.ceil(dec * 100 - 1e-6) : Math.floor(dec * 100 + 1e-6)) / 100;
  return x.toFixed(2);
};

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
export function tipLabel(iso, now = Date.now()) {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  // 24-hour clock in the reader's time zone; a game starting after midnight (before 6am) belongs to the night
  // before, so Thursday's late games read "Thu night · 00:30" rather than "Fri 12:30 AM"
  const clock = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const night = t.getHours() < 6;
  const day = new Date(t.getTime() - (night ? 6 * 3600e3 : 0)).toLocaleDateString('en-GB', { weekday: 'short' });
  const far = t - now > 6 * 86400e3 ? ` ${t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '';
  const mins = Math.round((t - now) / 60000);
  const until = mins <= 0 ? 'started' : mins < 60 ? `in ${mins}m` : mins < 24 * 60 ? `in ${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}` : `in ${Math.round(mins / 1440)}d`;
  return `${day}${night ? ' night' : ''}${far} · ${clock} · ${until}`;
}

/** page for a bad link or an unknown route */
export const notFound = (what) => `<section class="hero"><h1>Not <em>found</em></h1>
  <p>${what} Search a player with the box above (or press <kbd>/</kbd>), or go back to <a href="#/">tonight's games</a>.</p></section>`;

// export reminder for the browser-only bet log
const EXPORTED = 'propdesk.lastExport';
export const lastExport = () => { try { return localStorage.getItem(EXPORTED); } catch { return null; } };
export const markExported = () => { try { localStorage.setItem(EXPORTED, new Date().toISOString()); } catch { /* ignore */ } };
