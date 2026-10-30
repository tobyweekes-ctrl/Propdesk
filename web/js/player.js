// Player page.
//   verdict card (add the pick to the slip) · bookmaker lines with Over / Under buttons
//   price checker ("20+ at 5/1") with the DraftKings ladder · last 10/20 chart · splits
//   "Model details" drawer: minutes, adjustments, add-your-own O/U line, averages and game log
//   Context panel (c): plain-English notes on availability, the matchup and the game script
import { $, $$, esc, fmt, pct, edge, signed, api, debounce, state, refreshStatus, odds, slip, toast, teamColour, parsePrice, tipLabel, notFound } from './ui.js';
import { barChart } from './chart.js';
import { keyTiles, keyStrip, openTrend } from './keynums.js';

const S = { id: null, stat: 'pts', profile: null, res: null, splits: null, minutes: null, preview: null, selLine: null, window: 'L10', filters: { venue: null, minutes: false, without: '' }, checks: null, mainlines: {} };
const SMALL_N = 5;
const FLAG_LABEL = { returning: 'Return ramp', 'first-game-back': 'First game back', 'no-history': 'No history', 'manual-minutes': 'Manual minutes' };
const statOf = (row) => state.stats[S.stat].parts.reduce((a, k) => a + (row[k] ?? 0), 0);
const short = () => state.stats[S.stat].short;

export async function renderPlayer(view, id, stat) {
  if (S.id !== id) { S.minutes = null; S.preview = null; S.checks = null; S.filters = { venue: null, minutes: false, without: '' }; S.window = 'L10'; S.mainlines = {}; }
  if (S.id !== id || S.stat !== stat) { S.selLine = null; S.checks = null; }
  S.id = id; S.stat = stat;
  view.innerHTML = '<p class="empty">Loading…</p>';
  try {
    const [profile, res, splits, mainlines] = await Promise.all([api(`/api/player/${id}`), fetchAnalysis(), api(`/api/player/${id}/splits?stat=${stat}`),
      api(`/api/player/${id}/mainlines`).catch(() => ({}))]);
    S.profile = profile; S.res = res; S.splits = splits; S.mainlines = mainlines; S.similar = null;
    view.innerHTML = shell(profile);
    view.style.setProperty('--team', teamColour(profile.player.team));
    const tiles = keyTiles(profile, stat);
    $('#keynums', view).innerHTML = keyStrip(tiles);
    $('#keynums', view).onclick = (e) => { const b = e.target.closest('.kn'); if (b) openTrend(tiles[Number(b.dataset.i)], profile.player.name); };
    $('.chips', view).onclick = (e) => { const b = e.target.closest('button'); if (b) location.hash = `#/p/${S.id}/${b.dataset.s}`; };
    renderModel();
    refreshStatus();
    // background beside the model: loads after the page is up
    api(`/api/player/${id}/similar?stat=${stat}`).then((x) => { if (S.id === id && S.stat === stat) { S.similar = x; renderSimilar(); } }).catch(() => {});
  } catch (e) {
    view.innerHTML = /not found/i.test(e.message) ? notFound('That player link doesn\'t match anyone in the data.') : `<p class="err">${esc(e.message)}</p>`;
  }
}

function fetchAnalysis() {
  const q = new URLSearchParams({ stat: S.stat });
  if (S.minutes != null) q.set('min', S.minutes);
  if (S.preview) for (const k of ['line', 'over', 'under', 'book']) if (S.preview[k] !== '' && S.preview[k] != null) q.set(k, S.preview[k]);
  return api(`/api/player/${S.id}/analysis?${q}`);
}
async function rerun() {
  try { S.res = await fetchAnalysis(); renderModel(); } catch (e) { $('#verdict').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

// ---------- skeleton ----------
function flags(d) {
  const out = [];
  if (d.injury) out.push(`<span class="flag ${d.injury.status === 'Out' ? 'neg' : 'warn'}">${esc(d.injury.status)} · ${esc(d.injury.injury)}</span>`);
  const a = d.absence;
  if (a.status === 'returned' && a.gamesMissed >= 3) out.push(`<span class="flag warn">Back ${a.gamesSinceReturn}g after missing ${a.gamesMissed}</span>`);
  if (a.status === 'absent') out.push(`<span class="flag neg">Missed last ${a.gamesMissed} games</span>`);
  if (d.game?.restDays === 0) out.push('<span class="flag warn">Back-to-back</span>');
  return out.join('');
}

function shell(d) {
  const p = d.player, g = d.game;
  const keys = Object.keys(state.stats);
  const tip = g?.tipoff ? ` · ${tipLabel(g.tipoff)}` : '';
  return `
    <div class="ph">
      <h2>${esc(p.name)}</h2>
      <span class="sub">${p.team} · ${esc(p.pos) || '–'} · ${g ? `${g.home ? 'vs' : '@'} <b>${g.opp}</b>${tip}` : 'no game today'}</span>
      <span class="flags">${flags(d)}</span>
    </div>
    <div class="statbar">
      <div class="chips" role="group" aria-label="Stat">${keys.map((s, i) => `<button aria-pressed="${s === S.stat}" data-s="${s}" title="${esc(state.stats[s].label)}${S.mainlines[s] != null ? `, DraftKings line ${S.mainlines[s]}` : ''} (${i + 1})">${state.stats[s].short}${S.mainlines[s] != null ? `<small>${fmt(S.mainlines[s])}</small>` : ''}</button>`).join('')}</div>
      <button class="btn ctx-btn" id="ctxbtn" disabled aria-haspopup="dialog">Context</button>
      <span class="kbd-hint"><kbd>1</kbd>–<kbd>8</kbd> stat · <kbd>c</kbd> context · <kbd>/</kbd> search</span>
    </div>
    <section id="keynums" aria-label="Key numbers"></section>
    <div class="result">
      <div class="col-a">
        <section id="verdict" class="o-verdict"></section>
        <section id="chart-block" class="card o-chart"></section>
        <section id="matchup" class="card o-matchup" hidden></section>
        <section id="similar" class="card o-similar" hidden></section>
        <section id="splits" class="card o-splits"></section>
      </div>
      <div class="col-b">
        <section id="lines" class="card o-lines"></section>
        <section id="check" class="card o-check"></section>
      </div>
    </div>
    <details class="more" id="details"><summary>Model details</summary><div class="inner" id="details-inner"></div></details>`;
}

// stat shortcuts 1-8 (bound once)
document.addEventListener('keydown', (e) => {
  if (!location.hash.startsWith('#/p/') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  const keys = Object.keys(state.stats);
  if (e.key === 'c' && !$('#ctx')?.open) { openContext(); return; }
  const i = Number(e.key) - 1;
  if (i >= 0 && i < keys.length && S.id) location.hash = `#/p/${S.id}/${keys[i]}`;
});
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if ($('#chart-block') && S.res) renderLineParts(); }, 120); });

