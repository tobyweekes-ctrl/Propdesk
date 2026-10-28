// Betslip: every Over / Under / "20+" you tapped, with editable prices and stakes, then an
// analysis of the whole slip (singles and accumulator) and a button to log it as placed.
import { esc, fmt, pct, signed, api, slip, odds, parsePrice, state, toast, debounce, teamColour } from './ui.js';

const S = { mode: 'singles', accaStake: 5, analysis: null, error: null, busy: false };
const legLabel = (l) => (l.kind === 'atleast' ? `${l.line + 0.5}+ ${state.stats[l.stat]?.short}` : `${l.side === 'over' ? 'Over' : 'Under'} ${l.line} ${state.stats[l.stat]?.short}`);

export async function renderSlip(view) {
  const legs = slip.get();
  view.innerHTML = `
    <section class="hero"><h1>Your <em>slip</em></h1>
      <p>${legs.length ? `${legs.length} selection${legs.length === 1 ? '' : 's'}. Change any price to the one your bookie offers; the analysis updates as you go.` : 'Empty. Tap Over or Under on a player\'s lines, or + Slip in the price checker, to add selections.'}</p></section>
    ${legs.length ? `<div class="slip-grid">
      <section class="card">
        <div class="card-head"><h3>Selections</h3>
          <div class="seg" role="group" aria-label="Bet type"><button data-mode="singles" aria-pressed="${S.mode === 'singles'}">Singles</button><button data-mode="acca" aria-pressed="${S.mode === 'acca'}" ${legs.length < 2 ? 'disabled' : ''}>Acca</button></div></div>
        <div class="leg" style="padding-top:0;border:0"><span class="hint" style="margin:0">Selection</span><span class="hint" style="margin:0">Price</span><span class="hint" style="margin:0">${S.mode === 'singles' ? 'Stake (£)' : ''}</span><span></span></div>
        ${legs.map((l) => `<div class="leg" data-id="${esc(l.id)}">
          <div class="what"><b><i class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:${teamColour(l.team)}"></i>${esc(l.playerName)}</b><small>${esc(legLabel(l))} · ${esc(l.book || '')}</small></div>
          <input name="price" value="${esc(typeof l.price === 'number' ? odds(l.price) : l.price)}" aria-label="Price">
          ${S.mode === 'singles' ? `<input name="stake" inputmode="decimal" value="${esc(l.stake ?? 1)}" aria-label="Stake in pounds">` : '<span></span>'}
          <button class="x" data-x="${esc(l.id)}" aria-label="Remove">×</button>
        </div>`).join('')}
        ${S.mode === 'acca' ? `<div class="inline"><label class="f">Acca stake (£)<input id="acca-stake" inputmode="decimal" value="${esc(S.accaStake)}"></label></div>` : ''}
        <div class="slip-actions">
          <button class="btn primary" id="place">Log as placed</button>
          <button class="btn ghost" id="clear">Clear slip</button>
        </div>
        <p class="hint">"Log as placed" adds these to your bet log so results are tracked. It doesn't place anything with a bookmaker.</p>
      </section>
      <section class="card" id="analysis"><p class="empty">Analysing…</p></section>
    </div>` : ''}`;
  if (!legs.length) return;
  bind(view);
  analyse();
}

const analyse = debounce(async () => {
  const el = document.getElementById('analysis');
  if (!el) return;
  const legs = slip.get().map((l) => ({ ...l, price: parsePrice(l.price) ?? l.price }));
  try {
    S.analysis = await api('/api/slip/analyse', { method: 'POST', body: { legs, accaStake: S.accaStake } });
    S.error = null;
  } catch (e) {
    S.analysis = null; S.error = e.message;
  }
  el.innerHTML = analysisHtml();
}, 250);

