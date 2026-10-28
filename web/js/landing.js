// Landing: the model's best value tonight, then each game with its main players (projected minutes).
import { esc, fmt, pct, api, teamColour, tipLabel, odds, state, slip, toast } from './ui.js';

export async function renderLanding(view) {
  view.innerHTML = '<p class="empty">Loading tonight\'s games…</p>';
  let games;
  try { games = await api('/api/slate/players'); } catch (e) { view.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const best = games.best || [];
  const time = (g) => (g.tipoff ? tipLabel(g.tipoff) : esc(g.status || ''));
  const team = (t) => `<span class="tm"><i style="background:${teamColour(t)}"></i>${t}</span>`;
  const side = (players, t) => `<div class="side"><div class="side-h">${team(t)}</div>
    ${players.map((p) => `<a class="prow" href="#/p/${esc(p.id)}/pts"><span class="pn">${esc(p.name)}${p.injury ? ` <span class="tag">${esc(p.injury)}</span>` : ''}</span><span class="pm">${esc(p.pos)} · ${fmt(p.minProj ?? p.min, 0)}m${p.minProj != null ? ' proj' : ''}</span><span class="ps"><b>${fmt(p.pts)}</b> pts · <b>${fmt(p.reb)}</b> reb · <b>${fmt(p.ast)}</b> ast</span></a>`).join('')}
  </div>`;
  const label = (b) => `${b.side === 'over' ? 'Over' : 'Under'} ${fmt(b.line)} ${state.stats[b.stat]?.short || b.stat}`;
  const legOf = (x) => ({ playerId: x.playerId, playerName: x.name, team: x.team, stat: x.stat, kind: 'ou', side: x.side, line: x.line,
    price: x.side === 'over' ? x.over : x.under, otherPrice: x.side === 'over' ? x.under : x.over, book: x.book });
  const slipBtn = (i, inSlip) => `<button class="mini ${inSlip ? 'added' : ''}" data-best="${i}" ${inSlip ? 'aria-pressed="true"' : ''}>${inSlip ? '✓ In slip' : '+ Slip'}</button>`;
  view.innerHTML = `
    <section class="hero">
      <h1>Tonight's <em>props</em>, priced.</h1>
      <p>${games.length ? `${games.length} game${games.length === 1 ? '' : 's'}.` : 'No games tonight.'} The model prices every DraftKings line; check your own bookie's price on any player page. Press <kbd>/</kbd> to search.</p>
    </section>
    ${best.length ? `<section class="card">
      <div class="card-head"><h3>Best value tonight</h3><a class="hint" style="margin:0" href="#/record">How has the model done? →</a></div>
      <div class="scroll"><table class="best"><tr><th class="l">Player</th><th class="l">Pick</th><th>Price</th><th>Model</th><th>EV</th><th>Min</th><th></th></tr>
      ${best.map((b, i) => `<tr><td class="l c-who"><a href="#/p/${esc(b.playerId)}/${esc(b.stat)}"><b>${esc(b.name)}</b></a> <span class="dim">${b.team} ${b.home ? 'v' : '@'} ${b.opp}</span></td>
        <td class="l c-pick">${label(b)}</td><td class="c-price">${odds(b.side === 'over' ? b.over : b.under)}</td><td class="c-model">${pct(b.pWin, 0)}</td><td class="pos c-ev">+${Math.round(b.ev * 100)}%</td><td class="c-min">${fmt(b.minutes, 0)}</td>
        <td class="c-add">${slipBtn(i, slip.has(legOf(b)))}</td></tr>`).join('')}</table></div>
      <p class="hint">DraftKings prices (US). Edges over 8% against the market are left out: they usually mean news the model can't see. Confidence and reasons are on each player's page.</p>
    </section>` : ''}
    ${games.length ? `<div class="games">${games.map((g) => `<section class="game">
      <header>${team(g.away)} <span class="at">@</span> ${team(g.home)}<span class="time">${time(g)}</span></header>
      <div class="sides">${side(g.awayPlayers, g.away)}${side(g.homePlayers, g.home)}</div>
    </section>`).join('')}</div>` : ''}`;
  view.onclick = (e) => {
    const b = e.target.closest('[data-best]');
    if (!b) return;
    const x = best[Number(b.dataset.best)];
    if (slip.has(legOf(x))) { location.hash = '#/slip'; return; }
    slip.add(legOf(x));
    b.outerHTML = slipBtn(Number(b.dataset.best), true);
    toast(`Added: ${x.name.split(' ').at(-1)} ${label(x)}`);
  };
}