// ---------- model-dependent parts ----------
function renderModel() {
  const res = S.res;
  contextButton(res.analysis?.notes);
  if (res.out) {
    $('#verdict').innerHTML = outCard(res.out);
    $('#lines').innerHTML = ''; $('#check').innerHTML = ''; $('#details-inner').innerHTML = detailsHtml(null);
    S.selLine = null;
    renderLineParts();
    return;
  }
  if (!res.game || res.analysis?.error) {
    $('#verdict').innerHTML = `<div class="verdict"><div class="v-main"><span class="v-word dim">${!res.game ? 'NO GAME TODAY' : 'NOT ENOUGH DATA'}</span></div><p class="v-notes">${!res.game ? 'No game today, so there is nothing to price. History below.' : esc(res.analysis.error)}</p></div>`;
    $('#lines').innerHTML = ''; $('#check').innerHTML = ''; $('#details-inner').innerHTML = detailsHtml(null);
    renderLineParts();
    return;
  }
  const a = res.analysis;
  if (S.selLine == null || S.preview?.line) S.selLine = S.preview?.line ? Number(S.preview.line) : a.headline?.line ?? a.consensus?.line ?? a.projection.modelLine;
  if (!S.checks) {
    // first row: the line itself as "k or more"; second: at least 2 higher (low-count stats made these equal)
    const p = a.projection.mean;
    const k1 = S.selLine != null ? Math.floor(S.selLine) + 1 : Math.max(1, Math.round(p));
    S.checks = [{ k: k1, price: '' }, { k: k1 + Math.max(2, Math.round(p * 0.3)), price: '' }];
  }
  $('#verdict').innerHTML = verdictCard(a);
  $('#lines').innerHTML = linesCard(a);
  $('#check').innerHTML = checkCard(a);
  $('#details-inner').innerHTML = detailsHtml(a);
  bind();
  renderLineParts();
}

const legFrom = (e, side) => ({
  playerId: S.id, playerName: S.profile.player.name, team: S.profile.player.team, stat: S.stat, kind: 'ou', side, line: e.line,
  price: side === 'over' ? e.over : e.under, otherPrice: side === 'over' ? e.under : e.over, book: e.bookTitle,
});

const dur = (min) => (min == null ? 'an unknown time' : min < 60 ? `${min}m` : min < 48 * 60 ? `${Math.round(min / 60)}h` : `${Math.round(min / 1440)}d`);
const ago = (min) => (min == null ? 'time unknown' : `${dur(min)} ago`);

// P(stat > line) from the projection
const pOverLine = (pmf, line) => pAtLeast(pmf, Math.floor(line) + 1);
// the price at which a side becomes a bet: model chance at least the edge bar above the price's chance
const poss = (n) => `${esc(n)}${/s$/i.test(n) ? "'" : "'s"}`;
// the price at which a side becomes a pick: it must clear both bars the verdict uses (edge and expected return)
const valueAt = (p, a) => (p - a.config.threshold > 0.02 ? Math.max(1 / (p - a.config.threshold), (1 + (a.config.minEv ?? 0)) / p) : null);

// a pick on the less likely side is a price call, not a forecast: say so in words
function underdogNote(side, h, price, need) {
  const other = side === 'over' ? 'under' : 'over';
  const otherPrice = side === 'over' ? h.under : h.over;
  const head = `The model thinks the ${other} is more likely (${pct(h.model[other], 0)}), but at ${odds(otherPrice)} the ${other} is priced as if it were ${pct(1 / otherPrice, 0)} likely, so it's poor value. `;
  return need
    ? `${head}The ${side} at ${odds(price)} needs to land ${pct(1 / price, 0)} of the time to break even and the model gives it ${pct(h.model[side], 0)}: close to break-even, so no bet. It would be value from ${odds(need, 'up')}.`
    : `${head}The ${side} at ${odds(price)} needs to land only ${pct(1 / price, 0)} of the time to break even and the model gives it ${pct(h.model[side], 0)}. A value bet that still loses more often than it wins.`;
}

// why the pick got the confidence it did (same rule as server/model/evaluate.mjs)
function confidenceWhy(h, a) {
  const bar = a.config.threshold, q = a.quality.score;
  const e = h.edge[h.side];
  const parts = [];
  if (h.confidence === 'HIGH') return `High confidence: edge ${pct(e, 1)} (high needs ${pct(bar * 2.5, 0)}+) and data quality ${Math.round(q * 100)}%.`;
  const nextE = h.confidence === 'LOW' ? 1.5 : 2.5, nextQ = h.confidence === 'LOW' ? 0.5 : 0.7;
  if (e < bar * nextE) parts.push(`the edge (${pct(e, 1)}) is ${h.confidence === 'LOW' ? 'only just over' : 'well over'} the ${pct(bar, 0)} bar; ${h.confidence === 'LOW' ? 'medium' : 'high'} needs ${pct(bar * nextE, 0)}+`);
  if (q < nextQ) parts.push(`data quality is ${Math.round(q * 100)}%; ${h.confidence === 'LOW' ? 'medium' : 'high'} needs ${Math.round(nextQ * 100)}%+`);
  return `${h.confidence === 'LOW' ? 'Low' : 'Medium'} confidence because ${parts.join(', and ') || 'of the rules above'}.`;
}

