# Source: `racingcom` — Racing.com (Racing Victoria) GraphQL + Racing Australia "FreeFields" + Racing NSW / Racing Queensland

Research date: 2026-10-23. Researcher environment could **not** reach racing websites (proxy blocked `racing.com`, `racingaustralia.horse`, `racingnsw.com.au`, `racingqueensland.com.au`, `data.gov.au`, `web.archive.org`), so **nothing below was fetched live**. Every endpoint and field name comes from reading public source code on GitHub (via GitHub code search + `raw.githubusercontent.com`) that calls these services, plus one archived real HTML page copied from a public repo. Confidence tags: **high** = seen in ≥2 independent working client codebases or in a real captured response; **medium** = seen in one codebase; **low** = memory/inference, must be probed on the user's machine before relying on it.

> **Legal/ToS note (medium):** Racing Victoria and Racing NSW licence "race fields" data to wagering operators; use for personal research is common practice (many public repos do it) but redistribution/commercial use needs a Race Fields approval. Sources: https://www.racingnsw.com.au/race-field-information-use , https://racingvictoria.com.au/wagering/-/media/c1c05b199b1a4bbc8815a002a4289e61.ashx . Racing Queensland publishes its web services as open data (attribution required): https://www.racingqueensland.com.au/about/reports-and-data/open-data .

---

## 0. TL;DR for the adapter author

| Need | Best endpoint | Format | Confidence |
|---|---|---|---|
| Meetings for a date (all AU states + HK) | `POST https://graphql.rmdprod.racing.com/` query `GetMeetingByDate(date:"YYYY-MM-DD")` | JSON (AppSync GraphQL) | high |
| Meetings by state / date window | same host, query `GetRaceMeetingsByStateNew(states, daysBack, daysForward, userDate)` | JSON | medium |
| Meeting header (track condition, rating, rail, weather) | `getMeeting(id:"<meetCode>")` | JSON | high |
| Race list for a meeting | `getRacesForMeet(meetCode:"<meetCode>")` | JSON | high |
| Race card + form + odds + jockey/trainer stats | `getRaceForm(meetCode:"<meetCode>", raceNumber:N)` → `raceEntries` / `formRaceEntries` | JSON | high |
| Results, margins, in-running positions, sectionals, stewards report | `getRacesForMeet(...)` with `formRaceEntries{position margin ...} raceEntryTimes{...} stewardsReport{htmlCode}` or `getRaceForm(...)` with `raceEntries{finish ... timing{...}}` | JSON | medium-high |
| Pedigree (sire/dam/damsire), full career record by category, run-by-run lines with 600m times | Racing Australia `GET https://racingaustralia.horse/FreeFields/Form.aspx?Key=YYYYMonDD,STATE,Venue` (HTML) | HTML | high |
| Official results (any state), SP, margins, winner time, last 600m | `GET https://racingaustralia.horse/FreeFields/Results.aspx?Key=...` (HTML; identical on `racing.racingnsw.com.au` and `mdata.racingnsw.com.au`) | HTML | high (real sample in fixtures) |
| Scratchings only | `GET .../FreeFields/Scratchings.aspx?Key=...` | HTML | medium |
| Light-weight acceptances (22 KB) | `GET https://www.racingaustralia.horse/ozracing/Acceptances.aspx?key=...` | HTML (bare tables) | medium |
| Racing NSW machine-readable acceptances | `GET https://racing.racingnsw.com.au/FreeFields/XML.aspx?Key=...&stage=Acceptances` | XML | medium |
| Racing Queensland official meetings/races/horses | `GET https://www.racingqueensland.com.au/OpenDataWebServices/Meetings.asmx/{Op}?{params}` | XML | high (ops/params), medium (shapes) |
| Racing Queensland GPS sectionals | `GET https://www.racingqueensland.com.au/RacingFile.ashx?path=/Sectional/YYYYMMDD_<Venue>_T.csv` | CSV-ish | high (URL), medium (format) |
| Racing.com news (RSS substitute) | `GET https://graphql.api.racing.com?query=<GraphQL>` with `x-api-key` | JSON | medium |

Verification strategy that the evidence supports: key runners by **saddlecloth number (`raceEntryNumber` / "No.")** within (date, venue, raceNumber); cross-check **horse name** (strip country suffix `(NZ)`, `(GB)` …) and, where both sides carry it, Racing Australia **`horsecode`** (base64 string in `HorseFullForm.aspx?horsecode=`) vs racing.com `horseCode`. These are different code systems — do not expect them to match; name+number is the join.

---

## 1. Evidence base (all read in full or in part)

