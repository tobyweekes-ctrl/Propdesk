// Public track record: every pick the model published, graded from box scores.
import { esc, fmt, pct, api, state, odds } from './ui.js';

const units = (x) => (x == null ? '–' : `<span class="${x > 0 ? 'pos' : x < 0 ? 'neg' : ''}">${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(2)}u</span>`);
const STAT_ORDER = ['pts', 'reb', 'ast', 'fg3m', 'pra', 'pr', 'pa', 'ra'];

// one row per group: settled, won, hit rate against what the model said, ROI
const splitTable = (label, rows) => `<div class="scroll"><table class="split"><tr><th class="l">${label}</th><th>Record</th><th>Hit rate</th><th>Model said</th><th>ROI</th></tr>
  ${rows.filter(([, x]) => x.settled).map(([name, x]) => `<tr><td class="l">${name}</td><td>${x.won}–${x.settled - x.won}</td><td>${pct(x.hitRate, 0)}</td><td class="dim">${pct(x.expectedHitRate, 0)}</td><td>${signedPct(x.roi)}</td></tr>`).join('')}</table></div>`;

/** Daily profit bars with the running total as a line, one units axis; hover a day for its numbers. */
function profitChart(days, W = 640) {
  const H = 210, m = { t: 14, r: 14, b: 26, l: 40 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const vals = days.flatMap((d) => [d.profit, d.cumProfit, 0]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  // round tick steps (1, 2, 5 x 10^n) giving about four gridlines
  const raw = Math.max(1, hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((v) => v >= raw);
  const y0 = Math.floor(lo / step) * step - (lo % step === 0 && lo < 0 ? step : 0), y1 = Math.ceil(hi / step) * step + (hi % step === 0 ? step : 0);
  const y = (v) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
  const band = iw / days.length, bw = Math.min(28, Math.max(4, band - 4));
  const x = (i) => m.l + band * i + band / 2;
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Profit by day and running total, in units">`;
  for (let v = y0; v <= y1 + 1e-9; v += step) { svg += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${m.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${v.toFixed(0)}</text>`; }
  svg += `<line class="zero" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>`;
  days.forEach((d, i) => {
    const top = y(Math.max(0, d.profit)), bot = y(Math.min(0, d.profit));
    svg += `<rect class="bar ${d.profit >= 0 ? 'b-over' : 'b-under'}" x="${x(i) - bw / 2}" y="${top}" width="${bw}" height="${Math.max(1, bot - top)}" rx="3"/>`;
    if (days.length <= 14 || i % Math.ceil(days.length / 10) === 0) svg += `<text class="xl" x="${x(i)}" y="${H - 8}" text-anchor="middle">${d.date.slice(5).replace('-', '/')}</text>`;
  });
  const pts = days.map((d, i) => `${x(i)},${y(d.cumProfit)}`).join(' ');
  svg += `<polyline class="run" points="${pts}"/>${days.map((d, i) => `<circle class="run-dot" cx="${x(i)}" cy="${y(d.cumProfit)}" r="4"/>`).join('')}`;
  svg += days.map((d, i) => `<rect class="hit" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}"/>`).join('');
  return `${svg}</svg>`;
}
const signedPct = (x, d = 1) => (x == null ? '–' : `<span class="${x > 0 ? 'pos' : x < 0 ? 'neg' : ''}">${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%</span>`);

export async function renderRecord(view) {
  view.innerHTML = '<p class="empty">Loading…</p>';
  let r;
  try { r = await api('/api/record'); } catch (e) { view.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const o = r.overall || {};
  const head = `<section class="hero"><h1>Track <em>record</em></h1>
    <p>Every pick the model publishes is saved with the price at the time and the closing price, then graded from box scores. Prices are DraftKings'. Flat 1-unit stakes.</p></section>`;
  if (r.unavailable) { view.innerHTML = `${head}<p class="empty">The record is built by the scheduled job on the web version.</p>`; return; }
  const up = r.upcoming || [];
  const tracking = up.length ? `<section class="card"><div class="card-head"><h3>Tracked tonight</h3><span class="hint" style="margin:0">${r.pending} pick${r.pending === 1 ? '' : 's'}${up.length < r.pending ? `, best ${up.length} shown` : ''}</span></div>
      <div class="scroll"><table class="tracked"><tr><th class="l">Pick</th><th>Price</th><th>Model</th><th>EV</th><th>Confidence</th></tr>
      ${up.map((g) => `<tr><td class="l"><a href="#/p/${esc(g.playerId)}/${esc(g.stat)}"><b>${esc(g.name)}</b></a> <span class="dim">${g.side} ${fmt(g.line)} ${state.stats[g.stat]?.short || g.stat}</span></td><td>${odds(g.side === 'over' ? g.over : g.under)}</td><td>${pct(g.pWin, 0)}</td><td>${g.ev == null ? '–' : signedPct(g.ev, 0)}</td><td>${esc((g.confidence || '').toLowerCase())}</td></tr>`).join('')}
      </table></div><p class="hint">Saved at the first price seen; the closing price is recorded at tip-off.</p></section>` : '';
  if (!o.settled) {
    view.innerHTML = `${head}<section class="card"><p class="empty" style="padding:8px 0">${r.since ? `Tracking since ${esc(r.since)}.` : 'Tracking starts with tonight\'s picks.'} Results appear the morning after the games.</p></section>${tracking}`;
    return;
  }
  const box = (label, x) => `<div><dt>${label}</dt><dd>${x}</dd></div>`;
  const days = r.byDay || [];
  const statRows = Object.entries(r.byStat || {}).sort(([a], [b]) => STAT_ORDER.indexOf(a) - STAT_ORDER.indexOf(b)).map(([k, x]) => [state.stats[k]?.short || k, x]);
  const sideRows = ['over', 'under'].filter((k) => r.bySide?.[k]).map((k) => [k === 'over' ? 'Overs' : 'Unders', r.bySide[k]]);
  const confRows = Object.entries(r.byConfidence).map(([c, x]) => [c[0] + c.slice(1).toLowerCase(), x]);
  const games = (r.byGame || []).filter((g) => g.settled);
  const cal = r.calibration.map((b) => `<tr><td class="l">${b.range}</td><td>${b.n}</td><td>${pct(b.predicted)}</td><td>${pct(b.actual)}</td></tr>`).join('');
  const res = (g) => `<span class="chip ${g.result === 'win' ? 'value' : g.result === 'loss' ? 'avoid' : 'fair'}">${g.result}</span>`;
  view.innerHTML = `${head}
    <div class="summary">
      ${box('Settled picks', `${o.settled} <span class="dim">(${o.won} won)</span>`)}
      ${box('Hit rate', `${pct(o.hitRate)} <span class="dim">model said ${pct(o.expectedHitRate)}</span>`)}
      ${box('ROI (flat stakes)', signedPct(o.roi))}
      ${box('Beat the closing line', r.clv.n ? `${pct(r.clv.positive, 0)} <span class="dim">avg ${signedPct(r.clv.avg)}</span>` : '<span class="dim">not enough yet</span>')}
    </div>
    ${days.length ? `<section class="card"><div class="chart-head"><h3>Profit by day</h3>
        <div class="legend"><span><i class="sw b-over"></i>Day up</span><span><i class="sw b-under"></i>Day down</span><span><i class="ln"></i>Running total</span></div></div>
        <div class="chart-wrap" id="profit">${profitChart(days)}<div class="tip" hidden></div></div>
        <p class="hint">Units at flat 1-unit stakes. ${days.length} day${days.length === 1 ? '' : 's'} so far: give it a few weeks before reading much into it.</p></section>` : ''}
    <div class="slip-grid">
      <section class="card"><h3>By stat</h3>${splitTable('Stat', statRows)}</section>
      <section class="card"><h3>Overs, unders and confidence</h3>${splitTable('Side', sideRows)}<div style="height:10px"></div>${splitTable('Confidence', confRows)}</section>
    </div>
    ${games.length ? `<section class="card"><h3>By game</h3><div class="scroll"><table class="split"><tr><th>Date</th><th class="l">Game</th><th>Record</th><th>Hit rate</th><th>Profit</th></tr>
      ${games.slice(0, 40).map((g) => `<tr><td>${g.date.slice(5)}</td><td class="l">${esc(g.label)}</td><td>${g.won}–${g.settled - g.won}</td><td>${pct(g.hitRate, 0)}</td><td>${units(g.profit)}</td></tr>`).join('')}</table></div>
      <p class="hint">Many picks in one game share its pace, blowouts and overtime, so a game's picks tend to win or lose together.</p></section>` : ''}
    <section class="card"><h3>Calibration</h3>
        <div class="scroll"><table><tr><th class="l">Model chance</th><th>Picks</th><th>Predicted</th><th>Actual</th></tr>${cal}</table></div>
        <p class="hint">Well calibrated means the 60% picks win about 60% of the time. Small samples swing a lot.</p></section>
    ${tracking}
    <section class="card"><h3>Recent picks</h3>
      <div class="scroll"><table class="recent"><tr><th>Date</th><th class="l">Pick</th><th>Price</th><th>Model</th><th>Result</th><th>CLV</th></tr>
      ${r.recent.map((g, i) => (i === 25 ? '</table><details class="more-rows"><summary>Show all ' + r.recent.length + ' picks</summary><table class="recent">' : '') + `<tr><td>${g.date.slice(5)}</td><td class="l"><b>${esc(g.name)}</b> <span class="dim">${g.side} ${fmt(g.line)} ${state.stats[g.stat]?.short || g.stat}</span></td><td>${odds(g.price ?? (g.side === 'over' ? g.over : g.under))}</td><td>${pct(g.pWin, 0)}</td><td>${res(g)}${g.actual != null ? ` <span class="dim">${fmt(g.actual, 0)}</span>` : ''}</td><td>${g.clv == null ? '–' : signedPct(g.clv)}</td></tr>`).join('')}
      </table>${r.recent.length > 25 ? '</details>' : ''}</div>
      <p class="hint">CLV (closing-line value) = how far the market's fair price moved toward the pick by tip-off. Consistently beating the close is the best sign of a real edge.</p></section>`;
  const wrap = view.querySelector('#profit');
  if (wrap) {
    // redraw at the real width so text stays its own size
    wrap.querySelector('svg').outerHTML = profitChart(days, Math.max(280, Math.round(wrap.clientWidth)));
    const tip = wrap.querySelector('.tip');
    const svg = wrap.querySelector('svg');
    svg.addEventListener('pointermove', (e) => {
      const t = e.target.closest('.hit');
      if (!t) { tip.hidden = true; return; }
      const d = days[Number(t.dataset.i)];
      tip.innerHTML = `<b>${d.date}</b><br>${d.won}–${d.settled - d.won} · day ${units(d.profit)}<br>running ${units(d.cumProfit)}`;
      tip.hidden = false;
      const box = wrap.getBoundingClientRect(), tb = t.getBoundingClientRect();
      tip.style.left = `${Math.min(box.width - 150, Math.max(0, tb.left - box.left + tb.width / 2 - 70))}px`;
      tip.style.top = '4px';
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; });
  }
}