function verdictCard(a) {
  const h = a.headline;
  const p = a.projection;
  const side = h?.side;
  const check = !side && h?.disagree;
  const bar = pct(a.config.threshold, 0);
  let word, sub, style = '', stats = '', note = '';
  if (side) {
    const price = side === 'over' ? h.over : h.under;
    // a bet on the less likely side is a price call: the headline says VALUE so it doesn't read as a forecast
    word = `${h.model[side] < 0.5 ? 'VALUE ' : ''}${side.toUpperCase()} ${fmt(h.line)}`;
    sub = `${esc(h.bookTitle)} · ${odds(price)} · ${h.confidence.toLowerCase()} confidence`;
    style = h.confidence === 'LOW' ? 'lean' : 'bet';
    stats = `<div><dt>Model ${side}</dt><dd>${pct(h.model[side])}</dd></div><div><dt>Edge</dt><dd>${edge(h.leanEdge)}</dd></div><div><dt>Value (EV)</dt><dd>${edge(h.ev[side])}</dd></div>`;
    if (h.model[side] < 0.5) note = underdogNote(side, h, price);
  } else if (h) {
    // a priced line without a bet: say which way the model leans and what price would make it one
    const ls = h.leanSide || (h.model.over >= h.model.under ? 'over' : 'under');
    const pm = h.model[ls];
    const price = ls === 'over' ? h.over : h.under;
    const need = valueAt(pm, a);
    const fairish = (h.leanEdge ?? 0) < 0.01;
    word = check ? 'CHECK NEWS' : h.stale ? `STALE · ${ls.toUpperCase()} ${fmt(h.line)}` : fairish ? `FAIR AT ${fmt(h.line)}` : `LEAN ${ls.toUpperCase()} ${fmt(h.line)}`;
    sub = check ? `Model ${ls} ${pct(pm, 0)} vs ${esc(h.bookTitle)} ${pct(pm - h.leanEdge, 0)}: likely news the model can't see`
      : h.stale ? `${poss(h.bookTitle)} price hasn't moved for ${dur(h.ageMin)}: check your bookie's current price`
        : fairish ? `${esc(h.bookTitle)} have priced it right: no side clears the ${bar} edge bar`
          : `${esc(h.bookTitle)} ${odds(price)} is too short to bet${need ? `. Value from ${odds(need, 'up')}` : ''}`;
    style = check ? 'warnv' : 'soft';
    stats = `<div><dt>Model ${ls}</dt><dd>${pct(pm)}</dd></div><div><dt>Fair price</dt><dd>${odds(1 / pm, 'up')}</dd></div>${check ? '' : `<div><dt>Bet ${ls} at</dt><dd class="pos">${need ? `${odds(need, 'up')}+` : '–'}</dd></div>`}`;
    if (!check && !h.stale && !fairish && pm < 0.5) {
      // the value side is the less likely one and there's no bet: lead with the likely side, so the headline
      // and the numbers agree, and give the price that would make either side a bet
      const likely = ls === 'over' ? 'under' : 'over';
      const pl = h.model[likely], likelyPrice = likely === 'over' ? h.over : h.under;
      const needLikely = valueAt(pl, a);
      word = pl < 0.53 ? `COIN FLIP AT ${fmt(h.line)}` : `${likely.toUpperCase()} ${fmt(h.line)} LIKELY`;
      sub = `No bet: ${esc(h.bookTitle)} ${odds(likelyPrice)} for the ${likely} is too short${needLikely ? ` (value from ${odds(needLikely, 'up')})` : ''}${need ? `; the ${ls} would be value from ${odds(need, 'up')}` : ''}`;
      stats = `<div><dt>Model ${likely}</dt><dd>${pct(pl)}</dd></div><div><dt>Fair price</dt><dd>${odds(1 / pl, 'up')}</dd></div><div><dt>Bet ${likely} at</dt><dd class="pos">${needLikely ? `${odds(needLikely, 'up')}+` : '–'}</dd></div><div><dt>Bet ${ls} at</dt><dd class="pos">${need ? `${odds(need, 'up')}+` : '–'}</dd></div>`;
      note = underdogNote(ls, h, price, need);
    }
    if (check) note = `When the model disagrees with a two-sided bookmaker price by more than ${pct(a.config.marketDisagreement ?? 0.08, 0)}, the bookmaker is usually reacting to something the model can't see: a role change, an injury, a minutes limit. Check the news before treating it as value.`;
  } else {
    // no bookmaker line: the model's own line and the prices that would be value either side
    const L = p.modelLine;
    const po = pOverLine(p.pmf, L), pu = 1 - po;
    const ls = po >= pu ? 'over' : 'under';
    const pm = Math.max(po, pu);
    word = `MODEL LINE ${fmt(L)}`;
    sub = `No bookmaker line yet · model ${ls} ${fmt(L)} at ${pct(pm, 0)}`;
    style = 'soft';
    stats = `<div><dt>Fair over ${fmt(L)}</dt><dd>${odds(1 / po, 'up')}</dd></div><div><dt>Fair under</dt><dd>${odds(1 / pu, 'up')}</dd></div><div><dt>Bet over at</dt><dd class="pos">${valueAt(po, a) ? `${odds(valueAt(po, a), 'up')}+` : '–'}</dd></div><div><dt>Bet under at</dt><dd class="pos">${valueAt(pu, a) ? `${odds(valueAt(pu, a), 'up')}+` : '–'}</dd></div>`;
    note = 'Got a price from your bookie? Put it in the price checker below, or add the line under Model details.';
  }
  return `<div class="verdict ${style}">
    <div class="v-main"><span class="v-word">${word}</span><span class="v-sub">${sub}</span></div>
    <dl>
      ${stats}
      <div><dt>Projection</dt><dd>${fmt(p.mean)}</dd></div>
      <div><dt>Minutes</dt><dd>${fmt(p.minutes.proj)}</dd></div>
    </dl>
    ${side ? `<div class="v-actions"><button class="btn" data-addh="1">+ Add ${side} ${fmt(h.line)} to slip</button></div>` : ''}
    ${note ? `<p class="v-notes">${note}</p>` : ''}
    ${side ? `<p class="v-notes">${confidenceWhy(h, a)}</p>` : ''}
    <p class="v-notes">Data quality ${Math.round(a.quality.score * 100)}%${a.quality.notes.length ? ` · ${a.quality.notes.map(esc).join(' · ')}` : ''}</p>
  </div>`;
}

function outCard(inj) {
  return `<div class="verdict warnv"><div class="v-main"><span class="v-word">OUT</span><span class="v-sub">${esc(inj.injury || inj.status)} · no projection</span></div>
    <p class="v-notes">${esc(inj.status)} on the injury report${inj.note ? `: ${esc(inj.note)}` : ''}. His history is below; teammates' pages account for his absence.</p></div>`;
}

function lineRow(e) {
  const tag = e.source === 'manual' ? '<span class="tag">yours</span>' : '';
  const s = e.leanSide;
  // line movement since the open
  let mv = '';
  if (e.open?.line != null && e.open.line !== e.line) mv = `${e.line > e.open.line ? '▲' : '▼'} from ${fmt(e.open.line)}`;
  else if (e.open?.over && e.open.over !== e.over) mv = `${e.over < e.open.over ? '▲ over shortened' : '▼ over drifted'} from ${odds(e.open.over)}`;
  const age = e.source === 'manual' || e.source === 'preview' || e.ageMin == null ? '' : `changed ${ago(e.ageMin)}`;
  const btn = (side) => `<button class="sbtn ${e.side === side ? 'pick' : ''} ${(side === 'over' ? e.bestOver : e.bestUnder) ? 'best' : ''}" data-add="${esc(e.id)}" data-side="${side}" aria-label="Add ${side} ${e.line} to slip">
      <span>${side}</span><b>${odds(side === 'over' ? e.over : e.under)}</b><small>${pct(e.model[side], 0)}</small></button>`;
  return `<div class="lrow ${e.side ? 'rec' : ''} ${e.stale ? 'stale' : ''} ${e.line === S.selLine ? 'sel' : ''}" data-line="${e.line}" data-row="${esc(e.id)}" tabindex="0" title="Tap to chart this line">
    <div class="who">${esc(e.bookTitle)}${tag}${e.stale ? '<span class="tag">stale</span>' : ''}<small>${[mv, age].filter(Boolean).join(' · ') || '&nbsp;'}</small></div>
    <div class="ln">${fmt(e.line)}</div>
    <div class="side-btns">${btn('over')}${btn('under')}</div>
    <div class="lmeta"><span>Pick <b class="${e.side ? 'pos' : e.verdict === 'CHECK' ? 'warn' : 'dim'}">${e.side ? (e.model[e.side] < 0.5 ? `value ${e.side}` : e.verdict) : e.verdict === 'CHECK' ? 'CHECK NEWS' : s && (e.edge[s] ?? 0) >= 0.01 ? (e.model[s] < 0.5 ? 'no bet' : `lean ${s}`) : 'fair'}</b></span><span>Edge ${s ? `${s} ${edge(e.edge[s])}` : '–'}</span><span>EV ${edge(s ? e.ev[s] : null)}</span>${e.source === 'manual' ? `<button class="mini ghost" data-del="${esc(e.id)}">remove</button>` : ''}</div>
  </div>`;
}

