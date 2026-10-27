// App shell: status bar, slate, search with autocomplete, routing.
import { $, esc, fmt, api, state } from './ui.js';
import { renderPlayer } from './player.js';
import { renderBets } from './bets.js';
import { renderLanding } from './landing.js';

// ---------- status + slate ----------
async function loadStatus() {
  const s = await api('/api/health');
  const demo = s.statsProvider === 'demo';
  const q = s.oddsQuota || {};
  const credits = q.remaining != null
    ? ` · credits <b>${q.used}</b> used / <b class="${q.remaining < 50 ? 'low' : ''}">${q.remaining}</b> left${q.lastCost != null ? ` (last call ${q.lastCost})` : ''}`
    : s.keys?.oddsApi ? ' · credits <b>–</b>' : '';
  const asOf = s.dataAsOf
    ? ` · data <b class="${s.stale ? 'low' : ''}">${new Date(s.dataAsOf).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</b>`
    : '';
  $('#status').innerHTML = `${demo ? '<span class="demo">DEMO DATA</span> ' : ''}stats <b>${esc(s.statsProvider)}</b>${asOf} · odds <b>${esc(s.odds)}</b>${credits} · inj <b>${esc(s.injuryProvider)}</b> · <b>${esc(s.today)}</b>`;
}
async function loadSlate() {
  try {
    const games = await api('/api/slate');
    $('#slate').innerHTML = games.length
      ? games.map((g) => `<div class="g"><b>${g.away}</b> @ <b>${g.home}</b> ${g.tipoff ? new Date(g.tipoff).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : esc(g.status)}</div>`).join('')
      : '<div class="g">No games today</div>';
  } catch (e) {
    $('#slate').innerHTML = `<div class="g err">slate: ${esc(e.message)}</div>`;
  }
}

// ---------- search / autocomplete ----------
const input = $('#q');
const ac = $('#ac');
let results = [], sel = -1, timer;

function renderAc() {
  ac.hidden = !results.length;
  input.setAttribute('aria-expanded', String(!ac.hidden));
  ac.innerHTML = results.map((p, i) => `<li role="option" data-i="${i}" aria-selected="${i === sel}">
    <span>${esc(p.name)} <span class="meta">${p.team} · ${esc(p.pos)}</span></span>
    <span class="meta">${fmt(p.pts)} / ${fmt(p.reb)} / ${fmt(p.ast)} · ${fmt(p.min)}m</span></li>`).join('');
}
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const q = input.value.trim();
    results = q.length < 2 ? [] : await api(`/api/players/search?q=${encodeURIComponent(q)}`).catch(() => []);
    sel = results.length ? 0 : -1;
    renderAc();
  }, 120);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { sel = Math.min(results.length - 1, sel + 1); renderAc(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); renderAc(); e.preventDefault(); }
  else if (e.key === 'Enter' && results[sel]) choose(results[sel]);
  else if (e.key === 'Escape') { results = []; renderAc(); input.blur(); }
});
ac.addEventListener('mousedown', (e) => {
  const li = e.target.closest('li');
  if (li) choose(results[Number(li.dataset.i)]);
});
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === '/' && !typing) { e.preventDefault(); input.focus(); input.select(); }
});

function choose(p) {
  results = []; renderAc();
  input.blur();
  input.value = '';
  const stat = location.hash.match(/^#\/p\/[^/]+\/(\w+)/)?.[1] || 'pts';
  location.hash = `#/p/${p.id}/${stat}`;
}

// ---------- routing ----------
async function route() {
  const view = $('#view');
  view.onclick = null;
  const m = location.hash.match(/^#\/p\/([^/]+)(?:\/(\w+))?/);
  document.body.classList.toggle('is-landing', !m && !location.hash.startsWith('#/bets'));
  for (const a of document.querySelectorAll('.nav a')) a.toggleAttribute('aria-current', a.getAttribute('href') === (location.hash.startsWith('#/bets') ? '#/bets' : '#/'));
  if (location.hash.startsWith('#/bets')) return renderBets(view);
  if (!m) return renderLanding(view);
  const stat = state.stats[m[2]] ? m[2] : 'pts';
  return renderPlayer(view, m[1], stat);
}

window.addEventListener('hashchange', route);
window.addEventListener('status:refresh', () => loadStatus().catch(() => {}));
state.stats = await api('/api/stats');
loadStatus();
loadSlate();
route();
