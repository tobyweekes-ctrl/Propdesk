// Landing: the model's best value tonight, then each game with its main players (projected minutes).
// Each game, and the whole slate at the bottom, can generate a slip: best value or the 10 most likely legs.
import { esc, fmt, pct, api, teamColour, tipLabel, odds, state, slip, toast } from './ui.js';
import { autoSlip, legFromPool, AUTO_MODES } from './autoslip.js';

export async function renderLanding(view) {
  view.innerHTML = '<p class="empty">Loading tonight\'s games…</p>';
  let games;
  try { games = await api('/api/slate/players'); } catch (e) { view.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const best = games.best || [];
  const benefits = games.benefits || [];
  const gain = (v, label) => (v >= 0.5 ? `<span class="pos">+${fmt(v)}</span> ${label}` : '');
  const benefitCard = (b, i) => `<section class="bf ${i >= 4 ? 'extra' : ''}">
    <header>${team(b.team)} <span class="dim">${b.home ? 'v' : '@'} ${b.opp}</span></header>
    <p class="bf-out">Without ${b.out.map((o) => `<b>${esc(o.name)}</b> <span class="dim">(${esc(o.status.toLowerCase())}${o.injury ? `, ${esc(o.injury.toLowerCase())}` : ''} · ${fmt(o.pts)} pts, ${fmt(o.reb)} reb, ${fmt(o.ast)} ast)</span>`).join(', ')}</p>
    ${b.gainers.length ? b.gainers.map((x) => `<a class="bf-row" href="#/p/${esc(x.id)}/pts"><span class="pn">${esc(x.name)}</span>
      <span class="bf-d">${[gain(x.d.min, 'min'), gain(x.d.pts, 'pts'), gain(x.d.reb, 'reb'), gain(x.d.ast, 'ast')].filter(Boolean).join(' · ')}</span>
      <span class="bf-p">now ${fmt(x.pts)} pts · ${fmt(x.reb)} reb · ${fmt(x.ast)} ast</span></a>`).join('')
    : '<p class="hint" style="margin:6px 0 0">No teammate gains enough to note: the minutes spread thinly.</p>'}
  </section>`;
  const pool = games.pool || [];
  const poolFor = (gameId) => (gameId ? pool.filter((x) => x.gameId === gameId) : pool);
  const genMenu = (gameId, label) => {
    const opts = Object.entries(AUTO_MODES).map(([mode, m]) => {
      const n = autoSlip(poolFor(gameId), mode).length;
      return `<button role="menuitem" data-gen="${mode}" data-game="${esc(gameId || '')}" data-label="${esc(label)}" ${n ? '' : 'disabled'}>
        <b>${mode === 'likely' ? `Top ${n || 10} most likely` : m.label}</b><small>${n ? `${n} leg${n === 1 ? '' : 's'} · ${m.blurb}` : 'no picks yet'}</small></button>`;
    }).join('');
    return `<div class="gen"><button class="mini gen-btn" aria-haspopup="menu" aria-expanded="false">Generate slip ▾</button><div class="gen-menu" role="menu" hidden>${opts}</div></div>`;
  };
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
    ${benefits.length ? `<section class="card">
      <div class="card-head"><h3>Who benefits tonight</h3><span class="hint" style="margin:0">${benefits.length} team${benefits.length === 1 ? '' : 's'} missing rotation players</span></div>
      <div class="bf-grid">${benefits.map(benefitCard).join('')}</div>
      ${benefits.length > 4 ? `<button class="mini bf-more" data-bfmore>Show all ${benefits.length} teams</button>` : ''}
      <p class="hint">Model projection with tonight's injury report against the same projection with everyone available: extra minutes, plus a share of the points, assists and (for a missing centre) rebounds the absent player leaves. Bookmakers adjust these lines too; tap a player to see if the price still has value.</p>
    </section>` : ''}
    ${games.length ? `<div class="games">${games.map((g) => `<section class="game">
      <header>${team(g.away)} <span class="at">@</span> ${team(g.home)}<span class="sp"></span>${pool.length ? genMenu(g.gameId, `${g.away} @ ${g.home}`) : ''}<span class="time">${time(g)}</span></header>
      <div class="sides">${side(g.awayPlayers, g.away)}${side(g.homePlayers, g.home)}</div>
    </section>`).join('')}</div>` : ''}
    ${pool.length && games.length > 1 ? `<section class="card gen-all">
      <div class="card-head"><h3>Build a slip from every game</h3></div>
      <div class="gen-row">${Object.entries(AUTO_MODES).map(([mode, m]) => {
        const n = autoSlip(pool, mode).length;
        return `<button class="gen-big" data-gen="${mode}" data-game="" data-label="all ${games.length} games" ${n ? '' : 'disabled'}><b>${mode === 'likely' ? `Top ${n} most likely` : m.label}</b><small>${n} legs · ${m.blurb} across all ${games.length} games</small></button>`;
      }).join('')}</div>
      <p class="hint">One leg per player, DraftKings prices. Lines where the model disagrees with the market by more than 8%, and prices that haven't moved for hours, are left out. "Most likely" only takes prices the model rates fair or better. Replaces what's in your slip; the slip page analyses it.</p>
    </section>` : ''}`;
  // web version: download the season data in the background while this page is read, so opening a
  // player doesn't wait on it (only the download; the processing waits until a page needs it)
  if (window.PROPDESK_STATIC) {
    const go = () => import('./static.js').then((m) => m.prefetch()).catch(() => {});
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 3000 }); else setTimeout(go, 1500);
  }
  const closeMenus = () => view.querySelectorAll('.gen-menu').forEach((m) => { m.hidden = true; m.previousElementSibling.setAttribute('aria-expanded', 'false'); });
  view.onclick = (e) => {
    const toggle = e.target.closest('.gen-btn');
    if (toggle) {
      const menu = toggle.nextElementSibling;
      const open = menu.hidden;
      closeMenus();
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      return;
    }
    const gen = e.target.closest('[data-gen]');
    if (gen) {
      closeMenus();
      const legs = autoSlip(poolFor(gen.dataset.game), gen.dataset.gen).map(legFromPool);
      if (!legs.length) return;
      const have = slip.get().length;
      if (have && !confirm(`Replace the ${have} selection${have === 1 ? '' : 's'} in your slip with this one?`)) return;
      slip.clear();
      for (const l of legs) slip.add(l);
      toast(`${AUTO_MODES[gen.dataset.gen].label}: ${legs.length} legs from ${gen.dataset.label}`);
      location.hash = '#/slip';
      return;
    }
    if (!e.target.closest('.gen')) closeMenus();
    const more = e.target.closest('[data-bfmore]');
    if (more) { more.closest('.card').classList.add('bf-open'); more.remove(); return; }
    const b = e.target.closest('[data-best]');
    if (!b) return;
    const x = best[Number(b.dataset.best)];
    if (slip.has(legOf(x))) { location.hash = '#/slip'; return; }
    slip.add(legOf(x));
    b.outerHTML = slipBtn(Number(b.dataset.best), true);
    toast(`Added: ${x.name.split(' ').at(-1)} ${label(x)}`);
  };
}