function linesCard(a) {
  const res = S.res;
  const evals = a.evals.filter((e) => e.source !== 'preview');
  return `<div class="card-head"><h3>Lines · ${esc(state.stats[S.stat].label)}</h3><span class="hint" style="margin:0">${res.linesSource ? esc(res.linesSource) : 'no feed'}${res.oddsAgeSec != null ? ` · ${Math.round(res.oddsAgeSec / 60)}m ago` : ''}</span></div>
    ${evals.length ? `<div class="lines-list">${evals.map(lineRow).join('')}</div>
    <p class="hint">Tap Over or Under to add it to your slip. % = model chance. ★ best price. Tap a line to chart it.</p>`
    : '<p class="empty">No bookmaker lines for this market yet. Use the price checker, or add your bookie\'s line under Model details.</p>'}`;
}

// ---------- price checker ----------
function pAtLeast(pmf, k) { let s = 0; for (let x = Math.max(0, Math.ceil(k)); x < pmf.length; x++) s += pmf[x]; return s; }
function judge(p, dec, minEv) {
  const ev = p * dec - 1;
  return { ev, verdict: ev >= minEv ? 'VALUE' : ev >= 0 ? 'FAIR' : 'AVOID' };
}
function checkRow(c, i, a) {
  const pmf = a.projection.pmf;
  const dec = parsePrice(c.price);
  const p = c.k ? pAtLeast(pmf, Number(c.k)) : null;
  let out = '<span class="dim">Enter a threshold and a price, e.g. 20+ at 5/1</span>';
  if (p != null) {
    const fair = p > 0 ? 1 / p : null;
    out = `Model <b>${p < 0.001 ? '<0.1%' : pct(p)}</b> · fair <b>${fair && fair < 1000 ? odds(fair, 'up') : '1000/1+'}</b>`;
    if (dec) {
      const j = judge(p, dec, a.config.minEv);
      const low = j.verdict === 'VALUE' && a.quality.score < 0.5 ? ' <span class="dim">(low confidence)</span>' : '';
      out += ` · bookie ${pct(1 / dec)} · EV <b class="${j.ev >= 0 ? 'pos' : 'neg'}">${signed(j.ev * 100, 0)}%</b> <span class="chip ${j.verdict.toLowerCase()}">${j.verdict}</span>${low}`;
    }
    if (dec && p - 1 / dec > (a.config.marketDisagreement ?? 0.08)) out += '<br><span class="warn">Big gap between the model and this price: check team news before trusting it.</span>';
    const dk = (S.res.ladder || []).find((l) => l.k === Number(c.k));
    if (dk) out += `<br><span class="dim">DraftKings: ${odds(dk.price)} for ${c.k}+${dk.stale ? ` (unchanged for ${dur(dk.ageMin)}, may be out of date)` : dec ? (dec > dk.price ? ', so your price beats it' : dec < dk.price ? ', so theirs is better' : ', the same') : ''}</span>`;
  }
  return `<div class="crow" data-i="${i}">
    <label class="plus"><input name="k" inputmode="numeric" value="${esc(c.k)}" aria-label="Threshold">+</label>
    <label class="price"><input name="price" placeholder="5/1" value="${esc(c.price)}" aria-label="Price"></label>
    <div class="out">${out}</div>
    <button class="mini" data-cadd="${i}" ${dec && c.k ? '' : 'disabled'} title="Add to slip">+ Slip</button>
    <button class="mini ghost" data-cdel="${i}" aria-label="Remove row">×</button>
  </div>`;
}

function checkCard(a) {
  const pmf = a.projection.pmf;
  const ladder = S.res.ladder || [];
  const dk = new Map(ladder.map((l) => [l.k, l]));
  const gapBar = a.config.marketDisagreement ?? 0.08;
  // thresholds: everything DraftKings prices, plus a spread around the projection
  const ks = new Set(ladder.map((l) => l.k));
  for (let k = 1; k < pmf.length; k++) { const p = pAtLeast(pmf, k); if (p < 0.93 && p > 0.02) ks.add(k); }
  const sorted = [...ks].sort((x, y) => x - y).filter((k, i, arr) => dk.has(k) || arr.length <= 14 || i % Math.ceil(arr.length / 14) === 0);
  const rows = sorted.map((k) => {
    const p = pAtLeast(pmf, k);
    const l = dk.get(k);
    const price = l?.price;
    let j = price && !l.stale ? judge(p, price, a.config.minEv) : null;
    // one-sided prices carry a margin, so a gap beyond the bar after that is a warning, not value
    if (j && p - 1 / price > gapBar) j = { ...j, verdict: 'CHECK' };
    const tag = !price ? '' : l.stale ? `<span class="dim" title="price unchanged for ${dur(l.ageMin)}">stale</span>` : j ? `<span class="chip ${j.verdict === 'CHECK' ? 'fair' : j.verdict.toLowerCase()}">${j.verdict}</span>` : '';
    return `<tr class="${j?.verdict === 'VALUE' ? 'val' : ''} ${l?.stale ? 'stale' : ''}"><td class="k">${k}+</td><td>${pct(p, 0)}</td><td>${p > 0.001 ? odds(1 / p, 'up') : '–'}</td><td>${price ? odds(price) : '<span class="dim">–</span>'}</td>
      <td>${tag}</td><td>${price && !l.stale ? `<button class="mini" data-ladd="${k}" data-price="${price}">+ Slip</button>` : ''}</td></tr>`;
  }).join('');
  const thin = a.quality.score < 0.5 ? `<p class="hint neg">Thin data for this player (${a.quality.notes.map(esc).join('; ')}). Value calls here are low confidence.</p>` : '';
  return `<div class="card-head"><h3>Check a price · ${short()}</h3></div>
    <div class="check-rows">${S.checks.map((c, i) => checkRow(c, i, a)).join('')}</div>
    <div class="slip-actions"><button class="mini" id="cmore">+ Add another price</button></div>
    ${thin}
    <h3 style="margin:18px 0 6px;font-size:13px;letter-spacing:.1em;color:var(--faint)">Ladder: model vs DraftKings</h3>
    <div class="scroll"><table class="ladder"><tr><th class="l">${short()}</th><th>Model</th><th>Fair</th><th>DraftKings</th><th></th><th></th></tr>${rows}</table></div>
    <p class="hint">"20+" means 20 or more. Fair = the price at which the model sees no edge. VALUE = at least ${pct(a.config.minEv, 0)} expected return, the same bar as the verdict.</p>`;
}