| Repo / file | What it proves | URL |
|---|---|---|
| `agends-afk/KaiYingWinning` — `supabase/functions/kyw-sync/index.ts` (468 lines, read in full) | Production Supabase Edge Function polling racing.com GraphQL every 10 min + Racing Australia Form.aspx once a day; exact queries, fragment `E on RaceEntryItem`, quirks | https://github.com/agends-afk/KaiYingWinning/blob/8448a8440e55e47463191fac1e5aa347d3bce4b6/supabase/functions/kyw-sync/index.ts |
| same repo — `supabase/functions/kyw-runs/index.ts` (read in full) | Extended `getRaceForm` field list incl. betting fluctuations, `timing{}`, `horseForm{}`; throttling behaviour (403/429) | https://github.com/agends-afk/KaiYingWinning/blob/8448a8440e55e47463191fac1e5aa347d3bce4b6/supabase/functions/kyw-runs/index.ts |
| same repo — `supabase/functions/kyw-sync/ra.js` (read in full) | Regex parser for FreeFields `Form.aspx` HTML: class names, run-line grammar, record strings | https://github.com/agends-afk/KaiYingWinning/blob/8448a8440e55e47463191fac1e5aa347d3bce4b6/supabase/functions/kyw-sync/ra.js |
| same repo — `README.md` | 51,438 runner rows pulled for VIC 2025-09-20..2026-09-20 via racing.com; HK quirks | https://github.com/agends-afk/KaiYingWinning/blob/8448a8440e55e47463191fac1e5aa347d3bce4b6/README.md |
| `danielboasemammoth/racing-predictor` — `src/lib/scrapers/racing-com.ts` (read in full) | Independent second client of the same endpoint/key; `GetRaceMeetingsByStateNew`, `getRacesForMeet` with `raceEntryTimes`, `stewardsReport`, `meet{}`, typed interfaces | https://github.com/danielboasemammoth/racing-predictor/blob/6b2ad1691497ec8efb4129617f9b4693f53f11f9/src/lib/scrapers/racing-com.ts |
| `Islington036/HorseRacingNewsPortal` — `international/config.js` | News GraphQL on `graphql.api.racing.com` with a different public `x-api-key` | https://github.com/Islington036/HorseRacingNewsPortal/blob/a5e3d263550e6c812a027c95afc489a1157345bf/international/config.js |
| `duckduckgo/tracker-radar-wiki`, `powplowdevs/SpyView` | DNS: `graphql.rmdprod.racing.com` → `d262p94jkhxz14.cloudfront.net` (AWS); `api.racing.com`, `cdn.racing.com` → `san-www.racing.com.edgekey.net` (Akamai) | https://github.com/duckduckgo/tracker-radar-wiki/blob/933affd078d5e69e8d56eb8b4d21fbd3f57d5fd7/docs/domains/d262p94jkhxz14.cloudfront.net.html |
| `thumentianlu1993-blip/Umanewsbot` — `server/stable/fixtures/australia/wayback_ra_results_2025-10-18_caulfield.html` | **Real captured** FreeFields `Results.aspx` HTML (Caulfield 2025-10-18, Race 7) — copied into our fixtures | https://github.com/thumentianlu1993-blip/Umanewsbot/blob/main/server/stable/fixtures/australia/wayback_ra_results_2025-10-18_caulfield.html |
| `RatterAU/Bookie` — `Sources/BookieCore/RacingAustraliaFeed.swift`, `Sources/bookie-check/main.swift` | `/ozracing/Acceptances.aspx`, Key qualifiers (`Trial`, `Picnic`), bot-wall status, "not currently available", silks, jump-time formats, sample oz HTML | https://github.com/RatterAU/Bookie/blob/main/Sources/BookieCore/RacingAustraliaFeed.swift |
| `Kelvin1761/Kelvin-Agents` — `.agents/skills/au_racing/ra_fields.py` | Acceptances/Scratchings column headers, Key grammar, curl_cffi impersonation, 6 s delay | https://github.com/Kelvin1761/Kelvin-Agents/blob/main/.agents/skills/au_racing/ra_fields.py |
| `desscartes/horseride` — `server/australian-form.mjs` + test | `AllForm.aspx?Key=...&recentForm=N`; cheerio selectors; sire/dam/damsire from `.plain a.GreenLink` | https://github.com/desscartes/horseride/blob/main/server/australian-form.mjs |
| `RyzyO/tmstipping` — `admin-dark-script.js`, `supabase/functions/ra-proxy/index.ts` | Racing NSW `FreeFields/XML.aspx?Key=&stage=Acceptances` XML (`race@number`, `nomination@horse/@number/@jockeynumber`), `StageMeeting.aspx`, silks | https://github.com/RyzyO/tmstipping/blob/f8d5310d1155369a7e1a4d69c0bbf12d633cbf7f/admin-dark-script.js |
| `RyzyO/HorseMatch` — `script.js` | `racing.racingnsw.com.au/InteractiveForm/JockeySilkDetails.aspx?ColorID=` | https://github.com/RyzyO/HorseMatch/blob/1c0aada30005a257d02da6c4bd80e6797dc57cab/script.js |
| `JanamJonchhe/race-predictor` — `src/download_rnsw.py`, `src/download_rnsw_backfill.py` | `mdata.racingnsw.com.au/FreeFields/Calendar_Results.aspx`, `Acceptances.aspx?Key=` | https://github.com/JanamJonchhe/race-predictor/blob/f234fb7c512837bd64d7369d1afb9ab4e94e819a/src/download_rnsw.py |
| `bmck0592-alt/multi-eng` — `ben/Royalpast.py` | `racing.racingnsw.com.au/FreeFields/Calendar_Meetings.aspx?date=01/MM/YYYY`, `StageMeeting.aspx?Key=` | https://github.com/bmck0592-alt/multi-eng/blob/47e6427eed2a760b4df8eae3c70c9f5c9a74f48d/ben/Royalpast.py |
| `lifebloods/test1` — `app` | `mdata.racingnsw.com.au/FreeFields/Scratchings.aspx?Key=` | https://github.com/lifebloods/test1/blob/f15cf5e0735fe13f817e49fbad56c3d0586c3782/app |
| `WhoKnowsGroup/WKG-Scarp` — `RAHorseDataScrapper.java` | `racing.racingnsw.com.au/InteractiveForm/HorseFullForm.aspx?HorseCode=...&src=horsesearch` (2016) | https://github.com/WhoKnowsGroup/WKG-Scarp/blob/dc966ca4af4bb9fdcc37780cfaa0b2231dec9683/src/main/java/com/webscrapper/batch/RAHorseDataScrapper.java |
| `SteamatipAi/SteamatipAi` — `ScrapingService.kt` | `Form.aspx?Key=...&recentForm=Y`, `FreeServices/Premierships.aspx?State=&Season=&Table=Trainer`, `table.interactive-race-fields` | https://github.com/SteamatipAi/SteamatipAi/blob/master/app/src/main/java/com/steamatipai/network/ScrapingService.kt |
| `Kohdepitcher/RacesListCountDown` (Swift) | Mobile mirror `m.racingaustralia.horse/FreeFields/Calendar.aspx?State=` and `Acceptances.aspx?Key=...,QLD,<Venue>[,Trial]` | https://github.com/Kohdepitcher/RacesListCountDown |
| `brettanthonysjoberg179-lab/mcp-server-agents-aus` | `FreeFields/Calendar_Results.aspx?State=` loop over 8 states | https://github.com/brettanthonysjoberg179-lab/mcp-server-agents-aus/blob/main/servers/trifecta-racing-mcp-agent.js |
| `zuizui0223/keiba` — `scripts/ecology_rq_single_race_id_probe.py`, `scripts/ecology_rq_two_date_horse_id_repeat.py`, `scripts/ecology_rq_thoroughbred_sectional_audit.py`, tests, docs | Racing Queensland `Meetings.asmx` operations/params/XML element names; `RacingFile.ashx` CSV format | https://github.com/zuizui0223/keiba/blob/43e0fe30e0a2b976614b5b73bf889480a8e45c1c/scripts/ecology_rq_single_race_id_probe.py |
| data.gov.au dataset "Queensland Thoroughbred Racing Club data" (search summary only) | `OpenDataWebServices/ClubWebsites.asmx` (`GetNextMeetingForClub`, all-future-meetings op), XML, spec PDF | https://data.gov.au/data/dataset/queensland-thoroughbred-racing-club-data |

