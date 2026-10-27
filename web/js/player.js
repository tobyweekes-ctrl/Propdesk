// Player page.
//   verdict card (add the pick to the slip) · bookmaker lines with Over / Under buttons
//   price checker ("20+ at 5/1") with the DraftKings ladder · last 10/20 chart · splits
//   "Model details" drawer: minutes, adjustments, add-your-own O/U line, averages and game log
import { $, $$, esc, fmt, pct, edge, signed, api, debounce, state, refreshStatus, odds, slip, toast, teamColour, parsePrice, tipLabel, notFound } from './ui.js';
import { barChart } from './chart.js';

const S = { id: null, stat: 'pts', profile: null, res: null, splits: null, minutes: null, preview: null, selLine: null, window: 20, checks: null };
const SMALL_N = 5;
const FLAG_LABEL = { returning: 'Return ramp', 'first-game-back': 'First game back', 'no-history': 'No history', 'manual-minutes': 'Manual minutes' };
const statOf = (row) => state.stats[S.stat].parts.reduce((a, k) => a + (row[k] ?? 0), 0);
const short = () => state.stats[S.stat].short;

export async function renderPlayer(view, id, stat) {
  if (S.id !== id) { S.minutes = null; S.preview = null; S.checks = null; }
  if (S.id !== id || S.stat !== stat) { S.selLine = null; S.checks = null; }
  S.id = id; S.stat = stat;
  view.innerHTML = '<p class="empty">Loading…</p>';
  try {
    const [profile, res, splits] = await Promise.all([api(`/api/player/${id}`), fetchAnalysis(), api(`/api/player/${id}/splits?stat=${stat}`)]);
    S.profile = profile; S.res = res; S.splits = splits;
    view.innerHTML = shell(profile);
    view.style.setProperty('--team', teamColour(profile.player.team));
    $('.chips', view).onclick = (e) => { const b = e.target.closest('button'); if (b) location.hash = `#/p/${S.id}/${b.dataset.s}`; };
    renderModel();
    refreshStatus();
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
      <div class="chips" role="group" aria-label="Stat">${keys.map((s, i) => `<button aria-pressed="${s === S.stat}" data-s="${s}" title="${esc(state.stats[s].label)} (${i + 1})">${state.stats[s].short}</button>`).join('')}</div>
      <span class="kbd-hint"><kbd>1</kbd>–<kbd>8</kbd> stat · <kbd>/</kbd> search</span>
    </div>
    <div class="result">
      <div class="col-a">
        <section id="verdict" class="o-verdict"></section>
        <section id="chart-block" class="card o-chart"></section>
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
  const i = Number(e.key) - 1;
  if (i >= 0 && i < keys.length && S.id) location.hash = `#/p/${S.id}/${keys[i]}`;
});
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if ($('#chart-block') && S.res) renderLineParts(); }, 120); });

