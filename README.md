# Prop Desk: NBA player prop analyser

Search a player, pick a stat, and get tonight's lines by bookmaker, a modelled over/under
probability, the no-vig edge and a verdict. For analysis only. Gamble responsibly. 18+.

## Web version (GitHub Pages)

**https://tobyweekes-ctrl.github.io/Propdesk/** works on any device, including iPad, and needs no server.

A scheduled GitHub Action (`.github/workflows/pages.yml`) pulls real NBA data and rebuilds the site three
times a day (UTC 13:17 box scores, 19:47 injuries, 22:23 injuries plus prop lines), and on every push to `main`.
The model runs in your browser on that data. Run it by hand any time: **Actions → Build and deploy → Run workflow**.

One-time setup:
1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. For bookmaker lines: **Settings → Secrets and variables → Actions → New repository secret** named
   `ODDS_API_KEY`. The key lives only in GitHub's secret store and is never published. Only the 22:23 run and
   manual runs spend credits: about 1 credit per market per game (8 markets by default). To spend less, add
   a variable `ODDS_MARKETS`, e.g. `pts,reb,ast,pra`.

On the web version, manual lines and the bet log are saved **in your browser**. Use Export / Import on the
Bets page to back them up or move them between devices. Every fetched bookmaker line is archived to the
`data` branch for the real-line backtest.

## Stack

- **Node 22, zero npm dependencies.** The server uses `node:http` and built-in `fetch`; tests use `node:test`.
  Nothing to install, nothing to audit, and it starts instantly.
- **Server-side data layer.** All third-party calls and API keys stay on the server. The browser only talks to `/api/*`.
- **Two-level cache:** in-memory in front of JSON files in `cache/`. It shares one in-flight call between concurrent
  callers, serves the stale copy if an upstream fails, keeps completed seasons forever and throttles each host.
- **Vanilla ES-module frontend, no build step.** Hand-drawn SVG chart, no chart library. Fast, small and keyboard-first.
- **Model in its own module** (`server/model/`) as pure functions with every weight in `server/model/config.mjs`,
  shared by the API and `scripts/backtest.mjs`.

## Run

```bash
cp .env.example .env      # add keys (optional, see below)
npm start                 # http://localhost:5177
npm run warm              # optional: pre-fetch both seasons, slate, injuries
npm run backtest          # model on last season's games; report in reports/
npm test
STATS_PROVIDER=demo npm start   # fictional offline league, development only
```

## Data sources

| Data | Source | Cost / caching |
|---|---|---|
| Box scores, both seasons (**default**) | ESPN public JSON (`STATS_PROVIDER=espn`): scoreboard per date + box score per game, no key, works anywhere | per game and per past date: forever; first pull of a past season ≈ 1,400 requests, once |
| Box scores (alternative) | `stats.nba.com` `leaguegamelog` (what `nba_api` wraps), `STATS_PROVIDER=nba`; 1 call per season | past season forever; current 3h |
| Box scores (alternative) | balldontlie `/stats` (`STATS_PROVIDER=balldontlie`, ALL-STAR tier) | full pull once, then a date-incremental top-up |
| Tonight's games | from the chosen stats source | 10 min – 1h |
| Prop lines | The Odds API: `/events` (free) + `/events/{id}/odds` with all 8 prop markets in one call, only for games you open | `ODDS_TTL_MIN` (10 min) |
| Game spread (optional) | Added to the same call when `ODDS_FETCH_SPREADS=true` (+1 market); **off by default** | with the props |
| Injuries | ESPN public injury report | 30 min |

From these the data layer works out pace, offensive and defensive rating, usage rate,
**defence vs position** (stat allowed per minute to guards, forwards and centres, relative to
league average and shrunk toward 1 for small samples), rest days, back-to-backs, and
**absences and returns** (team games missed, minutes in each game since coming back).

All of this is **real NBA data**. ESPN's endpoints are unofficial, so if they ever change, switch to
`STATS_PROVIDER=nba` (stats.nba.com blocks many cloud IPs but usually works from home) or `balldontlie`.
`STATS_PROVIDER=demo` is a fictional offline league used only for development and tests; the app shows a
DEMO DATA tag whenever it is on.

Run `npm run warm` once after install: it pulls last season's ~1,230 box scores (about 10 minutes, cached
for good) so the first search is instant.

## Lines, price checker and betslip

- **Bookmaker lines:** DraftKings player props come free from ESPN's public odds API: over/unders for all 8
  markets plus the "20+ points"-style ladders, with opening lines for movement. The feed doesn't label which
  price is the over, so every build checks each pair against the one-sided milestone market at line + 0.5
  ("12+ points" is the same bet as over 11.5) and logs how many it confirmed. The Odds API can run alongside
  it if you add a key.
- **Check a price:** type a threshold and your bookie's price ("20+ at 5/1"). You get the model's chance, the
  fair price, expected value, VALUE / FAIR / AVOID, and DraftKings' price for the same threshold when it has
  one. The ladder lists model fair prices next to DraftKings' for every threshold.