---

## 2. Racing.com — public GraphQL API (`graphql.rmdprod.racing.com`) — **PRIMARY**

### 2.1 Transport

| Item | Value | Conf. | Evidence |
|---|---|---|---|
| Endpoint | `POST https://graphql.rmdprod.racing.com/` (trailing slash used by both clients) | high | kyw-sync L9, racing-com.ts L3 |
| Hosting | AWS AppSync behind CloudFront (`d262p94jkhxz14.cloudfront.net`); the `da2-…` key format is AppSync's API-key auth | high | tracker-radar CNAME; key prefix |
| Auth header | `x-api-key: da2-6nsi4ztsynar3l3frgxf77q5fe` — "racing.com's public site key, taken from their config.js" (i.e. shipped in the SPA bundle; may rotate — make it configurable, env `RACING_COM_API_KEY`) | high | kyw-sync L10, racing-com.ts L4 |
| Other headers | `Content-Type: application/json`; a `User-Agent` (`Mozilla/5.0` or a bot UA both worked). No `Referer`/`Origin` required by either client. | high | both |
| Body | `{"query": "<GraphQL>"}` (anonymous query string) **or** `{"query": "...", "variables": {...}}` (named operation) — both accepted | high | kyw uses inline literals; racing-predictor uses variables |
| Response | `{"data": {...}}`; on failure `{"data": null|partial, "errors":[{"message": ..., ...}]}` (AppSync shape). kyw treats `errors` with no `data` as fatal; racing-predictor treats any `errors` as fatal | high | both |
| Rate limiting | **403 or 429 when hammered**. kyw: 4 races in parallel, 1.2 s pause between batches, 0.8 s between meetings, on 403/429 sleep 20 s×attempt (3 tries); racing-predictor: 200 ms between meeting-list calls, 300 ms between meetings, retry 502/503/504 with 1 s×attempt backoff, 15 s timeout | high | kyw-runs L14-23, L53; racing-com.ts L189-215 |
| Introspection | Not evidenced. AppSync usually allows `__schema` with API-key auth — **probe** `{"query":"{ __schema { queryType { fields { name } } } }"}` once on the user's machine to enumerate every root field (horse profile, jockey, trainer, sectionals, stewards). | low | inference |

### 2.2 Root query fields observed

| Query | Args | Returns | Conf. | Evidence |
|---|---|---|---|---|
| `GetMeetingByDate(date: "YYYY-MM-DD")` | ISO date (Melbourne/Sydney local) | `[Meeting]` for **all** states incl. Hong Kong (`state:"HK"`), trials, jump-outs, picnics | high | kyw-sync L368, L430; kyw-runs L50 |
| `GetRaceMeetingsByStateNew(states: String!, daysBack: Int!, daysForward: Int!, userDate: String!)` | `states` is a single state code string e.g. `"VIC"` (looped per state); `userDate` `"YYYY-MM-DD"` | `[Meeting]` with `id venue date state isTrial isJumpOut meetUrl sortOrder`. **Quirk:** "The API always folds VIC meetings into every response regardless of the requested state, so dedupe by id." | medium | racing-com.ts L7-18, L218-233 |
| `getMeeting(id: "<meetCode>")` | meeting id from above | `Meeting` | high | kyw-sync L281, L407, L447 |
| `getRacesForMeet(meetCode: "<meetCode>")` | meeting id | `[Race]` | high | kyw-sync L282, L375; racing-com.ts L21 |
| `getRaceForm(meetCode: "<meetCode>", raceNumber: Int)` | meeting id + race number | `Race` incl. `raceEntries` and `formRaceEntries` | high | kyw-sync L111; kyw-runs L29 |
| `getNewsList(sites: ["RDC"], limit: 20)` | on the **news** host `https://graphql.api.racing.com` with key `da2-r5s52y73i5c7vi6vxflvfdufsa`, sent as `GET ...?query=<urlencoded>` | `[NewsItem]` | medium | HorseRacingNewsPortal config.js |

**Meeting id / meetCode:** an opaque string; use the `id` returned by the meeting queries verbatim as `meetCode`. Do not construct it (**high** that it is opaque; its exact format is not in the evidence — the fixtures use a placeholder).

### 2.3 Field catalogue (names exactly as selected in working queries)

**Meeting** (from `GetMeetingByDate` / `getMeeting` / `GetRaceMeetingsByStateNew`):
`id` (string), `date` (string, `YYYY-MM-DD`), `meetingName`, `venueName`, `venue`, `state` (`VIC|NSW|QLD|SA|WA|TAS|NT|ACT|HK|...`), `country`, `isTab` (**integer 1/0** — code tests `m.isTab === 1`), `isTrial` (bool), `isJumpOut` (bool), `isPicnic` (bool), `category`, `meetQuality`, `trackCondition` (e.g. `"Good"`), `trackRating` (e.g. `"4"` — clients join as `"Good 4"`), `railPosition` (string), `weather` (string), `racesCount` (int), `status`, `meetUrl` (site path), `sortOrder`. Conf: high for the kyw set, medium for `meetUrl/sortOrder/venue/category/meetQuality/isPicnic`.

**Race** (`getRacesForMeet`, `getRaceForm`):
`id`, `raceNumber` (int), `name`, `distance` (string — client strips non-digits, so expect `"1600m"`-style), `class` (e.g. `"BM78"`, `"Group 1"`, `"MDN"`), `rdcClass`, `group`, `raceStatus` (string; clients match `/abandon|cancel/`, `/result/`, `/running|interim/`), `status`, `hasResults` (bool), `resultsString` (string of finishing saddlecloths, split on non-digits), `trackCondition`, `trackRating`, `condition`, `time` (race start timestamp string; **verify TZ on first live call** — for HK racing.com labels local clock time "as if UTC"), `raceTime` (winner's time), `runnersCount`, `fieldCount`, `totalPrizeMoney` (string/number with `$`,`,`), `prizeMoney` (**array of JSON strings** each like `"{\"Value\":\"90000\",...}"` — racing-predictor `JSON.parse`s each and sums `Value`), `hasSectionals` (bool), `timingSource`, `tempo`, `straight` (metres string), `circumference` (metres string), `meet { trackCondition trackRating weather state }`, `stewardsReport { htmlCode }` (HTML string of the stewards' report for the race), `raceEntryTimes [...]` (sectionals, below), `raceEntries [RaceEntryItem]`, `formRaceEntries [RaceEntryItem]`.
Conf: high for the kyw `RACE_FIELDS` set; medium for racing-predictor-only fields.

