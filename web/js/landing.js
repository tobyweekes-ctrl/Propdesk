// Landing: tonight's games with each team's main players, one tap from their breakdown.
import { esc, fmt, api, teamColour } from './ui.js';

export async function renderLanding(view) {
  view.innerHTML = '<p class="empty">Loading tonight\'s games…</p>';
  let games;
  try { games = await api('/api/slate/players'); } catch (e) { view.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const time = (g) => (g.tipoff ? new Date(g.tipoff).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : esc(g.status || ''));
  const team = (t) => `<span class="tm"><i style="background:${teamColour(t)}"></i>${t}</span>`;
  const side = (players) => `<div class="side">
    ${players.map((p) => `<a class="prow" href="#/p/${esc(p.id)}/pts"><span class="pn">${esc(p.name)}${p.injury ? ` <span class="tag ${/out/i.test(p.injury) ? 'neg-tag' : ''}">${esc(p.injury)}</span>` : ''}</span><span class="pm">${esc(p.pos)} · ${fmt(p.min, 0)}m</span><span class="ps"><b>${fmt(p.pts)}</b> pts · <b>${fmt(p.reb)}</b> reb · <b>${fmt(p.ast)}</b> ast</span></a>`).join('')}
  </div>`;
  view.innerHTML = `
    <section class="hero">
      <h1>Tonight's <em>props</em>, priced.</h1>
      <p>${games.length ? `${games.length} game${games.length === 1 ? '' : 's'} tonight.` : 'No games tonight.'} Tap a player for the model's line, DraftKings prices and a price checker for your own bookie. Press <kbd>/</kbd> to search anyone.</p>
    </section>
    ${games.length ? `<div class="games">${games.map((g) => `<section class="game">
      <header>${team(g.away)} <span class="at">@</span> ${team(g.home)}<span class="time">${time(g)}</span></header>
      <div class="sides">${side(g.awayPlayers)}${side(g.homePlayers)}</div>
    </section>`).join('')}</div>` : ''}`;
}
