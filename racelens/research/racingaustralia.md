# Racing Australia "Free Fields" (`racingaustralia.horse`) — official national fields, form, results (server-rendered ASP.NET HTML)

Source key: **`racingaustralia`** · Researched 2026-10-23 for RaceLens · Fixtures: `research/fixtures/racingaustralia/` (index in its `README.md`)

> **Honesty note.** The research container cannot reach `racingaustralia.horse` (or its mirrors, or web.archive.org), so **nothing in this
> report was fetched live by me**. Every statement comes from (a) three REAL page captures republished in public GitHub repos
> (The Valley results 2025-10-25, Caulfield results 2025-10-18, a "not currently available" results page, plus a Group/Listed dates table),
> (b) reading 15+ public code bases that scrape the site (regexes, CSS selectors, URL builders, comments about live behaviour), and (c)
> search-engine snippets of indexed live pages. Confidence tags: **high** = seen in a real capture or in ≥2 independent working parsers;
> **medium** = one working parser; **low** = snippet-only, 2013-era code, or my memory. The first live run on the user's machine must
> save the raw HTML of each page type and diff it against the fixtures (section 13).

---

## 0. TL;DR for the adapter author

| Need | Page (all `GET`, no auth, HTML) | Confidence |
|---|---|---|
| Meetings for a date (per state) | `/FreeFields/Calendar.aspx?State={NSW\|VIC\|QLD\|SA\|WA\|TAS\|ACT\|NT}` → read every `href` matching `/FreeFields/\w+\.aspx?Key=...`, keep keys whose first token is the date | high |
| The meeting key | `Key={YYYY}{Mon}{DD},{STATE},{Venue}[,Trial\|Picnic]` e.g. `2026Oct24,VIC,Flemington` — **always copy from the calendar, never build the venue name** | high |
| Race card + full form (pedigree, age/sex/colour, gear changes, career & surface records, run-by-run lines with 600 m splits, prices) | `/FreeFields/Form.aspx?Key=...` (~870 KB; `&recentForm=Y` / `AllForm.aspx?...&recentForm=N` variants) | high |
| Acceptances with official handicap rating, probable weight, penalty, last-10 | `/FreeFields/Acceptances.aspx?Key=...` (styled) or `/ozracing/Acceptances.aspx?key=...` (bare 22 KB) | high / medium |
| Scratchings (refetch, changes until jump) | `/FreeFields/Scratchings.aspx?Key=...` | medium |
| Gear changes | `/FreeFields/GearChanges.aspx?Key=...` (also per-runner "Gear Changes:" inside Form.aspx) | low (page) / high (in Form) |
| Rail position, track condition, weather, penetrometer | `div.race-venue-bottom` on Form/Acceptances/Scratchings/Results pages; per race `Track Condition:` inside `table.race-title` on Results | high |
| Official results (placings, margins, SP, winning time, last 600 m, DQ/SB codes, late-scratching deductions) | `/FreeFields/Results.aspx?Key=...` — one page per meeting | high (real captures) |
| Results calendar (rolling ~3 months) | `/FreeFields/Calendar_Results.aspx?State=XX` | medium |
| Horse profile / full form by horse | `/InteractiveForm/HorseFullForm.aspx?horsecode={base64}&stage=...&Key=...&src=horseform&raceentry={base64}` (links on every page); search at `/SearchServices/HorseSearch.aspx` | high (URL) / low-medium (shape) |
| Jockey / trainer recent runs | `/InteractiveForm/JockeyLastRuns.aspx?jockeycode={base64}`, `/InteractiveForm/TrainerLastRuns.aspx?trainercode={base64}&trainername={urlenc}` | high (URL) / low (shape) |
| Premierships (jockey/trainer season tables) | `/FreeServices/Premierships.aspx?State=XX[&Season=YYYY&Table=Trainer]` | medium |
| Black-type calendar | `/arb/Group_ListedRaceDates/{YYYY}-{YYYY+1}.aspx` | high (real capture) |
| Silks image | `https://racingaustralia.horse/JockeySilks/{id}.png` | high |

**Not available here:** odds/markets (RA publishes none — the only prices are historical fluctuations/SP inside form lines and SP on results),
sectional times beyond "Last 600m" (race) and "(600m 34.95)" (per run line), stewards' reports, speed maps, news/rumours. Cross-verify those
from TAB / racing.com / Sportsbet / news sources.

---

## 1. Evidence base