**RaceEntryItem** (fragment `E on RaceEntryItem` — the GraphQL type name is **high** confidence):
`id`, `raceEntryNumber` (int saddlecloth), `barrierNumber` (int), `liveBarrierNumber` (int, after scratchings re-draw — prefer `liveBarrierNumber || barrierNumber`), `weight` (string, `"58.5kg"`-style), `weightCarried`, `weightPrevious`, `scratched` (bool), `isLateScratching` (bool), `emergency` (bool), `finish` (int; **1..N placing, `109` = scratched/did not run**, other values ≥100 are non-finish codes), `position` (int; same semantics in `formRaceEntries` — racing-predictor nulls `>50`), `margin`, `beatenMargin` (strings like `"0.65L"`), `winningTime` (**hundredths of a second**, e.g. `10788` → 107.88 s), `horseName`, `horseCode`, `horseCountry`, `jockeyName`, `jockeyCode`, `trainerName`, `trainerCode`, `gearChanges` (string), `gearHasChanges` (bool), `jockeyChanged` (bool), `commentShort` (form comment), `commentStewards`, `handicapRating`, `lastRaceDate`, `startingPrice` (`"$4.80"`-style), `bettingFluctuationsPriceOpen`, `bettingFluctuationsPriceMoveOne`, `bettingFluctuationsPriceMoveTwo`, `speedValue`, `positionAtSettled`, `positionAt800`, `positionAt400` (ints), `prizeMoney` (won), stats strings `trackStats`, `distanceStats`, `trackDistanceStats`, `atThisBarrierNumberStats`, `atThisClassStats` (**format `"starts:wins-seconds-thirds"` e.g. `"6:2-1-0"`, sometimes `"6-2-1-0"`** — regex `/(\d+)[:\-](\d+)-(\d+)-(\d+)/`), and nested:
- `horse { id name age sex careerStats lastTen goodStats softStats heavyStats firstUpStats secondUpStats rating horseForm [...] stats [{ starts firsts seconds thirds }] }` — `lastTen` is a **JSON-encoded array string** like `"[\"1\",\"3\",\"-\",\"x\",\"2\"]"` (`-` = spell/break; kyw notes it **counts trials**); `sex` is a word (`"Gelding"`), clients take first letter; `stats[0]` holds career counts as **strings**.
- `horse.horseForm[]` (last **ten** runs, any state): `date` (`YYYY-MM-DD`), `venue`, `distance`, `position`, `starters`, `margin`, `raceClass`, `raceCode`, `startingPrice`, `weightCarried`, `trackCondition`, `positionAt800`, `positionAt400`, `barrier`, `jockeyName`, `winningTime` (hundredths), `isTrial`, `isJumpOut`. Quirk: racing.com "flags only some" trials; kyw also treats `raceClass` matching `/TRL|TRIAL|JUMP|JMP|^OUT/` (without Listed/Group/Stakes) as trials, and a horse with `careerStats` starts = 0 as all-trials.
- `jockey { fullName winPercent recentWinPercent apprentice weightClaim }`, `trainer { fullName winPercent recentWinPercent }`.
- `odds [{ providerCode oddsWin oddsPlace }]` — multiple providers per runner. Tote codes seen: `"V"`, `"N"`, `"Q"` (VIC/NSW/QLD totes) and codes starting `"BTOTE"`; everything else is a fixed-odds bookmaker. kyw uses the **median fixed price** as "the market".
- `timing { finishTimeSeconds sixHundredMetresTime twoHundredMetresTime timeVarToWinner distanceTravelled }` — only meaningful when race `hasSectionals`; `finishTimeSeconds` is in hundredths (`/100`).

**raceEntryTimes[]** (race-level sectionals, racing-predictor): `horseCode`, `horseName`, `avgSpeedEarly`, `avgSpeedMid`, `avgSpeedLate`, `overallPeakSpeed`, `overallAvgSpeed`, `sixHundredMetresTime`, `standardTimeDifference`, `splitTimes [{ avgSpeed distance index position time }]`. Conf: medium.

**NewsItem** (`getNewsList`): `id name short_title description article_type image_url thumbnail published modified article_date page_url site category{label url} image_object{width height alt src thumbnail_src} thumbnail_object{...}`. Conf: medium.

### 2.4 Behavioural quirks you must code for (all from kyw/racing-predictor comments — high)

1. **Before race day `raceEntries` holds only the scratchings; the full field is in `formRaceEntries`.** Merge on `raceEntryNumber`, letting `raceEntries` win where both exist. After the race, `raceEntries` carries `finish`.
2. A saddlecloth can appear **twice** (an emergency and a scratching); keep the entry with `finish < 100`, else the last seen. racing-predictor dedupes by `horseCode` and throws on conflicting duplicates.
3. `finish === 109` ⇒ treat as scratched. `scratched || isLateScratching || finish === 109`.
4. Finishing order: use `finish` values 1..99; fallback `resultsString.split(/[^0-9]+/)`.
5. `hasResults` or non-empty `resultsString` ⇒ race finished.
6. Filter meetings with `isTab === 1 && !isTrial && !isJumpOut && !isPicnic` for betting meetings.
7. Odds: fixed odds available until ~30 min before first race; kyw then switches to tote. Opening price = first price read in the morning (`bettingFluctuationsPriceOpen` also exists).
8. Hong Kong: fields/prices/results present but **no `horseForm`**, times mislabelled, results filed under Sydney dates. Ignore HK unless needed.
9. `lastTen` counts trials; prefer building form from `horseForm` filtered by `isTrial/isJumpOut`.
10. Racing.com's `weight`/`distance`/`margin`/`price` fields are **strings with units/symbols**; clients strip `[$,kgL]` / `[^0-9.]`.

### 2.5 How-to recipes

