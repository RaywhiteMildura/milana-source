# RaceLens

**Every source. Every horse. One clear view.**

RaceLens is a personal horse-racing research assistant for Australian thoroughbred meetings. You pick a race day and a track, and it:

1. **Pulls the meeting from many independent sources at once** – official fields, form guides, bookmaker odds, news feeds, Reddit chatter and the weather – so it never depends on one website being up or complete.
2. **Cross-checks every fact** (saddlecloth number, barrier, jockey, trainer, weight, scratchings) across those sources and shows you a *verification score* for each runner, each race and the whole meeting, with the disagreements spelled out.
3. **Rates every runner on 16 factors** – recent form, class, track & distance record, wet-track form, barrier, pace map, jockey, trainer, weight, fitness/freshness, career strike rate, published ratings, market moves, news sentiment, gear changes and breeding – and pools that with the market to produce **win / place / top-6 probabilities and a predicted finishing order (top 6)**.
4. Gives each race a **confidence rating (0–100, Low/Fair/Good/High)** that explains itself: how complete the data was, how well the sources agreed, how clear-cut the race is, how fresh the data is, and whether conditions are volatile.
5. Suggests a **betting structure** sized to your bankroll, unit and risk profile – win / each-way / place, quinella, exacta standout, boxed trifecta (and First 4 for aggressive profiles), with flexi percentages – or tells you to *watch* or *skip* when confidence is low.
6. Saves all of that as a **meeting pack** so you can research the whole day in the morning, then hit **Pre-race check** before each race: it refreshes odds, scratchings and rider changes, pulls the results of races already run, looks for **day patterns** (on-pace bias, inside/outside barrier bias, favourites' day, track drift) and re-rates the remaining races, listing exactly what changed. While the app is running it also does this **automatically** a set number of minutes before each race (Settings → auto-recheck).
7. **Scores itself** once results are in (did the winner come from our top 3? did the trifecta box land?).

> RaceLens does not place bets and is not betting advice. Suggestions only. Bet responsibly – Gambling Help 1800 858 858.

---

## Quick start (your computer, open internet)

Requirements: Node.js 20 or newer (22 recommended). Install from https://nodejs.org.

```bash
cd racelens
npm install
npm run build      # builds the web app and the server
npm start          # http://localhost:4850
```

Open **http://localhost:4850**, pick tomorrow's date, choose the meeting (e.g. Flemington) and press **Research this meeting**.

Useful variations:

| Command | What it does |
|---|---|
| `npm run dev` | Development mode with live reload (web on :5173, API on :4850) |
| `npm run demo` | Runs with the bundled offline sample meeting (no internet needed) |
| `npm run probe -- 2026-10-24 flemington` | Prints which live sources respond for a date/venue |
| `RACELENS_RECORD=1 npm start` | Records every raw source response into `fixtures/recorded/` (handy for debugging a source) |
| `npm test` | Unit tests (vitest) |
| `npm run test:e2e` | Browser tests (Playwright) against the demo server – run `npx playwright install chromium` once first |
| `npm run typecheck` | TypeScript checks |

Environment variables: `RACELENS_PORT` (default 4850), `RACELENS_HOST` (default `127.0.0.1`; set `0.0.0.0` to open it to your phone on the same Wi-Fi), `RACELENS_DATA_DIR` (default `./data`), `RACELENS_MODE` (`live` default or `demo`), `RACELENS_LOG` (`debug|info|warn|error`), `RACELENS_CONTACT_EMAIL` (sent as the `From` header to the Ladbrokes affiliate API, as its terms ask), `RACING_COM_API_KEY` (override if racing.com rotates its public key).

Your research packs and settings are JSON files in `data/` – back them up or delete them freely.

## How to use it on race day

1. **Morning:** open RaceLens, choose the date and meeting, press *Research this meeting*. Wait for the progress panel (it fetches every source, collects form, cross-checks, scans news, checks weather and rates every race). Open the meeting.
2. **Read a race:** the top-6 cards show win %, place %, best price and bookmaker, a *VALUE* badge when our price beats the market, green reasons and amber concerns, and *Why* expands to the full factor table. The confidence dial tells you how much to trust it and why.
3. **Betting structure:** below the picks. Set your bankroll, unit and risk profile in *Settings* first – the plan scales to them. *Skip* / *Watch* means exactly that.
4. **Verification tab:** see which sources agree on each runner's barrier, jockey, trainer and weight. Amber = sources disagree; check the official card before you bet.
5. **Before each race:** press *Pre-race check this race* (or *Pre-race check all*). It refreshes everything, pulls results of earlier races, detects day patterns and tells you what changed.
6. **After the race:** *Fetch results* (or type them in manually) to see the scorecard and let the day-pattern detector learn from it.

## Race-day checklist (first run)

1. The night before or first thing: `npm install`, `npm run build`, `npm start`, open http://localhost:4850.
2. Click **Check sources** on the home page. Green = responding. If every racing source is red, your connection or an Australian-IP requirement is the problem (TAB and Sportsbet only answer Australian IPs); news and weather are unaffected.
3. Pick the date and the meeting, **Research this meeting**, and read the Verification tab for one race: the barrier/jockey/weight columns should agree across at least two sources. If one source disagrees everywhere, switch it off in Settings and re-run.
4. Set bankroll, unit and risk profile in **Settings** before trusting any stake sizes.
5. Leave the app running on race day: it re-checks each race automatically before the jump, pulls results, and re-rates the rest of the card. Press **Pre-race check** yourself any time.
6. If a source changes its format overnight, the research still completes with the remaining sources; run `npm run probe -- <date> <venue>` to see which one failed and `RACELENS_RECORD=1 npm start` to capture the raw response for fixing.

## Sources

Live mode uses whatever responds; each one is optional and can be switched off in Settings.

| Source | Kind | What it gives us |
|---|---|---|
| Racing Australia Free Fields (`racingaustralia.horse`, official) | official | Official fields, barriers, riders, weights, gear, scratchings, pedigree, run-by-run form, results with margins and times |
| Racing.com (Racing Victoria GraphQL, official for VIC) | official | Meetings, fields, form, odds from several providers, jockey/trainer strike rates, results, stewards' comments |
| TAB (`api.beta.tab.com.au`) | odds + form + results | Race cards, fixed & tote odds with price history, speed bands, TAB form ratings and win probabilities, results and dividends |
| Sportsbet | odds + form | Fixed odds with fluctuations, full runner form (career/track/distance/going splits, last starts), Racing & Sports comments, speed map, results |
| Ladbrokes / Neds (Entain affiliate API) | odds | Fixed odds, fluctuations, scratchings, rail position, R&S race comment and tips, speed map, results and tote dividends |
| Google News, Bing News, racing RSS feeds (Just Horse Racing, news.com.au Sport, Races.com.au…) | news | Stable talk, jockey changes, injuries, "worked brilliantly" stories – three independent channels |
| Reddit | rumours | r/horseracing and Australian subreddit chatter |
| Open-Meteo | weather | 72-hour rain lead-up and race-day forecast → expected track rating |

Source availability can change without notice (none of these is an official public API). The *Sources* strip on the home page and `npm run probe` show what is working right now. Research continues when a source is down – its absence just lowers the verification and confidence scores.

## How the prediction works (plain English)

* Each factor scores a runner between −1 and +1 and says how much data backed that score. Weak data shrinks a factor's influence instead of inventing a view.
* Scores are weighted (recent form and published ratings count most; gear and breeding least), combined into a strength, and turned into win probabilities.
* Because betting markets are the best single predictor, our probabilities are blended with the market's implied probabilities (about 45/55 our view/market). Where we are more bullish than the market, that's flagged as *value*.
* Place, top-6 and expected-finish come from simulating the race thousands of times (Plackett–Luce model) with those probabilities.
* Day patterns found in earlier results (e.g. "3 of 4 winners led") raise or lower the weight of the relevant factor for the rest of the day.
* Confidence = data completeness (20%) + source agreement (20%) + how clear-cut the race is (30%) + alignment with the market (15%) + field size (10%) + freshness (5%), reduced for volatile conditions (Heavy track, big rail move, many scratchings). Labels: under 45 Low, 45–61 Fair, 62–77 Good, 78+ High. A top pick under 25% to win is never rated above Fair; under 35% never High – open races are called open.
* Honest expectation: even a well-calibrated system's top pick wins roughly a third of the time and runs top-3 about two-thirds of the time. The betting plan says *Watch* or *Skip* when nothing clears the thresholds.

Model code: `src/server/core/factors.ts`, `model.ts`, `betting.ts`, `daypatterns.ts`. Reconciliation: `src/server/core/reconcile.ts`.

## Project layout

```
src/shared/      canonical data types shared by server and web
src/server/      Express API, source adapters (adapters/live, adapters/demo), engines (core), jobs, JSON store
src/web/         React UI (Vite)
fixtures/        sample raw source responses used by the tests and demo mode
research/        notes on each data source's endpoints and shapes
tests/e2e/       Playwright browser tests
docs/API.md      HTTP API contract
```