function analysisHtml() {
  if (S.error) return `<div class="card-head"><h3>Analysis</h3></div><p class="err">${esc(S.error)}</p>`;
  const a = S.analysis;
  if (!a) return '';
  const word = { POSITIVE: 'Good value', MARGINAL: 'Roughly fair', NEGATIVE: 'Bookie\'s favour' }[a.verdict] || '–';
  const blurb = { POSITIVE: 'The model rates this slip as positive expected value.', MARGINAL: 'Close to fair: small edge either way.', NEGATIVE: 'Expected to lose money over time at these prices.' }[a.verdict] || '';
  const legRows = a.legs.map((l) => l.error
    ? `<tr><td class="l">${esc(l.playerName || l.player || '')}</td><td colspan="5" class="l neg">${esc(l.error)}</td></tr>`
    : `<tr><td class="l">${esc(l.player.split(' ').at(-1))} <span class="dim">${esc(legLabel(l))}</span></td><td>${pct(l.pWin)}</td><td>${pct(l.fairP ?? l.implied)}</td><td>${odds(l.fairPrice, 'up')}</td><td class="${l.ev >= 0 ? 'pos' : 'neg'}">${signed(l.ev * 100, 0)}%</td><td><span class="chip ${l.verdict.toLowerCase()}">${l.verdict}</span></td></tr>`).join('');
  const s = a.singles, c = a.acca;
  const dist = s.winsDistribution.map((p, i) => `<div class="${i > 0 ? 'won' : ''}" style="height:${Math.max(2, p * 100)}%" title="${i} winner${i === 1 ? '' : 's'}: ${pct(p)}"><span>${pct(p, 0)}</span><label>${i}</label></div>`).join('');
  return `
    <div class="card-head"><h3>Analysis</h3><span class="hint" style="margin:0">${a.sims.toLocaleString()} simulated games</span></div>
    <div class="big-verdict ${a.verdict.toLowerCase()}"><b>${word}</b><span>${blurb}</span></div>
    <div class="scroll" style="margin-top:12px"><table class="legs"><tr><th class="l">Leg</th><th>Model</th><th>Bookie</th><th>Fair</th><th>EV</th><th></th></tr>${legRows}</table></div>
    ${S.mode === 'singles' || !c ? `
      <div class="stats">
        <div><dt>Total stake</dt><dd>£${fmt(s.stake, 2)}</dd></div>
        <div><dt>Expected profit</dt><dd class="${s.expectedProfit >= 0 ? 'pos' : 'neg'}">${s.expectedProfit >= 0 ? '+' : '−'}£${fmt(Math.abs(s.expectedProfit), 2)}</dd></div>
        <div><dt>Expected return</dt><dd class="${s.roi >= 0 ? 'pos' : 'neg'}">${signed((s.roi || 0) * 100, 1)}%</dd></div>
        <div><dt>Expected winners</dt><dd>${fmt(s.expectedWinners, 1)} of ${a.legs.filter((l) => !l.error).length}</dd></div>
        <div><dt>${a.legs.filter((l) => !l.error).length === 1 ? 'Loses' : 'All lose'}</dt><dd>${pct(s.pAllLose)}</dd></div>
      </div>
      <div class="sub-h hint" style="margin-top:14px">How many win (chance of each)</div>
      <div class="dist">${dist}</div><div style="height:20px"></div>`
    : `
      <div class="stats">
        <div><dt>Acca price</dt><dd>${odds(c.price)}</dd></div>
        <div><dt>Model chance</dt><dd>${pct(c.pWin, c.pWin < 0.01 ? 2 : 1)}</dd></div>
        <div><dt>Bookie chance</dt><dd>${pct(c.impliedP, c.impliedP < 0.01 ? 2 : 1)}</dd></div>
        <div><dt>Expected return</dt><dd class="${c.ev >= 0 ? 'pos' : 'neg'}">${signed(c.ev * 100, 0)}%</dd></div>
        <div><dt>Returns if it lands</dt><dd>£${fmt(c.price * S.accaStake, 2)}</dd></div>
      </div>
      <p class="hint">${c.correlation > 1.05 ? `Legs tend to land together (${fmt(c.correlation, 2)}× more often than if independent), which helps an acca.` : c.correlation < 0.95 ? `Legs work against each other (${fmt(c.correlation, 2)}×), which hurts an acca.` : 'Legs are close to independent.'} Independent-legs chance would be ${pct(c.pIndependent, 2)}.</p>
      ${c.dropBest ? `<p class="hint pos">Tip: dropping ${esc(c.dropBest.player)} ${esc(c.dropBest.label)} raises expected return to ${signed(c.dropBest.ev * 100, 0)}%.</p>` : ''}`}
    ${a.flags.length ? `<ul class="flags">${a.flags.map((f) => `<li class="${f.level}">${esc(f.text)}</li>`).join('')}</ul>` : ''}
    <p class="hint">Model chances come from each player's projection. Bookie chance is the price's implied probability (with the margin removed where both sides are known).</p>`;
}

function bind(view) {
  view.onclick = async (e) => {
    const x = e.target.closest('[data-x]');
    if (x) { slip.remove(x.dataset.x); return renderSlip(view); }
    const m = e.target.closest('[data-mode]');
    if (m && !m.disabled) { S.mode = m.dataset.mode; return renderSlip(view); }
    if (e.target.closest('#clear')) { if (confirm('Clear all selections?')) { slip.clear(); renderSlip(view); } return; }
    if (e.target.closest('#place')) return place(view, e.target.closest('#place'));
  };
  view.oninput = (e) => {
    const leg = e.target.closest('.leg');
    if (leg && (e.target.name === 'price' || e.target.name === 'stake')) {
      const patch = e.target.name === 'price' ? { price: e.target.value } : { stake: Number(e.target.value) || 0 };
      const legs = slip.get().map((l) => (l.id === leg.dataset.id ? { ...l, ...patch } : l));
      try { localStorage.setItem('propdesk.slip.v1', JSON.stringify(legs)); } catch { /* ignore */ }
      e.target.classList.toggle('neg', e.target.name === 'price' && !parsePrice(e.target.value));
      analyse();
    }
    if (e.target.id === 'acca-stake') { S.accaStake = Number(e.target.value) || 0; analyse(); }
  };
}

async function place(view, btn) {
  const legs = slip.get().map((l) => ({ ...l, price: parsePrice(l.price) }));
  if (legs.some((l) => !l.price)) return toast('Every selection needs a valid price');
  btn.disabled = true;
  try {
    const out = await api('/api/slip/place', { method: 'POST', body: { legs, mode: S.mode, accaStake: S.accaStake } });
    slip.clear();
    toast(`Logged ${out.length === 1 && S.mode === 'acca' ? 'acca' : `${out.length} bet${out.length === 1 ? '' : 's'}`}`);
    location.hash = '#/bets';
  } catch (e) {
    btn.disabled = false;
    toast(e.message);
  }
}
