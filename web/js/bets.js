// Bet log: everything logged from the slip, settled automatically from box scores.
import { esc, fmt, api, state, odds } from './ui.js';

const money = (x) => `<span class="${x > 0 ? 'pos' : x < 0 ? 'neg' : ''}">${x > 0 ? '+' : ''}${fmt(x, 2)}</span>`;
const roi = (x) => (x == null ? '–' : `<span class="${x > 0 ? 'pos' : x < 0 ? 'neg' : ''}">${x > 0 ? '+' : ''}${(x * 100).toFixed(1)}%</span>`);
const statShort = (s) => state.stats[s]?.short || s;
const betLabel = (b) => (b.kind === 'acca' ? b.legs.map((l) => `${esc(l.playerName.split(' ').at(-1))} ${esc(l.label)}`).join(' · ')
  : b.kind === 'atleast' ? `${b.line + 0.5}+ ${statShort(b.stat)}` : `${b.bet.side === 'over' ? 'Over' : 'Under'} ${fmt(b.line)} ${statShort(b.stat)}`);

export async function renderBets(view) {
  view.innerHTML = '<p class="empty">Loading…</p>';
  let log;
  try { log = await api('/api/bets'); } catch (e) { view.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const s = log.summary;
  const box = (x, label) => `<div><dt>${label}</dt><dd>${x.bets ? `${x.won}-${x.lost}${x.push ? `-${x.push}` : ''} · ${money(x.profit)}` : '–'}</dd><dd style="font-size:13px">${x.bets ? `ROI ${roi(x.roi)}` : ''}</dd></div>`;
  const res = (b) => {
    const r = b.result;
    if (r.status === 'pending') return '<span class="chip fair">pending</span>';
    if (r.status === 'void') return '<span class="chip fair">void</span>';
    return `<span class="chip ${r.betResult === 'win' ? 'value' : r.betResult === 'loss' ? 'avoid' : 'fair'}">${r.betResult}</span>${r.actual != null ? ` <span class="dim">${fmt(r.actual, 0)}</span>` : ''}`;
  };
  view.innerHTML = `
    <section class="hero"><h1>Bet <em>log</em></h1><p>${s.total} bets · ${s.pending} pending · ${s.void} void. Bets settle from box scores the day after the game; a player who doesn't play is void.</p></section>
    <div class="summary">
      ${box(s.settled, 'All settled')}
      ${box(s.withModel, 'Model rated value')}
      ${box(s.againstModel, 'Model did not')}
      <div><dt>Staked</dt><dd>${fmt(s.settled.staked, 2)}</dd></div>
    </div>
    <section class="card">
      ${log.bets.length ? `<div class="scroll"><table>
        <tr><th>Date</th><th class="l">Bet</th><th>Price</th><th>Stake</th><th class="l">Book</th><th>Result</th><th>P/L</th><th></th></tr>
        ${log.bets.map((b) => `<tr>
          <td>${b.date.slice(5)}</td>
          <td class="l">${b.kind === 'acca' ? `<b>${esc(b.playerName)}</b>` : `<a href="#/p/${esc(b.playerId)}/${esc(b.stat)}"><b>${esc(b.playerName)}</b></a>`} <span class="dim">${betLabel(b)}</span></td>
          <td>${odds(b.bet.price)}</td><td>${fmt(b.bet.stake, 2)}</td><td class="l">${esc(b.book || (b.kind === 'acca' ? 'Acca' : ''))}</td>
          <td>${res(b)}</td><td>${b.result.profit != null ? money(b.result.profit) : '–'}</td>
          <td><button class="mini ghost" data-untake="${esc(b.id)}" title="Remove from bet log">remove</button></td>
        </tr>`).join('')}
      </table></div>` : '<p class="empty">No bets logged yet. Build a slip and press "Log as placed".</p>'}
    </section>
    ${window.PROPDESK_STATIC ? `<section class="card"><h3>Saved on this device</h3>
      <p class="hint" style="margin-top:0">On the web version your bets live in this browser. Export to back them up or move them to another device.</p>
      <div class="inline"><button class="btn" id="export">Export</button><label class="btn ghost" for="import-file">Import</label><input type="file" id="import-file" accept="application/json,.json" hidden></div>
      <p class="hint" id="io-msg"></p></section>` : ''}`;
  view.onclick = async (e) => {
    const u = e.target.closest('[data-untake]');
    if (!u) return;
    u.disabled = true;
    await api(`/api/entries/${u.dataset.untake}`, { method: 'DELETE' });
    renderBets(view);
  };
  if (window.PROPDESK_STATIC) bindExport(view);
}

async function bindExport(view) {
  const { exportEntries, importEntries } = await import('./static.js');
  view.querySelector('#export').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportEntries()], { type: 'application/json' }));
    a.download = `propdesk-bets-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  view.querySelector('#import-file').onchange = async (e) => {
    const msg = view.querySelector('#io-msg');
    try {
      const n = importEntries(await e.target.files[0].text());
      msg.textContent = `Imported ${n} new entr${n === 1 ? 'y' : 'ies'}.`;
      renderBets(view);
    } catch (err) {
      msg.textContent = `Import failed: ${err.message}`;
    }
  };
}
