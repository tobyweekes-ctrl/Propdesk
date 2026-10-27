// Player results view.
//   left:  verdict · game-by-game chart with the selected line · hit rates · splits
//   right: lines by bookie (click a row to put that line on the chart) · add a line · minutes · adjustments
// The selected line drives the chart, hit rates and split hit rates, all computed client-side.
import { $, $$, esc, fmt, pct, edge, signed, api, debounce, state, refreshStatus } from './ui.js';
import { barChart } from './chart.js';

const S = { id: null, stat: 'pts', profile: null, res: null, splits: null, minutes: null, preview: null, selLine: null, window: 20 };

const FLAG_LABEL = { returning: 'Return ramp', 'first-game-back': 'First game back', 'no-history': 'No history', 'manual-minutes': 'Manual minutes' };

const statOf = (row) => state.stats[S.stat].parts.reduce((a, k) => a + (row[k] ?? 0), 0);

export async function renderPlayer(view, id, stat) {
  if (S.id !== id) { S.minutes = null; S.preview = null; }
  if (S.id !== id || S.stat !== stat) S.selLine = null;
  S.id = id; S.stat = stat;
  view.innerHTML = '<p class="empty">Loading…</p>';
  try {
    const [profile, res, splits] = await Promise.all([api(`/api/player/${id}`), fetchAnalysis(), api(`/api/player/${id}/splits?stat=${stat}`)]);
    S.profile = profile; S.res = res; S.splits = splits;
    view.innerHTML = shell(profile);
    bindShell(view);
    renderModel();
    refreshStatus();
  } catch (e) {
    view.innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

function fetchAnalysis() {
  const q = new URLSearchParams({ stat: S.stat });
  if (S.minutes != null) q.set('min', S.minutes);
  if (S.preview) for (const k of ['line', 'over', 'under', 'book']) if (S.preview[k] !== '' && S.preview[k] != null) q.set(k, S.preview[k]);
  return api(`/api/player/${S.id}/analysis?${q}`);
}

async function rerun() {
  try {
    S.res = await fetchAnalysis();
    renderModel();
  } catch (e) {
    $('#verdict').innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

// ---------- page skeleton ----------
function flags(d) {
  const out = [];
  if (d.injury) out.push(`<span class="flag ${d.injury.status === 'Out' ? 'neg' : 'warn'}">${esc(d.injury.status)} · ${esc(d.injury.injury)}</span>`);
  const a = d.absence;
  // single missed games (rest, illness) are common in real data; flag real absences only
  if (a.status === 'returned' && a.gamesMissed >= 3) out.push(`<span class="flag warn">Back ${a.gamesSinceReturn}g after missing ${a.gamesMissed}</span>`);
  if (a.status === 'absent') out.push(`<span class="flag neg">Missed last ${a.gamesMissed} team games</span>`);
  if (d.game?.restDays === 0) out.push('<span class="flag warn">Back-to-back</span>');
  return out.join(' ');
}

function shell(d) {
  const p = d.player, g = d.game;
  const keys = Object.keys(state.stats);
  const avgRows = Object.entries(d.averages).map(([k, a]) => `<tr><td>${k}</td><td>${a.gp}</td><td>${fmt(a.min)}</td><td>${fmt(a.usg)}</td>${keys.map((s) => `<td>${fmt(a[s])}</td>`).join('')}</tr>`).join('');
  const cols = ['date', 'opp', 'min', 'usg', 'pts', 'reb', 'ast', 'fg3m', 'fga', 'fta', 'tov', 'pm'];
  const logRows = d.logs.map((r) => `<tr>${cols.map((c) => `<td>${c === 'opp' ? (r.home ? 'v ' : '@ ') + r.opp : c === 'min' || c === 'usg' ? fmt(r[c]) : esc(r[c])}</td>`).join('')}</tr>`).join('');
  return `
    <div class="ph">
      <h2>${esc(p.name)}</h2>
      <span class="sub">${p.team} · ${esc(p.pos) || '–'} · ${g ? `${g.home ? 'vs' : '@'} <b>${g.opp}</b> tonight · rest ${g.restDays ?? '–'}d (opp ${g.oppRestDays ?? '–'}d)` : 'no game today'}</span>
      ${flags(d)}
    </div>
    <div class="statbar">
      <div class="chips" role="group" aria-label="Stat">${keys.map((s, i) => `<button aria-pressed="${s === S.stat}" data-s="${s}" title="${esc(state.stats[s].label)} (${i + 1})">${state.stats[s].short}</button>`).join('')}</div>
      <span class="kbd-hint"><kbd>1</kbd>–<kbd>8</kbd> stat · <kbd>/</kbd> search</span>
    </div>
    <div class="result">
      <div class="col-a">
        <section id="verdict" class="o-verdict"></section>
        <section id="chart-block" class="block o-chart"></section>
        <section id="splits" class="block o-splits"></section>
      </div>
      <div class="col-b">
        <section id="lines" class="block o-lines"></section>
        <section id="addline" class="block o-add"></section>
        <section id="minutes" class="block o-minutes"></section>
        <section id="factors" class="block o-factors"></section>
      </div>
    </div>
    <details class="block o-log"><summary><h3>Averages &amp; game log</h3></summary>
      <div class="scroll"><table><tr><th>Split</th><th>GP</th><th>Min</th><th>Usg%</th>${keys.map((s) => `<th>${state.stats[s].short}</th>`).join('')}</tr>${avgRows}</table></div>
      <div class="scroll"><table><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>${logRows}</table></div>
    </details>`;
}

function bindShell(view) {
  $('.chips', view).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) location.hash = `#/p/${S.id}/${b.dataset.s}`;
  });
}

// stat shortcuts 1-8 (bound once)
document.addEventListener('keydown', (e) => {
  if (!location.hash.startsWith('#/p/') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  const keys = Object.keys(state.stats);
  const i = Number(e.key) - 1;
  if (i >= 0 && i < keys.length && S.id) location.hash = `#/p/${S.id}/${keys[i]}`;
});
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if ($('#chart-block')) renderLineParts(); }, 120); });