| # | Repo / file (read in full unless noted) | What it proves | URL |
|---|---|---|---|
| E1 | `thumentianlu1993-blip/Umanewsbot` — `server/stable/fixtures/australia/ra_results_2025-10-25_thevalley.html` | **REAL** whole-meeting `Results.aspx` HTML (4 races kept) | https://github.com/thumentianlu1993-blip/Umanewsbot/blob/main/server/stable/fixtures/australia/ra_results_2025-10-25_thevalley.html |
| E2 | same — `ra_results_2025-11-04_flemington.html` | **REAL** "not currently available" page | https://github.com/thumentianlu1993-blip/Umanewsbot/blob/main/server/stable/fixtures/australia/ra_results_2025-11-04_flemington.html |
| E3 | same — `wayback_ra_results_2025-10-18_caulfield.html` | **REAL** Results race (Wayback 2025-10-23) | https://github.com/thumentianlu1993-blip/Umanewsbot/blob/main/server/stable/fixtures/australia/wayback_ra_results_2025-10-18_caulfield.html |
| E4 | same — `ra_group_listed_2025-2026.html`, `ra_group_listed_404.html` | **REAL** Group/Listed table + 404 | https://github.com/thumentianlu1993-blip/Umanewsbot/blob/main/server/stable/fixtures/australia/ra_group_listed_2025-2026.html |
| E5 | same — `runtime/tools/prepare_racing_australia_race_detail_candidates.py`, `server/stable/test_australia_race_details.py`, `docs/race_calendar_source_registry.md`, `runtime/tools/prepare_racing_australia_graded_catalog.py` | Results parser (header aliases, finish codes DQ/SB/FF/LR, retention window), UA used, Group/Listed table validation | https://github.com/thumentianlu1993-blip/Umanewsbot/blob/main/runtime/tools/prepare_racing_australia_race_detail_candidates.py |
| E6 | `agends-afk/KaiYingWinning` — `supabase/functions/kyw-sync/ra.js` (+ `index.ts`, `README.md`) | Production regex parser of `Form.aspx` (every class name, run-line grammar, record strings), calendar `matchKey`, headers, robots note | https://github.com/agends-afk/KaiYingWinning/blob/8448a8440e55e47463191fac1e5aa347d3bce4b6/supabase/functions/kyw-sync/ra.js |
| E7 | `Kelvin1761/Kelvin-Agents` — `.agents/skills/au_racing/ra_fields.py` | Calendar discovery (quote styles), `Acceptances.aspx` column names incl. `Hcp Rating`, `Scratchings.aspx` grammar, curl_cffi, 6 s delay, live-tested 2026-08 | https://github.com/Kelvin1761/Kelvin-Agents/blob/main/.agents/skills/au_racing/ra_fields.py |
| E8 | `desscartes/horseride` — `server/australian-form.mjs`, `australian-results.mjs`, `collect-australian-form.mjs`, tests | cheerio selectors for Form/AllForm & Results, `AllForm.aspx?...&recentForm=N`, human-verification interstitial text, trial/jump-out prefixes | https://github.com/desscartes/horseride/blob/main/server/australian-form.mjs |
| E9 | `RatterAU/Bookie` — `Sources/BookieCore/RacingAustraliaFeed.swift`, `Sources/bookie-check/main.swift` | `/ozracing/Acceptances.aspx`, three publication variants, Key qualifiers, "not currently available", "TAB MEETING", silks/time regexes, time zones, live 2026-07-21 | https://github.com/RatterAU/Bookie/blob/main/Sources/BookieCore/RacingAustraliaFeed.swift |
| E10 | `SteamatipAi/SteamatipAi` — `app/src/main/java/com/steamatipai/network/ScrapingService.kt`, `NetworkConfig.kt` (grep + sections) | `Form.aspx?...&recentForm=Y`, `HorseFullForm.aspx` param list, `table.interactive-race-fields`, `Premierships.aspx` params/columns, headers | https://github.com/SteamatipAi/SteamatipAi/blob/master/app/src/main/java/com/steamatipai/network/ScrapingService.kt |
| E11 | `RyzyO/tmstipping` — `tests/ra-silks.test.js`, `admin-dark-script.js` (grep) | HTML trimmed from a REAL Rosehill 2026-08-29 `Form.aspx` (race-title-spacer, relative hrefs, horse-gear span, entities), Key builder | https://github.com/RyzyO/tmstipping/blob/f8d5310d1155369a7e1a4d69c0bbf12d633cbf7f/tests/ra-silks.test.js |
| E12 | `brettanthonysjoberg179-lab/mcp-server-agents-aus` — `servers/trifecta-racing-mcp-agent.js` | `Calendar_Results.aspx` row parsing, `extractLabel()` for `Track Name/Type/Condition/Time/Last 600m/Timing Method/Rail Position/Weather/Results Last Published`, rolling-window warning | https://github.com/brettanthonysjoberg179-lab/mcp-server-agents-aus/blob/main/servers/trifecta-racing-mcp-agent.js |
| E13 | `brettanthonysjoberg179-lab/fair-dinkum-press` — `docs/reports/race_results_2026_09_30.md` | Real venue spellings in Results keys (`Rosehill%20Gardens`, `Sportsbet-Ballarat`, `Doomben`, `Geraldton`, `Balaklava`) | https://github.com/brettanthonysjoberg179-lab/fair-dinkum-press/blob/main/docs/reports/race_results_2026_09_30.md |
| E14 | `Tudman/ml_horses` — `scraper/nightly_race_data_main.py` (2013, `risa.com.au` era) | `div.race-venue-bottom > div.col1/div.col2/div.comments` labels, `Calendar_Results` "Available Now" links, `&BodyClass=PrintFriendly`, `e` emergency suffix, Results race-info label order | https://github.com/Tudman/ml_horses/blob/master/scraper/nightly_race_data_main.py |
| E15 | `WhoKnowsGroup/WKG-Scarp` — `RAHorseDataScrapper.java` (2016) | `HorseFullForm.aspx` structure: 2× `table.horse-search-details`, `h2.first`, row order (status, owner, embargoes, vaccination, gear, trainer, stats) | https://github.com/WhoKnowsGroup/WKG-Scarp/blob/dc966ca4af4bb9fdcc37780cfaa0b2231dec9683/src/main/java/com/webscrapper/batch/RAHorseDataScrapper.java |
| E16 | `Kohdepitcher/RacesListCountDown` — `MeetingCreator.swift`, `MeetingDetailViewModel.swift`, `MeetingBrowserViewModel.swift` | Mobile mirror `m.racingaustralia.horse/FreeFields/{Calendar,Acceptances}.aspx`, `,Trial` qualifier, QLD venues | https://github.com/Kohdepitcher/RacesListCountDown/blob/ce0b17003e9800b929e473aff9d953d0b46dc724/RacesListCountDown/MeetingCreator.swift |
| E17 | `JanamJonchhe/race-predictor` — `src/download_rnsw.py`; `bmck0592-alt/multi-eng` — `ben/Royalpast.py`; `lifebloods/test1` — `app` | NSW mirrors `mdata.racingnsw.com.au` / `racing.racingnsw.com.au` serving the same `/FreeFields/*` pages (`Calendar_Results`, `Calendar_Meetings.aspx?date=01/MM/YYYY`, `StageMeeting.aspx`, `Scratchings.aspx`) | https://github.com/JanamJonchhe/race-predictor/blob/f234fb7c512837bd64d7369d1afb9ab4e94e819a/src/download_rnsw.py |
| E18 | `equinegpt/tips-results-service` — `app/daily_generator.py` | `RaceProgram.aspx?Key=` URL used as a race "url" field | https://github.com/equinegpt/tips-results-service/blob/main/app/daily_generator.py |
| E19 | Search-engine index of live pages (titles/snippets only): `Calendar.aspx?State=VIC` ("RACE FIELDS & FORM - Victoria", columns nominations/weights/acceptances/gear/scratchings); `Form.aspx?Key=2026Oct24%2CVIC%2CFlemington` (runner entries with trainer, jockey, weight, barrier, career record, prize money); `RaceProgram.aspx?Key=2025Apr25%2CVIC%2CFlemington` ("Rail Position: True Entire Circuit", Good 4, Turf); `Form.aspx?...&recentForm=Y`; `GearChanges.aspx?Key=2026Jun01%2CNSW%2CWarren` etc.; `Results.aspx?Key=2025Dec26,VIC,Drouin,Picnic`; `Acceptances.aspx?Key=2024Nov30%2CWA%2CAscot` ("not available"); `ScratchingReleaseInformation.aspx`; `InteractiveForm/HorseFullForm.aspx?HorseCode=...` ("Career summary: 11-1:4:2 Prizemoney: $176,585"); `SearchServices/HorseSearch.aspx`; Wikipedia citations of `FreeFields/RaceHistory.aspx` | page existence, titles, a few label strings | https://www.racingaustralia.horse/FreeFields/Calendar.aspx?State=VIC |

---

## 2. Hosts, mirrors, transport

| Item | Value | Conf. | Evidence |
|---|---|---|---|
| Canonical host | `https://www.racingaustralia.horse` (also serves without `www.`) | high | E6 E7 E9 E12 |
| Mobile mirror | `https://m.racingaustralia.horse/FreeFields/...` (same pages) | medium | E16 |
| Racing NSW mirrors (byte-identical app) | `https://racing.racingnsw.com.au/FreeFields/...`, `https://mdata.racingnsw.com.au/FreeFields/...`, `.../InteractiveForm/...` | high | E11 E15 E17 |
| Legacy hosts | `risa.com.au/FreeFields/...` (2013) — treat as dead | low | E14 |
| Technology | Classic ASP.NET WebForms (`.aspx`, ASP.NET 404 page "Server Error in '/' Application."), server-rendered tables, no JSON API discovered anywhere on GitHub | high | E4 |
| Method / auth | `GET`, no cookies, no auth, no API key. HTML, UTF-8 | high | all |
| Robots | KaiYingWinning README: "the site's robots file asks automated agents to keep out of Free Fields, and the licence question was put to the owner before this was built" → respect low frequency; RaceLens runs on the user's own machine for personal research | medium | E6 README |
| Copyright | Each state section prints a notice, e.g. "VIC racing materials, including fields, form and horse racing results, is subject to copyright which is owned by RVL and other parties working with it" (SA: Racing SA). Don't republish raw pages | high | E19 |

