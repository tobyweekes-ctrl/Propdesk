// App shell: search with autocomplete, routing, slip counter, odds-format toggle, data note.
import { $, esc, fmt, api, state, slip, oddsFormat, setOddsFormat, teamColour, notFound } from './ui.js';
import { renderPlayer } from './player.js';
import { renderBets } from './bets.js';
import { renderLanding } from './landing.js';
import { renderSlip } from './slip.js';
import { renderRecord } from './record.js';

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
const showFormat = () => {
  const dec = oddsFormat() === 'dec';
  toggle.textContent = dec ? 'Odds 6.00' : 'Odds 5/1';
  toggle.title = `Odds shown as ${dec ? 'decimal' : 'fractional'}: tap for ${dec ? 'fractional' : 'decimal'}`;
};
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
  const page = h.startsWith('#/slip') ? '#/slip' : h.startsWith('#/bets') ? '#/bets' : h.startsWith('#/record') ? '#/record' : null;
  for (const a of document.querySelectorAll('.nav a')) a.toggleAttribute('aria-current', a.getAttribute('href') === page);
  window.scrollTo(0, 0);
  if (page === '#/slip') return renderSlip(view);
  if (page === '#/bets') return renderBets(view);
  if (page === '#/record') return renderRecord(view);
  const m = h.match(/^#\/p\/([^/]+)(?:\/(\w+))?/);
  if (!m && h && h !== '#' && h !== '#/') { view.innerHTML = notFound('There\'s no page at that address.'); return; }
  if (!m) return renderLanding(view);
  return renderPlayer(view, m[1], state.stats[m[2]] ? m[2] : 'pts');
}

window.addEventListener('hashchange', route);
window.addEventListener('status:refresh', () => loadStatus().catch(() => {}));

// web version: the page itself may be a cached copy (Pages allows 10 minutes), so check quietly for a newer
// build and offer a refresh rather than run old code
if (window.PROPDESK_META) {
  const check = async () => {
    try {
      const r = await fetch('data/meta.json', { cache: 'no-store' });
      const m = await r.json();
      if (m.generated && m.generated !== window.PROPDESK_META.generated && !document.querySelector('.update-bar')) {
        const bar = document.createElement('div');
        bar.className = 'update-bar';
        bar.setAttribute('role', 'status');
        bar.innerHTML = '<span>A newer version of Prop Desk is available.</span><button class="mini">Refresh</button>';
        bar.querySelector('button').onclick = () => location.reload();
        document.body.append(bar);
      }
    } catch { /* offline: try again later */ }
  };
  setTimeout(check, 4000);
  setInterval(check, 10 * 60 * 1000);
}
state.stats = await api('/api/stats');
showFormat();
updateCount(false);
loadStatus().catch(() => {});
route();