// ---------- model-dependent parts ----------
function renderModel() {
  const res = S.res;
  if (!res.game || res.analysis?.error) {
    const msg = !res.game ? 'No game today, so there is nothing to price. History below.' : res.analysis.error;
    $('#verdict').innerHTML = `<p class="empty">${esc(msg)}</p>`;
    for (const id of ['#lines', '#addline', '#minutes', '#factors']) $(id).innerHTML = '';
    renderLineParts();
    return;
  }
  const a = res.analysis;
  if (S.selLine == null || (S.preview && S.preview.line !== '')) {
    S.selLine = S.preview?.line ? Number(S.preview.line) : a.headline?.line ?? a.consensus?.line ?? a.projection.modelLine;
  }
  $('#verdict').innerHTML = verdictStrip(a);
  $('#lines').innerHTML = linesBlock(a);
  $('#addline').innerHTML = addLineBlock(a);
  $('#minutes').innerHTML = minutesBlock(a);
  $('#factors').innerHTML = factorsBlock(a);
  bindModel();
  renderLineParts();
}

function verdictStrip(a) {
  const h = a.headline;
  const p = a.projection;
  const side = h?.side;
  const price = side ? (side === 'over' ? h.over : h.under) : null;
  return `<div class="verdict">
    <div class="v-main"><span class="v-word ${side ? 'pos' : 'dim'}">${h ? h.verdict : 'NO LINE'}</span>${h?.confidence ? `<span class="v-conf">${h.confidence}</span>` : ''}</div>
    <dl>
      ${h ? `<div><dt>${side ? 'Best bet' : 'Closest'}</dt><dd>${esc(h.bookTitle)} ${side ? side[0] : (h.leanSide || 'o')[0]}${fmt(h.line)}${price ? ` @ ${fmt(price, 2)}` : ''}</dd></div>
      <div><dt>Edge</dt><dd>${edge(h.leanEdge)}</dd></div>
      <div><dt>EV</dt><dd>${edge(side ? h.ev[side] : h.leanSide ? h.ev[h.leanSide] : null)}</dd></div>
      <div><dt>Model O / U</dt><dd>${pct(h.model.over)} / ${pct(h.model.under)}</dd></div>` : ''}
      <div><dt>Projection</dt><dd>${fmt(p.mean)} <span class="dim">±${fmt(p.sd)}</span></dd></div>
      <div><dt>Model line</dt><dd>${fmt(p.modelLine)}</dd></div>
      <div><dt>Minutes</dt><dd>${fmt(p.minutes.proj)} <span class="dim">±${fmt(p.minutes.sd)}</span></dd></div>
    </dl>
    <p class="v-notes">Edge vs no-vig, threshold ${pct(a.config.threshold, 0)} · ${esc(p.family)} · data quality ${Math.round(a.quality.score * 100)}%${a.quality.notes.length ? `: ${a.quality.notes.map(esc).join('; ')}` : ''}${a.consensus ? ` · market ${pct(a.consensus.over)} over ${fmt(a.consensus.line)} (${a.consensus.books} books)` : ''}</p>
  </div>`;
}