- **Betslip:** Over / Under buttons, the verdict card and "+ Slip" buttons add selections. On the Slip page
  you can edit each price to your bookie's, set stakes, and switch between singles and an acca. The analysis
  covers each leg's value, expected profit, the chance of each number of winners, and for an acca the
  combined chance. Legs on the same player are simulated together (one minutes and form draw shared by all
  his stats), so correlated legs are priced properly. It flags overlapping legs, opposite sides, same-game
  legs, thin data and injury returns. "Log as placed" puts the slip in the bet log, where accas settle leg by leg.
- **Guard rails:**
  - when the model differs from a two-sided no-vig price by more than **8 points**, the line is marked CHECK
    and never presented as the pick; gaps that big usually mean news the model can't see;
  - prices unchanged for more than 6 hours are marked stale and can't be the pick or show VALUE;
  - players ruled out get no projection;
  - splits under 5 games are greyed out.
- **Data checks** (`server/data/checks.mjs`) run on every line before it's used: the player is on one of the two
  teams, one price per line, ladder prices rise with the line (ESPN sometimes files a second market under the same
  name, e.g. a 2+..7+ series inside "Rebounds Milestones"), and future timestamps are treated as unknown. Each
  build logs the counts.
- **Track record** (Record page): every published pick is archived on the `data` branch with its first price
  and closing price, then graded from box scores: hit rate against what the model predicted, ROI at flat stakes,
  calibration buckets, and closing-line value (CLV).
- **Odds format:** fractional by default; the button in the header switches to decimal.

## Using it

- **Landing:** tonight's games with each team's main players; click one, or press `/` and search any player.
- **Stat:** chips for PTS, REB, AST, 3PM, PRA, P+R, P+A, R+A, or keys `1`–`8`.
- **Verdict strip:** the best bet across all lines (OVER / UNDER / PASS, confidence, edge, EV), projection,
  the model's own line and projected minutes.
- **Chart:** the last 10 or 20 games as bars with the selected line drawn across (over green, under red) and the
  projection dashed. Hover, or focus the chart and use ← →, for each game. Hit rates for L5 / L10 / L20 / season
  / last season sit underneath.
- **Lines by bookie:** price, model probability, edge, EV and pick per book, with the best price highlighted.
  **Click a row** to put that line on the chart, hit rates and splits. **Take** logs it as a bet.
- **Splits:** this season / last season, home / away, vs tonight's opponent, rest days, and with / without each
  key teammate (seasons they shared a team only; teammates out tonight are flagged).
- **Minutes and adjustments:** every step behind the projection, plus a box to enter your own minutes.
- **Context (`c`):** plain-English notes built from the data, each marked ▲ helps the over / ▼ helps the under:
  availability (questionable tag, games missed, return ramp, teammates out, new team), history against tonight's
  opponent and how much the model trusts it, the opponent's defence against the player's position and its style
  from box scores (rim protection, threes allowed, pressure, defensive rebounding, fouling), and the game script
  (pace, blowout risk, back-to-backs, home/away). Scheme words like "drop" or "switching" are inferred from
  box-score numbers, not tracking data, and the panel says so.

## Model (`server/model/`)

For each player, stat and line:

1. **Minutes** (`minutes.mjs`), as an explicit step, each adjustment listed in the UI:
   - base minutes: this season's recency-weighted minutes with the current team, blended with last season
     (`n/(n+5)`, or `n/(n+2)` after a team change)
   - return from injury: first game back = 75% of pre-injury; then follow minutes since return plus a ramp; wider spread
   - teammates out: his own with/without history (shrunk to small samples), else a positional share of the
     absent player's minutes
   - blowout risk: expected margin from the spread (if `ODDS_FETCH_SPREADS=true`) or team net ratings; his own
     minutes in past blowouts vs normal games
   - back-to-back; optional manual minutes override
2. **Per-minute rate** (`projection.mjs`) for pts, reb, ast and 3PM: this season vs last season `n/(n+12)`
   (3PM `n/(n+20)`), then 70% season, 20% last 10, 10% last 5. Multiplied by home/away, back-to-back, matchup
   pace, opponent defence vs his position (guards / forwards / centres), head-to-head (`n/(n+15)`, capped ±10%),
   and the usage bump from teammates out. Combos sum their parts.
3. **Distribution** (`distributions.mjs`): negative binomial with dispersion fitted to his game-to-game spread
   (it falls back to Poisson when the data show no extra spread, as with most 3PM), mixed over the minutes
   uncertainty, plus the uncertainty of the estimate itself (sampling error + `modelCv`).
4. **No-vig edge** (`odds.mjs`, `evaluate.mjs`): implied probabilities with the margin removed (multiplicative,
   or power); one-sided prices assume a 5% margin. Edge = model probability − no-vig probability.
5. **Verdict**: OVER / UNDER only if edge ≥ `threshold` (4%) **and** EV > 0 at the offered price; else PASS.
   Confidence HIGH / MEDIUM / LOW from edge size and a data-quality score.
6. **Hit rates** vs the exact line: last 5, 10, 20, this season, last season.