### 2.1 Headers that work

All of these were used successfully against the live site in 2026:

```http
GET /FreeFields/Form.aspx?Key=2026Oct24%2CVIC%2CFlemington HTTP/1.1
Host: www.racingaustralia.horse
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15
Accept: text/html,application/xhtml+xml
Accept-Language: en-AU,en;q=0.9
```
- Bookie (Swift URLSession, Safari UA, the three headers above): "Verified live 2026-07-21: plain URLSession/curl is served fine — RA is NOT bot-walled the way TAB is" (E9, high).
- Kelvin: `curl_cffi` `impersonate="chrome120"`, `delay ≥ 2 s` (default **6 s**), rejects bodies `< 5000` bytes, **no retry on non-200**; "RA 冇封過我哋" = RA has never blocked us (E7, high).
- Umanewsbot: honest bot UA `umanewsbot/1.0 (+https://umafans.run; low-frequency race detail import)`, plain HTTPS, 2026-09-27 captures succeeded (E5, high).
- SteamatipAi: Chrome/91 UA + `Accept`, `Accept-Language: en-US,en;q=0.5`, `Upgrade-Insecure-Requests: 1` (E10).
- kyw: Safari UA + `Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.8`, `redirect: follow` (E6).

### 2.2 Failure modes to handle

| Symptom | Meaning / handling | Conf. | Evidence |
|---|---|---|---|
| HTTP 200, body contains **"not currently available"** (Results: "Results for this meeting are not currently available."; Acceptances: "acceptances are not available for that meeting"; Birdsville gear: "gear-change data is unavailable"), or body `< 400` chars | Stage not published yet **or** fell out of retention. Not an error — mark "not yet"/"expired" | high | E2 E9 E19 |
| Results retention | Results pages stay ~**11 months**; `Calendar_Results.aspx` lists a rolling window (~3 months per trifecta warning). Older → fixture E2 page | medium | E5 registry, E12 |
| Human-verification interstitial | horseride treats a body matching `/Are you human\?\|let us know that you are not a robot/i` as `official_source_human_verification_required` and records `blocked_by_source_verification` to stop automatic retries → **detect and back off for hours**, never loop | medium | E8 |
| HTTP 404 ASP.NET page | Unknown season/route (e.g. `Group_ListedRaceDates/2026-2027.aspx` before July) | high | E4 |
| Small body (< 5000 B) on a page that should be big | treat as failure, retry later | medium | E7 |
| Quote-style differences | VIC calendar emits `href='…'`, NSW `href="…"`; Form page mixes `class='raceNum'` and `class="horse-number"` → **regexes must accept both quotes** | high | E7 E6 E11 |

### 2.3 Rate limiting policy that community code converged on

