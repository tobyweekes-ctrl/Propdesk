// Plain-English context for one player-game, built only from numbers the model already has:
// availability, history against this opponent, the opponent's defence, and the game script.
// Every note carries a tone relative to the stat going OVER: 'up', 'down' or 'flat'.
// Scheme words (drop, switch) are inferences from box-score numbers, and the text says so.
import { STATS, statValue } from '../stats.mjs';
import { blendTeam, seasonWeight } from './blend.mjs';
import { mean } from '../util.mjs';

const GROUP = { G: 'guards', F: 'forwards', C: 'centres' };
const ORD = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const P = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const signedPct = (x) => (Math.round(Math.abs(x) * 100) === 0 ? '0%' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(0)}%`);
const an = (n) => (/^(8|11|18)(\D|$)/.test(String(n)) ? 'an' : 'a');
const toneOf = (x, band = 0.03) => (x > band ? 'up' : x < -band ? 'down' : 'flat');
// "top" / "bottom" of the league for a trait (8 of 30)
const EXTREME = 8;
/** "4th most" in the top half, "3rd fewest" in the bottom half. */
const rankWord = (r, most = 'most', fewest = 'fewest') => (r.rank <= r.of / 2 ? `${ORD(r.rank)} ${most}` : `${ORD(r.of + 1 - r.rank)} ${fewest}`);
const count = (n, label) => `${n} ${n === 1 ? label.replace(/s(?= made$|$)/, '') : label}`;

/** Rank of `team` on `key` among all teams (1 = highest value). */
function rankOf(teams, team, key) {
  const vals = Object.values(teams).filter((t) => t[key] != null).sort((a, b) => b[key] - a[key]);
  const i = vals.findIndex((t) => t.team === team);
  return i < 0 ? null : { rank: i + 1, of: vals.length, value: vals[i][key], league: mean(vals.map((t) => t[key])) };
}

/** Which season's team numbers to describe: this one once it has a few games, else last season. */
function profileSeason(ctx) {
  const games = ctx.teams.cur[ctx.game.opp]?.games || 0;
  if (games >= 8 || !Object.keys(ctx.teams.prev).length) return { teams: ctx.teams.cur, label: 'this season', games };
  return { teams: ctx.teams.prev, label: 'last season', games };
}

/**
 * @param ctx  buildContext output
 * @param pp   projectPlayer output
 * @param sp   projectStat output for `stat`
 * @param cfg  model config
 * @param line the main line (for hit rates), optional
 * @returns { summary, sections: [{ title, notes: [{ key, tone, title, text }] }], basis }
 */
export function contextNotes(ctx, pp, sp, cfg, line = null) {
  const stat = sp.stat;
  const parts = STATS[stat].parts;
  const short = STATS[stat].label.toLowerCase();
  const name = (ctx.player?.name || 'He').split(' ').at(-1);
  const g = ctx.game;
  const m = pp.minutes;
  const has = (s) => parts.includes(s);

  // ---------- availability ----------
  const avail = [];
  const inj = ctx.ownInjury;
  if (inj && !/^out/i.test(inj.status)) {
    avail.push({ key: 'injury', tone: 'down', title: `Listed ${inj.status.toLowerCase()}`,
      text: `${inj.injury ? `${inj.injury}. ` : ''}The model doesn't cut minutes for a questionable tag, so check the news before tip-off: if ${name} plays limited minutes, overs suffer most.` });
  }
  const a = ctx.absence;
  const R = cfg.minutes.restriction;
  const usual = mean(ctx.logs.slice(-10).map((r) => r.min));
  if (a.status === 'absent') {
    const first = a.gamesMissed >= R.minMissed;
    avail.push({ key: 'absent', tone: first ? 'down' : 'flat', title: `Missed the last ${a.gamesMissed} game${a.gamesMissed === 1 ? '' : 's'}`,
      text: first
        ? `Last played ${a.lastPlayed} (${a.daysSince} days ago). If ${name} plays tonight it's a first game back: the model projects ${f1(m.proj)} minutes against ${f1(usual)} before the absence, because returning players are often on a minutes limit.`
        : `Last played ${a.lastPlayed}. A short absence, so minutes aren't cut, but confirm ${name} is playing.` });
  } else if (a.status === 'returned' && a.gamesMissed >= R.minMissed) {
    const ramp = m.steps.find((s) => s.key === 'restriction');
    const pre = a.minutesBefore;
    const ramping = ramp && (pre == null || m.proj < pre - 1);
    avail.push({ key: 'returned', tone: ramping && ramp.value < -0.5 ? 'down' : 'flat', title: `Back ${a.gamesSinceReturn} game${a.gamesSinceReturn === 1 ? '' : 's'} from ${an(a.gamesMissed)} ${a.gamesMissed}-game absence`,
      text: `Minutes since returning: ${a.minutesSinceReturn.map((x) => Math.round(x)).join(', ')}${pre != null ? `, against ${f1(pre)} before` : ''}. ${ramping ? `The model expects ${f1(m.proj)} tonight as the ramp continues; a jump to full minutes is possible but not assumed.` : 'Minutes look back to normal.'}` });
  }
  // what a missing player usually puts up, for the parts of this stat
  const line3 = (x) => ['pts', 'reb', 'ast'].map((k) => `${f1(x.avg?.[k] || 0)} ${k}`).join(', ');
  const share = sp.factors.find((f) => f.key === 'mates');
  const shareGame = share ? (share.value - 1) / share.value * sp.mean : 0; // per game, from the per-minute factor
  ctx.teammatesOut.forEach((mate, i) => {
    const step = m.steps.find((s) => s.key === `mate:${mate.id}`);
    const delta = step?.value ?? 0;
    const hist = step?.note?.match(/^(\d+)g without him: ([+-]?[\d.]+) \(weight (\d+)%/);
    const minText = Math.abs(delta) < 0.25
      ? `${name}'s minutes barely change${hist ? ` (in ${hist[1]} games without them they moved ${Number(hist[2]) >= 0 ? '+' : ''}${hist[2]})` : ''}.`
      : `${name} gets ${delta > 0 ? '+' : '−'}${f1(Math.abs(delta))} minutes${hist ? `, based partly on ${hist[1]} games without them` : ', a share of theirs by position'}.`;
    // the production share is reported once, on the first absence, for all of them together
    const shareText = i === 0 && shareGame >= 0.1
      ? ` With ${ctx.teammatesOut.length > 1 ? 'those players' : 'them'} out, ${name} also picks up about +${f1(shareGame)} ${short} a game of the production they leave (what they put up above a typical replacement, more of it to the same position).`
      : '';
    const tone = toneOf((delta / Math.max(1, m.base)) + (i === 0 ? shareGame / Math.max(1, sp.mean) : 0), 0.015);
    avail.push({ key: `mate:${mate.id}`, tone, title: `${mate.name} out (${g.team})`,
      text: `Last 10 games: ${Math.round(mate.avg?.min || mate.min)} minutes, ${line3(mate)}. ${minText}${shareText}` });
  });
  for (const o of ctx.oppOut) {
    const bigBoards = has('reb') && o.group === 'C' && ctx.group !== 'G' && (o.avg?.reb || 0) >= 6;
    avail.push({ key: `opp:${o.id}`, tone: bigBoards && ctx.group === 'C' ? 'up' : 'flat', title: `${o.name} out (${g.opp})`,
      text: `Last 10 games: ${Math.round(o.avg?.min || o.min)} minutes, ${line3(o)}. ${bigBoards
        ? `Without their centre, ${g.opp} lose some size on the glass. Last season, centres facing a team missing its starting centre beat their projection by about 0.3 rebounds: real but small and noisy, so the model doesn't add it. Lean slightly over on ${name}'s rebounds if anything.`
        : 'Their replacement absorbs most of the role; no adjustment for this player.'}` });
  }
  if (ctx.traded) {
    avail.push({ key: 'traded', tone: 'flat', title: `New team: ${ctx.teamRows.length} game${ctx.teamRows.length === 1 ? '' : 's'} with ${g.team}`,
      text: `Minutes lean on games with ${g.team}; numbers from the previous team count for less until there's a bigger sample here.` });
  }
  if (ctx.logs.length < 10) {
    avail.push({ key: 'thin', tone: 'flat', title: `Only ${ctx.logs.length} games of history`, text: 'Thin sample: the projection leans on a typical player at this position, and the confidence is capped.' });
  }
  if (!avail.length) avail.push({ key: 'clear', tone: 'flat', title: 'No availability flags', text: `${name} has played every recent game and no regular rotation players on either team are listed out.` });

  // ---------- opponent history ----------
  const hist = [];
  const h = ctx.h2hRows;
  if (!h.length) {
    hist.push({ key: 'h2h-none', tone: 'flat', title: `No games against ${g.opp}`, text: 'Not in the data this season or last, so no head-to-head read.' });
  } else {
    const vals = h.map((r) => statValue(r, stat));
    const avgH = mean(vals), avgAll = mean(ctx.logs.map((r) => statValue(r, stat)));
    const minH = mean(h.map((r) => r.min)), minAll = mean(ctx.logs.map((r) => r.min));
    const rateRatio = minH > 0 && avgAll > 0 ? avgH / minH / (avgAll / minAll) : 1;
    const enough = h.length >= cfg.adjust.h2hMinGames;
    const word = !enough ? 'Small sample' : rateRatio >= 1.12 ? 'Historically strong' : rateRatio <= 0.89 ? 'Historically poor' : 'About normal';
    const over = line != null ? vals.filter((v) => v > line).length : null;
    const hf = sp.factors.find((f) => f.key === 'h2h');
    const weight = enough ? Math.round(seasonWeight(h.length, cfg.adjust.h2hK) * 100) : 0;
    hist.push({ key: 'h2h', tone: enough ? toneOf(rateRatio - 1, 0.08) : 'flat', title: `${word} against ${g.opp}`,
      text: `${h.length} game${h.length === 1 ? '' : 's'}: ${f1(avgH)} ${short} in ${f1(minH)} minutes, against ${f1(avgAll)} in ${f1(minAll)} overall (per minute ${signedPct(rateRatio - 1)}).${over != null ? ` Over ${line} in ${over} of ${h.length}.` : ''} ${!enough ? `Under ${cfg.adjust.h2hMinGames} games, so the model ignores it.` : hf && Math.round(Math.abs(hf.value - 1) * 100) >= 1 ? `The model gives it ${weight}% weight (${signedPct(hf.value - 1)} on the projection): a handful of games is mostly noise.` : 'Too close to normal, and too few games, to move the projection.'}` });
    const last = h.at(-1);
    hist.push({ key: 'h2h-last', tone: 'flat', title: 'Last meeting', text: `${last.date}: ${count(statValue(last, stat), short)} in ${Math.round(last.min)} minutes${last.team !== g.team ? ` (for ${last.team})` : ''}.` });
  }

  // ---------- opponent defence ----------
  const def = [];
  const ps = profileSeason(ctx);
  const opp = ps.teams[g.opp];
  // defence vs this position for this stat, weighted by how much each component makes up the stat
  const posFactor = (team) => {
    const pd = ctx.posDef(team, ctx.group);
    let num = 0, den = 0;
    for (const s of parts) {
      const w = pp.comps[s]?.base || 0;
      const fc = pd.cur?.[s], fp = pd.prev?.[s];
      if (fc == null && fp == null) return null;
      const wd = fp == null ? 1 : fc == null ? 0 : seasonWeight(pd.curGames, cfg.blend.teamK);
      num += w * (wd * (fc ?? 1) + (1 - wd) * (fp ?? 1)); den += w;
    }
    return den > 0 ? num / den : null;
  };
  const oppPos = posFactor(g.opp);
  if (oppPos != null) {
    const all = Object.keys({ ...ctx.teams.cur, ...ctx.teams.prev }).map((t) => [t, posFactor(t)]).filter(([, v]) => v != null).sort((x, y) => y[1] - x[1]);
    const rank = all.findIndex(([t]) => t === g.opp) + 1;
    const dv = sp.factors.find((f) => f.key === 'defence');
    const word = oppPos >= 1.04 ? 'generous' : oppPos <= 0.96 ? 'stingy' : 'average';
    def.push({ key: 'pos', tone: toneOf(oppPos - 1, 0.04), title: `${g.opp} vs ${GROUP[ctx.group]}: ${word}`,
      text: Math.abs(oppPos - 1) < 0.03
        ? `${short[0].toUpperCase() + short.slice(1)} allowed to ${GROUP[ctx.group]} are within 3% of the league average, so no real matchup effect.`
        : `They allow ${signedPct(oppPos - 1)} ${short} per minute to ${GROUP[ctx.group]} compared with the league${rank ? ` (${rankWord({ rank, of: all.length })} of ${all.length})` : ''}. The model applies half of that${dv ? ` (${signedPct(dv.value - 1)})` : ''}, because these numbers are noisy.` });
  }
  if (opp) {
    const d = rankOf(ps.teams, g.opp, 'drtg');
    if (d && has('pts')) {
      const best = d.of + 1 - d.rank; // lowest drtg = best
      def.push({ key: 'drtg', tone: best <= EXTREME ? 'down' : best > d.of - EXTREME ? 'up' : 'flat',
        title: `Defensive rating ${f1(d.value)} (${rankWord({ rank: best, of: d.of }, 'best', 'worst')})`, text: `Points allowed per 100 possessions ${ps.label}, league average ${f1(d.league)}.${ps.label === 'last season' ? ` ${g.opp} have only ${ps.games} games this season, so last season's numbers are shown.` : ''}` });
    }
    // style traits, kept to the ones that matter for this stat and position
    const traits = [];
    const trait = (key, test) => {
      const r = rankOf(ps.teams, g.opp, key);
      if (!r) return;
      const high = r.rank <= EXTREME, low = r.rank > r.of - EXTREME;
      if (!high && !low) return;
      const t = test(r, high);
      if (t) traits.push({ key, ...t });
    };
    const big = ctx.group !== 'G';
    if (has('pts')) {
      trait('blkPer100', (r, high) => ({ tone: big ? (high ? 'down' : 'up') : 'flat',
        title: high ? 'Strong rim protection' : 'Weak rim protection',
        text: `${f1(r.value)} blocks per 100 possessions (${rankWord(r)}). ${high ? `Finishing inside is hard: ${big ? 'tougher for bigs and anyone who lives at the rim' : 'guards who drive may settle for jumpers'}.` : `Little resistance at the rim: ${big ? 'good for bigs' : 'good for drivers'}.`}` }));
      trait('oppFtRate', (r, high) => ({ tone: high ? 'up' : 'down', title: high ? 'Fouls a lot' : 'Rarely fouls',
        text: `Opponents shoot ${f1(r.value * 100)} free throws per 100 shots (${rankWord(r)}). ${high ? 'Extra free throws pad scoring.' : 'Fewer cheap points at the line.'}` }));
    }
    if (has('pts') || has('fg3m')) {
      trait('opp3paRate', (r, high) => ({ tone: has('fg3m') || ctx.group === 'G' ? (high ? 'up' : 'down') : 'flat',
        title: high ? 'Concedes lots of threes' : 'Runs shooters off the line',
        text: `${P(r.value)} of opponent shots are threes (${rankWord(r)}). ${high ? 'That pattern usually means a drop or help-heavy defence that gives up pull-ups and kick-outs: good for shooters.' : 'That pattern usually means switching and hard closeouts: fewer clean looks from three.'} (Inferred from box scores, not tracking data.)` }));
    }
    if (has('fg3m')) {
      trait('opp3pPct', (r, high) => ({ tone: high ? 'up' : 'down', title: high ? 'Opponents shoot well from three' : 'Opponents shoot poorly from three',
        text: `${P(r.value, 1)} allowed from three (${rankWord(r, 'highest', 'lowest')}, league ${P(r.league, 1)}). Three-point percentage allowed is partly luck, so treat this lightly.` }));
    }
    if (has('reb')) {
      trait('oppOrebPct', (r, high) => ({ tone: high ? 'up' : 'down', title: high ? 'Gives up offensive rebounds' : 'Controls the defensive glass',
        text: `Opponents grab ${P(r.value)} of their own misses (${rankWord(r)}). ${high ? `More loose balls: good for ${big ? 'bigs on the offensive glass' : 'crashing guards'}.` : 'Fewer second chances.'}` }));
    }
    if (has('ast')) {
      trait('tovForcedPer100', (r, high) => ({ tone: ctx.group === 'G' ? (high ? 'down' : 'up') : 'flat', title: high ? 'High-pressure defence' : 'Low-pressure defence',
        text: `Forces ${f1(r.value)} turnovers per 100 possessions (${rankWord(r)}). ${high ? 'Aggressive, trapping or switch-everything defences make life harder for ball-handlers.' : 'Ball-handlers can survey the floor.'}` }));
      trait('oppAstRate', (r, high) => ({ tone: high ? 'up' : 'down', title: high ? 'Ball moves against them' : 'Few assisted baskets allowed',
        text: `${P(r.value)} of opponent baskets are assisted (${rankWord(r)}). ${high ? 'Rotations get stretched: good for passers.' : 'Opponents are pushed into one-on-one play.'}` }));
    }
    def.push(...traits);
    if (!traits.length) def.push({ key: 'style-none', tone: 'flat', title: 'No standout style', text: `Nothing in ${g.opp}'s numbers ${ps.label} is near the top or bottom of the league for this stat.` });
  }

  // ---------- game script ----------
  const script = [];
  const k = cfg.blend.teamK;
  const tPace = blendTeam(ctx.team, 'pace', k), oPace = blendTeam(ctx.opp, 'pace', k);
  const lgPace = blendTeam({ cur: ctx.league.cur && { ...ctx.league.cur, games: ctx.team.cur?.games || 0 }, prev: ctx.league.prev }, 'pace', k);
  const paceSide = (t, v, lg) => `${t} ${Math.abs(v - lg) < 0.75 ? 'about average' : v > lg ? 'faster' : 'slower'} (${f1(v)})`;
  if (tPace && oPace && lgPace) {
    const gp = tPace + oPace - lgPace;
    const diff = gp - lgPace;
    script.push({ key: 'pace', tone: diff > 1.5 ? 'up' : diff < -1.5 ? 'down' : 'flat', title: `${diff > 1.5 ? 'Fast' : diff < -1.5 ? 'Slow' : 'Average'} pace`,
      text: `Possessions per game: ${paceSide(g.team, tPace, lgPace)}, ${paceSide(g.opp, oPace, lgPace)}, league ${f1(lgPace)}. Each team's gap from average adds up, so expect about ${Math.round(gp)} tonight. ${Math.abs(diff) > 1.5 ? `${diff > 0 ? 'More' : 'Fewer'} possessions mean ${diff > 0 ? 'more' : 'fewer'} chances for every counting stat.` : 'No real pace effect.'}` });
  }
  const em = m.expectedMargin;
  const bstep = m.steps.find((s) => s.key === 'blowout');
  if (em) {
    const fav = em.value >= 0 ? g.team : g.opp;
    const B = cfg.minutes.blowout;
    const big = Math.abs(em.value) >= 7;
    const cut = bstep?.value ?? 0;
    script.push({ key: 'blowout', tone: cut < -0.3 ? 'down' : cut > 0.3 ? 'up' : 'flat', title: big ? `Blowout risk: ${fav} by ${f1(Math.abs(em.value))}` : `Close game expected (${fav} by ${f1(Math.abs(em.value))})`,
      text: `From ${em.source}. Chance of a ${B.margin}+ point game: ${P(m.blowoutProb)}. ${Math.abs(cut) > 0.3 ? `${cut < 0 ? 'Starters sit' : 'Bench players soak up'} minutes in lopsided games, so the model ${cut < 0 ? 'trims' : 'adds'} ${f1(Math.abs(cut))} minutes.` : 'Minutes barely move for it.'}` });
  }
  if (ctx.restDays === 0) {
    script.push({ key: 'b2b', tone: 'down', title: 'Second night of a back-to-back', text: `The model trims minutes ${P(1 - cfg.minutes.b2bFactor)} and per-minute output slightly. Watch for rest days on the injury report.` });
  } else if (ctx.restDays != null && ctx.oppRestDays === 0) {
    script.push({ key: 'opp-b2b', tone: 'up', title: `${g.opp} on a back-to-back`, text: `${g.team} have ${ctx.restDays} day${ctx.restDays === 1 ? '' : 's'} of rest; tired legs on defence can help, though the model doesn't add anything for it.` });
  } else if (ctx.restDays != null && ctx.restDays >= 3) {
    script.push({ key: 'rest', tone: 'flat', title: `${ctx.restDays} days of rest`, text: 'Fully rested. No adjustment.' });
  }
  const venue = sp.factors.find((f) => f.key === 'venue');
  if (venue && Math.abs(venue.value - 1) >= 0.02) {
    script.push({ key: 'venue', tone: toneOf(venue.value - 1, 0.015), title: g.home ? 'At home' : 'On the road', text: `${name}'s ${short} per minute run ${signedPct(venue.value - 1)} ${g.home ? 'at home' : 'away'} after shrinking toward the league-wide effect.` });
  }

  // ---------- summary: how far context moved the projection ----------
  const rateMove = sp.basePer36 > 0 ? sp.per36 / sp.basePer36 - 1 : 0;
  const minMove = m.proj - m.base;
  const projBase = (sp.basePer36 / 36) * m.base;
  const totalMove = projBase > 0 ? sp.mean / projBase - 1 : 0;
  const summary = {
    tone: toneOf(totalMove, 0.03),
    text: Math.abs(totalMove) < 0.015
      ? `Tonight's context roughly cancels out: projection ${f1(sp.mean)} ${short}, the same as ${name}'s normal rate over ${f1(m.proj)} minutes.`
      : `Tonight's context moves ${name}'s projection ${totalMove > 0 ? 'up' : 'down'} ${signedPct(totalMove).replace(/^[+−]/, '')}, from ${f1(projBase)} to ${f1(sp.mean)} ${short}. Minutes ${f1(m.base)} → ${f1(m.proj)}; per-minute output ${Math.abs(rateMove) < 0.005 ? 'unchanged' : signedPct(rateMove)}.`,
  };

  return {
    summary,
    sections: [
      { title: 'Availability', notes: avail },
      { title: `History vs ${g.opp}`, notes: hist },
      { title: `${g.opp} defence`, notes: def },
      { title: 'Game script', notes: script },
    ],
    basis: `Team numbers from ${ps.label}. Built from box scores and the injury report only.`,
  };
}
