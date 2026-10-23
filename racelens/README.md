# RaceLens

**Every source. Every horse. One clear view.**

RaceLens is a personal horse-racing research assistant for Australian thoroughbred meetings. You pick a race day and a track, and it:

1. **Pulls the meeting from many independent sources at once** – official fields, form guides, bookmaker odds, news feeds, Reddit chatter and the weather – so it never depends on one website being up or complete.
2. **Cross-checks every fact** (saddlecloth number, barrier, jockey, trainer, weight, scratchings) across those sources and shows you a *verification score* for each runner, each race and the whole meeting, with the disagreements spelled out.
3. **Rates every runner on 16 factors** – recent form, class, track & distance record, wet-track form, barrier, pace map, jockey, trainer, weight, fitness/freshness, career strike rate, published ratings, market moves, news sentiment, gear changes and breeding – and pools that with the market to produce **win / place / top-6 probabilities and a predicted finishing order (top 6)**.
4. Gives each race a **confidence rating (0–100, Low/Fair/Good/High)** that explains itself: how complete the data was, how well the sources agreed, how clear-cut the race is, how fresh the data is, and whether conditions are volatile.
5. Suggests a **betting structure** sized to your bankroll, unit and risk profile – win / each-way / place, quinella, exacta standout, boxed trifecta (and First 4 for aggressive profiles), with flexi percentages – or tells you to *watch* or *skip* when confidence is low.
6. Saves all of that as a **meeting pack** and then **runs the race day by itself**: a pre-race check before each race (fresh odds, scratchings, rider changes, day patterns such as on-pace bias or inside-barrier bias, re-rating), the **result fetched automatically a couple of minutes after each race**, and the remaining races re-rated every time one lands. The *Pre-race check* and *Fetch results* buttons stay for manual control.
7. **Scores itself** once results are in (did the winner come from our top 3? did the trifecta box land?).

> RaceLens does not place bets and is not betting advice. Suggestions only. Bet responsibly – Gambling Help 1800 858 858.

---

## Using it on your phone with a Mac mini (the main way)

**Start here: [docs/MAC-MINI.md](docs/MAC-MINI.md).** Paste one line into Terminal on the Mac mini once; after that the
Mac runs RaceLens silently in the background (starts by itself, restarts itself, keeps the Mac awake) and you use it
only from your phone – anywhere, via Tailscale's private `https://` address, installed on the home screen like an app.

```bash
curl -fsSL https://raw.githubusercontent.com/RaywhiteMildura/milana-source/refs/heads/claude/horse-racing-predictor-ts4iet/racelens/scripts/mac/bootstrap.sh | bash
```

Run the same line again to update. No Mac to leave on? [docs/DEPLOY.md](docs/DEPLOY.md) option B hosts it on Fly.io in Sydney.

## Quick start (a developer's computer)

Requirements: Node.js 22 or newer – install the LTS version from https://nodejs.org. (Node 20.19+ still builds and runs it, but the tests need Node 22.12+.)

```bash
cd racelens
npm install
npm run build      # builds the web app and the server
npm start          # http://localhost:4850
```

Open **http://localhost:4850**, pick tomorrow's date, choose the meeting (e.g. Flemington) and press **Research this meeting**.

## Other ways to reach it from a phone

```bash
npm run start:phone      # same as npm start, but reachable from your Wi-Fi; prints a QR code
```

Scan the QR code with the phone's camera (same Wi-Fi), or read the address under **Settings → Use RaceLens on your phone**, then add it to the home screen (full-screen on iPhone; on Android full-screen needs an https address – see docs/DEPLOY.md). Set `RACELENS_PASSWORD` first so nobody else on the network can open it. `scripts\start-phone.cmd` (Windows) and `scripts/start-phone.sh` (macOS/Linux) do the build, ask for the password (hidden while you type) and start it in one go.

The server must be running somewhere for the whole race day – the phone is only a window on it. **[docs/DEPLOY.md](docs/DEPLOY.md)** walks through the three ways to do that (office computer + phone, with Tailscale for away-from-home; hosted on Fly.io in Sydney or Render; Android-only with Termux), exactly what happens automatically on race day, and troubleshooting.

Useful variations:

| Command | What it does |
|---|---|
| `npm run dev` | Development mode with live reload (web on :5173, API on :4850) |
| `npm run start:phone` | Listens on every network address and prints the phone URL and a QR code |
| `npm run start:phone:demo` | The same with the bundled offline sample meeting – try the phone setup without internet |
| `npm run start:phone:rehearse` | A full race-day rehearsal on any date: the bundled Flemington meeting with the server clock starting at 12:15 pm on 24 Oct 2026, ten minutes before Race 1. Research the meeting, then watch the automatic pre-race checks, results and re-rating happen by themselves. Uses its own `data-rehearse` folder |
| `npm run demo` | Runs with the bundled offline sample meeting (no internet needed) |
| `npm run probe -- 2026-10-24 flemington` | Prints which live sources respond for a date/venue |
| `RACELENS_RECORD=1 npm start` | Records every raw source response into `fixtures/recorded/` (handy for debugging a source) |
| `npm test` | Unit tests (vitest) |
| `npm run test:e2e` | Browser tests (Playwright) against two demo servers started from the built app – run `npm run build` first (and `npx playwright install chromium` once) |
| `npm run build:termux` | The build for an Android phone running Termux, where `npm run build` cannot run (docs/DEPLOY.md, option C) |
| `npm run typecheck` | TypeScript checks |
| `docker build -t racelens .` | Builds the container image used by Fly.io / Render (see `Dockerfile`, `fly.toml`, `render.yaml`) |

Environment variables:

| Variable | Meaning |
|---|---|
| `RACELENS_PORT` | Port (default 4850) |
| `RACELENS_HOST` | `127.0.0.1` (default) = this computer only; `0.0.0.0` = reachable from your phone / Tailscale / Docker |
| `RACELENS_PASSWORD` | Turns on the login screen. A phone stays signed in for 30 days, extended while it is used, for at most 90 days after signing in. Changing the password signs every device out. Empty = no login (refused on a hosted server, see below) |
| `RACELENS_ALLOWED_HOSTS` | Extra host names RaceLens may be opened by (comma-separated, e.g. a Tailscale MagicDNS name), or `*` for hosted platforms where the platform owns the hostname and the password protects the app. The machine's own addresses are always allowed. `*` (like running on Fly.io or Render) makes the server *hosted*: it needs a password and shows its public address instead of Wi-Fi addresses |
| `RACELENS_PUBLIC_URL` | The address phones should use, shown with a QR code in Settings (e.g. a custom domain or a Tailscale https name). Fly.io and Render fill it in by themselves |
| `RACELENS_TRUST_PROXY` | `1` to trust the client address passed on by a proxy in front of RaceLens (the login lock then counts per device). Automatic on Fly.io and Render; set it only when that proxy is the only way in. Login cookies are marked secure over https either way |
| `RACELENS_ALLOW_OPEN` | `1` lets a hosted server start without a password (only on a private network you trust) |
| `RACELENS_QR` | `0` to skip printing the QR code at start-up (hosted platforms, logs) |
| `RACELENS_DATA_DIR` | Where packs, settings and the login secret live (default `./data`) |
| `RACELENS_MODE` | `live` (default) or `demo` |
| `RACELENS_LOG` | `debug` / `info` / `warn` / `error` |
| `RACELENS_CONTACT_EMAIL` | Sent as the `From` header to the Ladbrokes affiliate API, as its terms ask |
| `RACING_COM_API_KEY` | Override if racing.com rotates its public key |

Your research packs and settings are JSON files in `data/` – back them up or delete them freely. (`data/.secret` signs the login cookies together with the password; deleting it, or changing the password, signs every phone out. `data/.revoked-sessions.json` remembers phones that signed out.)

Security note: by default RaceLens listens on this computer only and only answers requests addressed to it (localhost or its own network addresses; add others with `RACELENS_ALLOWED_HOSTS=name1,name2`). If you open it to your Wi-Fi with `RACELENS_HOST=0.0.0.0`, **set `RACELENS_PASSWORD`** – otherwise anyone on that network can change settings and results (the server warns). A hosted server (Fly.io, Render, or `RACELENS_ALLOWED_HOSTS=*` as in the Docker image) refuses to start without a password unless `RACELENS_ALLOW_OPEN=1`. The login uses a signed cookie tied to the password, compares passwords in constant time, ends the session on the server when you sign out, and never keeps a phone signed in for more than 90 days. Five wrong passwords from one address within ten minutes lock that address out for a minute, and 30 wrong passwords within ten minutes from all addresses together pause every new sign-in for a minute (phones already signed in keep working). Use HTTPS for a hosted deployment (Fly.io and Render provide it).

## How to use it on race day

1. **The night before or in the morning:** open RaceLens, choose the date and meeting, press *Research this meeting*. Wait for the progress panel (it fetches every source, collects form, cross-checks, scans news, checks weather and rates every race). Open the meeting. This is the one step that needs you.
2. **Read a race:** the top-6 cards show win %, place %, best price and bookmaker, a *VALUE* badge when our price beats the market, green reasons and amber concerns, and *Why* expands to the full factor table. The confidence dial tells you how much to trust it and why.
3. **Betting structure:** below the picks. Set your bankroll, unit and risk profile in *Settings* first – the plan scales to them. *Skip* / *Watch* means exactly that.
4. **Verification tab:** see which sources agree on each runner's barrier, jockey, trainer and weight. Amber = sources disagree; check the official card before you bet.
5. **Before each race – nothing to press.** Ten minutes before the jump (Settings → *Auto pre-race check*) and again in the final three minutes, the server refreshes odds, scratchings and rider changes, pulls any results of earlier races that are due, detects day patterns and re-rates. The open page refreshes itself and the race history says what changed. *Pre-race check this race* / *Pre-race check all* are there if you want it right now.
6. **After each race – nothing to press.** From two minutes after the scheduled start the server polls the results sources until the result is published, records it, scores the prediction and re-rates the rest of the card; the phone shows "R3 result in". *Fetch results* forces a check, and *Enter result manually* lets you type the placings if no source publishes them – a typed-in result is never replaced by the sources.
7. **Leave it running.** The server does all of this only while it is on – keep the computer awake, or host it (docs/DEPLOY.md). If it was off for a while, it catches up within a minute of coming back, and opening a race page on the phone asks it to catch up if it is behind.

