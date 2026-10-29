// Key numbers strip on the player page: minutes, usage, shots and the selected stat, this season against last,
// each with a small trend line. Tapping a tile opens a game-by-game chart of that number.
import { esc, fmt, state } from './ui.js';

const seasonShort = (s) => (s && /^\d{4}-\d{2}$/.test(s) ? `${s.slice(2, 4)}/${s.slice(5)}` : s || '');

/** The tiles for one player and stat. `d` is the /api/player/:id payload. */
export function keyTiles(d, stat) {
  const [cur, prev] = Object.keys(d.averages);
  const A = d.averages[cur], B = d.averages[prev], R = d.averages.last5;
  const st = state.stats[stat];
  const statOf = (r) => st.parts.reduce((a, k) => a + (r[k] ?? 0), 0);
  const threes = stat === 'fg3m';
  return [
    { key: 'min', label: 'Minutes', unit: 'a game', a: A.min, b: B.gp ? B.min : null, r: R.min, of: (r) => r.min,
      extra: A.gp ? `started ${A.gs} of ${A.gp}` : '' },
    { key: 'usg', label: 'Usage', unit: '% of team plays', a: A.usg, b: B.gp ? B.usg : null, r: R.usg, of: (r) => r.usg,
      help: 'Share of the team\'s plays that end with this player (a shot, free throws or a turnover) while on the floor.' },
    threes
      ? { key: 'fg3a', label: 'Threes tried', unit: 'a game', a: A.fg3a, b: B.gp ? B.fg3a : null, r: R.fg3a, of: (r) => r.fg3a }
      : { key: 'fga', label: 'Shots', unit: 'a game', a: A.fga, b: B.gp ? B.fga : null, r: R.fga, of: (r) => r.fga },
    { key: 'stat', label: st.label, unit: 'a game', a: A[stat], b: B.gp ? B[stat] : null, r: R[stat], of: statOf },
  ].map((t) => ({ ...t, cur, prev, games: d.logs.slice().reverse().map((r) => ({ date: r.date, opp: r.opp, home: r.home, season: r.season, value: t.of(r) })).filter((g) => g.value != null) }));
}

const delta = (a, b) => {
  if (a == null || b == null || !b) return '';
  const pc = (a / b - 1) * 100;
  if (Math.abs(pc) < 5) return '<span class="kd dim">about the same</span>';
  return `<span class="kd ${pc > 0 ? 'pos' : 'neg'}">${pc > 0 ? '▲' : '▼'} ${Math.abs(Math.round(pc))}% this season</span>`;
};

