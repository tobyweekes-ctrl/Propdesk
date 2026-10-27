// Public track record: every pick the model published, graded from box scores.
import { esc, fmt, pct, api, state, odds } from './ui.js';

const signedPct = (x, d = 1) => (x == null ? '–' : `<span class="${x > 0 ? 'pos' : x < 0 ? 'neg' : ''}">${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%</span>`);

export async function renderRecord(view) {
  view.innerHTML = '<p class="empty">Loading…</p>';
  let r;
  try { r = await api('/api/record'); } catch (e) { view.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const o = r.overall || {};
  const head = `<section class="hero"><h1>Track <em>record</em></h1>
    <p>Every pick the model publishes is saved with the price at the time and the closing price, then graded from box scores. Prices are DraftKings'. Flat 1-unit stakes.</p></section>`;
  if (r.unavailable) { view.innerHTML = `${head}<p class="empty">The record is built by the scheduled job on the web version.</p>`; return; }
  if (!o.settled) {
    view.innerHTML = `${head}<section class="card"><p class="empty" style="padding:8px 0">${r.since ? `Tracking since ${esc(r.since)}.` : 'Tracking starts with tonight\'s picks.'} ${r.pending ? `${r.pending} pick${r.pending === 1 ? '' : 's'} waiting on tonight's games.` : ''} Results appear the morning after.</p></section>`;
    return;
  }
  const box = (label, x) => `<div><dt>${label}</dt><dd>${x}</dd></div>`;
  const conf = Object.entries(r.byConfidence).filter(([, x]) => x.picks).map(([c, x]) => `<tr><td class="l">${c}</td><td>${x.settled}</td><td>${pct(x.hitRate)}</td><td>${pct(x.expectedHitRate)}</td><td>${signedPct(x.roi)}</td></tr>`).join('');
  const cal = r.calibration.map((b) => `<tr><td class="l">${b.range}</td><td>${b.n}</td><td>${pct(b.predicted)}</td><td>${pct(b.actual)}</td></tr>`).join('');
  const res = (g) => `<span class="chip ${g.result === 'win' ? 'value' : g.result === 'loss' ? 'avoid' : 'fair'}">${g.result}</span>`;
  view.innerHTML = `${head}
    <div class="summary">
      ${box('Settled picks', `${o.settled} <span class="dim">(${o.won} won)</span>`)}
      ${box('Hit rate', `${pct(o.hitRate)} <span class="dim">model said ${pct(o.expectedHitRate)}</span>`)}
      ${box('ROI (flat stakes)', signedPct(o.roi))}
      ${box('Beat the closing line', r.clv.n ? `${pct(r.clv.positive, 0)} <span class="dim">avg ${signedPct(r.clv.avg)}</span>` : '<span class="dim">not enough yet</span>')}
    </div>
    <div class="slip-grid">
      <section class="card"><h3>By confidence</h3>
        <div class="scroll"><table><tr><th class="l">Confidence</th><th>Picks</th><th>Won</th><th>Model said</th><th>ROI</th></tr>${conf}</table></div></section>
      <section class="card"><h3>Calibration</h3>
        <div class="scroll"><table><tr><th class="l">Model chance</th><th>Picks</th><th>Predicted</th><th>Actual</th></tr>${cal}</table></div>
        <p class="hint">Well calibrated means the 60% picks win about 60% of the time. Small samples swing a lot.</p></section>
    </div>
    <section class="card"><h3>Recent picks</h3>
      <div class="scroll"><table><tr><th>Date</th><th class="l">Pick</th><th>Price</th><th>Model</th><th>Result</th><th>CLV</th></tr>
      ${r.recent.map((g) => `<tr><td>${g.date.slice(5)}</td><td class="l"><b>${esc(g.name)}</b> <span class="dim">${g.side} ${fmt(g.line)} ${state.stats[g.stat]?.short || g.stat}</span></td><td>${odds(g.price ?? (g.side === 'over' ? g.over : g.under))}</td><td>${pct(g.pWin, 0)}</td><td>${res(g)}${g.actual != null ? ` <span class="dim">${fmt(g.actual, 0)}</span>` : ''}</td><td>${g.clv == null ? '–' : signedPct(g.clv)}</td></tr>`).join('')}
      </table></div>
      <p class="hint">CLV (closing-line value) = how far the market's fair price moved toward the pick by tip-off. Consistently beating the close is the best sign of a real edge.</p></section>`;
}