- **Meetings for a date:** `{ m: GetMeetingByDate(date:"2026-10-24"){ id date meetingName venueName state country isTab isTrial isJumpOut isPicnic category meetQuality railPosition trackCondition trackRating weather racesCount status meetUrl } }` → pick `isTab===1` AU meetings; match venue by slug tokens (kyw matches `/flemington/` etc.).
- **Race card (runners: number, name, barrier, jockey, trainer, weight, scratched, odds):** `getRaceForm(meetCode, raceNumber)` selecting fragment `E`; runner number = `raceEntryNumber`, barrier = `liveBarrierNumber || barrierNumber`, weight = `weightCarried ?? weight`, jockey = `jockey.fullName ?? jockeyName`, trainer = `trainer.fullName ?? trainerName`, scratched rule above, odds = `odds[]` (+ `startingPrice` after the race).
- **Form (past starts, career, track/dist/condition stats):** same call: `horse.horseForm[]`, `horse.careerStats`, `trackStats`, `distanceStats`, `trackDistanceStats`, `atThisBarrierNumberStats`, `atThisClassStats`, `horse.goodStats/softStats/heavyStats/firstUpStats/secondUpStats`, `horse.rating`, `handicapRating`. **Sire/dam are NOT in any observed racing.com selection** — take pedigree from Racing Australia `Form.aspx` (section 3) or probe schema introspection.
- **Results:** `getRaceForm` after `hasResults` → `raceEntries[].finish/margin/beatenMargin/startingPrice/positionAt800/positionAt400/positionAtSettled/timing{}`; or `getRacesForMeet` with `formRaceEntries[].position/margin/winningTime` + `raceEntryTimes` + `stewardsReport{htmlCode}`.
- **Track condition / rail / weather:** `getMeeting(id){ trackCondition trackRating railPosition weather }` (meeting-level) and per race `trackCondition trackRating` (races can be upgraded/downgraded mid-meeting — re-read per race).
- **Jockey/trainer stats:** per entry `jockey{winPercent recentWinPercent apprentice weightClaim}`, `trainer{winPercent recentWinPercent}`.
- **Stewards:** race `stewardsReport{htmlCode}` and per-entry `commentStewards`.
- **Sectionals:** race `hasSectionals`/`timingSource`, entry `timing{...}`, race `raceEntryTimes[]` (Victorian meetings publish; others often null — README: "sectional times … racing.com's Victorian timing").

### 2.6 Racing.com HTML / other surfaces

| Surface | Notes | Conf. |
|---|---|---|
| `https://www.racing.com/` | Next.js SPA; article lists and form data are **not** in static HTML (news-portal comment); scrape via GraphQL instead. `meetUrl` from `GetRaceMeetingsByStateNew` gives the canonical meeting page path — store it for deep links. | medium |
| `https://www.racing.com/form-guide` | form-guide root (used as the source URL by racing-predictor) | medium |
| `https://www.racing.com/form/{YYYY-MM-DD}/{venue-slug}[/race/{n}]`, `https://www.racing.com/results`, `/horses/{slug}`, `/jockeys/{slug}`, `/trainers/{slug}` | from memory of the pre-2023 site; **may 404 on the new SPA** — do not depend on | low |
| `https://www.racing.com/news/latest-news` (+ GraphQL `getNewsList` on `graphql.api.racing.com`) | News. No RSS feed was found by search; the GraphQL news list is the RSS substitute. | medium |
| `api.racing.com`, `cdn.racing.com` | Exist (Akamai CNAMEs) but **no code calls `api.racing.com/v1/en-au/...`** was found anywhere on GitHub (code search for `"api.racing.com/v1"` → 0 hits). Treat the `/v1/en-au/` REST API from the task brief as **unverified/legacy (low)**; the live data path is the GraphQL above. | high (absence) |

---

## 3. Racing Australia "FreeFields" (`racingaustralia.horse`) — **official national fields/form/results, HTML** (also serves VIC)

Racing Australia (RISA) hosts the official nominations → weights → acceptances → form → results pipeline for **every** Australian thoroughbred meeting. The same ASP.NET app is mirrored, byte-identical, at `https://racing.racingnsw.com.au/FreeFields/…`, `https://mdata.racingnsw.com.au/FreeFields/…` and `https://m.racingaustralia.horse/FreeFields/…` (mobile). This is the best cross-verification source for racing.com and the only evidenced source of **pedigree** and **run-by-run form with 600 m splits**.

### 3.1 URL grammar (all `GET`, no auth)

| Page | URL | Conf. | Evidence |
|---|---|---|---|
| Calendar by state | `/FreeFields/Calendar.aspx?State={NSW|VIC|QLD|SA|WA|TAS|ACT|NT}` — lists meetings with links `href="/FreeFields/<Page>.aspx?Key=..."` (Nominations/Weights/Acceptances/Form/Results depending on stage) | high | kyw ra.js `matchKey`, Kelvin, Bookie, SteamatipAi |
| Calendar by date | `/FreeFields/Calendar.aspx?Date=YYYYMonDD` | medium | SteamatipAi |
| Results calendar | `/FreeFields/Calendar_Results.aspx?State=XX` | medium | mcp-server-agents-aus, horseride, race-predictor (mdata) |
| Monthly diary (NSW mirror) | `https://racing.racingnsw.com.au/FreeFields/Calendar_Meetings.aspx?date=01/MM/YYYY` → links to `StageMeeting.aspx?Key=` / `Results.aspx?Key=` | medium | Royalpast.py |
| Meeting Key | `Key=YYYYMonDD,STATE,Venue[,Trial|Picnic]` e.g. `2026Oct24,VIC,Flemington`, `2026Jul21,NSW,Warren,Trial`, `2026Jul25,NSW,Trangie,Picnic`. Month = `Jan..Dec`; venue is RA's sponsored name (`Sportsbet-Ballarat`, `Ladbrokes Geelong`, `Royal Randwick`, `Rosehill Gardens`, `The Valley`, `Sportsbet Sandown Hillside`, `Southside Cranbourne`, `Canberra Acton`) — **take it from the calendar, never guess**. URL-encode `,`→`%2C`, space→`+` or `%20` (all accepted). | high | ra.js `parseKey`, Bookie, Kelvin, many URLs |
| Nominations | `/FreeFields/Nominations.aspx?Key=` | medium | Umanewsbot URL list |
| Weights | `/FreeFields/Weights.aspx?Key=` | medium | Bookie calendar sample |
| Acceptances (styled, ~125 KB) | `/FreeFields/Acceptances.aspx?Key=` (+`&BodyClass=PrintFriendly` identical data) | high | Bookie, Kelvin, Kohdepitcher |
| Acceptances (bare, ~22 KB) | `/ozracing/Acceptances.aspx?key=` — fixed-width tables, no silks, no scratchings | medium | Bookie |
| Scratchings | `/FreeFields/Scratchings.aspx?Key=` — "change up to race start", refetch each time | medium | Kelvin, lifebloods |
| Full form guide (~870 KB) | `/FreeFields/Form.aspx?Key=` (+`&recentForm=Y`) | high | kyw ra.js, SteamatipAi, tmstipping |
| All form | `/FreeFields/AllForm.aspx?Key=...&recentForm=N` | medium | horseride |
| Race program | `/FreeFields/RaceProgram.aspx?Key=` | medium | URLs in repos |
| Stage router | `/FreeFields/StageMeeting.aspx?Key=` (redirects to the current stage page) | medium | Royalpast, tmstipping |
| Results | `/FreeFields/Results.aspx?Key=` — whole meeting, one page | high | real fixture |
| Racing NSW XML | `https://racing.racingnsw.com.au/FreeFields/XML.aspx?Key=...&stage=Acceptances` | medium | tmstipping |
| Horse full form | `/InteractiveForm/HorseFullForm.aspx?horsecode=<base64>&stage=Results&Key=...&src=horseform&raceentry=<base64>` (also legacy `?HorseCode=...&src=horsesearch`) | high | real fixture, WKG-Scarp |
| Trainer / jockey last runs | `/InteractiveForm/TrainerLastRuns.aspx?trainercode=<base64>&trainername=<urlenc>`, `/InteractiveForm/JockeyLastRuns.aspx?jockeycode=<base64>` | high | real fixture |
| Silks | `https://racingaustralia.horse/JockeySilks/{id}.png`; owner lookup `/InteractiveForm/JockeySilkDetails.aspx?ColorID={id}` (NSW mirror) | high / medium | real fixture; HorseMatch |
| Premierships | `/FreeServices/Premierships.aspx?State=XX[&Season=2025&Table=Trainer]` | medium | SteamatipAi |
| Group/Listed dates | `/arb/Group_ListedRaceDates/{season}.aspx` e.g. `2025-2026` | medium | Umanewsbot doc |