// ---------- context panel ----------
const TONE = { up: ['▲', 'pos', 'moved the projection up'], down: ['▼', 'neg', 'moved the projection down'], info: ['◦', 'dim', 'context the model does not use'], flat: ['•', 'dim', 'neutral'] };

function contextButton(n) {
  const b = $('#ctxbtn');
  if (!b) return;
  b.disabled = !n;
  if (!n) { b.textContent = 'Context'; return; }
  const all = n.sections.flatMap((x) => x.notes);
  const up = all.filter((x) => x.tone === 'up').length, down = all.filter((x) => x.tone === 'down').length;
  b.innerHTML = `Context <span class="pos">▲${up}</span> <span class="neg">▼${down}</span>`;
  b.onclick = openContext;
}

function openContext() {
  const n = S.res?.analysis?.notes;
  if (!n) return;
  let d = $('#ctx');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'ctx';
    d.className = 'ctx';
    d.setAttribute('aria-labelledby', 'ctx-title');
    document.body.append(d);
    // click on the backdrop closes
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  }
  const p = S.profile.player, g = S.res.game;
  const note = (x) => {
    const [icon, cls, label] = TONE[x.tone] || TONE.flat;
    return `<li class="cnote ${x.tone}"><span class="ci ${cls}" title="${label}" aria-label="${label}">${icon}</span><div><b>${esc(x.title)}</b><p>${esc(x.text)}</p></div></li>`;
  };
  // background that reads the same for everyone facing this opponent is folded away, so the panel leads with what matters
  const quiet = n.sections.flatMap((sec) => sec.notes.filter((x) => x.quiet));
  d.innerHTML = `<div class="ctx-in">
    <header><div><h2 id="ctx-title">${esc(p.name)} · ${short()}</h2><span class="sub">${g.home ? 'vs' : '@'} ${esc(g.opp)}${g.tipoff ? ` · ${tipLabel(g.tipoff)}` : ''}</span></div>
      <button class="mini ghost" data-close aria-label="Close">Esc ×</button></header>
    <p class="ctx-sum ${TONE[n.summary.tone]?.[1] || ''}">${esc(n.summary.text)}</p>
    ${n.sections.filter((sec) => sec.notes.some((x) => !x.quiet)).map((sec) => `<section><h3>${esc(sec.title)}</h3><ul>${sec.notes.filter((x) => !x.quiet).map(note).join('')}</ul></section>`).join('')}
    ${quiet.length ? `<details class="ctx-quiet"><summary>Also checked, nothing that changes this pick (${quiet.length})</summary><ul>${quiet.map(note).join('')}</ul></details>` : ''}
    <p class="hint">▲ ▼ moved the projection up or down · ◦ background the model doesn't use · • neutral. ${esc(n.basis)}</p>
  </div>`;
  d.showModal();
  d.querySelector('[data-close]').focus();
}

// ---------- details drawer ----------
function detailsHtml(a) {
  const d = S.profile;
  const keys = Object.keys(state.stats);
  const avgRows = Object.entries(d.averages).map(([k, x]) => `<tr><td>${k}</td><td>${x.gp}</td><td>${fmt(x.min)}</td><td>${fmt(x.usg)}</td>${keys.map((s) => `<td>${fmt(x[s])}</td>`).join('')}</tr>`).join('');
  const cols = ['date', 'opp', 'min', 'pts', 'reb', 'ast', 'fg3m', 'fga', 'fta', 'tov', 'pm'];
  const logRows = d.logs.map((r) => `<tr>${cols.map((c) => `<td>${c === 'opp' ? (r.home ? 'v ' : '@ ') + r.opp : c === 'min' ? fmt(r[c], 0) : esc(r[c])}</td>`).join('')}</tr>`).join('');
  if (!a) return `<div class="scroll"><table><tr><th>Split</th><th>GP</th><th>Min</th><th>Usg%</th>${keys.map((s) => `<th>${state.stats[s].short}</th>`).join('')}</tr>${avgRows}</table></div>`;
  const m = a.projection.minutes, p = a.projection;
  const prev = a.evals.find((e) => e.source === 'preview');
  const pv = S.preview || {};
  return `
    <div class="sub-h">Minutes · ${fmt(m.proj)} ±${fmt(m.sd)}${m.flags.length ? ` · ${m.flags.map((f) => FLAG_LABEL[f] || f).join(', ')}` : ''}</div>
    <div class="scroll"><table><tr><th class="l">Step</th><th>Min</th><th class="l">Why</th></tr>${m.steps.map((s) => `<tr><td class="l">${esc(s.label)}</td><td>${s.key === 'base' ? fmt(s.value) : signed(s.value)}</td><td class="why">${esc(s.note || '')}</td></tr>`).join('')}</table></div>
    <form id="minform" class="inline"><label class="f">Your minutes<input name="min" inputmode="decimal" placeholder="${fmt(m.proj)}" value="${S.minutes ?? ''}"></label><button class="btn">Apply</button>${S.minutes != null ? '<button type="button" class="btn ghost" id="minreset">Reset</button>' : ''}</form>
    <div class="sub-h">Rate per 36 · ${fmt(p.basePer36)} → ${fmt(p.per36)} · ${esc(p.family)}</div>
    <div class="scroll"><table><tr><th class="l">Adjustment</th><th>Effect</th><th class="l">Note</th></tr>
      <tr><td class="l">Season blend</td><td>–</td><td class="why">${Math.round(p.seasonWeight * 100)}% this season, rest last season; recent form on top</td></tr>
      ${p.factors.map((f) => `<tr><td class="l">${esc(f.label)}</td><td>${edge(f.value - 1)}</td><td class="why">${esc(f.note || '')}</td></tr>`).join('')}</table></div>
    <div class="sub-h">Add your bookie's over/under line</div>
    <form id="manual" class="manual" autocomplete="off">
      <label class="f">Bookie<input name="book" required maxlength="40" placeholder="Bet365" value="${esc(pv.book || '')}"></label>
      <label class="f">Line<input name="line" required inputmode="decimal" placeholder="${fmt(S.selLine)}" value="${esc(pv.line ?? '')}"></label>
      <label class="f">Over<input name="over" placeholder="10/11" value="${esc(pv.over || '')}"></label>
      <label class="f">Under<input name="under" placeholder="5/6" value="${esc(pv.under || '')}"></label>
      <button type="submit" class="btn">Save line</button>
    </form>
    ${prev ? `<div class="lines-list" style="margin-top:10px">${lineRow(prev)}</div>` : ''}
    <p id="manual-msg" class="hint">Saved lines appear in the Lines card with Over / Under buttons.</p>
    <div class="sub-h">Averages</div>
    <div class="scroll"><table><tr><th>Split</th><th>GP</th><th>Min</th><th>Usg%</th>${keys.map((s) => `<th>${state.stats[s].short}</th>`).join('')}</tr>${avgRows}</table></div>
    <div class="sub-h">Game log</div>
    <div class="scroll"><table><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>${logRows}</table></div>`;
}

