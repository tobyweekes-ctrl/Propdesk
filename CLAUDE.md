# Prop Desk: notes for Claude

NBA player-prop analyser. Live site: https://tobyweekes-ctrl.github.io/Propdesk/ (GitHub Pages, rebuilt by
`.github/workflows/pages.yml`). README.md has the long version; this is what a session needs first.

## Run, test, build

- `npm test`: the whole suite, about 1-2 s. A Stop hook (`.claude/hooks/stop-tests.mjs`) runs it before you
  finish and blocks while it fails. Fix the failure, or say plainly why not.
- `npm start`: local server on http://localhost:5177. `TODAY=YYYY-MM-DD npm start` replays a past day.
  First start downloads box scores into `cache/` (several minutes when the cache is empty).
- `node scripts/build-static.mjs`: the Pages build into `dist/` (`ARCHIVE_DIR=<dir>` for the picks archive).
  Serve it with `cd dist && python3 -m http.server 8099` to test the real site locally.
- `node scripts/backtest.mjs --season 2025-26 [--stats pts,reb] [--set adjust.x=0.2] [--dump]`: model
  accuracy on past games, no look-ahead. Use it before changing any model weight.

## Deploy

Push to `main` deploys (Pages source is "GitHub Actions"). The workflow also runs at 13:17, 19:47 and
22:23 UTC and on manual dispatch. The `data` branch holds the archive: `picks/<date>.json` (graded into
the Record page) and `odds/<date>.jsonl`. Never rewrite it.

## Architecture

- Zero npm dependencies, Node 22, ES modules. Keep it that way.
- `server/routes.mjs` and everything it imports must stay pure (no Node built-ins): the Pages build copies
  that import closure into the browser and fails on `env`, `cache`, `store` or `userdata`.
- The browser runs the same routes over prebuilt data (`web/js/static.js`, `window.PROPDESK_STATIC`).
  The landing page reads the small `data/landing.json` (best value, generated-slip pool) and skips the
  season files.
- Model (`server/model/`): minutes first, then per-minute rates with adjustments, a negative-binomial
  distribution, edges against no-vig prices. All weights are in `config.mjs`, each with the backtest
  evidence for it. Context notes: `notes.mjs`. Slip analysis: `slip.mjs`. Track record: `record.mjs`.
- Frontend: vanilla JS (`web/js/`), hand-drawn SVG chart, no build step. Design tokens are at the top of
  `web/styles.css`.

## Rules of thumb

- Real NBA data only: never invent players, lines or results. Prices are DraftKings (via ESPN), plus The
  Odds API when `ODDS_API_KEY` is set.
- Change a model weight only with a backtest showing it helps, and record the evidence in `config.mjs`.
- User-facing text is plain English: no unexplained jargon. The user is in the UK and reads fractional odds.
- Check UI changes in a real browser at 1280 px and 390 px (Playwright is preinstalled), with no console
  errors and no sideways scrolling.
- Footer stays: for analysis only, gamble responsibly, 18+.