function lineRow(e) {
  const tag = e.source === 'manual' ? '<span class="tag">MANUAL</span>' : e.source === 'preview' ? '<span class="tag">PREVIEW</span>' : '';
  const s = e.leanSide;
  const actions = e.source === 'preview' ? '' : `<button class="mini" data-take="${esc(e.id)}">Take</button>${e.source === 'manual' ? `<button class="mini ghost" data-del="${esc(e.id)}" title="Delete line" aria-label="Delete line">×</button>` : ''}`;
  return `<tr class="${e.side ? 'rec' : ''} ${e.line === S.selLine ? 'sel' : ''}" data-row="${esc(e.id)}" data-line="${e.line}" tabindex="0" title="Show this line on the chart">
    <td class="l">${esc(e.bookTitle)}${tag}</td><td>${fmt(e.line)}</td>
    <td class="${e.bestOver ? 'best' : ''}">${fmt(e.over, 2)}</td><td class="${e.bestUnder ? 'best' : ''}">${fmt(e.under, 2)}</td>
    <td>${pct(e.model.over, 0)}</td>
    <td>${s ? `<span class="dim">${s[0]}</span>${edge(e.edge[s])}` : '–'}${e.fair?.estimated ? '<span class="dim">*</span>' : ''}</td>
    <td>${edge(s ? e.ev[s] : null)}</td>
    <td class="verdict-cell ${e.side ? 'pos' : 'dim'}">${e.verdict}${e.confidence ? ` <span class="dim">${e.confidence[0]}</span>` : ''}</td>
    <td class="actions">${actions}</td></tr>`;
}

const LINE_HEAD = '<tr><th class="l">Book</th><th>Line</th><th>Over</th><th>Under</th><th>Model O</th><th>Edge</th><th>EV</th><th>Pick</th><th></th></tr>';

function linesBlock(a) {
  const res = S.res;
  const evals = a.evals.filter((e) => e.source !== 'preview');
  const head = `<h3>Lines · ${esc(state.stats[S.stat].label)}${res.linesSource ? ` · ${esc(res.linesSource)}` : ''}${res.oddsAgeSec != null ? ` · ${Math.round(res.oddsAgeSec / 60)}m old` : ''}</h3>`;
  if (!evals.length) return `${head}<p class="empty">No lines for this market. Add your bookie's line below.</p>`;
  return `${head}<div class="scroll"><table class="lines">${LINE_HEAD}${evals.map(lineRow).join('')}</table></div>
    <p class="hint">Click a row to chart that line. Edge = model − no-vig probability on the better side. <span class="best-key">Best price</span>.${evals.some((e) => e.fair?.estimated) ? ' * one price only, margin assumed.' : ''}</p>`;
}