// ---------- chart, hit rates, splits (client-side, follow the selected line) ----------
function hitOf(values, line) {
  // with no line there is nothing to hit: counting "v > null" made every game an over (100%)
  if (line == null) return { n: values.length, over: null, rate: null, avg: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null };
  const over = values.filter((v) => v > line).length;
  return { n: values.length, over, rate: values.length ? over / values.length : null };
}
// games behind the chart and hit rates: the filters (venue, minutes like tonight's, without a teammate), then a window
const WINDOWS = [['L5', 'Last 5'], ['L10', 'Last 10'], ['L20', 'Last 20'], ['season', 'This season'], ['h2h', 'vs opp']];
function filterInfo() {
  const proj = S.res.analysis?.projection?.minutes?.proj;
  const minCut = proj != null ? Math.max(10, Math.floor(proj) - 3) : null;
  const mates = S.splits.filter((x) => x.key.startsWith('without:') && x.dates);
  return { minCut, mates };
}
function filteredLogs() {
  const f = S.filters, { minCut, mates } = filterInfo();
  const without = f.without ? new Set(mates.find((m) => m.key === f.without)?.dates || []) : null;
  return S.profile.logs.filter((r) => (!f.venue || (f.venue === 'home') === Boolean(r.home))
    && (!f.minutes || minCut == null || r.min >= minCut) && (!without || without.has(r.date)));
}
function windowRows(rows, w) {
  const opp = S.res.game?.opp;
  if (w === 'season') return rows.filter((r) => r.season === Object.keys(S.profile.averages)[0]); // current season first
  if (w === 'h2h') return opp ? rows.filter((r) => r.opp === opp) : [];
  return rows.slice(0, Number(w.slice(1)));
}
const median = (xs) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

function renderLineParts() {
  const line = S.selLine;
  const team = S.profile.player.team;
  const rows = filteredLogs();
  const { minCut, mates } = filterInfo();
  const opp = S.res.game?.opp;
  const f = S.filters;
  const anyFilter = f.venue || f.minutes || f.without;
  const strip = WINDOWS.filter(([w]) => w !== 'h2h' || opp).map(([w, label]) => {
    const v = windowRows(rows, w).map(statOf);
    return { w, label: w === 'h2h' ? `vs ${opp}` : label, ...hitOf(v, line), avg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null };
  });
  const changed = S.profile.logs.some((r) => r.team !== team);
  const sel = windowRows(rows, S.window);
  const selVals = sel.map(statOf);
  const games = sel.slice().reverse().map((r) => ({ date: r.date, opp: r.opp, home: r.home, min: r.min, season: r.season, team: r.team, old: r.team !== team, value: statOf(r) }));
  const proj = S.res.analysis?.projection?.mean ?? null;
  const winLabel = (WINDOWS.find(([w]) => w === S.window) || [])[1] || '';
  const block = $('#chart-block');
  if (!block.querySelector('#chart')) {
    block.innerHTML = `<div class="chart-head"><h3 id="chart-title"></h3>
        <div class="legend"><span><i class="sw b-over"></i>Over</span><span><i class="sw b-under"></i>Under</span><span><i class="ln"></i>Line</span>${proj != null ? '<span><i class="ln proj"></i>Projection</span>' : ''}</div></div>
      <div class="hitstrip" id="hitstrip" role="group" aria-label="Games shown"></div>
      <div class="filters" id="filters"></div>
      <div id="chart"></div>
      <div class="linectl" id="linectl"></div>
      <p class="hint" id="chart-note"></p>`;
  }
  $('#chart-title').textContent = `${S.window === 'h2h' ? `vs ${opp}` : winLabel} · ${short()}${line != null ? ` vs ${fmt(line)}` : ''}`;
  $('#hitstrip').innerHTML = strip.map((h) => `<button data-w="${h.w}" aria-pressed="${S.window === h.w}" ${h.n ? '' : 'disabled'}>
      <span class="hl">${esc(h.label)}</span>
      <b class="${h.rate == null ? '' : h.rate >= 0.5 ? 'pos' : 'neg'}">${!h.n ? '–' : line == null ? fmt(h.avg) : pct(h.rate, 0)}</b>
      <small>${!h.n ? 'no games' : line == null ? `${h.n} game${h.n === 1 ? '' : 's'}` : `${h.over} of ${h.n}`}</small>${h.n && line != null ? `<small>avg ${fmt(h.avg)}</small>` : ''}</button>`).join('');
  $('#filters').innerHTML = `<span class="fl">Filter</span>
    <button class="fchip" data-f="home" aria-pressed="${f.venue === 'home'}">Home</button>
    <button class="fchip" data-f="away" aria-pressed="${f.venue === 'away'}">Away</button>
    ${minCut != null ? `<button class="fchip" data-f="min" aria-pressed="${f.minutes}" title="Games where he played about as long as tonight's projection or longer">${minCut}+ min</button>` : ''}
    ${mates.length ? `<label class="fsel"><span class="sr">Without a teammate</span><select data-f="without"><option value="">With or without anyone</option>${mates.map((m) => `<option value="${esc(m.key)}" ${f.without === m.key ? 'selected' : ''}>${esc(m.label)} (${m.dates.length}g)${m.outTonight ? ' · out tonight' : ''}</option>`).join('')}</select></label>` : ''}
    ${anyFilter ? '<button class="fchip clear" data-f="clear">Clear</button>' : ''}`;
  barChart($('#chart'), games, { line, projection: proj, label: `${S.profile.player.name} ${short()}` });
  if (!games.length) $('#chart').innerHTML = `<p class="empty">No games match${anyFilter ? ' these filters' : ''}.</p>`;
  renderLineCtl();
  const notes = [];
  if (selVals.length) notes.push(`Average ${fmt(selVals.reduce((a, b) => a + b, 0) / selVals.length)} · median ${fmt(median(selVals))} over ${selVals.length} game${selVals.length === 1 ? '' : 's'}${anyFilter ? ' that match the filters' : ''}.`);
  if (changed) notes.push(`Faded bars are games for his previous team.`);
  if (selVals.length && selVals.length < SMALL_N) notes.push('Small sample: treat the hit rate lightly.');
  $('#chart-note').textContent = notes.join(' ');
  renderSplits(line);
  renderMatchup();
  $$('.lrow[data-line]').forEach((r) => r.classList.toggle('sel', Number(r.dataset.line) === line));
}