### What happens automatically

* **Pre-race checks** at 10 minutes before the jump and again inside the final 3 minutes (the first number is adjustable in Settings; 0 switches them off).
* **Results polling** from 2 minutes after the scheduled start: every 2 minutes for the first half hour, every 5 minutes to 90 minutes, every 15 minutes to 4 hours, then it gives up with a note on the race and leaves it to you. If no results source answers at all, the race says so ("No results source answered (TAB: HTTP 403; …)") instead of "Nothing published yet". A check that fails on the server is logged as a warning and retried 5 minutes later.
* **Abandoned races:** from 20 minutes after the jump, while nothing is published, the race-card sources are asked now and then (20, 30, 45, 60, 90 minutes, then 2, 3 and 4 hours) whether the race was abandoned; if so it is marked abandoned and no longer watched.
* **Confirmation:** two agreeing sources (or a typed-in result) settle a race at once. A final result from a single source is recorded, scored and used for re-rating straight away – the race shows "Result from TAB only - waiting for a second source" while the server looks up to 3 more times for a second source, then it accepts it. A result that any agreeing source still calls interim (a protest, correct weight not yet signalled) shows as "Interim result in" and stays under watch until it is declared final.
* **Late corrections:** a result the sources settled within 30 minutes of the jump gets one more look at the 30-minute mark, in case a protest or amended result changed it; after that the race is left alone.
* **Re-rating** of every remaining race, plus day-pattern detection and the scorecard, each time a result lands – also when you type one in or press *Fetch results*.
* **The phone screen:** an open race page checks every 30 seconds and refreshes when something changed, with a message only for news (a result, a correction, a scratching or rider change, new picks). With automatic results on, opening or returning to a race page asks the server to catch up – quietly – when a race that jumped more than 3 minutes ago has no result and the server either never checked it or is more than 90 seconds late with its next check; the server then checks only what its own schedule says is due.
* **Catch-up after a restart or sleep:** the first scheduler pass runs 5 seconds after start-up and every minute after that, so missed results are fetched within a minute of the server coming back.
* **Settings → Race day automation** shows the live status ("Watching Flemington R3 – next check in 1 min") and has the on/off switches.

## Race-day checklist (first run)

1. The night before or first thing: `npm install`, `npm run build`, `npm run start:phone` (or `npm start` for this computer only), open http://localhost:4850 and scan the QR code on the phone.
2. Click **Check sources** on the home page. Green = responding. If every racing source is red, your connection or an Australian-IP requirement is the problem (TAB and Sportsbet only answer Australian IPs); news and weather are unaffected.
3. Pick the date and the meeting, **Research this meeting**, and read the Verification tab for one race: the barrier/jockey/weight columns should agree across at least two sources. If one source disagrees everywhere, switch it off in Settings and re-run.
4. Set bankroll, unit and risk profile in **Settings** before trusting any stake sizes, and check that *Race day automation* says the scheduler is running.
5. Leave the server running and the computer awake. It re-checks each race before the jump, fetches results after it and re-rates the rest of the card. Press **Pre-race check** or **Fetch results** yourself any time.
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

Source availability can change without notice (none of these is an official public API). The *Sources* strip on the home page and `npm run probe` show what is working right now. Research continues when a source is down – its absence just lowers the verification and confidence scores. TAB and Sportsbet only answer Australian IP addresses, which is why the hosted guide recommends Fly.io's Sydney region.

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
src/server/      Express API, auth (password login), source adapters (adapters/live, adapters/demo), engines (core), jobs (research, scheduler), JSON store
src/web/         React UI (Vite); PWA manifest, icons and service worker in src/web/public
fixtures/        sample raw source responses used by the tests and demo mode
research/        notes on each data source's endpoints and shapes
scripts/         start-phone.cmd / start-phone.sh (one-click phone start), make-icons.mjs
tests/e2e/       Playwright browser tests
docs/API.md      HTTP API contract
docs/DEPLOY.md   Using it on your phone: computer + phone, Tailscale, Fly.io, Render, Termux; race-day automation; troubleshooting
Dockerfile, fly.toml, render.yaml, deploy/fly-deploy.yml   hosted deployment
```