### 3.2 Access / bot protection

- "Verified live on 2026-07-21: plain URLSession/curl is served fine — RA is NOT bot-walled the way TAB is" (Bookie). kyw uses a Safari UA + `Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.8` + `Accept-Language: en-AU,en;q=0.9`, `redirect: follow`. Kelvin uses `curl_cffi` `impersonate="chrome120"` with ≥2 s (default 6 s) delay and rejects bodies < 5000 bytes. horseride records a `blocked_by_source_verification` state, i.e. a verification interstitial **can** appear under heavy use — send a browser-like UA, keep ≤1 req/s, cache aggressively (Form.aspx once per meeting; Scratchings/Acceptances every few minutes; Results after each race). Conf: high.
- A meeting whose stage is not yet published returns **HTTP 200 with body containing "not currently available"** (or a body < 400 chars) — treat as "not yet", not as error (Bookie). Conf: medium.
- `TAB MEETING` text on the card marks TAB-covered meetings (Bookie). Conf: medium.
- Times on the pages are **local time of the race meeting** (`<span class="localtimedisplayed">Times displayed in local time of Race Meeting</span>` in the real fixture). State → TZ map: QLD Brisbane, SA Adelaide, NT Darwin, WA Perth, others Sydney.

### 3.3 HTML structure — `Results.aspx` (from the **real** captured page, high)

```
div.top > h2 "Caulfield: Melbourne Racing Club" > span.race-venue-date "Saturday, 18 October 2025"
span.meeting-type "Meeting Type: Metro (TAB MEETING)"
div.printer-friendly a[href="?Key=2025Oct18,VIC,Caulfield&BodyClass=PrintFriendly"]
table.race-title  > tr > th > span "Race 7 - 3:45PM Schweppes Thousand Guineas (1600 METRES)" ; span.localtimedisplayed
                  > tr > td  "<b>Of $1,500,000.1st $900,000, 2nd $270,000, ...</b><br/>... GROUP 1<br>Set Weights, Three-Years-Old, Fillies...<br>
                               <b>Track Name:</b> Main <b>Track Type:</b> Turf <b>Track Condition:</b> Good 4 <b>Time:</b> 1:37.83 <b>Last 600m:</b> 0:34.95 <b>Timing Method:</b> Electronic"
table.race-strip-fields > tr > th.no "Colour" | th "Finish" | th "No." | th "Horse" | th "Trainer" | th "Jockey" | th "Margin" | th "Bar." | th "Weight" | th "Penalty" | th "Starting Price"
   tr.EvenRow / tr.OddRow >
      td > img.minimizeStyle[src=https://www.racingaustralia.horse/JockeySilks/64092.png]
      td > span.Finish.F1 "1"                       (F1..F12 = placing class; scratched rows show no Finish span)
      td "3"                                        (saddlecloth)
      td.horse > a.GreenLink[href=/InteractiveForm/HorseFullForm.aspx?horsecode=...&stage=Results&Key=...&src=horseform&raceentry=...] "OLE DANCER" ; optional img.NewVobisLogo
      td.trainer > a.GreenLink[href=/InteractiveForm/TrainerLastRuns.aspx?trainercode=...&trainername=...] "Peter G Moody & Katherine Coleman"
      td.jockey > a.GreenLink[href=/InteractiveForm/JockeyLastRuns.aspx?jockeycode=...] > span.Hilite "Blake Shinn"
      td "0.35L"  (margin; winner blank)   td "5" (barrier)   td "56kg"   td "" (penalty)   td "$1.90F" (SP; F = favourite, EF = equal fav)
```
Repeat `table.race-title` + `table.race-strip-fields` per race (one page per meeting).

### 3.4 HTML structure — `Form.aspx` (from kyw `ra.js` regexes + horseride selectors + Bookie, high/medium)