// drag the line: hit rates, the chart and the model's chance follow it
function renderLineCtl() {
  const el = $('#linectl');
  const a = S.res.analysis;
  const line = S.selLine;
  if (line == null) { el.innerHTML = ''; return; }
  const vals = S.profile.logs.slice(0, 40).map(statOf);
  const proj = a?.projection?.mean ?? line;
  const lo = 0.5, hi = Math.max(line, proj * 2, ...vals) + 0.5;
  const pmf = a?.projection?.pmf;
  const po = pmf ? pOverLine(pmf, line) : null;
  const ev = a?.evals?.find((e) => e.line === line && e.source !== 'preview');
  const lad = (S.res.ladder || []).find((l) => l.k === Math.floor(line) + 1);
  const book = ev ? `DraftKings over ${odds(ev.over)} · under ${odds(ev.under)}` : lad ? `DraftKings ${lad.k}+ at ${odds(lad.price)}` : 'no DraftKings price at this line';
  const main = a?.headline?.line ?? a?.consensus?.line ?? null;
  const info = `${po != null ? `Model: over ${pct(po, 0)} (fair ${odds(1 / Math.max(po, 0.001), 'up')}) · under ${pct(1 - po, 0)} (fair ${odds(1 / Math.max(1 - po, 0.001), 'up')}) · ` : ''}${book}`;
  if (!el.querySelector('input')) {
    el.innerHTML = `<button class="mini ghost" data-ln="-1" aria-label="Line down">−</button>
      <label class="lrange"><span class="sr">Line</span><input type="range" min="${lo}" max="${hi}" step="0.5" value="${line}"></label>
      <button class="mini ghost" data-ln="1" aria-label="Line up">+</button>
      <b class="lval"></b><span class="linfo"></span><button class="mini ghost lreset" data-ln="0" hidden>Back to ${fmt(main)}</button>`;
  }
  const input = el.querySelector('input');
  if (Number(input.value) !== line) input.value = line;
  el.querySelector('.lval').textContent = `Line ${fmt(line)}`;
  el.querySelector('.linfo').textContent = info;
  el.querySelector('.lreset').hidden = main == null || main === line;
}

// same-position players' recent games against tonight's opponent, each against their own average
function renderSimilar() {
  const el = $('#similar');
  const d = S.similar;
  if (!el) return;
  if (!d || !d.rows?.length) { el.hidden = true; return; }
  el.hidden = false;
  const delta = (v) => `<span class="${v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : 'dim'}">${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))}</span>`;
  const above = d.rows.filter((x) => x.value > x.avg).length;
  el.innerHTML = `<div class="card-head"><h3>Similar players vs ${esc(d.opp)}</h3><span class="hint" style="margin:0">${d.rows.length} game${d.rows.length === 1 ? '' : 's'}</span></div>
    <p class="sim-sum">Players at his position ${d.matchOn === 'fg3a' ? `who try a similar number of threes (he tries ${fmt(d.myAtt)} a game)` : d.matchOn === 'fga+pts' ? `with similar shots and scoring (he takes ${fmt(d.myAtt)} shots and scores ${fmt(d.myAvg)} a game)` : `with similar ${esc(state.stats[S.stat].label.toLowerCase())} numbers`} put up ${delta(d.avgDelta)} on average against their own average when they faced ${esc(d.opp)}; ${above} of ${d.rows.length} beat it.</p>
    <div class="scroll"><table class="sim"><tr><th class="l">Player</th><th>Date</th><th>Min</th><th>${short()}</th>${d.matchOn === 'fg3a' ? '<th>3PA avg</th>' : d.matchOn === 'fga+pts' ? '<th>Shots avg</th>' : ''}<th>Their avg</th><th>Vs avg</th></tr>
    ${d.rows.map((x) => `<tr class="${x.season !== d.current ? 'old' : ''}"><td class="l"><a href="#/p/${esc(x.id)}/${esc(S.stat)}"><b>${esc(x.name)}</b></a> <span class="dim">${esc(x.team)}</span></td><td>${x.date.slice(5).replace('-', '/')}</td><td>${x.min}</td><td>${fmt(x.value, 0)}</td>${x.att != null ? `<td class="dim">${fmt(x.att)}</td>` : ''}<td class="dim">${fmt(x.avg)}</td><td>${delta(x.value - x.avg)}</td></tr>`).join('')}</table></div>
    <p class="hint">Same-position players who played 20+ minutes against ${esc(d.opp)} in their last 15 games, picked for ${d.matchOn === 'fg3a' ? 'three-point attempts closest to his (under 1 a game left out)' : d.matchOn === 'fga+pts' ? 'shots a game and points a game closest to his' : 'averages closest to his'}. ${d.rows.some((x) => x.season !== d.current) ? ' Faded rows are from last season.' : ''} One game each, so it swings a lot: background next to the model, which doesn't use it.</p>`;
}

// tonight's opponent against his position, for each stat, ranked out of every team
function renderMatchup() {
  const el = $('#matchup');
  const d = S.res.analysis?.defence;
  if (!d || !d.stats?.length) { el.hidden = true; return; }
  el.hidden = false;
  const parts = state.stats[S.stat].parts;
  const ORD = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
  const rankText = (x) => (x.rank <= x.of / 2 ? `${ORD(x.rank)} most` : `${ORD(x.of + 1 - x.rank)} fewest`);
  const word = (x) => (x.factor >= 1.04 ? ['soft', 'pos'] : x.factor <= 0.96 ? ['tough', 'neg'] : ['average', 'dim']);
  el.innerHTML = `<div class="card-head"><h3>${esc(d.opp)} defence vs ${esc(d.groupLabel)}</h3><span class="hint" style="margin:0">rank of ${d.stats[0].of}</span></div>
    <div class="mu-grid">${d.stats.map((x) => {
      const [w, cls] = word(x);
      // soft (allows the most) on the right, like a meter
      const pos = x.of > 1 ? (1 - (x.rank - 1) / (x.of - 1)) * 100 : 50;
      return `<div class="mu ${parts.includes(x.stat) ? 'on' : ''}"><span class="mu-l">${esc(state.stats[x.stat]?.label || x.stat)} allowed</span>
        <b class="${cls}">${x.factor >= 1 ? '+' : '−'}${Math.abs(Math.round((x.factor - 1) * 100))}%</b><small>vs league · ${rankText(x)} · ${w}</small>
        <span class="meter" aria-hidden="true"><i style="left:${pos.toFixed(0)}%"></i></span></div>`;
    }).join('')}</div>
    <p class="hint">Per minute, to ${esc(d.groupLabel)}, against the league average: ${esc(d.basis)}. Left of the bar is tough, right is soft. Highlighted: the parts of ${esc(state.stats[S.stat].label.toLowerCase())}. These numbers are noisy, so the model applies half of the difference${d.games && d.games < 10 ? `, and with ${d.games} game${d.games === 1 ? '' : 's'} this season most of it comes from last season` : ''}.</p>`;
}

