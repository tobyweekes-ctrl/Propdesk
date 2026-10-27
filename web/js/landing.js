// Landing: tonight's slate with each team's main players, one click from their prop breakdown.
import { esc, fmt, api } from './ui.js';

export async function renderLanding(view) {
  view.innerHTML = '<p class="empty">Loading tonight\'s games…</p>';
  let games;
  try { games = await api('/api/slate/players'); } catch (e) { view.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const time = (g) => (g.tipoff ? new Date(g.tipoff).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : esc(g.status || ''));
  const side = (team, players) => `<div class="side"><div class="side-team">${team}</div>
    ${players.map((p) => `<a class="prow" href="#/p/${esc(p.id)}/pts"><span class="pn">${esc(p.name)}${p.injury ? ` <span class="tag ${/out/i.test(p.injury) ? 'neg-tag' : ''}">${esc(p.injury)}</span>` : ''}</span><span class="pm">${esc(p.pos)} · ${fmt(p.min, 0)}m</span><span class="ps">${fmt(p.pts)} <i>/</i> ${fmt(p.reb)} <i>/</i> ${fmt(p.ast)}</span></a>`).join('')}
  </div>`;
  view.innerHTML = `
    <div class="landing-head">
      <h2>Tonight</h2>
      <span class="sub">${games.length} game${games.length === 1 ? '' : 's'} · press <kbd>/</kbd> to search any player · pts / reb / ast over the last 10</span>
    </div>
    ${games.length ? `<div class="games">${games.map((g) => `<section class="game">
      <header><b>${g.away}</b> @ <b>${g.home}</b><span class="dim">${time(g)}</span></header>
      <div class="sides">${side(g.away, g.awayPlayers)}${side(g.home, g.homePlayers)}</div>
    </section>`).join('')}</div>` : '<p class="empty">No games today. Search any player to see their history.</p>'}`;
}