function addLineBlock(a) {
  const p = S.preview || {};
  const prev = a.evals.find((e) => e.source === 'preview');
  return `<h3>Add a line · any bookie</h3>
    <form id="manual" class="manual" autocomplete="off">
      <label>Bookie<input name="book" required maxlength="40" placeholder="Bet365" value="${esc(p.book || '')}"></label>
      <label>Line<input name="line" required inputmode="decimal" placeholder="${fmt(S.selLine)}" value="${esc(p.line ?? '')}"></label>
      <label>Over<input name="over" placeholder="10/11" value="${esc(p.over || '')}"></label>
      <label>Under<input name="under" placeholder="5/6" value="${esc(p.under || '')}"></label>
      <div class="manual-actions">
        <button type="submit" class="btn">Save line</button>
        <span class="betbox"><select name="side" aria-label="Bet side"><option value="">Side</option><option value="over">Over</option><option value="under">Under</option></select><input name="stake" inputmode="decimal" placeholder="Stake" aria-label="Stake"><button type="button" class="btn" id="save-bet">Save + bet</button></span>
      </div>
    </form>
    ${prev ? `<div class="scroll"><table class="lines">${LINE_HEAD}${lineRow(prev)}</table></div>` : ''}
    <p id="manual-msg" class="hint">Fractional (10/11), decimal (1.91) or American (-110). One side is enough. Saved on the server for the bet log and real-line backtest.</p>`;
}

function minutesBlock(a) {
  const m = a.projection.minutes;
  return `<h3>Minutes · ${fmt(m.proj)} ±${fmt(m.sd)}${m.flags.length ? ` · ${m.flags.map((f) => FLAG_LABEL[f] || f).join(', ')}` : ''}</h3>
    <div class="scroll"><table><tr><th class="l">Step</th><th>Min</th><th class="l">Why</th></tr>
    ${m.steps.map((s) => `<tr><td class="l">${esc(s.label)}</td><td>${s.key === 'base' ? fmt(s.value) : signed(s.value)}</td><td class="why">${esc(s.note || '')}</td></tr>`).join('')}
    </table></div>
    <form id="minform" class="inline"><label>Your minutes<input name="min" inputmode="decimal" placeholder="${fmt(m.proj)}" value="${S.minutes ?? ''}"></label><button class="btn">Apply</button>${S.minutes != null ? '<button type="button" class="btn ghost" id="minreset">Reset</button>' : ''}</form>`;
}

function factorsBlock(a) {
  const p = a.projection;
  return `<h3>Rate per 36 · ${fmt(p.basePer36)} → ${fmt(p.per36)}</h3>
    <div class="scroll"><table><tr><th class="l">Adjustment</th><th>×</th><th class="l">Note</th></tr>
    <tr><td class="l">Season blend</td><td>–</td><td class="why">${Math.round(p.seasonWeight * 100)}% this season, rest last season; recent form on top</td></tr>
    ${p.factors.map((f) => `<tr><td class="l">${esc(f.label)}</td><td>${edge(f.value - 1)}</td><td class="why">${esc(f.note || '')}</td></tr>`).join('')}
    </table></div>`;
}

// ---------- line-dependent parts (client-side) ----------
function hitOf(values, line) {
  const over = values.filter((v) => v > line).length;
  const under = values.filter((v) => v < line).length;
  return { n: values.length, over, under, push: values.length - over - under, rate: values.length ? over / values.length : null };
}