function renderSplits(line) {
  const all = S.splits.filter((s) => s.group === 'Season').flatMap((s) => s.values);
  const base = all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
  let group = null;
  const rows = S.splits.filter((s) => s.n > 0 || s.group === 'Teammates').map((s) => {
    const h = hitOf(s.values, line);
    const head = s.group !== group ? `<tr class="grp"><td colspan="5">${esc(s.group)}</td></tr>` : '';
    group = s.group;
    const delta = s.avg != null && base != null ? s.avg - base : null;
    // under 5 games a split is mostly noise: show it greyed, without a verdict-like hit rate
    const small = s.n < SMALL_N && s.group !== 'Season';
    return `${head}<tr class="${small ? 'small' : ''}"><td class="l">${esc(s.label)}${s.outTonight ? '<span class="tag neg-tag">out tonight</span>' : ''}${small ? '<span class="small-n">small sample</span>' : ''}</td><td>${s.n}</td>
      <td>${small ? fmt(s.avg) : `${fmt(s.avg)} ${delta == null ? '' : `<span class="${delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'dim'}">${signed(delta)}</span>`}`}</td><td>${fmt(s.min, 0)}</td><td>${small || !s.n || line == null ? '–' : `${h.over}/${h.n} <span class="dim">${pct(h.rate, 0)}</span>`}</td></tr>`;
  }).join('');
  $('#splits').innerHTML = `<div class="card-head"><h3>Splits · ${short()}${line != null ? ` · over ${fmt(line)}` : ''}</h3></div>
    <div class="scroll"><table class="splits"><tr><th class="l">Split</th><th>GP</th><th>Avg</th><th>Min</th><th>Over</th></tr>${rows}</table></div>`;
}

// ---------- interactions ----------
function bind() {
  const view = $('#view');
  view.onclick = async (e) => {
    const t = e.target;
    const addH = t.closest('[data-addh]');
    if (addH) { const h = S.res.analysis.headline; return addLeg(legFrom(h, h.side)); }
    const add = t.closest('[data-add]');
    if (add) { const ev = S.res.analysis.evals.find((x) => x.id === add.dataset.add); return addLeg(legFrom(ev, add.dataset.side)); }
    const del = t.closest('[data-del]');
    if (del) { del.disabled = true; await api(`/api/entries/${del.dataset.del}`, { method: 'DELETE' }); return rerun(); }
    const cadd = t.closest('[data-cadd]');
    if (cadd) { const c = S.checks[Number(cadd.dataset.cadd)]; return addLeg(atLeastLeg(Number(c.k), c.price, 'Your price')); }
    const ladd = t.closest('[data-ladd]');
    if (ladd) return addLeg(atLeastLeg(Number(ladd.dataset.ladd), Number(ladd.dataset.price), 'DraftKings'));
    const cdel = t.closest('[data-cdel]');
    if (cdel) { S.checks.splice(Number(cdel.dataset.cdel), 1); if (!S.checks.length) S.checks.push({ k: '', price: '' }); return redrawCheck(); }
    if (t.closest('#cmore')) { S.checks.push({ k: '', price: '' }); redrawCheck(); return $$('.crow input[name=k]').at(-1)?.focus(); }
    if (t.closest('#minreset')) { S.minutes = null; return rerun(); }
    const row = t.closest('.lrow[data-line]');
    if (row && !t.closest('button')) { S.selLine = Number(row.dataset.line); renderLineParts(); return; }
    const w = t.closest('#hitstrip [data-w]');
    if (w && !w.disabled) { S.window = w.dataset.w; return renderLineParts(); }
    const fc = t.closest('.fchip[data-f]');
    if (fc) {
      const k = fc.dataset.f;
      if (k === 'clear') S.filters = { venue: null, minutes: false, without: '' };
      else if (k === 'min') S.filters.minutes = !S.filters.minutes;
      else S.filters.venue = S.filters.venue === k ? null : k;
      return renderLineParts();
    }
    const ln = t.closest('[data-ln]');
    if (ln) {
      const a = S.res.analysis;
      const step = Number(ln.dataset.ln);
      S.selLine = step === 0 ? a?.headline?.line ?? a?.consensus?.line ?? S.selLine : Math.max(0.5, S.selLine + step);
      return renderLineParts();
    }
  };
  view.onchange = (e) => {
    if (e.target.matches('select[data-f=without]')) { S.filters.without = e.target.value; renderLineParts(); }
  };
  view.oninput = (e) => {
    if (e.target.matches('#linectl input[type=range]')) { S.selLine = Number(e.target.value); renderLineParts(); }
  };
  // price checker inputs: recompute in place, keep focus
  $('#check').oninput = debounce((e) => {
    const r = e.target.closest('.crow');
    if (!r) return;
    const i = Number(r.dataset.i);
    S.checks[i] = { ...S.checks[i], [e.target.name]: e.target.value };
    const name = e.target.name, pos = e.target.selectionStart;
    redrawCheck();
    const again = $(`.crow[data-i="${i}"] input[name=${name}]`);
    if (again) { again.focus(); again.setSelectionRange?.(pos, pos); }
  }, 250);

  const form = $('#manual');
  if (form) {
    const readForm = () => Object.fromEntries(new FormData(form));
    form.oninput = debounce(() => {
      const f = readForm();
      S.preview = f.line !== '' && (f.over || f.under) ? { line: f.line, over: f.over, under: f.under, book: f.book || 'Your line' } : null;
      const focused = document.activeElement?.name;
      rerun().then(() => { $('#details').open = true; const i = $('#manual')?.elements[focused]; if (i) { i.focus(); i.setSelectionRange?.(i.value.length, i.value.length); } });
    }, 450);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = readForm();
      try {
        await api('/api/entries', { method: 'POST', body: { playerId: S.id, stat: S.stat, line: f.line, over: f.over, under: f.under, book: f.book, source: 'manual' } });
        S.preview = null; await rerun(); $('#details').open = true; toast('Line saved');
      } catch (err) { const m = $('#manual-msg'); m.textContent = err.message; m.className = 'hint neg'; }
    };
  }
  $('#minform')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = new FormData(e.target).get('min');
    S.minutes = v === '' ? null : Number(v);
    rerun().then(() => { $('#details').open = true; });
  });
}

function redrawCheck() { $('#check').innerHTML = checkCard(S.res.analysis); }

const atLeastLeg = (k, price, book) => ({
  playerId: S.id, playerName: S.profile.player.name, team: S.profile.player.team, stat: S.stat,
  kind: 'atleast', side: 'over', line: k - 0.5, price, book,
});

function addLeg(leg) {
  const isNew = slip.add(leg);
  const label = leg.kind === 'atleast' ? `${leg.line + 0.5}+ ${short()}` : `${leg.side} ${leg.line} ${short()}`;
  toast(`${isNew ? 'Added' : 'Updated'}: ${leg.playerName.split(' ').at(-1)} ${label} @ ${odds(parsePrice(leg.price))}`);
}