### Season blending and team changes

The weight on this season is `n / (n + k)` where n = games this season. With `k = 12` (scoring rates):
0 games → 100% last season, 5 → 29%, 15 → 56%, 40 → 77%. Minutes use `k = 5` because roles settle quickly.
Team pace and defence use `k = 15` team games. After a team change, per-minute production carries over (skill
travels) but last season's minutes count far less (`k = 2`), and only games with the new team set the minutes base.

### Backtest (`npm run backtest`)

`node scripts/backtest.mjs --season 2025-26 [--from --to] [--stats pts,reb] [--set adjust.defWeight=0.6] [--dump]`

Only data from before each game is used (team stats come from a weekly snapshot). Three sections, kept separate:

1. **Accuracy + calibration**, which need no lines: projection error vs season-average and last-10 baselines,
   Brier score and calibration buckets, and a *spread* ratio (1.00 = the predicted uncertainty matches reality).
2. **ROI vs ESTIMATED lines**, clearly labelled. There are no free historical prop lines, so each line is estimated
   (0.6 × last-10 + 0.4 × season average, rounded to x.5, 1.91 both sides). Real books are sharper, so this ROI
   overstates what you would get. Treat it as a sanity check only.
3. **ROI vs REAL lines**: every Odds API fetch is saved (`userdata/live/odds/`) and graded at the latest
   pre-tip-off price, together with your manual lines. This starts empty and grows as you use the app.

### Results on real games (2025-26, 131,688 predictions)

Mean absolute error, lower is better. The model beats every simple baseline on all 8 stats:

| Stat | Model | Season avg | Last 10 | Est. line |
|---|---|---|---|---|
| PTS | **5.17** | 5.30 | 5.29 | 5.23 |
| REB | **2.01** | 2.05 | 2.07 | 2.06 |
| AST | **1.54** | 1.57 | 1.59 | 1.59 |
| 3PM | **1.03** | 1.04 | 1.05 | 1.11 |
| PRA | **6.55** | 6.77 | 6.72 | 6.65 |

Per-stat uncertainty is calibrated so the predicted spread matches real outcomes (backtest "spread" 0.99–1.05).
Calibration is close between 30% and 80%. Below 30% the model is still too confident: when it gives an over
16–26%, overs actually landed 31–33% of the time, and this is worst late in the season (load management,
tanking). Treat strong UNDER calls with care. What tuning on real data changed, settings chosen on
Dec–Jan and checked on Oct–Nov and Feb–Apr:
- the teammates-out adjustment at full strength made projections worse, so it now applies gently
  (25% minutes redistribution, heavy shrinkage) and the per-minute usage bump is off;
- recent form gets more weight (55% season, 30% last 10, 15% last 5).

Beating these baselines is necessary, not sufficient: bookmaker lines are sharper than any of them. The
real-line section is the test that matters, and it fills in as lines are archived.

### Manual lines and bet log

Add any bookie's line (fractional `10/11`, decimal or American; one side is enough) on the player page. It is
evaluated exactly like feed lines and **saved on the server** (`userdata/<demo|live>/entries.json`), with the
model's numbers at the time. **Take** marks any line as a bet (side, stake, price). The **Bets** page grades bets
from box scores (DNP = void) and shows W-L, profit and ROI, split by bets with and against the model's pick.
Demo and live data are stored separately.

## Layout

```
server/
  index.mjs            HTTP server
  routes.mjs           API routes, shared by the server and the in-browser (Pages) backend
  env.mjs, cache.mjs, http.mjs, teams.mjs, stats.mjs, util.mjs
  providers/           espn, nbaStats, balldontlie, oddsApi, espnInjuries, demo
  data/derive.mjs      pure derivations (pace, usage, position defence, defensive profile, absences)
  data/store.mjs       provider selection, caching, live fetching (Node only)
  data/league.mjs      indexed League, search, averages, lines (pure, also runs in the browser)
  data/entries.mjs     grading and bet-log summary (pure)
  data/splits.mjs      home/away, opponent, rest, with/without teammates
  data/userdata.mjs    manual lines, bet log, odds snapshots, grading
  model/               config, context, minutes, projection, distributions, odds, evaluate, notes, slip, record
web/                   index.html, styles.css, js/ (app, landing, player, chart, bets, ui, static)
scripts/               warm-cache.mjs, backtest.mjs, build-static.mjs (GitHub Pages build)
userdata/, reports/    created at runtime, gitignored
test/
```

## API

`GET /api/health` · `/api/players/search?q=` · `/api/player/:id` · `/api/player/:id/lines?stat=pts`
· `/api/player/:id/analysis?stat=pts[&line=&over=&under=&book=][&min=]` · `/api/player/:id/splits?stat=pts`
· `/api/slate?date=` · `/api/slate/players` · `/api/injuries`
· `/api/teams` · `/api/stats` · `GET/POST /api/entries` · `PATCH/DELETE /api/entries/:id` · `GET /api/bets`

Stat keys: `pts reb ast fg3m pra pr pa ra`.