- Fetch each **state calendar at most every 6 h** (its URL never changes but its content moves daily — Kelvin's cache bug froze 7 states on a stale day) (E7).
- `Form.aspx` **once per meeting per day** (870 KB) and cache; `Acceptances.aspx` permanently cacheable once published; `Scratchings.aspx` **never cache** (force refetch); Results after each race (E7 E9 E6).
- 1 request every 2–6 s, sequential, 3 retries with 400 ms·n backoff and 20 s timeout (E9) — kyw calls its footprint "a few page views a day".

---

## 3. The meeting `Key` and the calendar

### 3.1 Key grammar (high)

```
Key = <YYYY><Mon><DD> "," <STATE> "," <Venue> [ "," <Qualifier> ]
<Mon>       = Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec        (title case)
<DD>        = zero-padded day                                           ("2026Oct05")
<STATE>     = NSW|VIC|QLD|SA|WA|TAS|ACT|NT
<Venue>     = RA's venue spelling INCLUDING sponsor words and spaces/hyphens
<Qualifier> = Trial | Picnic                                            (barrier-trial meetings; picnic meetings)
```
Examples seen in code/URLs: `2026Oct24,VIC,Flemington` · `2025Oct25,VIC,The Valley` · `2025Oct18,VIC,Caulfield` · `2026Sep30,NSW,Rosehill Gardens` ·
`2026Sep30,VIC,Sportsbet-Ballarat` · `2025Aug27,VIC,Sportsbet Sandown Hillside` · `2026Jun26,NSW,Tamworth` · `2026Aug05,NSW,Canterbury Park` ·
`2026Jul21,NSW,Warren,Trial` · `2026Jul25,NSW,Trangie,Picnic` · `2025Dec26,VIC,Drouin,Picnic` · `2024Nov30,WA,Ascot` · `2021Jul25,QLD,Rockhampton[,Trial]`.
Parsers: kyw `parseKey` `/^(\d{4})([A-Z][a-z]{2})(\d{2}),([A-Z]+),([^,]+)(?:,(.+))?$/` (E6); Bookie `Key.parse` with `qualifier` (E9); Kelvin `ra_date()` (E7).

Encoding: the server accepts the raw comma and space, `%2C`, `%20` and `+` interchangeably (`Key=2026Oct24%2CVIC%2CFlemington`, `Key=2025Oct25,VIC,The%20Valley`,
`Key=2026Jul21%2CNSW%2CTaree`) (high — E6 E10 E11 E13). Note the `ozracing` page uses lower-case `key=` (E9).

**Venue spelling is the trap**: `Canterbury Park` not `Canterbury`, `Southside Cranbourne`, `bet365 Traralgon`, `Ladbrokes Geelong`, `Royal Randwick`, `Rosehill Gardens`,
`The Valley` (not Moonee Valley), `Sportsbet-Ballarat` (hyphen), `Sportsbet Sandown Hillside`, `Ladbrokes Pioneer Park`. Discover it from the calendar and match by token
overlap after dropping sponsor/filler tokens (`park, racecourse, the, racing, club, gardens, royal`, sponsor names) — kyw `matchKey` scoring (E6) and Kelvin
`matches_venue` substring rule (E7). Persist the exact Key once matched.

### 3.2 `Calendar.aspx?State=XX` (meetings list, one per state)

- URL: `GET /FreeFields/Calendar.aspx?State={STATE}`; also `?Date=YYYYMonDD` is attempted by SteamatipAi (low). Title (VIC): "RACE FIELDS & FORM - Victoria" (E19).
- Content (indexed snippet): a table of upcoming/recent meetings with **columns for nominations, weights, acceptances, gear, and scratchings** (plus form/results links as the
  meeting advances). The only contract every parser relies on: anchors `href=["']/FreeFields/(Nominations|Weights|Acceptances|GearChanges|Scratchings|Form|Results|RaceProgram)\.aspx\?Key=…["']`
  (E6 E7 E9 E10). A meeting appears **only in its own state's calendar** → loop all 8 states (E9 E7).
- Parsing recipe: collect unique Keys per date; drop `,Trial` unless wanted (Bookie drops trials; Kelvin drops `Trial`; trifecta drops `/trial|jumpout/`); keep `,Picnic` (bettable).

### 3.3 `Calendar_Results.aspx?State=XX` (results list) and NSW-mirror extras

- `GET /FreeFields/Calendar_Results.aspx?State={STATE}` → rows with `<a href="/FreeFields/Results.aspx?Key=…">Available Now</a>` (link text per 2013 code E14; 2026 trifecta reads
  `cells[1]` meeting text, `cells[2]` availability) (medium). Rolling window (E12).
- NSW mirror only (evidenced there): `Calendar_Meetings.aspx?date=01/MM/YYYY` monthly diary with `StageMeeting.aspx?Key=` (redirects to the current stage) and `Results.aspx?Key=` links (E17, medium).
- `StageMeeting.aspx?Key=…` — "stage router"; tmstipping falls back from it to `Acceptances.aspx` when no runners are found (E11, medium).

### 3.4 Publication stages (what exists when)

`Nominations → Weights → Acceptances (+ GearChanges, Scratchings) → Form → Results`. Nominations ~4–5 days out, acceptances ~2 days out (metro), Form published with/after
acceptances, Results progressively on race day (from memory, **low**; verify with the calendar's link set). `ScratchingReleaseInformation.aspx` lists per-state scratching deadline
times (E19).

---

## 4. `Form.aspx?Key=…` — the race card + full form (primary page)

`GET /FreeFields/Form.aspx?Key=2026Oct24,VIC,Flemington` (~870 KB, all races). Variants: `&recentForm=Y` (SteamatipAi, tmstipping; believed to limit run lines to recent
starts — **medium**), `/FreeFields/AllForm.aspx?Key=…&recentForm=N` (horseride: full form, **medium**), `&BodyClass=PrintFriendly` (Bookie: "same bytes again, print CSS", **high**).
The `MeetingCode=` variant named in the task brief was **not found in any code or index — low/unverified**; the evidenced print variant is `BodyClass=PrintFriendly`.
Fixture: `Form.aspx-flemington-2026-10-24-constructed.html` (parses with the unmodified kyw `ra.js`, see §12).

### 4.1 Page skeleton (document order)

```
div.page-content
  div.top
    h2  "<Venue>: <Club name>"  > span.race-venue-date "Saturday, 24 October 2026"      (E1 E3 E8: date format "%A, %d %B %Y")
    span.meeting-type "Meeting Type: Metro (TAB MEETING)"                               (E1; "TAB MEETING" absent on non-TAB bush meetings — E9)
    div.printer-friendly > a[href="?Key=2026Oct24,VIC,Flemington&BodyClass=PrintFriendly"]   (E1 E3)
  div.race-venue-bottom                                                                 (single-quoted class; E6 regex /<div class='race-venue-bottom'>([\s\S]*?)<div class='comments'>/)
    div.col1  <b>Rail Position:</b> … <b>Track Condition:</b> … <b>Track Type:</b> … <b>Weather:</b> … <b>Penetrometer:</b> …   (E14 2013 labels; kyw reads Rail Position / Track Condition / Weather from the text — E6)
    div.col2  <b>… Last Published:</b> …                                                 (E14: "Results Last Published:" on Results; E12 extractLabel "Results Last Published")
    div.comments  free text (track upgrades/downgrades, rail notes)                      (E6 E14)
  -- per race --
  a[name="Race1"]  (+ div.race-title-spacer — E11)
  table.race-title            (width=750 border=0 cellspacing=0 cellpadding=5 class="race-title")
     tr > th > span.raceNum "Race 1"  " - 12:40PM Maribyrnong Trial Stakes (1000 METRES)"  span.localtimedisplayed "Times displayed in local time of Race Meeting"
     tr.race-info > td  "<b>Of $200,000.1st $120,000, 2nd $36,000, …</b><br>Prize money contribution totalling 3.5% … prior to distribution LISTED<br>Set Weights, Two-Years-Old, Apprentices cannot claim.<br>…<b>Track Name:</b> Main <b>Track Type:</b> Turf<br>Field Limit: 16 + 4 EM"
  table.race-strip-fields     (summary strip)  th: No. | Last 10 | Horse | Trainer | Jockey | Barrier | Weight | Penalty | Hcp Rating   (td classes no / last / horse / trainer / jockey / penalty / hcp — E6 reads by class)
     tr.OddRow | tr.EvenRow  [ + " Scratched" ]     (single-quoted class attr on this page — E6 /<tr class='(?:Odd|Even)Row[^']*'>/)
  table.horse-form-table  × runners   (exact opening tag `<table border="0" cellspacing="0" cellpadding="0" class="horse-form-table">` — kyw splits on it, E6)
     div.Silks > img[src="https://racingaustralia.horse/JockeySilks/64092.png" width=46 height=60]            (E9 E11)
     div.horse-info
        span.horse-number "1"                                                                                    (E6 E8 E9 E11)
        span.horse-name > a.GreenLink[href="../InteractiveForm/HorseFullForm.aspx?horsecode=…&stage=Form&Key=…&src=horseform&raceentry=…"] "TRUE LINE"   (relative ../ path — E1 E11; <s> strike-through + "Scratched" note when scratched — sibling fixture, medium)
        span.horse-gear "(Blks)"                                                                                 (E11; abbreviations of gear carried — medium)
        span.plain "2 year old bay colt (male) <a.GreenLink>SNITZEL</a> x <a.GreenLink>STRAIGHT LINE</a> (<a.GreenLink>REDOUTE'S CHOICE</a>)<br>Owners: …<br>Colours: …<br>Gear Changes: Blinkers FIRST TIME"
                 → age, colour, sex (kyw /(\d+)\s+year old\s+([a-z ]+?)\s+(colt|gelding|mare|filly|horse|stallion|rig)/i); sire, dam, damsire = the ONLY three a.GreenLink in span.plain (E8 reads parents[0..2]); "Gear Changes:" line (E6)
     <b>Trainer:</b> <a.GreenLink[TrainerLastRuns.aspx?trainercode=…&trainername=…]>Ciaron Maher</a> (Ballarat)   <b>Jockey:</b> <a.GreenLink[JockeyLastRuns.aspx?jockeycode=…]>Jamie Kah 58kg</a>   <b>Barrier:</b> 4      (E6 regex; stable town in parentheses; apprentice claim appears as "Celine Gaudray 59.5kg (a2)")
     <b>Record:</b> 4:3-1-0 <b>1st Up:</b> 1:1-0-0 <b>2nd Up:</b> 1:0-1-0 <b>Track:</b> 1:1-0-0 <b>Dist:</b> 2:2-0-0 <b>Track/Dist:</b> 1:1-0-0 <b>Firm:</b> 0:0-0-0 <b>Good:</b> 3:2-1-0 <b>Soft:</b> 1:1-0-0 <b>Heavy:</b> 0:0-0-0 <b>Synthetic:</b> 0:0-0-0 <b>Prizemoney:</b> $212,400   (E6 labels, E10 "1st Up:" regex)
     table.horse-last-start > tr.OddRow|EvenRow > td.Pos "2 of 10" | td.remain "<run line>"     (single-quoted classes — E6 /<td class='Pos'>/ ; E8 td.Pos/td.remain)
```
Record strings everywhere are `starts:wins-seconds-thirds` (`"21:6-4-3"`) (E6 E8 E10, high).

### 4.2 Run line grammar (td.Pos + td.remain) — high (E6 regex + E10 real text sample + E8 selectors)

```
td.Pos    :=  [ <font color="#ff0000">T</font> | J ]  <pos> " of " <fieldSize>        T = barrier trial, J = jump-out (horseride: kind trial/jump_out; kyw: trial flag)
td.remain :=  <b><a href="Meeting.aspx?racecode=…">VENUECODE DDMonYY</a></b> " " <dist>m " " <cond> " " <class> " $"<prize> [" ($"<prizeWon>")"] " " <a JockeyLastRuns>Jockey</a> " " <wt>kg [" (cd "<carried>"kg)"] " Barrier " <n>
              <br>
              "1st " <winner> " " <wt>kg ", 2nd " <second> " " <wt>kg [", 3rd " <third> " " <wt>kg] " " <m:ss.hh> " (600m " <ss.hh> "), " <margin>"L, " <p>"th@800m, " <p>"th@400m, " $o/$o/$o/$sp["F"|"EF"]
```
Real example (from SteamatipAi's debug comment, HorseFullForm variant): `7th of 11 BRAT 29Jun25 1500m Soft7 MDN-SW $37,500 ($750) John Allen 57.5kg Barrier 7 1st Tassron 59.5kg, 2nd Autumnheat 59.5kg 1:34.04 (600m 36.89), 7.9L, 5th@800m, 6th@400m, $10/$16/$15/$16`.
kyw's example: `KENS 14Jan26 1150m Soft5 SUPER MDN-SW $100,000 ($9,750) Tim Clark 57kg (cd 55kg) Barrier 5 … 1st Gorgeous 55.5kg, 2nd Let's Go Barbie 54kg 1:07.88 (600m 34.95), 0.65L, 2nd@800m, 2nd@400m, $4.80/$4.40/$4.20/$4`.
Semantics: `cond` is `Good4|Soft5|Heavy8|Firm2|Synth…` (no space, cf. "Good 4" elsewhere); time is the **winner's** time (horseride: "never assume it is this runner's time"); `(600m ..)` is the race's last 600 m; the price list is opening→SP flucs with the last being SP; `EF` = equal favourite; `(cd 55kg)` = carried weight after apprentice claim; prize `$0` and `0kg` for trials; venue codes are RA abbreviations (`FLEM`, `CAUL`, `MV`, `SAND`, `RAND`, `KENS`, `BRAT`, `W FM`, `GEEL`, `BDGO`, `PAKE`, `CRAN`).

### 4.3 Strip table (per race summary) — medium/high

`table.race-strip-fields` on Form/Acceptances: `td.no` saddlecloth (may carry `e` = emergency — E7 regex `(\d+)(e?)`, E14), `td.last` "Last 10" form figures
(`x` = spell, `-` = season break; e.g. `3x12104`, `0x4421`), `td.hcp` official handicap rating (blank for maidens), `td.penalty` (e.g. `1.5kg`), `tr … Scratched` class marks
scratchings (E6 reads `/Scratched/i` in the first 60 chars of the row). Acceptances column set (Kelvin header names): `No | Horse | Trainer | Jockey | Barrier | Weight | Probable Weight | Penalty | Hcp Rating | Last 10` (E7, high for names).

### 4.4 Normalised card record (what RaceLens should emit from Form.aspx)

```ts
type RAMeeting = { key: string; date: 'YYYY-MM-DD'; state: 'VIC'|…; venue: string; club?: string; meetingType?: string; tabMeeting: boolean;
  rail?: string; trackCondition?: string; trackType?: 'Turf'|'Synthetic'|…; weather?: string; penetrometer?: number; comments?: string; lastPublished?: string; races: RARace[] };
type RARace = { number: number; advertisedStartLocal: 'h:mmAM'; name: string; distanceM: number; prizeTotal: number; prizeByPlace: Record<string,number>;
  grade?: 'GROUP 1'|'GROUP 2'|'GROUP 3'|'LISTED'|null; conditions: string; trackName?: string; fieldLimit?: string; runners: RARunner[] };
type RARunner = { saddlecloth: number; emergency: boolean; scratched: boolean; name: string; country: string|null; horsecode: string; raceentry: string;
  silksId: string|null; age: number; colour: string; sex: 'colt'|'gelding'|'mare'|'filly'|'horse'|'stallion'|'rig'; sire: string; dam: string; damsire: string;
  owners?: string; gearCarried?: string; gearChanges: string; trainer: string; trainercode: string; stable: string; jockey: string; jockeycode: string;
  apprenticeClaimKg?: number; weightKg: number; barrier: number|null; last10: string; hcpRating: number|null; penalty: string;
  record: Record<'career'|'firstUp'|'secondUp'|'track'|'dist'|'trackDist'|'firm'|'good'|'soft'|'heavy'|'synthetic', [starts,wins,seconds,thirds]>; prizemoney: number; runs: RARun[] };
type RARun = { kind: 'race'|'trial'|'jumpout'; position: number; fieldSize: number; venueCode: string; date: 'YYYY-MM-DD'; distanceM: number; condition: string; class: string;
  prize: number; prizeWon: number|null; jockey: string; weightKg: number; carriedKg: number|null; barrier: number|null; first: string; second: string|null; third: string|null;
  winnerTimeS: number|null; last600S: number|null; marginL: number|null; posAt800: number|null; posAt400: number|null; prices: number[]; sp: number|null; equalFav: boolean };
```
`parsed/Form.aspx-flemington-2026-10-24.parsed-by-kyw-ra.json` shows the real kyw output for the fixture (its `rec` arrays are `[starts, wins, placings]`).

---

## 5. `Acceptances.aspx`, `/ozracing/Acceptances.aspx`, `Nominations.aspx`, `Weights.aspx`

| Page | URL | Shape | Conf. |
|---|---|---|---|
| Styled acceptances (~125 KB) | `GET /FreeFields/Acceptances.aspx?Key=…` | same `div.top` + `race-venue-bottom` header; per race `table.race-title` (header row text `Race N - h:mmAM Name (D METRES)`, info row `Of $…` + conditions incl. `Group 1-3`/`Listed`) then a runner table whose header row contains the text **`Hcp Rating`** with columns `No, Horse, Trainer, Jockey, Barrier, Weight, Probable Weight, Penalty, Hcp Rating, Last 10` | high (E7 live 2026-08; classes medium) |
| Bare acceptances (~22 KB) | `GET /ozracing/Acceptances.aspx?key=…` | `<title>TAREE Acceptances on Tuesday 21st July, 2026</title>`, `<h2>` same, text `TAB MEETING.&nbsp;&nbsp;Rail: +3m Entire`, per race `<tr><td>1-12.55</td><td width=70%>RACE NAME</td><td align=right>2018 M</td></tr>` (**12-hour clock without AM/PM**), prize line `Of $27000.  CLASS 1. Set Weights.`, runner table `No. | Horse | Trainer | Jockey | Barr | Wgt | Pen | RTG` with RTG `(41)`. No silks, no scratchings | medium (E9 transcription) |
| Print variant | `…&BodyClass=PrintFriendly` | identical data | high (E9 E1) |
| Nominations / Weights | `GET /FreeFields/Nominations.aspx?Key=…`, `GET /FreeFields/Weights.aspx?Key=…` | exist (calendar links, E9 sample); shape assumed like Acceptances without barrier/jockey (nominations) — **low** | low |
| Race program | `GET /FreeFields/RaceProgram.aspx?Key=…` | exists; indexed snippet shows rail/track header; equinegpt uses it as the race URL | medium (exists) / low (shape) |

Kelvin's live measurement: 86.2% of runners had an official `Hcp Rating` (maidens/unrated blank) (E7). The Acceptances page is the right place for **probable weight** and **penalty**.
Bookie resolves the oz page's meridiem: first race is AM only if its hour reads 7–11, then flips to PM once a time would go backwards, never flips back (E9).

---

## 6. `Scratchings.aspx` and `GearChanges.aspx`

- `GET /FreeFields/Scratchings.aspx?Key=…` — Kelvin grammar (E7, medium): rows with ≤3 cells containing `Race N` start a race; runner rows have ≥2 cells with `cells[1]` like
  `6 BLENHEIM GIRL (5/8 0728)` → regex `^\s*(?P<no>\d+)(?P<em>e?)\s+(?P<horse>.+)`, strip the trailing parenthesis (scratching time stamp, meaning unverified) and the country suffix.
  Page text also carries `Track Condition:` (lifebloods reads it) (E17). Late scratchings after the page is read are also printed on Results in `Official Comments`
  (`Late Scratching (Tropicus) $5.50 @ 4:11 PM. Deductions in $: Win $0.13 & Place $0.12 …`) (E1, high).
- `GET /FreeFields/GearChanges.aspx?Key=…` — exists (E19, five indexed meetings); lists runners by number with equipment changes; no public parser → fixture is **low** confidence.
  The reliable place for gear changes is the per-runner `Gear Changes:` line inside Form.aspx (E6, high). Vocabulary: `Blinkers FIRST TIME`, `Blinkers OFF FIRST TIME`, `Tongue Tie FIRST TIME`,
  `Cross-over Nose Band FIRST TIME`, `Ear Muffs (Pre-Race Only)`, `Winkers`, `Visors`, `Lugging Bit`, `Nose Roll`, `Pacifiers`, `Nil` (standard stewards wording; medium).

---

## 7. `Results.aspx?Key=…` — official results (high; from the real captures E1 E3)

One page per meeting, every race. Fixture `Results.aspx-REAL-thevalley-2025-10-25.html` + normalised JSON.

```
div.page-content > div.top > h2 "The Valley: Moonee Valley Racing Club" + span.race-venue-date "Saturday, 25 October 2025" ; span.meeting-type "Meeting Type: Metro (TAB MEETING)" ; div.printer-friendly
-- per race --
table.race-title (width=750 border=0 cellspacing=0 cellpadding=5)
  tr > th > span "Race 8 - 4:10PM Cirka McEwen Stakes (1200 METRES)"  + span.localtimedisplayed      (NO span.raceNum on Results; Umanewsbot regex ^Race\s+(\d+)\s*-\s*(?:(\d{1,2}:\d{2}\s*[AP]M)\s+)?(.*?)\s*(?:\((\d+)\s*METRES\))?$)
  tr > td   <b>Of $300,000.1st $180,000, 2nd $54,000, 3rd $27,000, …</b><br>Prize money contribution totalling 3.5% … prior to distribution GROUP 2<br>Standard Weight for Age, Three-Years-Old and Upwards, Apprentices cannot claim.<br>[This race carries a $10,000 Nominator Bonus only for qualified horses.<br>]<br>
            <b>Track Name:</b> Main <b>Track Type:</b> Turf  <b>Track Condition:</b> Good 4 <b>Time:</b> 1:09.91 <b>Last 600m:</b> 0:34.81 <b>Timing Method:</b> Electronic
            [<br><br><b>Official Comments:</b> Late Scratching (Tropicus) $5.50 @ 4:11 PM. Deductions in $: Win $0.13 & Place $0.12 for 1st, … | Original 4th placegetter (Major Share) Disqualified AR 240 (Original Margin 4.35L)]
table.race-strip-fields (width=750 border=0 cellpadding=3 cellspacing=0)
  th.no "Colour" | th "Finish" | th "No." | th "Horse" | th "Trainer" | th "Jockey" | th "Margin" | th "Bar." | th "Weight" | th "Penalty" | th "Starting Price"     (11 columns; Umanewsbot aliases: finish, no., horse, trainer, jockey, margin, bar., weight, penalty, starting price)
  tr.EvenRow | tr.OddRow [ + " Scratched"]         (DOUBLE-quoted class attr on this page)
    td > img.minimizeStyle[src="https://www.racingaustralia.horse/JockeySilks/90159.png"]      (+ an HTML comment with a second <img> — strip comments before regexing: E12 does)
    td > span.Finish.F1 "1" | span.Finish.FDQ "DQ" | span.Finish.FSB "SB" | (empty td for scratched)
    td "7"                              saddlecloth (text-align:center)
    td.horse > a.GreenLink[href="../InteractiveForm/HorseFullForm.aspx?horsecode=Mzg1NTc3NDMxMjA%3d&stage=Results&Key=2025Oct25,VIC,The Valley&src=horseform&raceentry=MTExNTAyNjEzMDcw"] "BEAST MODE" ; span[style=float:right] (optional img.NewVobisLogo title="VOBIS Silver Bonus Scheme")
    td.trainer > a.GreenLink[href="../InteractiveForm/TrainerLastRuns.aspx?trainercode=NTE3MTA1MjE1MA%3d%3d&trainername=Ben%2c+Will+%26+JD+Hayes"] "Ben, Will & JD Hayes"
    td.jockey  > a.GreenLink[href="../InteractiveForm/JockeyLastRuns.aspx?jockeycode=MTY3NTY3OTQw"] > span.Hilite "Craig Williams"      (apprentice: "Logan Bates (a)")
    td "1.5L"   margin to the horse in front/winner (blank for winner; "0.35L", "10.21L")
    td "4"      barrier ("0" on scratched rows)
    td "53kg"   weight ("58kg (cd 56kg)" when a claim was taken — E8 test; blank on scratched rows except SB which keeps it)
    td ""       penalty
    td "$2.40F" starting price: "$3", "$7.50", "$1.90F" (favourite), "$4EF" (equal fav); blank on scratched rows
```
**Finish codes** (E1 real + E5 tests): numeric = placing; `""` (empty) = scratched (row also has class `Scratched`, barrier `0`, no weight/SP); `SB` = scratched at barrier (class `Scratched`, weight kept);
`DQ` = disqualified (ran, no placing — Official Comments give original placing/margin); `FF` = fell; `LR` = lost rider. Umanewsbot raises on any other code → RaceLens should log-and-skip unknown codes.
Dead-heats share an official position (seen on justhorseracing's mirror of the Melbourne Cup; RA presumably likewise — medium).
Horse names are UPPER CASE with country suffix `(NZ)`, `(GB)`, `(IRE)`, `(USA)`, `(JPN)`, `(FR)`, `(GER)`, `(SAF)`, `(ARG)`, `(BRZ)` (E1 E7 regex) and may contain a raw Unicode apostrophe (`DON’T HOPE DO`, E1) or `&rsquo;` entity (E11).

Identifiers in links (high, from E1): `horsecode`, `raceentry`, `trainercode`, `jockeycode` are **base64 of decimal ids**, URL-encoded with lower-case `%3d` padding
(`Mzg1NTc3NDMxMjA%3d` → `38557743120`). `horsecode` is stable per horse across pages/dates → use it as the RA horse id; `raceentry` is per start. Decoded samples from the real page: horsecode `Mzg0NDA4MjYxMDA%3d`→`38440826100`, raceentry `MTEwMzYwMjQwOTEw`→`110360240910`, trainercode `MTAxNzk3NTYw`→`101797560`, jockeycode `MTUwMTc2MjMwNzQw`→`150176230740`; a scratched runner with **no jockey declared** links `jockeycode=MA%3d%3d` (= `0`) with an empty jockey cell (ZORB, Race 9) — treat id `0` as null.
`trainername` is form-encoded (`Ben%2c+Will+%26+JD+Hayes`). Silks id = `/JockeySilks/(\d+)\.png` (owner colours; same id reused across a stable's runners).

Timing: all times are **local time of the meeting** (`span.localtimedisplayed`). State → IANA zone (Bookie): `QLD→Australia/Brisbane`, `SA→Australia/Adelaide`, `NT→Australia/Darwin`,
`WA→Australia/Perth`, others `Australia/Sydney` (TAS/VIC/ACT/NSW share offsets) (E9, high).

---

## 8. Horse profile, jockey/trainer pages, search

| Page | URL | Shape | Conf. |
|---|---|---|---|
| Horse full form | `GET /InteractiveForm/HorseFullForm.aspx?horsecode={b64}&stage={Form\|Acceptances\|Results}&Key={key}&src=horseform&raceentry={b64}`; legacy `?HorseCode={b64}&src=horsesearch` (works with just `horsecode`) | 2016 (E15): two `table.horse-search-details`; first: `h2.first` name, `<br>` then "…: <foaled>" text; second: rows status (`td>strong`), owner (`td>strong`), stewards embargoes, emergency vaccination record link, last gear change, trainer link, …, a stats row with `<b>` labels followed by text (prize, bonus, max/min dist win, 1st Up, 2nd Up, Firm, Good, Soft, Heavy). 2025 (E10): run history rows in `table.interactive-race-fields` (first row header), row text `7th of 11 BRAT 29Jun25 1500m Soft7 MDN-SW $37,500 ($750) John Allen 57.5kg Barrier 7 1st … (600m 36.89), 7.9L, 5th@800m, 6th@400m, $10/$16/$15/$16` (ordinal position; `T`/`J` prefixes for trials); stats found by regex `1st Up:\s*(\d+):(\d+)-(\d+)-(\d+)` etc. Indexed snippet: "Career summary: 11-1:4:2 Prizemoney: $176,585" | URL high; shape low/medium |
| Horse search | `GET /SearchServices/HorseSearch.aspx` ("designed to provide identification information and brief details"); name availability `/searchservices/horse_name_search.aspx` | ASP.NET WebForms search → expect `__VIEWSTATE` POST; not evidenced in code | low |
| Pretty profile URL `/horse/{name}` (from task brief) | **no code or indexed page found** — treat as unverified; the horse links on every RA page are `HorseFullForm.aspx?horsecode=` | low |
| Jockey recent runs | `GET /InteractiveForm/JockeyLastRuns.aspx?jockeycode={b64}` | shape not read by any parser found | URL high / shape unknown |
| Trainer recent runs | `GET /InteractiveForm/TrainerLastRuns.aspx?trainercode={b64}&trainername={urlenc}` | ditto | URL high / shape unknown |
| Meeting by racecode | `GET /InteractiveForm/Meeting.aspx?racecode={b64}` (target of the venue/date link inside every run line) | past-race results page (horseride uses it as `sourceUrl` for `parseAustralianResultEvidence`, i.e. same `race-title`/`race-strip-fields` tables, header `div.race-venue` "Thursday 17, October 2024") | medium |
| Silk owner lookup | `https://racing.racingnsw.com.au/InteractiveForm/JockeySilkDetails.aspx?ColorID={id}` | sibling research (RyzyO/HorseMatch) | medium |
| Premierships | `GET /FreeServices/Premierships.aspx?State={XX}[&Season=2025&Table=Trainer]` | first table; data rows cells `[name, 1st, 2nd, 3rd, 4th, 5th, prizemoney, strike-rate, starts]` (E10) | medium |
| Group/Listed dates | `GET /arb/Group_ListedRaceDates/2025-2026.aspx` | `table.tableizer-table` with `tr.tableizer-firstrow` header `Meeting Date | R ID | Grp | Grp | State | Club | Venue | PRA Seasonal Race Name | Dist. | Prizemoney | Age | Sex | (type: Hcp/SWP/WFA/SW) | Registered Race Name`; dates `02/Aug/2025`; Grp numeric 1-4,7 and code G1/G2/G3/LR/RL; 404 before ~July for the next season | high (E4) |
| Race history | `GET /FreeFields/RaceHistory.aspx?…` (cited by Wikipedia for Aurie's Star Hcp, Australia Stakes, The Shorts) — parameters unknown | low |

---

## 9. How to satisfy each RaceLens need

1. **Meetings for a date** — fetch 8 × `Calendar.aspx?State=XX` (cache 6 h), regex all `/FreeFields/\w+\.aspx?Key=` hrefs (both quote styles), decode, keep `date == target`, split qualifier,
   return `{key, date, state, venue, qualifier, stageLinks}`. Also fetch `Calendar_Results.aspx?State=XX` for the result-availability flag.
2. **Race card** — `Form.aspx?Key` (once/day) → §4 parser; if not yet published (body "not currently available") fall back to `Acceptances.aspx?Key` (§5) which still gives number,
   name, barrier, jockey, trainer, weight, probable weight, penalty, rating, last-10; then `Scratchings.aspx?Key` every few minutes for `scratched` flags. **Odds: none here.**
3. **Form** — from the same Form.aspx: career record by category, 1st/2nd-up, track/dist/track-dist, surface records, prizemoney, pedigree (sire/dam/damsire), age/sex/colour, owners,
   gear, and every run line (date, venue code, distance, condition, class, prize, jockey, weight/claim, barrier, placings with weights, winner time, last 600 m, margin, 800/400 positions,
   price flucs → SP). Deeper history per horse: `HorseFullForm.aspx?horsecode=` (§8).
4. **Results** — poll `Results.aspx?Key` after each race (page grows race by race; a race is present once its `table.race-title`+`race-strip-fields` appear; "INTERIM"/"FINAL" markers are
   not evidenced on RA — horseride checks for them but they come from other sites; treat presence of placings as interim until a later refetch is unchanged) → §7 parser; late
   scratchings/deductions/DQ from `Official Comments`.
5. **Track condition / rail / weather** — `div.race-venue-bottom` (Form/Acceptances/Scratchings/Results) + per-race `Track Condition:` in each Results `race-title` (can change through
   the day, e.g. upgrades noted in `div.comments`); `Penetrometer:` reading when provided.
6. **Cross-verification joins** — key runners by `(date, venue, raceNumber, saddlecloth)` and confirm by normalised horse name (strip country suffix, apostrophes, case) — RA's `horsecode`
   is RA-specific (not racing.com's `horseCode` nor TAB ids). Official for: fields, barriers, weights, scratchings, results, margins, SP. Use RA + a mirror host (`racing.racingnsw.com.au`)
   as two fetch paths to the same official data for availability, but **count them as one source** in the verification score.

---

## 10. Response shapes — quick reference of exact strings to parse

| Field | Example(s) | Regex / rule |
|---|---|---|
| Meeting date | `Saturday, 25 October 2025` | `%A, %d %B %Y` (E5) |
| Race header | `Race 7 - 3:45PM Schweppes Thousand Guineas (1600 METRES)` | `Race\s+(\d+)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)?\s*(.*?)\s*\((\d+)\s*METRES\)` (E6 E12 E5) |
| Prize line | `Of $1,500,000.1st $900,000, 2nd $270,000, …` | `Of \$([\d,]+)` then `(\d+)(?:st|nd|rd|th) \$([\d,]+)` |
| Grade token | `… prior to distribution GROUP 1` / `LISTED` | `\b(GROUP [123]|LISTED|RESTRICTED LISTED)\b` (Kelvin `Group\s*[123]|Listed` /i) |
| Track line | `Track Name: Main Track Type: Turf  Track Condition: Good 4 Time: 1:37.83 Last 600m: 0:34.95 Timing Method: Electronic` | `extractLabel(label)` = `<b>label:</b>` up to next `<b>`/`<br>` (E12) |
| Condition | `Good 4`, `Soft 5`, `Heavy 8`, `Firm 2`, `Synthetic` (run lines: `Good4`) | `(Firm|Good|Soft|Heavy)\s?(\d)|Synth\w*` |
| Rail | `True Entire Circuit`, `+3m Entire`, `+6m 1000m-400m` | free text after `Rail Position:` / `Rail:` |
| Weight | `56kg`, `59.5kg`, `58kg (cd 56kg)` | `([\d.]+)kg(?:\s*\(cd\s*([\d.]+)kg\))?` |
| Margin | `0.35L`, `10.21L`, `` (winner) | `([\d.]+)L` |
| SP | `$5`, `$1.90F`, `$4EF` | `^\$([\d.]+)(EF|F)?$` |
| Saddlecloth | `3`, `17e` | `(\d+)(e?)` |
| Jockey claim | `Celine Gaudray (a2)`, `Logan Bates (a)` | strip `\s*\([^)]*\)\s*$` for name; capture claim |
| Country | `CHATEAU EZE (GB)` | `\s*\(([A-Z]{2,3})\)\s*$` |
| Record | `21:6-4-3` | `(\d+):(\d+)-(\d+)-(\d+)` |
| Age/sex/colour | `4 year old bay gelding (male)` | `(\d+)\s+year old\s+([a-z ]+?)\s+(colt|gelding|mare|filly|horse|stallion|rig)` |
| Run date | `14Jan26` | `(\d{2})([A-Z][a-z]{2})(\d{2})` → 20YY |
| Codes | `horsecode=Mzg1NTc3NDMxMjA%3d` | URL-decode → base64 → decimal id |

---

## 11. Caveats

- No live fetch was possible from the research container; the Form/Acceptances/Scratchings/Calendar fixtures are constructed. They reproduce what public parsers match, but column
  order on Acceptances, the Scratchings table classes, GearChanges, HorseFullForm and Premierships are **medium-to-low** and must be re-checked against a saved live page.
- The `/horse/{name}` and `Form.aspx?...&MeetingCode=` URLs from the task brief were not found anywhere; the evidenced equivalents are `HorseFullForm.aspx?horsecode=` and `&BodyClass=PrintFriendly`.
- RA publishes **no odds**; SP only after the race, flucs only inside historical run lines.
- Emergency runners: kyw/Bookie regexes assume `\d+` saddlecloths and silently drop `17e` — RaceLens must use `(\d+)(e?)`.
- Attribute quoting is inconsistent across pages (single quotes on Form rows/raceNum/venue-bottom, double on Results rows) — use an HTML parser (cheerio) rather than regexes where possible.
- robots.txt reportedly disallows automated agents on `/FreeFields/` (single second-hand statement). Keep traffic minimal (a handful of pages per meeting per day), identify the client, cache, and surface the copyright notice in the UI.
- Results retention ~11 months; results calendar ~3 months. Historical back-fill beyond that needs another source.
- Verification interstitial ("Are you human?") can appear; detect and stop for hours.

---

## 12. Fixture validation performed (2026-10-23, Node 22.22, cheerio from the repo's node_modules)

All assertions passed (`ALL VALIDATIONS PASSED`):
- Unmodified **KaiYingWinning `ra.js`** `parseForm()` on `Form.aspx-flemington-2026-10-24-constructed.html`: condition `Good 4`, rail `True Entire Circuit`, weather `Fine`; 2 races with
  time/name/distance/prize/conditions; runner 1 → `{no:1, name:'TRUE LINE', age:2, colour:'bay', sex:'C', trainer:'Ciaron Maher', stable:'Ballarat', jockey:'Jamie Kah', weight:58, barrier:4,
  gear:'Blinkers FIRST TIME', last10:'11', hcp:92, prize:212400}`; all 11 record categories; 4 run lines incl. a trial; run-line fields (venue, date, distance, cond, class, prize, prizeWon, jockey,
  weight, claim, barrier, 1st/2nd, time 58.6 s, 600 m 34.7, margin 0.3, 800/400 positions, SP 4, EF) exact; `scratched:true` from the strip table; apprentice/penalty on race 2; `matchKey`
  resolved `flemington` and `ballarat` from the calendar fixture. Output saved to `parsed/…kyw-ra.json`.
- **horseride** cheerio selectors on the same file: 8 runners, 14 past runs, 2 trial/jump-out rows, sire/dam/damsire for all 8, `horsecode` for all, `Record:` for all.
- **Bookie** regexes: 7/8 silks (the `17e` emergency is dropped by `\d+`, documented), both race times with meridiem, `Key=` regex, `TAB MEETING`, two `Race` anchors; oz page race-header regex ×2 + `Rail:`.
- **Kelvin** calendar href regex hits both quote styles (27 anchors); `acceptances()` logic (1:1 port with bs4 `get_text(" ")` emulation): 2 races, 8 runners, 6 rated, prize 200000, grade LISTED; `scratchings()` grammar yields `{1:[6 MISSING ENTRY, 17e SPARE PART], 2:[No Scratchings], 3:[9 SOUTHERN CROSSING]}`.
- **REAL The Valley** page normalised: venue/club/date; race 1 `Time 0:56.55`, `Last 600m 0:33.95`, `Good 4`, DQ comment; statuses `{placed:29, scratched:12, disqualified:1}`; `SB` row keeps `58.5kg` and has class `Scratched`; Cox Plate winner `VIA SISTINA (IRE)` `$2.25F` barrier 5 with `horsecode`. REAL Caulfield race 7: 12 runners, `F` flag, VOBIS logo title. REAL not-available page detected. REAL Group/Listed header read.
- Constructed HorseFullForm page satisfies the WKG (2016) and SteamatipAi (2025) selectors.

## 13. First-run checklist on the user's machine

1. `GET Calendar.aspx?State=VIC` → save raw; confirm anchors and the Flemington key for the target date. 2. `GET Form.aspx?Key=…` → save raw (expect 500 KB–1 MB); run the adapter;
compare counts to the calendar's field sizes. 3. `GET Acceptances.aspx`, `Scratchings.aspx`, `GearChanges.aspx` → save raw; confirm header texts (`Hcp Rating`, `Probable Weight`). 4. After race 1,
`GET Results.aspx` → confirm it matches the real fixtures' structure. 5. Record response sizes/latency; keep ≥2 s between requests. 6. Diff saved pages against `fixtures/racingaustralia/*`
and update the constructed ones where they differ.
