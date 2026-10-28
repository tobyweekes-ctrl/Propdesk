// Game-by-game bar chart with the prop line drawn across it.
// Bars: over = green, under = red, push = grey (validated for colour-blind separation on the
// dark surface). The line itself is the second encoding, so identity is never colour alone.
// Hover or arrow keys show a tooltip; the game log table below is the full data view.
import { esc, fmt } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';

function niceMax(v) {
  if (v <= 0) return 1;
  const step = v <= 4 ? 1 : v <= 10 ? 2 : v <= 25 ? 5 : v <= 60 ? 10 : 20;
  return Math.ceil(v / step) * step;
}

/**
 * @param el container element
 * @param games [{date, opp, home, value, min, season}] oldest first
 * @param opts {line, projection, label}
 */
export function barChart(el, games, { line, projection = null, label = '' } = {}) {
  el.innerHTML = '';
  if (!games.length) { el.innerHTML = '<p class="empty">No games yet.</p>'; return; }
  const W = Math.max(280, el.clientWidth || 600);
  const H = W < 500 ? 210 : 240;
  const m = { t: 18, r: 46, b: 34, l: 30 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const n = games.length;
  const band = iw / n;
  const bw = Math.min(24, Math.max(4, band - 2)); // cap at 24px, keep a surface gap
  const yMax = niceMax(Math.max(line ?? 0, projection ?? 0, ...games.map((g) => g.value)) * 1.08);
  const y = (v) => m.t + ih - (v / yMax) * ih;
  const ticks = [0, yMax / 2, yMax];
  const showValues = band >= 26;
  const labelEvery = band >= 30 ? 1 : band >= 16 ? 2 : 3;

  const cls = (v) => (line == null ? 'b-neutral' : v > line ? 'b-over' : v < line ? 'b-under' : 'b-push');
  let svg = `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" tabindex="0"
    aria-label="${esc(label)}: last ${n} games${line != null ? `, line ${line}` : ''}. Use arrow keys for each game.">`;
  // grid
  for (const t of ticks) svg += `<line class="grid" x1="${m.l}" x2="${m.l + iw}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${m.l - 6}" y="${y(t) + 3.5}" text-anchor="end">${fmt(t, 0)}</text>`;
  // season / team boundaries (games for a previous team are drawn faded)
  for (let i = 1; i < n; i++) {
    const newSeason = games[i].season !== games[i - 1].season;
    const newTeam = games[i].team && games[i].team !== games[i - 1].team;
    if (newSeason || newTeam) {
      const x = m.l + i * band;
      const label = [newSeason ? games[i].season : null, newTeam ? `now ${games[i].team}` : null].filter(Boolean).join(' · ');
      svg += `<line class="season" x1="${x}" x2="${x}" y1="${m.t - 6}" y2="${m.t + ih}"/><text class="season-label strong" x="${x + 4}" y="${m.t - 6}">${esc(label)}</text>`;
    }
  }
  // bars (4px rounded top, square at the baseline)
  games.forEach((g, i) => {
    const x = m.l + i * band + (band - bw) / 2;
    const top = y(g.value), base = y(0);
    const h = Math.max(0, base - top);
    const r = Math.min(4, bw / 2, h);
    const d = h <= 0
      ? `M${x},${base - 1}h${bw}v1h${-bw}z`
      : `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${base}Z`;
    svg += `<path class="bar ${cls(g.value)} ${g.old ? 'old' : ''}" data-i="${i}" d="${d}"/>`;
    if (showValues) svg += `<text class="val" x="${x + bw / 2}" y="${top - 4}" text-anchor="middle">${fmt(g.value, 0)}</text>`;
    if (i % labelEvery === (n - 1) % labelEvery) {
      svg += `<text class="xl" x="${m.l + i * band + band / 2}" y="${m.t + ih + 13}" text-anchor="middle">${g.home ? '' : '@'}${esc(g.opp)}</text>`;
      // a game from an earlier season carries its year, so last October's 10/29 doesn't read as a future date
      if (band >= 40) svg += `<text class="xd" x="${m.l + i * band + band / 2}" y="${m.t + ih + 25}" text-anchor="middle">${g.date.slice(5).replace('-', '/')}${g.season !== games[n - 1].season ? `/${g.date.slice(2, 4)}` : ''}</text>`;
    }
  });
  // projection (dashed, quiet) and line (solid, labelled)
  if (projection != null) svg += `<line class="proj" x1="${m.l}" x2="${m.l + iw}" y1="${y(projection)}" y2="${y(projection)}"/><text class="proj-label" x="${m.l + iw + 4}" y="${y(projection) + (line != null && Math.abs(y(projection) - y(line)) < 12 ? (projection > line ? -6 : 14) : 4)}">${fmt(projection)}</text>`;
  if (line != null) svg += `<line class="pline" x1="${m.l}" x2="${m.l + iw}" y1="${y(line)}" y2="${y(line)}"/><text class="pline-label" x="${m.l + iw + 4}" y="${y(line) + 4}">${fmt(line)}</text>`;
  // hit targets: full-height bands, bigger than the marks
  games.forEach((_, i) => { svg += `<rect class="hit" data-i="${i}" x="${m.l + i * band}" y="${m.t}" width="${band}" height="${ih}"/>`; });
  svg += '</svg>';

  el.innerHTML = `<div class="chart-wrap">${svg}<div class="tip" hidden></div></div>`;
  const root = el.querySelector('svg');
  const tip = el.querySelector('.tip');
  let active = -1;
  const show = (i) => {
    active = i;
    root.querySelectorAll('.bar').forEach((b) => b.classList.toggle('dimmed', Number(b.dataset.i) !== i));
    if (i < 0) { tip.hidden = true; root.querySelectorAll('.bar').forEach((b) => b.classList.remove('dimmed')); return; }
    const g = games[i];
    const res = line == null ? '' : g.value > line ? 'OVER' : g.value < line ? 'UNDER' : 'PUSH';
    tip.innerHTML = `<b>${fmt(g.value, 0)}</b> ${res ? `<span class="${res === 'OVER' ? 'pos' : res === 'UNDER' ? 'neg' : 'dim'}">${res}</span>` : ''}<br>${g.team ? `${esc(g.team)} ` : ''}${g.home ? 'vs' : '@'} ${esc(g.opp)} · ${g.date}<br>${fmt(g.min)} min${g.old ? ' · previous team' : ''}`;
    tip.hidden = false;
    const x = m.l + i * band + band / 2;
    const left = Math.min(W - 130, Math.max(0, x - 60));
    tip.style.left = `${(left / W) * 100}%`;
    tip.style.top = `${Math.max(0, y(g.value) - 70)}px`;
  };
  root.addEventListener('pointermove', (e) => { const t = e.target.closest('.hit'); show(t ? Number(t.dataset.i) : -1); });
  root.addEventListener('pointerleave', () => show(-1));
  root.addEventListener('blur', () => show(-1));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { show(Math.min(n - 1, active + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { show(active < 0 ? n - 1 : Math.max(0, active - 1)); e.preventDefault(); }
    else if (e.key === 'Escape') show(-1);
  });
}