function spark(games) {
  const xs = games.slice(-10).map((g) => g.value);
  if (xs.length < 2) return '';
  const W = 84, H = 26, lo = Math.min(...xs), hi = Math.max(...xs), span = hi - lo || 1;
  const pts = xs.map((v, i) => `${(i / (xs.length - 1)) * (W - 4) + 2},${H - 3 - ((v - lo) / span) * (H - 6)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

export function keyStrip(tiles) {
  return `<div class="keynums" role="list">${tiles.map((t, i) => `<button class="kn" role="listitem" data-i="${i}" aria-haspopup="dialog" aria-label="${esc(t.label)}: ${fmt(t.a)} this season. Open graph">
    <span class="kl">${esc(t.label)} <span class="dim">${esc(t.unit)}</span></span>
    <span class="kv"><b>${fmt(t.a)}</b>${spark(t.games)}</span>
    <span class="ks">${t.b != null ? `last season ${fmt(t.b)}` : 'no games last season'}</span>
    <span class="ks">last 5 games ${fmt(t.r)}</span>
    ${t.b != null ? `<span class="ks">${delta(t.a, t.b)}</span>` : ''}
    ${t.extra ? `<span class="ks">${esc(t.extra)}</span>` : ''}
  </button>`).join('')}</div>`;
}

/** Game-by-game line with this season's and last season's averages as dashed guides. */
function trendSvg(t, W) {
  const games = t.games, H = W < 500 ? 220 : 260, m = { t: 16, r: 74, b: 30, l: 34 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const vals = games.map((g) => g.value).concat([t.a, t.b].filter((v) => v != null));
  const hi = Math.max(1, ...vals) * 1.1, lo = Math.min(0, ...vals);
  const step = hi <= 5 ? 1 : hi <= 12 ? 2 : hi <= 30 ? 5 : 10;
  const top = Math.ceil(hi / step) * step;
  const y = (v) => m.t + ih - ((v - lo) / (top - lo)) * ih;
  const x = (i) => m.l + (games.length === 1 ? iw / 2 : (i / (games.length - 1)) * iw);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(t.label)}, game by game">`;
  for (let v = 0; v <= top + 1e-9; v += step) s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${m.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`;
  // season break
  const brk = games.findIndex((g, i) => i > 0 && g.season !== games[i - 1].season);
  if (brk > 0) {
    const bx = (x(brk - 1) + x(brk)) / 2;
    s += `<line class="brk" x1="${bx}" x2="${bx}" y1="${m.t}" y2="${m.t + ih}"/><text class="xl" x="${bx + 4}" y="${m.t + 10}">${esc(seasonShort(games[brk].season))}</text>`;
  }
  const guide = (v, label, cls) => (v == null ? '' : `<line class="guide ${cls}" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="gl ${cls}" x="${W - m.r + 6}" y="${y(v) + 3.5}">${esc(label)} ${fmt(v)}</text>`);
  // keep the two labels apart when the averages are close
  const close = t.a != null && t.b != null && Math.abs(y(t.a) - y(t.b)) < 13;
  s += guide(t.b, seasonShort(t.prev), 'prev');
  s += close ? guide(t.a, seasonShort(t.cur), 'cur').replace(/y="([\d.]+)">/, (_, v) => `y="${Number(v) + (y(t.a) > y(t.b) ? 12 : -12)}">`) : guide(t.a, seasonShort(t.cur), 'cur');
  s += `<polyline class="trend" points="${games.map((g, i) => `${x(i)},${y(g.value)}`).join(' ')}"/>`;
  s += games.map((g, i) => `<circle class="tdot${g.season === t.cur ? ' cur' : ''}" data-i="${i}" cx="${x(i)}" cy="${y(g.value)}" r="${W < 500 ? 4 : 4.5}"><title>${esc(g.date)} ${g.home ? 'v' : '@'} ${esc(g.opp)}: ${fmt(g.value)}</title></circle>`).join('');
  const every = Math.max(1, Math.ceil(games.length / (W < 500 ? 5 : 9)));
  games.forEach((g, i) => { if (i % every === 0 || i === games.length - 1) s += `<text class="xl" x="${x(i)}" y="${H - 8}" text-anchor="middle">${g.date.slice(5).replace('-', '/')}</text>`; });
  return `${s}</svg>`;
}

export function openTrend(t, name) {
  let d = document.getElementById('trend');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'trend';
    d.className = 'ctx trend';
    d.setAttribute('aria-labelledby', 'trend-title');
    document.body.append(d);
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  }
  const n = t.games.length;
  d.innerHTML = `<div class="ctx-in">
    <header><div><h2 id="trend-title">${esc(t.label)}</h2><span class="sub">${esc(name)} · last ${n} game${n === 1 ? '' : 's'}</span></div>
      <button class="mini ghost" data-close aria-label="Close">Esc ×</button></header>
    <div class="trend-wrap"></div>
    <p class="trend-cap hint">Tap a dot for the game.</p>
    ${t.help ? `<p class="hint">${esc(t.help)}</p>` : ''}
    <p class="hint">Dashed lines: this season's average (${fmt(t.a)})${t.b != null ? ` and last season's (${fmt(t.b)})` : ''}. Last 5 games: ${fmt(t.r)}.</p>
  </div>`;
  d.showModal();
  const wrap = d.querySelector('.trend-wrap');
  wrap.innerHTML = trendSvg(t, Math.max(280, Math.round(wrap.clientWidth)));
  const cap = d.querySelector('.trend-cap');
  wrap.addEventListener('click', (e) => {
    const c = e.target.closest('.tdot');
    if (!c) return;
    const g = t.games[Number(c.dataset.i)];
    cap.textContent = `${g.date}, ${g.home ? 'vs' : 'at'} ${g.opp}: ${fmt(g.value)}`;
    wrap.querySelectorAll('.tdot.on').forEach((x) => x.classList.remove('on'));
    c.classList.add('on');
  });
  d.querySelector('[data-close]').focus();
}