function renderLineParts() {
  const line = S.selLine;
  const logs = S.profile.logs; // newest first
  const games = logs.slice(0, S.window).reverse().map((r) => ({ date: r.date, opp: r.opp, home: r.home, min: r.min, season: r.season, value: statOf(r) }));
  const proj = S.res.analysis?.projection?.mean ?? null;
  const vals = logs.map(statOf);
  const cur = S.splits.find((x) => x.key === 'cur');
  const prev = S.splits.find((x) => x.key === 'prev');
  const hits = [['L5', vals.slice(0, 5)], ['L10', vals.slice(0, 10)], ['L20', vals.slice(0, 20)], ['Season', cur?.values || []], ['Last season', prev?.values || []]]
    .map(([k, v]) => ({ k, ...hitOf(v, line) }));
  const short = state.stats[S.stat].short;

  $('#chart-block').innerHTML = `
    <div class="chart-head">
      <h3>Last ${games.length} · ${short}${line != null ? ` vs ${fmt(line)}` : ''}</h3>
      <div class="legend"><span><i class="sw b-over"></i>Over</span><span><i class="sw b-under"></i>Under</span><span><i class="ln"></i>Line</span>${proj != null ? '<span><i class="ln proj"></i>Projection</span>' : ''}</div>
      <div class="seg" role="group" aria-label="Games shown">${[10, 20].map((w) => `<button aria-pressed="${S.window === w}" data-w="${w}">L${w}</button>`).join('')}</div>
    </div>
    <div id="chart"></div>
    <div class="hits">${hits.map((h) => `<div><dt>${h.k}</dt><dd>${h.n ? `${h.over}/${h.n} <span class="${h.rate >= 0.5 ? 'pos' : 'neg'}">${pct(h.rate, 0)}</span>` : '–'}</dd></div>`).join('')}</div>`;
  barChart($('#chart'), games, { line, projection: proj, label: `${S.profile.player.name} ${short}` });
  $('#chart-block .seg').onclick = (e) => {
    const b = e.target.closest('button');
    if (b) { S.window = Number(b.dataset.w); renderLineParts(); }
  };
  renderSplits(line);
  $$('#lines tr[data-line], #addline tr[data-line]').forEach((tr) => tr.classList.toggle('sel', Number(tr.dataset.line) === line));
}

function renderSplits(line) {
  const all = S.splits.filter((s) => s.group === 'Season').flatMap((s) => s.values);
  const base = all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
  let group = null;
  const rows = S.splits.filter((s) => s.n > 0 || s.group === 'Teammates').map((s) => {
    const h = hitOf(s.values, line);
    const head = s.group !== group ? `<tr class="grp"><td colspan="6" class="l">${esc(s.group)}${s.group === 'Season' ? '' : ' <span class="dim">· 2 seasons</span>'}</td></tr>` : '';
    group = s.group;
    const delta = s.avg != null && base != null ? s.avg - base : null;
    return `${head}<tr><td class="l">${esc(s.label)}${s.outTonight ? '<span class="tag neg-tag">OUT TONIGHT</span>' : ''}</td><td>${s.n}</td>
      <td>${fmt(s.avg)}</td><td>${delta == null ? '–' : `<span class="${delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'dim'}">${signed(delta)}</span>`}</td>
      <td>${fmt(s.min)}</td><td>${s.n ? `${h.over}-${h.under}${h.push ? `-${h.push}` : ''} <span class="dim">${pct(h.rate, 0)}</span>` : '–'}</td></tr>`;
  }).join('');
  $('#splits').innerHTML = `<h3>Splits · ${state.stats[S.stat].short}${line != null ? ` · over ${fmt(line)}` : ''}</h3>
    <div class="scroll"><table class="splits"><tr><th class="l">Split</th><th>GP</th><th>Avg</th><th>vs avg</th><th>Min</th><th>O-U</th></tr>${rows}</table></div>
    <p class="hint">"vs avg" compares with his average over both seasons. Teammate splits only count seasons they shared a team.</p>`;
}