```
div.race-venue-bottom  ... "Rail Position: <text>" "Track Condition: <text>" "Weather: <text>" ... div.comments
<a name="Race1"></a>
table.race-title > tr > th > span.raceNum "Race 1" " - 12:50PM " <race name> "(1200 METRES)"
                 > tr.race-info > td "Of $150,000. 1st $82,500 ... <conditions line> ... BOBS ... Track ... Field Limit ..."
table.race-strip-fields > tr.OddRow|EvenRow[ Scratched]  > td.no | td.last (Last 10, e.g. "x3210-14") | td (horse) | ... | td.hcp (Hcp Rating) | td.penalty
   -- Acceptances column headers (Kelvin): No | Horse | Trainer | Jockey | Barrier | Weight | Probable Weight | Penalty | Hcp Rating | Last 10
table.horse-form-table (one per runner; `border="0" cellspacing="0" cellpadding="0"`)
   div.Silks > img[src=https://racingaustralia.horse/JockeySilks/6564.png]
   div.horse-info > span.horse-number "1" ; span.horse-name > a[href=/InteractiveForm/HorseFullForm.aspx?horsecode=...] "HORSE NAME"
                  > span.plain "4 year old bay gelding (male) ... <a class=GreenLink>SIRE</a> ... <a class=GreenLink>DAM</a> ... <a class=GreenLink>DAMSIRE</a> ... Gear Changes: Blinkers first time"
   <b>Trainer:</b> <a>Name</a> (Stable Town)  <b>Jockey:</b> <a>Name 58.5kg</a>  <b>Barrier:</b> 5
   <b>Record:</b> 12:3-2-1  <b>1st Up:</b> 3:1-0-1  <b>2nd Up:</b> ...  <b>Track:</b> ...  <b>Dist:</b> ...  <b>Track/Dist:</b> ...  <b>Firm:</b> <b>Good:</b> <b>Soft:</b> <b>Heavy:</b> <b>Synthetic:</b>  <b>Prizemoney:</b> $245,000
   table.horse-last-start > tr.OddRow|EvenRow > td.Pos "2 of 10" (prefix "T" = trial, "J" = jump-out) | td.remain
      td.remain grammar (one run line):
      "<b><a href='Meeting.aspx?...'>KENS 14Jan26</a></b> 1150m Soft5 SUPER MDN-SW  $100,000 ($9,750) Tim Clark 57kg (cd 55kg) Barrier 5<br>
       1st Gorgeous 55.5kg, 2nd Let's Go Barbie 54kg 1:07.88 (600m 34.95), 0.65L, 2nd@800m, 2nd@400m, $4.80/$4.40/$4.20/$4[EF]"
      => venueCode, date(DDMonYY), distance, condition(Good4/Soft5/Heavy8/Synth), class, prize, prizeWon, jockey, weight, claim(cd), barrier,
         1st/2nd/3rd + weights, winner time, last 600m, margin(L), position@800m, position@400m, price fluctuations (last = SP; EF = equal fav)
```
Record string format everywhere: `"starts:wins-seconds-thirds"` (`"3:0-1-1"`).

### 3.5 HTML structure — `/ozracing/Acceptances.aspx?key=` (medium, Bookie regexes + sample)

Plain tables: race header row `<tr><td>1-12.55</td><td width=70%>RACE NAME</td><td align=right>2018 M</td></tr>` (race no – hh.mm **12-hour without AM/PM**; distance in M), then `Of $27000. CLASS 1. Set Weights.`, then runner table `No. | Horse | Trainer | Jockey | Barr | Wgt | Pen | RTG` with RTG in parentheses. Header line contains `TAB MEETING.&nbsp;&nbsp;Rail: +3m Entire`. Resolve AM/PM: first race AM only if hour 7–11; flip to PM when time would go backwards.

### 3.6 Racing NSW `XML.aspx` (medium, tmstipping)

`GET https://racing.racingnsw.com.au/FreeFields/XML.aspx?Key=2026Oct24,NSW,Royal Randwick&stage=Acceptances` → XML with `<race number="1" ...>` containing `<nomination horse="HORSE NAME" number="3" jockeynumber="64092" .../>` elements (`jockeynumber` = silks image id). Other attributes exist but were not read by the only client found — capture and inspect on first live call. Other `stage` values presumably `Nominations|Weights|Acceptances|Results` (low).

---

## 4. Racing NSW (`racingnsw.com.au`) — summary

| Item | Value | Conf. |
|---|---|---|
| Fields/form/results | Same FreeFields app as §3 on `racing.racingnsw.com.au` (Akamai edge) and `mdata.racingnsw.com.au` — all `/FreeFields/*.aspx?Key=` pages verified in code for both hosts (`Calendar_Results.aspx`, `Calendar_Meetings.aspx`, `Acceptances.aspx`, `Scratchings.aspx`, `Results.aspx`, `StageMeeting.aspx`, `XML.aspx`, `InteractiveForm/*`). Use as the **second independent host** for the same official data (different CDN → good for availability fallback). | high |
| Main site | WordPress (`/wp-content/uploads/...` PDFs, `/news/...` articles). No JSON API discovered. | medium |
| Sectionals | "Punter's Intelligence" (saddle-cloth transmitters, 50 Hz) at https://www.racingnsw.com.au/punters-intelligence/ — presentation only; no API found. | low |
| Licensing | Race Fields approval regime; see §0 note. | medium |

## 5. Racing Queensland (`racingqueensland.com.au`) — summary

