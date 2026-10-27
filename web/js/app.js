// App shell: search with autocomplete, routing, slip counter, odds-format toggle, data note.
import { $, esc, fmt, api, state, slip, oddsFormat, setOddsFormat, teamColour } from './ui.js';
import { renderPlayer } from './player.js';
import { renderBets } from './bets.js';
import { renderLanding } from './landing.js';
import { renderSlip } from './slip.js';

// ---------- footer data note ----------
async function loadStatus() {
  const s = await api('/api/health');
  const asOf = s.dataAsOf ? ` · updated ${new Date(s.dataAsOf).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : '';
  const demo = s.statsProvider === 'demo' ? 'DEMO DATA · ' : '';
  $('#data-note').textContent = `${demo}Stats ${s.statsProvider}${asOf} · Lines ${s.odds} · Injuries ${s.injuryProvider}`;
}

// ---------- slip counter ----------
function updateCount(bump) {
  const n = slip.get().length;
  const el = $('#slip-count');
  el.hidden = n === 0;
  el.textContent = n;
  if (bump) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
}
window.addEventListener('slip:change', () => updateCount(true));

// ---------- odds format toggle ----------
const toggle = $('#odds-toggle');
const showFormat = () => { toggle.textContent = oddsFormat() === 'dec' ? '6.00' : '5/1'; };
toggle.addEventListener('click', () => { setOddsFormat(oddsFormat() === 'dec' ? 'frac' : 'dec'); showFormat(); route(); });

// ---------- search / autocomplete ----------
const input = $('#q');
const ac = $('#ac');
let results = [], sel = -1, timer;

function renderAc() {
  ac.hidden = !results.length;
  input.setAttribute('aria-expanded', String(!ac.hidden));
  ac.innerHTML = results.map((p, i) => `<li role="option" data-i="${i}" aria-selected="${i === sel}">
    <span><i class="dot" style="background:${teamColour(p.team)}"></i>${esc(p.name)} <span class="meta">${p.team} · ${esc(p.pos)}</span></span>
    <span class="meta">${fmt(p.pts)} pts · ${fmt(p.reb)} reb · ${fmt(p.ast)} ast</span></li>`).join('');
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
input.addEventListener('blur', () => setTimeout(() => { results = []; renderAc(); }, 150));
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === '/' && !typing) { e.preventDefault(); input.focus(); input.select(); }
});

function choose(p) {
  results = []; renderAc();
  input.value = '';
  input.blur();
  const stat = location.hash.match(/^#\/p\/[^/]+\/(\w+)/)?.[1] || 'pts';
  location.hash = `#/p/${p.id}/${stat}`;
}

// ---------- routing ----------
async function route() {
  const view = $('#view');
  view.onclick = null;
  view.oninput = null;
  const h = location.hash;
  const page = h.startsWith('#/slip') ? '#/slip' : h.startsWith('#/bets') ? '#/bets' : null;
  for (const a of document.querySelectorAll('.nav a')) a.toggleAttribute('aria-current', a.getAttribute('href') === page);
  window.scrollTo(0, 0);
  if (page === '#/slip') return renderSlip(view);
  if (page === '#/bets') return renderBets(view);
  const m = h.match(/^#\/p\/([^/]+)(?:\/(\w+))?/);
  if (!m) return renderLanding(view);
  return renderPlayer(view, m[1], state.stats[m[2]] ? m[2] : 'pts');
}

window.addEventListener('hashchange', route);
window.addEventListener('status:refresh', () => loadStatus().catch(() => {}));
state.stats = await api('/api/stats');
showFormat();
updateCount(false);
loadStatus().catch(() => {});
route();