// ---------- model-dependent parts ----------
function renderModel() {
  const res = S.res;
  if (res.out) {
    $('#verdict').innerHTML = outCard(res.out);
    $('#lines').innerHTML = ''; $('#check').innerHTML = ''; $('#details-inner').innerHTML = detailsHtml(null);
    S.selLine = null;
    renderLineParts();
    return;
  }
  if (!res.game || res.analysis?.error) {
    $('#verdict').innerHTML = `<div class="verdict"><div class="v-main"><span class="v-word dim">${!res.game ? 'NO GAME' : 'NO DATA'}</span></div><p class="v-notes">${!res.game ? 'No game today, so there is nothing to price. History below.' : esc(res.analysis.error)}</p></div>`;
    $('#lines').innerHTML = ''; $('#check').innerHTML = ''; $('#details-inner').innerHTML = detailsHtml(null);
    renderLineParts();
    return;
  }
  const a = res.analysis;
  if (S.selLine == null || S.preview?.line) S.selLine = S.preview?.line ? Number(S.preview.line) : a.headline?.line ?? a.consensus?.line ?? a.projection.modelLine;
  if (!S.checks) {
    const p = a.projection.mean;
    S.checks = [{ k: Math.max(1, Math.round(p * 1.2)), price: '' }, { k: Math.max(2, Math.round(p * 1.5)), price: '' }];
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

function verdictCard(a) {
  const h = a.headline;
  const p = a.projection;
  const side = h?.side;
  const price = side ? (side === 'over' ? h.over : h.under) : null;
  const check = !side && h?.disagree;
  const word = side ? `${side.toUpperCase()} ${fmt(h.line)}` : check ? 'NO PICK' : h ? 'PASS' : 'NO LINE';
  const sub = side ? `${esc(h.bookTitle)} · ${odds(price)} · ${h.confidence.toLowerCase()} confidence`
    : check ? `The model is ${pct(h.leanEdge, 0)} away from ${esc(h.bookTitle)}'s fair price, so something is probably missing`
      : h?.stale ? `${esc(h.bookTitle)}'s price hasn't changed for ${dur(h.ageMin)}, too old to trust`
        : h ? `No side clears the ${pct(a.config.threshold, 0)} edge bar` : 'Use the price checker below with your bookie\'s price';
  const style = side ? (h.confidence === 'LOW' ? 'lean' : 'bet') : check ? 'warnv' : '';
  return `<div class="verdict ${style}">
    <div class="v-main"><span class="v-word">${word}</span><span class="v-sub">${sub}</span></div>
    <dl>
      ${h && !check ? `<div><dt>Model ${side || h.leanSide || 'over'}</dt><dd>${pct(side ? h.model[side] : h.model[h.leanSide || 'over'])}</dd></div>
      <div><dt>Edge</dt><dd>${edge(h.leanEdge)}</dd></div>
      <div><dt>Value (EV)</dt><dd>${edge(side ? h.ev[side] : h.leanSide ? h.ev[h.leanSide] : null)}</dd></div>` : ''}
      <div><dt>Projection</dt><dd>${fmt(p.mean)}</dd></div>
      <div><dt>Minutes</dt><dd>${fmt(p.minutes.proj)}</dd></div>
    </dl>
    ${side ? `<div class="v-actions"><button class="btn" data-addh="1">+ Add ${side} ${fmt(h.line)} to slip</button></div>` : ''}
    ${check ? `<p class="v-notes">When the model disagrees with a two-sided bookmaker price by more than ${pct(a.config.marketDisagreement ?? 0.08, 0)}, the bookmaker is usually reacting to something the model can't see: a role change, an injury, a minutes limit. Check the news before treating it as value.</p>` : ''}
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
  const age = e.source === 'manual' || e.source === 'preview' ? '' : `changed ${ago(e.ageMin)}`;
  const btn = (side) => `<button class="sbtn ${e.side === side ? 'pick' : ''} ${(side === 'over' ? e.bestOver : e.bestUnder) ? 'best' : ''}" data-add="${esc(e.id)}" data-side="${side}" aria-label="Add ${side} ${e.line} to slip">
      <span>${side}</span><b>${odds(side === 'over' ? e.over : e.under)}</b><small>${pct(e.model[side], 0)}</small></button>`;
  return `<div class="lrow ${e.side ? 'rec' : ''} ${e.stale ? 'stale' : ''} ${e.line === S.selLine ? 'sel' : ''}" data-line="${e.line}" data-row="${esc(e.id)}" tabindex="0" title="Tap to chart this line">
    <div class="who">${esc(e.bookTitle)}${tag}${e.stale ? '<span class="tag">stale</span>' : ''}<small>${[mv, age].filter(Boolean).join(' · ') || '&nbsp;'}</small></div>
    <div class="ln">${fmt(e.line)}</div>
    <div class="side-btns">${btn('over')}${btn('under')}</div>
    <div class="lmeta"><span>Pick <b class="${e.side ? 'pos' : e.verdict === 'CHECK' ? 'warn' : 'dim'}">${e.verdict === 'CHECK' ? 'CHECK NEWS' : e.verdict}</b></span><span>Edge ${s ? `${s} ${edge(e.edge[s])}` : '–'}</span><span>EV ${edge(s ? e.ev[s] : null)}</span>${e.source === 'manual' ? `<button class="mini ghost" data-del="${esc(e.id)}">remove</button>` : ''}</div>
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
function judge(p, dec) {
  const ev = p * dec - 1;
  return { ev, verdict: ev >= 0.05 ? 'VALUE' : ev >= 0 ? 'FAIR' : 'AVOID' };
}
function checkRow(c, i, a) {
  const pmf = a.projection.pmf;
  const dec = parsePrice(c.price);
  const p = c.k ? pAtLeast(pmf, Number(c.k)) : null;
  let out = '<span class="dim">Enter a threshold and a price, e.g. 20+ at 5/1</span>';
  if (p != null) {
    const fair = p > 0 ? 1 / p : null;
    out = `Model <b>${p < 0.001 ? '<0.1%' : pct(p)}</b> · fair <b>${fair && fair < 1000 ? odds(fair) : '1000/1+'}</b>`;
    if (dec) {
      const j = judge(p, dec);
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
    let j = price && !l.stale ? judge(p, price) : null;
    // one-sided prices carry a margin, so a gap beyond the bar after that is a warning, not value
    if (j && p - 1 / price > gapBar) j = { ...j, verdict: 'CHECK' };
    const tag = !price ? '' : l.stale ? `<span class="dim" title="price unchanged for ${dur(l.ageMin)}">stale</span>` : j ? `<span class="chip ${j.verdict === 'CHECK' ? 'fair' : j.verdict.toLowerCase()}">${j.verdict}</span>` : '';
    return `<tr class="${j?.verdict === 'VALUE' ? 'val' : ''} ${l?.stale ? 'stale' : ''}"><td class="k">${k}+</td><td>${pct(p, 0)}</td><td>${p > 0.001 ? odds(1 / p) : '–'}</td><td>${price ? odds(price) : '<span class="dim">–</span>'}</td>
      <td>${tag}</td><td>${price && !l.stale ? `<button class="mini" data-ladd="${k}" data-price="${price}">+ Slip</button>` : ''}</td></tr>`;
  }).join('');
  const thin = a.quality.score < 0.5 ? `<p class="hint neg">Thin data for this player (${a.quality.notes.map(esc).join('; ')}). Value calls here are low confidence.</p>` : '';
  return `<div class="card-head"><h3>Check a price · ${short()}</h3></div>
    <div class="check-rows">${S.checks.map((c, i) => checkRow(c, i, a)).join('')}</div>
    <div class="slip-actions"><button class="mini" id="cmore">+ Add another price</button></div>
    ${thin}
    <h3 style="margin:18px 0 6px;font-size:13px;letter-spacing:.1em;color:var(--faint)">Ladder: model vs DraftKings</h3>
    <div class="scroll"><table class="ladder"><tr><th class="l">${short()}</th><th>Model</th><th>Fair</th><th>DraftKings</th><th></th><th></th></tr>${rows}</table></div>
    <p class="hint">"20+" means 20 or more. Fair = the price at which the model sees no edge. VALUE = at least 5% expected return.</p>`;
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
  const over = values.filter((v) => v > line).length;
  return { n: values.length, over, rate: values.length ? over / values.length : null };
}
function renderLineParts() {
  const line = S.selLine;
  const logs = S.profile.logs;
  const team = S.profile.player.team;
  const games = logs.slice(0, S.window).reverse().map((r) => ({ date: r.date, opp: r.opp, home: r.home, min: r.min, season: r.season, team: r.team, old: r.team !== team, value: statOf(r) }));
  const proj = S.res.analysis?.projection?.mean ?? null;
  const vals = logs.map(statOf);
  const cur = S.splits.find((x) => x.key === 'cur'), prev = S.splits.find((x) => x.key === 'prev');
  const withTeam = logs.filter((r) => r.team === team);
  const changed = withTeam.length < logs.length;
  const hits = [['L5', vals.slice(0, 5)], ['L10', vals.slice(0, 10)], ['L20', vals.slice(0, 20)], ['Season', cur?.values || []],
    changed ? [`With ${team}`, withTeam.map(statOf)] : ['Last season', prev?.values || []]].map(([k, v]) => ({ k, ...hitOf(v, line) }));
  $('#chart-block').innerHTML = `
    <div class="chart-head"><h3>Last ${games.length} · ${short()}${line != null ? ` vs ${fmt(line)}` : ''}</h3>
      <div class="legend"><span><i class="sw b-over"></i>Over</span><span><i class="sw b-under"></i>Under</span><span><i class="ln"></i>Line</span>${proj != null ? '<span><i class="ln proj"></i>Projection</span>' : ''}</div>
      <div class="seg" role="group" aria-label="Games shown">${[10, 20].map((w) => `<button aria-pressed="${S.window === w}" data-w="${w}">L${w}</button>`).join('')}</div></div>
    <div id="chart"></div>
    ${changed ? `<p class="hint">Faded bars are games for his previous team; "With ${team}" counts only games since he joined.</p>` : ''}
    <div class="hits">${hits.map((h) => `<div><dt>${h.k}</dt><dd>${h.n ? `${h.over}/${h.n} <span class="${h.rate >= 0.5 ? 'pos' : 'neg'}">${pct(h.rate, 0)}</span>` : '–'}</dd></div>`).join('')}</div>`;
  barChart($('#chart'), games, { line, projection: proj, label: `${S.profile.player.name} ${short()}` });
  $('#chart-block .seg').onclick = (e) => { const b = e.target.closest('button'); if (b) { S.window = Number(b.dataset.w); renderLineParts(); } };
  renderSplits(line);
  $$('.lrow[data-line]').forEach((r) => r.classList.toggle('sel', Number(r.dataset.line) === line));
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
      <td>${small ? fmt(s.avg) : `${fmt(s.avg)} ${delta == null ? '' : `<span class="${delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'dim'}">${signed(delta)}</span>`}`}</td><td>${fmt(s.min, 0)}</td><td>${small || !s.n ? '–' : `${h.over}/${h.n} <span class="dim">${pct(h.rate, 0)}</span>`}</td></tr>`;
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
    if (row && !t.closest('button')) { S.selLine = Number(row.dataset.line); renderLineParts(); }
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