| Item | Value | Conf. |
|---|---|---|
| Open Data Web Services (ASMX, `GET` with query params, returns XML) | `https://www.racingqueensland.com.au/OpenDataWebServices/Meetings.asmx/{Op}?{params}` with ops `GetMeetingsForDate?meetingDate=YYYY-MM-DD`, `GetRacesForMeeting?meetingId=N`, `GetHorsesForRace?raceId=N`, `GetHorseDetailsInRace?raceId=N&horseId=N`, `GetRaceDetails?raceId=N`; WSDL at `.../Meetings.asmx?WSDL`; spec PDF `https://www.racingqueensland.com.au/rq-open-data-web-services.pdf` | high (ops/params from keiba code) |
| XML shapes | `<Meetings><Meeting Id="130893"><MeetingDate>2026-10-11</MeetingDate><TrackName>Ladbrokes Cannon Park</TrackName><IsBarrierTrial>false</IsBarrierTrial></Meeting>…`; `<Races><Race Id="123451"><RaceNumber>1</RaceNumber><RaceName>…</RaceName><TrackRating>Good</TrackRating><Distance>950 metres</Distance><Class>Maiden</Class></Race>…`; `<Horses><Horse Id="9001"><HorseName>…</HorseName>…<Jockey Id="…">…</Jockey></Horse>…` (`Horse@Id` is RQ's internal numeric "HORSES" id). keiba notes: "Official detail schema has no horse result finish time or placement field in the tested methods." Element names are from keiba's parser + test stubs (the real PDF was unreachable). | medium |
| Club web services | `/OpenDataWebServices/ClubWebsites.asmx` — ops returning all future meetings for a club (meeting date, track name, meeting name, race calendar URL, friendly date) and `GetNextMeetingForClub`; XML (data.gov.au) | medium |
| Sectionals CSV | `https://www.racingqueensland.com.au/RacingFile.ashx?path=/Sectional/YYYYMMDD_<Venue_With_Underscores>_T.csv` (e.g. `20261010_Eagle_Farm_T.csv`, `20261011_Ladbrokes_Cannon_Park_T.csv`); index page https://www.racingqueensland.com.au/industry/thoroughbred/thoroughbred-sectionals . Not rectangular: header lines `Date,RaceNumber,<DD/MM/YYYY 12:00:00 AM>;<venue>;<race title>;<HH:MM:SS.fff race time>;<route>` then runner lines `DD/MM/YYYY,<raceNo>,<HorseName>;<cloth>;<dist>;<value>;<HH:MM:SS.fff>;…` (triples of marker/value/section time). | high (URL), medium (format) |
| Website pages | `https://www.racingqueensland.com.au/racing/full-calendar/thoroughbred/meeting/{venueCode}/{YYYYMMDD}/race/{n}` and `.../stewards-report` (venue codes seen: `ipsw`, `dalb`, `emer`, `rock`, `camo`, `crns`); greyhound `fields-sheet-report` analogue | medium |

---

## 6. Recommended adapter design (`racingcom` source family)

1. **Discovery:** `GetMeetingByDate(date)` (racing.com) **and** `Calendar.aspx?State=XX` ×8 (RA). Join on date + venue token overlap (strip sponsor words: `Sportsbet`, `Ladbrokes`, `bet365`, `Park`, `Racecourse`, `Royal`, `Gardens`). Persist both ids: racing.com `meetCode`, RA `Key`.
2. **Card/form (morning):** `getRaceForm` per race (≤4 in parallel, 1.2 s pause) + RA `Form.aspx` once per meeting (pedigree, run lines, 600 m splits, records by surface). Cache RA for the day.
3. **Pre-race re-check (T-30, T-10, T-2 min):** `getRaceForm` (scratchings, `liveBarrierNumber`, `jockeyChanged`, `gearHasChanges`, `odds[]`, per-race `trackCondition/trackRating`, `getMeeting.railPosition/weather`) + RA `Scratchings.aspx` as a second opinion.
4. **Results:** poll `getRaceForm` until `hasResults`; confirm with RA `Results.aspx` (official placings/SP/margins). Pull `stewardsReport.htmlCode`, `commentStewards`, `raceEntryTimes`/`timing` for the day-pattern engine (track bias: `positionAtSettled/800/400` vs finish; sectional `sixHundredMetresTime`).
5. **Failure modes:** 403/429 → exponential backoff (20 s×n), reduce concurrency to 1; `errors[]` with `data` → use partial; RA 200 + "not currently available" → not published yet; AppSync key rotation → make the key configurable and surface a clear UI error ("racing.com key changed — update RACING_COM_API_KEY").
6. **Confidence weighting in the verifier:** RA/Racing NSW mirrors are *official* for fields and results (weight 1.0); racing.com is official for VIC and authoritative for odds/sectionals/stewards (0.9); RQ web services official for QLD (1.0) but lack results.

---

## 7. Caveats

- Nothing was fetched live; the AppSync key and the field list may have changed since the clients were written (kyw last commit 2026; racing-predictor 2026). First run must execute `GetMeetingByDate` for today and the introspection probe, and fail loudly if either errors.
- GraphQL argument/field **casing is inconsistent on purpose** (`GetMeetingByDate`, `GetRaceMeetingsByStateNew` vs `getMeeting`, `getRacesForMeet`, `getRaceForm`) — copy exactly.
- Scalar types for several fields (`weight`, `distance`, `startingPrice`, `totalPrizeMoney`, `time`) are inferred from parsing code (they strip `$`, `kg`, `L`, commas); fixtures use those unit-bearing string forms but a tolerant parser is mandatory.
- `meetCode`/`id` format and `time` timezone semantics are not in the evidence — fixtures use placeholders; verify live.
- `api.racing.com/v1/en-au/...` (REST) was **not** found in any public code; it may be a legacy/partner API. The site's real data path is the AppSync GraphQL.
- Racing Queensland XML child elements beyond `Meeting{Id,MeetingDate,TrackName,IsBarrierTrial}`, `Race{Id,RaceNumber,RaceName,TrackRating,Distance,Class}`, `Horse{Id,HorseName}` are constructed in the fixtures.
- Racing NSW `XML.aspx` attributes beyond `race@number`, `nomination@horse/@number/@jockeynumber` are constructed.

---

## 8. Fixture validation performed

- `fixtures/racingcom/racingaustralia-Form.aspx-flemington-2026-10-24.html` was run through the **unmodified** KaiYingWinning `ra.js` parser (`parseForm`, `matchKey`) under Node 22: it returned date/state/venue, `condition="Good 4"`, `rail="True Entire Circuit"`, `weather="Fine"`, 2 races with time/name/distance/prize/conditions, every runner with trainer/stable/jockey/weight/barrier/age/sex/colour/gear, all eleven record categories, `last10`/`hcp`/`scratched` from the strip table, and every run line (venue code, date, distance, condition, class, prize, prize won, jockey, weight, claim, barrier, placings, time, last 600 m, margin, 800 m/400 m positions, price fluctuations, SP). `matchKey` resolved `flemington` → `2026Oct24,VIC,Flemington` and `ballarat` → `2026Oct24,VIC,Sportsbet-Ballarat` from the calendar fixture.
- The same file was run through the `desscartes/horseride` cheerio selectors: `.race-venue-date`, `table.horse-form-table`, `.horse-info .horse-number/.horse-name`, `horsecode` query param, `.plain a.GreenLink` → sire/dam/damsire, `Record:` career line, `table.horse-last-start td.Pos/td.remain`, `a[href*="Meeting.aspx"]`, `a[href*="JockeyLastRuns"]` — all populated.
- RatterAU/Bookie regexes (silks → saddlecloth map, `raceNum` jump times, `Key=` date/state) matched; Kelvin-Agents `Hcp Rating` header detection, `Of $` prize and `Group|Listed` grade regexes and the `(\d+)(e?)` emergency-number regex matched the Acceptances fixture; the Bookie oz-page race-header regex matched the ozracing fixture.
- The REAL `Results.aspx` fixture yields 12 `tr.EvenRow/OddRow` rows with `span.Finish.F{n}`, saddlecloth, `td.horse/.trainer/.jockey` anchors, margin, barrier, weight, penalty and SP cells; all Wayback URL prefixes were removed (the only remaining `web.archive.org` string is in the provenance comment).
- All JSON fixtures parse; all XML fixtures parse (ElementTree); the Racing NSW XML yields `race@number` → `nomination@number/@horse/@jockeynumber` exactly as the tmstipping client reads it.