// ---------- interactions ----------
function bindModel() {
  const form = $('#manual');
  const readForm = () => Object.fromEntries(new FormData(form));
  let lastFocus = null;
  const preview = debounce(() => {
    const f = readForm();
    S.preview = f.line !== '' && (f.over || f.under) ? { line: f.line, over: f.over, under: f.under, book: f.book || 'Preview' } : null;
    rerun().then(() => {
      const again = $('#manual');
      if (again && lastFocus) { const i = again.elements[lastFocus]; if (i) { i.focus(); i.setSelectionRange?.(i.value.length, i.value.length); } }
    });
  }, 400);
  form.addEventListener('input', (e) => { lastFocus = e.target.name; if (e.target.name !== 'side' && e.target.name !== 'stake') preview(); });

  async function save(withBet) {
    const f = readForm();
    const body = { playerId: S.id, stat: S.stat, line: f.line, over: f.over, under: f.under, book: f.book, source: 'manual' };
    if (withBet) {
      if (!f.side) return msg('Pick a side for the bet.', true);
      body.bet = { side: f.side, stake: f.stake || 1 };
    }
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await api('/api/entries', { method: 'POST', body });
      S.preview = null;
      await rerun();
      msg(withBet ? 'Line saved and bet logged.' : 'Line saved.');
    } catch (e) {
      buttons.forEach((b) => { b.disabled = false; });
      msg(e.message, true);
    }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); save(false); });
  $('#save-bet').addEventListener('click', () => save(true));

  $('#minform').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = new FormData(e.target).get('min');
    S.minutes = v === '' ? null : Number(v);
    rerun();
  });
  $('#minreset')?.addEventListener('click', () => { S.minutes = null; rerun(); });

  const result = $('.result');
  // onclick (not addEventListener): .result survives re-renders, so this must replace, not stack
  result.onclick = async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { del.disabled = true; await api(`/api/entries/${del.dataset.del}`, { method: 'DELETE' }); return rerun(); }
    const take = e.target.closest('[data-take]');
    if (take) return openTake(take.dataset.take);
    const ok = e.target.closest('[data-confirm]');
    if (ok) { ok.disabled = true; return confirmTake(ok.dataset.confirm, ok.closest('tr')); }
    if (e.target.closest('[data-cancel]')) return e.target.closest('tr').remove();
    const row = e.target.closest('tr[data-line]');
    if (row && !e.target.closest('button, input, select')) selectLine(Number(row.dataset.line));
  };
  result.onkeydown = (e) => {
    const row = e.target.closest?.('tr[data-line]');
    if (row && (e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); selectLine(Number(row.dataset.line)); }
  };
}

function selectLine(line) {
  S.selLine = line;
  const ph = $('#manual input[name=line]');
  if (ph) ph.placeholder = fmt(line);
  renderLineParts();
}

function msg(text, bad = false) {
  const m = $('#manual-msg');
  if (m) { m.textContent = text; m.className = `hint ${bad ? 'neg' : 'pos'}`; }
}

function openTake(id) {
  $$('.take-row').forEach((r) => r.remove());
  const e = S.res.analysis.evals.find((x) => x.id === id);
  const tr = $(`tr[data-row="${CSS.escape(id)}"]`);
  if (!e || !tr) return;
  const side = e.side || e.leanSide || 'over';
  const row = document.createElement('tr');
  row.className = 'take-row';
  row.innerHTML = `<td colspan="9" class="l"><span class="take">
    <select name="side" aria-label="Side"><option value="over" ${side === 'over' ? 'selected' : ''}>Over ${fmt(e.line)} @ ${fmt(e.over, 2)}</option><option value="under" ${side === 'under' ? 'selected' : ''}>Under ${fmt(e.line)} @ ${fmt(e.under, 2)}</option></select>
    <input name="stake" inputmode="decimal" value="1" size="5" aria-label="Stake">
    <button class="mini" data-confirm="${esc(id)}">Log bet</button><button class="mini ghost" data-cancel>Cancel</button></span></td>`;
  tr.after(row);
  $('input', row).focus();
}

async function confirmTake(id, row) {
  const e = S.res.analysis.evals.find((x) => x.id === id);
  const side = $('select', row).value;
  const stake = Number($('input', row).value) || 1;
  try {
    if (e.source === 'manual') {
      await api(`/api/entries/${id}`, { method: 'PATCH', body: { bet: { side, stake } } });
    } else {
      await api('/api/entries', { method: 'POST', body: { playerId: S.id, stat: S.stat, line: e.line, over: e.over, under: e.under, book: e.bookTitle, source: 'api', bet: { side, stake } } });
    }
    row.innerHTML = `<td colspan="9" class="l pos">Bet logged: ${side} ${fmt(e.line)} @ ${fmt(side === 'over' ? e.over : e.under, 2)}, stake ${stake}. <a href="#/bets">Bet log</a></td>`;
  } catch (err) {
    row.innerHTML = `<td colspan="9" class="l neg">${esc(err.message)}</td>`;
  }
}
