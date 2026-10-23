# Sportsbet AU racing JSON gateway (`sportsbet`)

Research report for the RaceLens `sportsbet` source adapter. Written 2026-10-23 from community
code and documentation only (this container cannot reach sportsbet.com.au); nothing below was
fetched live by the author. Every fact carries a confidence tag:

- **high** = reproduced from a wire-verified document or from a raw JSON capture committed to a public repo
- **medium** = inferred from working client code that reads the field/endpoint, envelope not seen
- **low** = from a response hint, JS-bundle path list, or memory; verify on the user's machine first

## 1. Purpose and what this source gives RaceLens

Sportsbet (Flutter-owned AU corporate bookmaker) runs a JSON API gateway at
`https://www.sportsbet.com.au/apigw/*` that its own web app calls anonymously. The
`sportsbook-racing` service behind it is unusually rich for a bookmaker: besides fixed-odds
win/place prices it inlines a full **form guide per runner** (career/track/distance/going splits,
last starts with margins and SP, sire/dam, age/sex/colour, ratings, speed/settling-position map,
Racing & Sports comments, editorial tips), **scratchings and deductions**, **track condition** per
race, **odds fluctuations**, and **results with tote dividends and exotics** once a race is run.
It is therefore a primary source for: meetings for a date, race cards, form, odds and market
movement, scratchings, going, results. It is NOT a source for rail position or weather (only an
editorial "track report" endpoint that is usually empty), nor for official stewards data.

Legal/ethical note: these are undocumented, anonymous endpoints used by Sportsbet's own front end.
They are AU-geo-fenced. Use polite rates, cache, and prefer the batch endpoint.

## 2. Evidence base (sources)

| # | Source | What it contributed | Confidence |
|---|---|---|---|
| S1 | https://github.com/DanielTomaro13/sportsdata-mcp/blob/main/documentation/Sportsbet.md | 2,572-line unofficial reference "verified against live traffic (probed 2026-05-25)" from a logged-out AU client: every racing endpoint, params, verified sizes, response shapes, enums, error envelopes, JS-bundle path list | high |
| S2 | https://raw.githubusercontent.com/DanielTomaro13/sportsdata-mcp/main/src/sportsdata_mcp/specs/sportsbet.yaml | Machine spec: base URL, default headers, 15 racing endpoints with params/types, cache policy (`never_cache` on racecard), classId notes | high |
| S3 | https://github.com/kaballas/yy1/blob/0cd4af7b284a99c492a8faaa7c67d7abf4c011d2/backup/race_10812059_class_1.json | RAW 338 KB `RacecardWithContext?classId=1` capture (Ruakaka R5, 2026-08-15, resulted) — used for every selection/statistics/results field name | high |
| S4 | https://github.com/kaballas/yy1/blob/0cd4af7b284a99c492a8faaa7c67d7abf4c011d2/src/get_data/data/race_10323069_class_1.json | RAW capture (Penola R1, resulted, 5 markets incl. "Live Fixed Win") | high |
| S5 | https://github.com/kaballas/x9/blob/d11735d396cf65404b3a12e9775626c92ce34f88/live/data/sportsbet_racing_json_2026-05-25/race_10513900_class_1.json | RAW capture of the same Mornington R1 event S1 documents (9 markets incl. Head to Head, tempo "Fast", `expectedSettlingPosition`, `awards`) | high |
| S6 | https://github.com/kaballas/yy1/blob/0cd4af7b284a99c492a8faaa7c67d7abf4c011d2/src/get_data/data/race_10248679_class_1.json | RAW capture (statusCode "B", `tippedSelectionsWithTypes` populated) | high |
| S7 | https://github.com/kaballas/yy1/blob/0cd4af7b284a99c492a8faaa7c67d7abf4c011d2/src/get_data/fetch_sportsbet_races.py and `src/get_data/convert_race_to_hf.py`, `build_race_report.py` | Working AllRacing -> RacecardWithContext harvester (daily, 16-120 races/day, Aug-Sep 2026) and a feature converter that reads ~60 field names | high |
| S8 | https://github.com/Kelvin1761/Kelvin-Agents/blob/0bffbeb674d32ef9cc79722c931751c35250315a/.agents/skills/au_racing/claw_sportsbet_form.py and `au_daily_auto/au_daily_schedule.py` | `NextEvents?racingFilters=HR_DOMESTIC&groupByFilters=true` and `Events/{id}/Markets` usage; notes that sportsbet.com.au never blocked them while sportsbetform.com.au 403s non-browsers (Oct 2026) | medium |
| S9 | https://github.com/DanielTomaro13/sportsdata-agents/blob/0c5e2b42ff8f0f585d017e0065e811f93510a0d6/src/sportsdata_agents/interfaces/racingboard/corporate.py | Production racing board: MultipleRacecards shape note (verified live 2026-09-01), WAF flag earned by hammering the single-racecard endpoint on 2026-09-01, `recentOddsFluctuations` ordering | high/medium |
| S10 | https://github.com/l0rdwalker/betshock_v4/blob/528130c5cc386f54792446ed938a1b290a2557f6/Arbie/concreteImplementations/sportsbett/sportsbettEvent.cs (+ `sportsbettProvider.cs`) | Full browser header set captured from the real site incl. `apptoken: cxp-desktop-web`, `channel: cxp`, `x-request-id`; scratched = `statusCode != "A"`; WebSocket push at `/push` | medium |
| S11 | https://github.com/l0rdwalker/betshock_v2/blob/5ab9224a78abebd5da400737f8ce2ab9ad105fbc/Arbie/engine/sportsbet/sports/sportsbet_horses.py | Alternate host `gwapi.sportsbet.com.au/sportsbook-racing/...` (no `/apigw` prefix); scratched = `result == "V"` | medium |
| S12 | https://github.com/BotDev365/SportsbetAU/blob/6f93c867ab56b751b5c483355f2730e6ffeac693/SPTradePlacer/Controller/BookieCtrl.cs | AllRacing + `httpLink` navigation, `markets[0].selections[].runnerNumber/id/name`, `price.winPrice` | medium |
| S13 | https://github.com/declanwalpole/sportsbook-odds-scraper/blob/main/sportsbook_implementations/sportsbet.py | Sports-side `SportCard`/`MarketGroupings` pattern; explicit geo-block error ("Use VPN") when non-JSON content-type returned | medium |
| S14 | https://github.com/bensharkey3/sports-odds-scraper/blob/main/src/handler.py | Header set used in production Lambda (`country-code: AU`, `brand: sportsbet`, Referer) for `sportsbook-sports` | medium |
| S15 | https://github.com/Cwollie/Arbitrage-Betting-Bot/blob/8b80ea7c89e2063b53d77e5f831c07ab20ff7b98/ArbiBettingBot.ipynb | Independent confirmation of `RacecardWithContext?classId=1` -> `racecardEvent.markets[0].selections` | medium |
| S16 | https://github.com/DanielTomaro13/sportsdata-mcp/blob/main/src/sportsdata_mcp/http_client.py | Generic client: HTTP/2 preferred by Akamai CDNs, 401/403/429 handling, "bot-challenge page" detection | medium |

Field tables below were produced by walking S3-S6 programmatically (union of keys over 82
selections, 75 statistics objects, 82 recent-start rows) and cross-checked against S1.

## 3. Base URLs, services, headers, bot protection

### 3.1 Base URL and service map (S1, S2 - high)

```
https://www.sportsbet.com.au/apigw/<service>/...
```

| Sub-path | Service | Racing-relevant? |
|---|---|---|
| `sportsbook-racing/Sportsbook/Racing/...` | Racing service | YES — everything in section 5 |
| `sportsbook-sports/Sportsbook/Sports/...` | Sports service | no (sport fixtures/markets; same market/selection/price shapes) |
| `sportsbook-results/Sportsbook/Results/...` | Results browser | lists classes/competitions with results for a date (sport-oriented; racing classes appear in `Classes?date=today`) |
| `media/nomad/...` | Editorial content | `trackreport`, `racePreview` |
| `sportsbook/graph` | Apollo persisted GraphQL | sport stats only (`EventStats`) |
| `multi-pricer-racing/...`, `racing-event/srm*`, `racing-meeting/feed`, `racing-schedule/{horse,greyhound,harness}/today`, `feed/home/racing` | seen in JS bundles, NOT probed | unknown (low) |
| `acs/bets`, `history/bets`, `ciam/*`, `accounts/*` | account/placement — needs `accesstoken` JWT | out of scope for RaceLens |

Alternate host (S11, medium): `https://gwapi.sportsbet.com.au/sportsbook-racing/Sportsbook/Racing/AllRacing/{date}`
— same paths WITHOUT the `/apigw` prefix. Useful as a fallback host; treat as low-confidence until probed.

All racing reads are **GET**, anonymous, return `application/json`. No pagination anywhere
(payloads are whole; AllRacing ~330 KB, Racecard ~200 KB, MultipleRacecards for 2 events ~364 KB,
BestBetsWithEvents ~505 KB) (S1, high).

### 3.2 Headers (what to send)

Minimum that works in the wild (S7 `fetch_sportsbet_races.py` ran daily with only these — high):

```
User-Agent: Mozilla/5.0            (any browser-like UA; sportsdata-mcp used "Mozilla/5.0 (compatible; sportsdata-mcp/0.1)")
Accept: application/json
```

Recommended "look like the web app" set (S2 defaults + S10 real capture + S14 — medium):

```
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36
Accept: application/json, text/plain, */*
Accept-Language: en-AU,en;q=0.9
Origin: https://www.sportsbet.com.au
Referer: https://www.sportsbet.com.au/horse-racing
apptoken: cxp-desktop-web        (static public app key seen on every request in S10's capture; not needed for anonymous reads)
channel: cxp
x-request-id: <fresh 32-hex uuid per call>   (optional; Sportsbet tracing)
country-code: AU                 (S14, sports side)
brand: sportsbet                 (S14, sports side)
Accept-Encoding: gzip
```

No cookie, token or API key is required for any endpoint in section 5 (S1, S2 — high).

### 3.3 Bot protection, geo-fencing, rate behaviour (what really happens)

- **Geo-blocked outside Australia** (S1, S2, S13 — high). From a non-AU IP the gateway returns
  a non-JSON body (HTML challenge/landing page) — S13 raises "This may be due to Sportsbet
  (australia) geo-blocking outside of Australia. Use VPN". The RaceLens adapter must check
  `Content-Type` starts with `application/json` before parsing, and classify a 403 or an HTML body
  as `GEO_OR_BOT_BLOCKED` rather than "no races".
- **CDN is Akamai** (cookie `AKA_A2=A` and `akstat.io` beacons in S10's captured cookie jar; S16
  notes Akamai prefers HTTP/2 — medium). Use HTTP/2-capable client (Node 22 `fetch`/undici is fine).
- **WAF flag from hammering the single-racecard endpoint** (S9 — high for the event, medium for the
  threshold): on 2026-09-01 a board polling `Events/{id}/Racecard` per race every couple of seconds
  "earned the WAF flag that froze prices". Mitigation adopted by S9: refresh prices via
  `Events/MultipleRacecards?eventIds=...` in batches through one recycled session, near races every
  cycle, far races every ~10th cycle; never fetch individual racecards in the fast loop.
- Observed sustainable pacing: S7 harvested 16-120 racecards per day sequentially with an optional
  `--sleep` between calls; S9's spec defaults are `rate_limit_rps: 10` (token bucket) and
  `request_timeout_seconds: 30`, with 60 s response cache for discovery endpoints and
  **no cache for racecards** (`never_cache: true`, "live racing prices move in seconds") (S2 — high).
- **No HTTP 429 documented** for racing reads; S16 handles 429 generically. Treat 403 as block.
- `sportsbetform.com.au` (the long-form HTML site linked from `longFormLink`) is CloudFront-fronted
  and returns 403 to curl/curl_cffi; it needs a real browser (S8 — medium). Do not depend on it.
- Date-partitioned discovery (`AllRacing/{date}`) is safe to cache for minutes; racecards are not.

### 3.4 Conventions (S1 high unless noted)

- **IDs** are integers: `competitionId` = meeting (venue+day; stable per venue? Caulfield 279,
  Rosehill 580, Morphettville 488, Doomben 330, Belmont 231, Kembla Grange 423, Mornington 487,
  Taree 614, Townsville 638, Shepparton 58, Ruakaka 583 recur across captures months apart, so the
  id looks venue-stable — medium), `id` on an event = race (`eventId`, ~10.5-10.9 million in 2026),
  `markets[].id` (~2.4-2.6e8), `selections[].id` (~1.18-1.29e9). `externalId` on events/selections
  is a UUID string (the AAP silk image path reuses it).
- **classId** for racing: 1 Horses - Aus/NZ, 2 Horses - International, 3 Harness (inferred, low),
  4 and 112 Greyhound Racing, 5 Horse Racing: Futures - AUS/NZ, 108 Jockey Challenge, 161 Racing
  Extras. `RacecardWithContext` and `ResultedEvents` REQUIRE the matching classId.
- **Time**: all `startTime`, `meetingDate`, `competitionStartTime`, `estStartTime`, `dateTimeTo`,
  `firstEventStartTime` are **Unix epoch seconds UTC (integer)**. Path/query dates are
  `YYYY-MM-DD` in Sportsbet local time (AEST/AEDT). `recentStartsThoroughbreds[].date` is `DD/MM/YYYY`.
- **Event `statusCode`**: `A` active/open, `B` observed on resulted-but-pending/ "bookmaker priced"
  races, `R` resulted, `S` suspended (seen on markets/selections after the race), `W` winner
  (sport results). **`bettingStatus`**: `PRICED`, `OFF`, `RESULTED`.
- **Selection `result`** (Win or Place market): `"-"` not yet run, `W` won, `P` placed (also used
  for 4th), `L` lost, `V` void/scratched (S3-S5 — high). Secondary-market selections omit `result`.
- **Scratching**: `isOut: true` is the documented flag (S1). Community parsers also use
  `result == "V"` (S11) and `statusCode != "A"` (S10). Use any-of (section 6.4).
- **Price object** (`prices[]` entries keyed by `priceCode`):
  `L` live fixed price `{priceCode, winPrice, winPriceNum, winPriceDen, placePrice, placePriceNum, placePriceDen, topicLink}`;
  `MDP` mid-day price and `TMD` top-of-mid-day `{priceCode, winPrice, topicLink}`; `MID` seen once (S3).
  Decimal = `1 + num/den` (e.g. 11/20 -> 1.55). A scratched runner's `L` entry has only `priceCode` + `topicLink`.
  `availablePriceTypes` on the market is a CSV like `"MDP,TMD,L,TMDMDP"`; `homeTote` e.g. `"SUT"`.
- `topicLink` = pub/sub topic `Sportsbet/Sportsbook/Sports/{classId}/Competitions/{compId}/Events/{eventId}[/Markets/{mId}[/Selections/{sId}[/Prices/{code}]]]`
  (used by the WebSocket price push at `https://www.sportsbet.com.au/push`, S10 — low for protocol).
  `httpLink` = relative path to prefix with `/apigw/sportsbook-racing/` (racing) e.g.
  `Sportsbook/Racing/Events/10513900/Racecard`, `Sportsbook/Racing/Events/10812059/Markets/250890610`.
- **Error envelopes**: racing service `{"code":"ResourceNotFound","message":"/Sportsbook/Racing/TrackSummaries does not exist"}`;
  gateway `{"message":"404 - \"\"","code":"ERR_BAD_REQUEST","uniqueIdentifier":"<uuid>"}` or
  `{"message":"404 - undefined","code":"ERR-IS",...}`. HTTP 200 with `[]` is normal for media endpoints.

## 4. How RaceLens gets each thing (recipes)

| Need | Call(s) | Fields | Conf. |
|---|---|---|---|
| Meetings for a date | `GET /sportsbook-racing/Sportsbook/Racing/AllRacing/{YYYY-MM-DD}` | `dates[0].sections[raceType=="horse"].meetings[]` -> `id` (competitionId), `name`, `classId`, `regionName`, `isInternational`, `events[]{id, raceNumber, startTime, name, distance, statusCode, bettingStatus, httpLink}` | high |
| Race card (runners, barrier, jockey, trainer, weight, scratched, odds) | `GET .../Events/{eventId}/RacecardWithContext?classId=1` (or `.../Racecard`) | `racecardEvent.markets[name=="Win or Place"].selections[]` -> `runnerNumber`, `name`, `drawNumber` (barrier), `jockey`, `trainer`, `weightGram` (/1000 = kg), `weightClaim`, `isOut`, `result`, `statusCode`, `prices[priceCode=="L"].winPrice/placePrice`, `recentOddsFluctuations`, `mobileSilkImage` | high |
| Form (career, track/dist/going splits, last starts, sire/dam, age/sex, ratings, comment) | same payload | `selections[].statistics.*` (section 6.3) | high |
| Speed map / settling | same payload | `statistics.expectedSettlingPosition` (Leader / Off Pace / Midfield / Off Midfield / Backmarker), `statistics.speed` (0-100), race-level `tempo` (Fast / Normal / Not Available) | high |
| Odds + movement | same payload (or batched `Events/MultipleRacecards?eventIds=a,b,c`) | `prices[L]`, `statistics.openPrice/fluc1/fluc2`, `recentOddsFluctuations` (newest-first), `marketMover`, `powerPlayPricing` (promo), `MDP`/`TMD` opening-board prices | high |
| Scratchings + deductions | same payload | `selections[].isOut`, `racecardEvent.deductions[]{name, runnerNumber, dateTimeTo, value, placeDeduction}` | high |
| Editorial tips | same payload; `GET .../BestBets`, `.../BestBetsWithEvents` | `tippedSelectionProvider`, `tippedSelection1..4`, `tippedSelectionsWithTypes[]{outcomeId, tipType}`, `overview` text; BestBets `meetings[].events[].tipsters[].tips[]` | high |
| Results for finished races | `GET .../Events/{eventId}/RacecardWithContext?classId=1` after the race; meeting-wide: `GET .../Competitions/{competitionId}/ResultedEvents?classId=1&date=YYYY-MM-DD` | `racecardEvent.results[]{place, runnerNumber, name, result, winPrice, placePrice, dividend[]}`, `exoticResults[]{name, runnerNumbers[], dividend}`, selection `place`/`margin`; ResultedEvents gives per-race `result` strings only | high / medium |
| Track condition (going) | racecard `trackStatus` ("Good (4)", "Soft (6)", "Heavy (10)"); meeting `events[].track`; competition `events[].trackStatus`; `NextEvents` events `trackStatus` | string with rating in parentheses; parse `/^(\w+)(?: \((\d+)\))?$/` | high |
| Rail / weather | `GET /media/nomad/trackreport?eventDate=YYYY-MM-DD[&raceType=horse&trackName=Flemington]` | returns `[]` when no editorial copy (both verified calls were empty); when populated "track condition, rail position, weather, editorial comments" — field names unknown | low |
| Next-to-go | `GET .../RacingMultisEvents` (`nextToJump[]`), `GET .../NextEvents?racingFilters=HR_DOMESTIC&groupByFilters=true` (next ~30 races with `trackStatus`) | section 5.11 / 5.12 | high / medium |
| Jockey book for the day | `GET .../JockeyHub/TopJockeys` | `jockeyList[]{jockeyName, rideCards[]{eventId, eventOutcome, raceNumber, trackName, trainer, startTimeInUnix}}` | high |
| Sibling races / nav | `GET .../Events/{eventId}/Meeting`, `GET .../Competitions/{competitionId}`, or `racecardContext.events[]` | section 5.2 / 5.6 | high |

Cross-source join keys RaceLens can use: venue `name` + `raceNumber` + local date (AllRacing);
runner `name` (uppercase-normalise; Sportsbet uses "Can't Be Reel" style with apostrophes) and
`runnerNumber`; `drawNumber` = barrier; `jockey`/`trainer` strings are initials-style
("M M Laurie", "J & R Vance") for AU/NZ. `longFormLink` encodes the sportsbetform ids
(`/form/RUNZ_15082026_05.html` = region code + DDMMYYYY + race; `/mobile/{eventId}/{runnerNumber}/`).

## 5. Endpoints (racing service, all GET, anonymous)

Base for this section: `https://www.sportsbet.com.au/apigw/sportsbook-racing/Sportsbook/Racing`.

### 5.1 `AllRacing/{eventDate}` — meetings and races for a date  (S1, S2, S7, S10, S12 — high)

- `eventDate` path, `YYYY-MM-DD` local. Verified `AllRacing/2026-05-25` -> 200, ~328 KB.
- Response:

```jsonc
{ "dates": [ { "meetingDate": 1779633000,                 // epoch s, local midnight
    "sections": [ { "displayName": "Horses", "displayOrder": 100, "raceType": "horse",   // horse|harness|greyhound
        "meetings": [ { "id": 487, "name": "Mornington", "geolocationExclusion": [], "classId": 1,
            "isInternational": false, "className": "Horses - Aus/NZ", "regionName": "Australia",
            "streamingAvailable": false, "availableStreamingType": "sky", "mbsAvailable": false,
            "events": [ { "id": 10513900, "raceNumber": 1, "startTime": 1779679800,
                "name": "R1 Asset Painting Services Mdn Plate", "hasBIR": true, "hasBIRStarted": false,
                "sort": 10, "statusCode": "A",
                "streaming": { "liveStream": { "provider": "sky", "channel": "1" }, "replay": { "provider": "sky" } },
                "streamingAvailable": false, "availableStreamingType": "sky", "mbsAvailable": false,
                "httpLink": "Sportsbook/Racing/Events/10513900/Racecard", "regionGroup": "Aus/NZ",
                "type": "horse", "category": "standard", "bettingStatus": "PRICED", "isInternational": false,
                "distance": "1200", "displayName": "R1 Mornington" } ] } ] } ] } ] }
```

- Filter AU thoroughbreds: `section.raceType == "horse" && meeting.regionName == "Australia" && !meeting.isInternational`
  (S8 does exactly this; NZ meetings are `classId 1` but `regionName: "New Zealand"`). Greyhounds/harness
  reuse venue names (Newcastle), so always key on `raceType` too.
- Fixture: `fixtures/sportsbet/allracing_2026-10-24.json` (constructed).

### 5.2 `Events/{eventId}/Meeting` — parent meeting + all races (+pools)  (S1 — high)

Verified `Events/10513900/Meeting` -> 200, ~25 KB.

```jsonc
{ "classId": 1, "className": "Horses - Aus/NZ", "displayOrder": -90, "id": 487, "meetingType": "horses",
  "name": "Mornington", "resulted": false, "totalEventsInMeeting": 7, "regionName": "Australia", "sameGameMultiEnabled": true,
  "events": [ { "id": 10513900, "classId": 1, "raceNumber": 1, "startTime": 1779679800, "hasBIR": true, "hasBIRStarted": false,
      "numMarkets": 12, "className": "Horses - Aus/NZ", "competitionId": 487, "competitionName": "Mornington",
      "track": "Good (4)",                       // going lives here on the meeting view
      "bettingStatus": "PRICED", "eventResulted": false, "distance": "1200", "name": "R1 ...", "sort": 10, "statusCode": "A",
      "streamingAvailable": false, "availableStreamingType": "sky", "mbsAvailable": false, "region": "Australia", "regionGroup": "Aus/NZ",
      "isInternational": false, "topicLink": "Sportsbet/Sportsbook/Sports/1/Competitions/487/Events/10513900",
      "httpLink": "Sportsbook/Racing/Events/10513900/Racecard", "markets": [], "type": "horse", "category": "standard",
      "streaming": { ... }, "grade": "UNKNOWN_GROUP", "isFeatureRace": false } ],
  "pools": [] }                                   // tote pools; observed empty for AU
```

Fixture: `event_meeting_flemington_10950007.json` (constructed).

### 5.3 `Events/{eventId}/Racecard[?selectionNames=...]` — one race, unwrapped  (S1, S2, S9, S10 — high)

- Verified `Events/10513900/Racecard` -> 200, ~198 KB; `?selectionNames=Can%27t%20Be%20Reel` -> ~94 KB
  (restricts to one runner; URL-encode apostrophes).
- Response is the **`racecardEvent` object itself** (no envelope). Shape: section 6.
- Do NOT poll this per race at high frequency (section 3.3). Fixture: `racecard_flemington_r1_resulted.json` (constructed, resulted).

### 5.4 `Events/{eventId}/RacecardWithContext?classId={classId}` — race + nav context  (S1-S7, S15 — high)

- `classId` query **required** (1 for AU/NZ horses; wrong value -> error envelope). Verified -> 200, ~201 KB.
- Response: `{ "racecardEvent": { ...section 6... }, "racecardContext": { "meetings": [...], "events": [...], "pools": [] } }`
- `racecardContext.meetings[]` (all meetings of the same code today): `{classId, className, name, competitionId, id /*an eventId in that meeting*/, isFullyResulted, firstEventStartTime, lastEventStartTime}`.
- `racecardContext.events[]` (sibling races): `{id, raceNumber, startTime, distance, name, trackStatus, statusCode, mbsAvailable, sameGameMultiEnabled}`.
- This is the workhorse call. Fixtures: `racecard_with_context_flemington_r7_priced.json` (constructed, pre-race),
  `racecard_with_context_REAL_ruakaka_r5_resulted_trimmed.json` (REAL capture S3, trimmed).

### 5.5 `Events/MultipleRacecards?eventIds=a,b,c` — batch  (S1 verified, S9 shape — high/low)

- Verified `?eventIds=10513900,10513897` -> 200, ~364 KB. Each entry has the same `markets[].selections[]`
  shape as a racecard (S9 reads `.markets` per entry; "`recentOddsFluctuations` is populated for priced AU
  races"). The **envelope key is unconfirmed** — S2 hints `{racecards:[...]}`, S1 says "wrapped collection".
  Adapter: accept a bare array OR a single-key object whose value is an array. Web client sends up to ~25 ids.
- Preferred way to refresh prices for many races (section 3.3). Fixture: `multiple_racecards_flemington_r7_r8.json` (constructed, envelope low).

### 5.6 `Competitions/{competitionId}` — meeting summary  (S1 — high)

Verified `Competitions/614` -> 200, ~5 KB. `{id, name, classId, className, region, startTime, topicLink, events:[...], type, category}`;
each event `{id, raceNumber, startTime, result /* "" until settled */, distance, name, classId, className, competitionId,
competitionName, sort, statusCode, streamingAvailable, availableStreamingType, mbsAvailable, topicLink, httpLink,
trackStatus /* "Heavy (10)" */, type, category, streaming}`. Fixture: `competition_flemington_356.json`.

### 5.7 `Competitions/{competitionId}/ResultedEvents?classId=1&date=YYYY-MM-DD`  (S1, S2 — high)

- Both query params required and must match the competition's class; mismatch -> 404. Verified -> 200, ~4 KB.
- Response is a **bare JSON array** of event summaries identical to 5.6 `events[]` plus `result` (string, `""` until
  placings settled; the populated format was not observed — low). Same-day call before any race finished returns 200 with
  the upcoming events. Fixture: `resulted_events_flemington_2026-10-24.json`.

### 5.8 `Events/{eventId}/Markets` and `Events/{eventId}/Markets/{marketId}`  (S8, S3 — medium/low)

- `.../Markets/{marketId}` is the `httpLink` carried by every market object in a racecard (verified field, endpoint not probed).
- `.../Markets` (no id) is called by S8 and walked generically for objects having `runnerNumber` and `winPrice`/`placePrice`.
  Envelope unverified; most likely an array of market objects as in `racecardEvent.markets[]`. Fixture: `event_markets_flemington_r7.json` (constructed, low-medium).

### 5.9 `Events/{eventId}/Results` (racing)  (S1 — low)

"Returns 404 for events that have not yet been resulted; only test it against events with `result` populated".
Shape not documented for racing (sports variant: `{..., markets:[{selections:[{name, oddsDecimal, place, statusCode:"W"}]}]}`).
RaceLens should get results from 5.4 instead. No fixture.

### 5.10 `Futures`  (S1 — high)

Bare array of future events (`classId 5`, `category: "future"`) each with `markets[]` lacking selections
(fetch the racecard via `httpLink` for prices). Fixture: `futures.json`.

### 5.11 `RacingMultisEvents` — next-to-jump queue  (S1 — high)

`{ "nextToJump": [ { "id", "competitionId", "competitionName", "startTime", "bettingStatus", "competitionDisplayOrder", "status": "A", "country": "Australia" } ] }`
(~75 KB verified; other grouping keys may exist). Fixture: `racing_multis_events.json`.

### 5.12 `NextEvents?racingFilters=HR_DOMESTIC&groupByFilters=true`  (S8 — medium)

Used in production by S8 (Oct 2026): returns only the next ~30 races; event objects expose `id`, `competitionName`,
`raceNumber`, `startTime`, `trackStatus` (going), `statusCode`, `country`. Grouping envelope and other
`racingFilters` values unknown. Fixture: `next_events_hr_domestic.json` (constructed, low-medium).

### 5.13 `BestBets`, `BestBetsWithEvents`  (S1 — high)

`BestBets` (~38 KB): `{ meetings:[{ meetingId, name, date:"YYYY-MM-DD", events:[{ eventId, raceNumber, startTime,
tipsters:[{ name, type:"MAIN", tips:[{ type:"BEST"|"VALUE"|null, sort, runnerNumber, name, outcomeId, mobileSilkImage }] }] }] }] }`.
`BestBetsWithEvents` (~505 KB): `{ tipsModules:[{ tipsterName, meeting, meetingId, startTime, tips:[{type, sort, runnerNumber,
outcomeId, name, eventId, startTime, raceNumber, mobileSilkImage}] }], events:[ full event+market trees ] }`.
Single-book editorial opinion — label it as such in the UI. Fixture: `best_bets.json`.

### 5.14 `JockeyHub/TopJockeys`  (S1 — high)

`{ jockeyList:[{ jockeyName, country, rideCards:[{ eventId, eventOutcome /*horse*/, startTimeInUnix, raceNumber, trackName, trainer }] }] }` (~55 KB). Fixture: `jockeyhub_top_jockeys.json`.

### 5.15 `Challenges/All`, `Megabets`  (S1 — high)

Arrays of meta-events (`classId "108"` Jockey Challenge, `"161"` Racing Extras — note classId is a STRING here),
same event-summary shape, `category: "jockey_challenge"`. Not needed by RaceLens.

### 5.16 `PopularSrms?hierarchyLevel=event&ids=10513900&maxItems=5&minUniqueCount=5&sortBy=popularity&popularsrms=true`  (S1, S2 — high)

`{ popularSRMs:[{ ranking, backers, lastPrices:[...], eventId, marketIds:[...], selections:[selectionIds] }], events:[ event with markets ] }`.
`hierarchyLevel` in `event|competition|class`. Fixture: `popular_srms_event_10950007.json`.

### 5.17 Media: `/apigw/media/nomad/trackreport`, `/apigw/media/nomad/racePreview`  (S1 — high that they exist, low on populated shape)

- `trackreport?eventDate=YYYY-MM-DD[&raceType=horse&trackName=Caulfield%20Heath]` -> `[]` in both verified calls; when
  populated contains track condition, rail position, weather, editorial comments (names unknown). `trackName` must be paired with `raceType`.
- `racePreview?raceType=horse&trackName=...&raceNumber=N&eventDate=YYYY-MM-DD` -> `{"videoUrl":"","subtitleUrl":""}` (32 B).
- Fixtures: `media_trackreport_empty.json`, `media_race_preview_empty.json`.

### 5.18 Known-dead / unprobed paths  (S1 — high that TrackSummaries 404s; low otherwise)

`Sportsbook/Racing/TrackSummaries` -> 404 ResourceNotFound. Present in JS bundles but unprobed:
`/apigw/racing-schedule/{horse|greyhound|harness}/today`, `/apigw/racing-meeting/feed`, `/apigw/feed/home/racing`,
`/apigw/racing-event/srm`, `/srm/popular`, `/srm/prepackaged`, `/apigw/multi-pricer-racing/combinations/price/racing`.
`/apigw/page-content/homepage/racing` (verified 200) returns homepage layout modules, not data.

## 6. The racecard event object (field reference)

Source: union over S3-S6 raw captures + S1. Types are JSON types as observed. "(resulted)" = only present after the race.

### 6.1 `racecardEvent` top level

| Field | Type | Notes |
|---|---|---|
| `id` | int | eventId |
| `raceNumber` | int | |
| `distance` | string | metres as string, e.g. `"1600"` |
| `className`, `classId` | string, int | `"Horses - Aus/NZ"`, 1 |
| `competitionId`, `competitionName` | int, string | meeting id / venue |
| `startTime`, `competitionStartTime` | int | epoch s |
| `estStartTime` | int | (sometimes) estimated jump time |
| `name`, `displayName` | string | `"R5 Ruakāka Beach Front Motel (Bm65)"`, `"R5 Ruakaka"` — class is often in parentheses in `name` |
| `statusCode` | string | `A` / `B` / `R` |
| `bettingStatus` | string | `PRICED` / `OFF` / `RESULTED` |
| `trackStatus` | string | going, `"Good (4)"`, `"Soft (6)"`, `"Good"` (no number for some) |
| `tempo` | string | `"Fast"`, `"Normal"`, `"Not Available"` — Sportsbet's pace call |
| `overview` | string | race-level editorial preview naming runners in CAPS with (number) |
| `country` | string | `"Australia"`, `"New Zealand"` |
| `isInternational` | bool | (sometimes) |
| `eventSort` | string | `"MTCH"` |
| `hasBIR`, `hasBIRStarted` | bool | bet-in-running flags |
| `livePriceResultConfirmed`, `livePriceSettled`, `nonLivePriceSettled` | bool | settlement progress |
| `quinellaAvailable`, `exactaAvailable`, `trifectaAvailable`, `firstFourAvailable` | bool | exotics offered |
| `srmExoticsConfig` | obj | `{availableExotics:{...}, enabled, guaranteedPrice}` |
| `srmExoticsMarketList`, `sgmMarketList`, `topXFinishMarketList` | arrays | same-race-multi market variants (`name: "Win"` etc., `statusCode`, `externalId`, slim selections) — ignore |
| `markets` | array | section 6.2 |
| `results` | array | (resulted) section 6.5 |
| `exoticResults` | array | (resulted) `{name:"Quinella"|"Exacta"|"Trifecta"|"First 4", runnerNumbers:[string], dividend:string}` |
| `deductions` | array | `{name, runnerNumber, dateTimeTo (epoch), id, isValid:"Y", priceType:"L", value (cents in $ win), placeDeduction}` — late scratchings |
| `tippedSelectionProvider` | string | `"BESTBETS_EDITORIAL"` or `"R_AND_S"` |
| `tippedSelection1..4` | int | selection ids in tipped order |
| `tippedSelectionsWithTypes` | array | `[{outcomeId, tipType:"BEST"|"VALUE"}]` (may be `[]`) |
| `longFormLink`, `longFormAvailable` | string, bool | `https://www.sportsbetform.com.au/form/RUNZ_15082026_05.html` |
| `externalId` | string | UUID |
| `grade`, `isFeatureRace` | string, bool | `"UNKNOWN_GROUP"` observed even for a Group race day; enum otherwise unknown |
| `type`, `category` | string | `"horse"`, `"standard"` (`"future"`, `"jockey_challenge"` elsewhere) |
| `streaming`, `streamingAvailable`, `availableStreamingType`, `raceReplayAvailable`, `showFoldIcon`, `powerPlayExtra`, `sameGameMultiEnabled`, `mbsAvailable`, `sort`, `topicLink` | misc | UI flags |

### 6.2 `markets[]`

| Field | Type | Notes |
|---|---|---|
| `id`, `name` | int, string | names seen: `Win or Place` (the runner market), `Live Fixed Win`, `Head to Head`, `Odds vs Evens`, `Diamond in the Roughies`, `Back the Field`, `Insure 2`, `Insure 3`, `Betting Without` |
| `marketType` | string | `"-"` |
| `marketSort` | string | `--` Win/Place, `LR` Live Fixed Win, `RH` head-to-head, `RO` odds/evens, `EX` exotic promo, `I2`/`I3` insure, `WO` betting without |
| `availablePriceTypes` | string CSV | `"MDP,TMD,L,TMDMDP"`, `"MID,MDP,L"`, `"L"` |
| `statusCode` | string | `A` open, `S` suspended/closed |
| `numPlaces` | int | places paid (3) |
| `eachwayAvailable`, `placeAvailable`, `livePriceAvailable`, `BIR`, `powerPlay`, `international`, `isDisplayed`, `mbsAvailable`, `cashoutIcon` | bool | |
| `homeTote` | string | `"SUT"` (SuperTAB) etc. |
| `poolDividendList` | array | (resulted) tote pool results `{dividendValue, legResults, races, name, poolType:"Running Double"}` |
| `blurb` | string | T&C text |
| `accMax`, `accRestriction`, `sort`, `geolocationExclusion`, `trifectaAvailable`..., `cashoutAvailablePriceTypes`, `topicLink`, `httpLink` | misc | |
| `selections` | array | section 6.3 |

### 6.3 `selections[]` of the **Win or Place** market (runner object)

| Field | Type | Notes |
|---|---|---|
| `id` | int | selection/outcome id (used by BestBets `outcomeId`, `tippedSelection*`) |
| `name` | string | horse name |
| `runnerNumber` | int | saddlecloth |
| `drawNumber` | int | **barrier** |
| `emergencyRunnerNumber` | int | (rare) emergency number |
| `jockey`, `trainer` | string | `"Patrick Moloney"`, `"M M Laurie"` / `"J & R Vance"` |
| `trainerLocation` | string | stable base, e.g. `"Cambridge"` |
| `weightGram` | int | carried weight in grams (59500 = 59.5 kg) |
| `weightClaim` | string | apprentice claim e.g. `"a2"`, `"a1.5"` (present on 27/82) |
| `shortForm` | string | last-4 form string, `"X007"`, `"2"` (x = spell) |
| `isOut` | bool | **scratched** |
| `statusCode` | string | `A` active; `S` after race/suspended |
| `result` | string | `-`, `W`, `P`, `L`, `V` |
| `resultConfirmed` | bool | (resulted) |
| `place` | int | (resulted) finishing position (all finishers) |
| `margin` | string | (resulted) `"1.5L"` behind winner (winner also has a margin string) |
| `dividend` | array[string] | (resulted, placings) `"SP:4.80"`, `"NSW/PL:4.4/1.7"`, `"UNI/PL:4.6/1.6"`, `"MID/PL:..."`, `"STAB/PL:..."`, `"NTS:..."`, `"NTL:..."`, `"TF:3.4"`, `"TT+/MD:..."` — tote code `:` win[/place] |
| `prices` | array | price objects by `priceCode` (section 3.4) |
| `recentOddsFluctuations` | array[number] | up to 10, **newest-first**: `[0]` equals `statistics.fluc2` (previous) in all 3 captures; current price = `prices[L].winPrice` / `statistics.fluc1`; `[]` when scratched |
| `marketMover` | bool | book-flagged mover |
| `powerPlayPricing` | obj | `{sPrice, rPrice, gPrice, vPrice, pPrice, lPrice, mPrice, ePrice}` promo prices (ignore for modelling) |
| `mobileSilkImage` | string | `https://assets.sbstatic.com.au/silks/AAP/{eventExternalId}/{uuid}.png` |
| `longFormLink` | string | `https://www.sportsbetform.com.au/mobile/{eventId}/{runnerNumber}/` |
| `racingIQShortformAvailable`, `runnerCountry` | bool, string | `"AUS"`, `"NZ"` |
| `multiplesKey`, `sort`, `topicLink` | misc | |
| `statistics` | obj | section 6.4 |

### 6.4 `selections[].statistics` (form)

Record strings are `"starts:wins,seconds,thirds"` e.g. `"54:6,5,7"`.

| Field | Type | Notes |
|---|---|---|
| `total` | string | career record |
| `distance`, `track`, `distanceTrack` | string | at this distance / this track / track+distance |
| `firm`, `good`, `soft`, `heavy`, `synthetic`, `jumps` | string | by going |
| `firstUp`, `secondUp`, `thirdUp`, `fourthUp` | string | by run in preparation |
| `horseJockey` | string | this horse with today's jockey |
| `winPercentage`, `placePercentage` | number | % |
| `formFig`, `lastSix` | string | last-six form figures, e.g. `"73x007"` (both equal in captures) |
| `expectedSettlingPosition` | string | **speed map**: `Leader`, `Off Pace`, `Midfield`, `Off Midfield`, `Backmarker` |
| `speed` | int | 0-100 early-speed score (100 = leader) |
| `dryRating`, `wetRating` | string | numeric ratings as strings, `"97"` |
| `sire`, `dam` | string | `"Deep Field (AUS)"`, `"Kiss The Daddy (USA)"` |
| `age` | int | |
| `sex` | string | `g`, `m`, `h`, `f`, `c` (also seen uppercase `"G"`) |
| `colour` | string | `b`, `ch`, `br`, `gr` ... |
| `blinkers` | bool | gear flag (only blinkers exposed) |
| `prizeMoney` | int | career earnings in whole dollars |
| `openPrice`, `fluc1`, `fluc2` | number | opening price, current (latest) fluc, previous fluc |
| `overview`, `overviewProvider` | string | runner comment; provider `"R_AND_S"` (Racing and Sports) |
| `awards` | array | badges `{type, rate, awardTitle, awardDescription, iconName}`; types seen: `trackExpert`, `perfectPrep1stUp`, `podiumChamp`, `likesTheWet` |
| `lastStart` | obj | observed `{}` in every capture (resulted) — populated shape unknown (low) |
| `recentStartsThoroughbreds` | array | last starts, newest first, up to 6 (see below) |

`recentStartsThoroughbreds[]` (all 16 keys present on every row):

`place` int, `totalRunners` int, `date` `"DD/MM/YYYY"`, `trackName`, `distance` `"1600m"`, `trackStatus` (`"Good"|"Soft"|"Heavy"|"Firm"|"Synthetic"`),
`trackStatusValue` int|null (e.g. 10), `margin` `"7.3L"`, `jockey`, `weight` `"59kg"`, `barrier` int, `startingPrice` `"$7.20"`,
`class` `"BM65"`, `time` `"01.43.77"`, `first` `"Zenith (54.5kg)"`, `second` `"Sugar Daddy (59kg)"`.
Barrier trials appear here too (S7's report builder filters "trials") — detect via `class` text.

Scratching detection recommended for the adapter: `scratched = isOut === true || result === "V" || (statusCode !== "A" && bettingStatus !== "RESULTED")`
(the three signals used respectively by S1, S11 and S10).

### 6.5 `racecardEvent.results[]` (after the race)

`{ id, name, runnerNumber, result: "W"|"P", mobileSilkImage?, winPrice, placePrice?, jockey, trainer, drawNumber, place, dividend:[string] }`
— top 4 only, **not sorted by place** (captured order 3,4,2,1), 4th place carries `result:"P"` and a lone `"SP:x"` dividend.
Full finishing order is in `markets[WinOrPlace].selections[].place` (+ `margin`). Dead-heats/protests: not observed.

## 7. Fixtures written

Directory: `/home/user/milana-source/racelens/research/fixtures/sportsbet/`. Constructed files carry a top-level
`_fixtureNote` (array responses carry it as a leading note object that must be skipped). Venue/date for constructed data:
Flemington, 2026-10-24 (Saturday), AEDT; competitionId 356 and all horses/people/ids invented.

| File | Endpoint | Real or constructed | Conf. |
|---|---|---|---|
| `allracing_2026-10-24.json` | `AllRacing/{date}` | constructed | shape high |
| `event_meeting_flemington_10950007.json` | `Events/{id}/Meeting` | constructed | shape high |
| `competition_flemington_356.json` | `Competitions/{id}` | constructed | shape high (`result` format low) |
| `resulted_events_flemington_2026-10-24.json` | `Competitions/{id}/ResultedEvents` | constructed (array) | shape high |
| `racecard_with_context_flemington_r7_priced.json` | `Events/{id}/RacecardWithContext?classId=1` pre-race | constructed | high (pre-race `A/PRICED` values from S1) |
| `racecard_flemington_r1_resulted.json` | `Events/{id}/Racecard` resulted | constructed | high |
| `racecard_with_context_REAL_ruakaka_r5_resulted_trimmed.json` | `RacecardWithContext?classId=1` | **REAL capture (S3), trimmed** | high |
| `event_markets_flemington_r7.json` | `Events/{id}/Markets` | constructed | low-medium (envelope) |
| `multiple_racecards_flemington_r7_r8.json` | `Events/MultipleRacecards` | constructed | low (envelope key) |
| `next_events_hr_domestic.json` | `NextEvents?racingFilters=HR_DOMESTIC&groupByFilters=true` | constructed | low-medium |
| `best_bets.json`, `jockeyhub_top_jockeys.json`, `racing_multis_events.json`, `popular_srms_event_10950007.json`, `futures.json` | as named | constructed | shape high |
| `media_trackreport_empty.json`, `media_race_preview_empty.json` | media/nomad | verified empty bodies | high |
| `error_resource_not_found.json`, `error_gateway_404.json` | error envelopes | from S1 | high |

Fixture generator (reproducible): scratchpad `tools/gen_fixtures.py` (not committed; regenerate by re-running it against S3).

## 8. Caveats and open questions

1. No live request was made from this environment; all "verified" claims are S1's (2026-05-25 probe) or raw
   captures (Mar-Sep 2026). The user's first run should execute `AllRacing/{today}` and one `RacecardWithContext`
   and diff keys against section 6; log any new keys.
2. Geo-fence: the user's machine must have an Australian IP. Non-JSON `Content-Type` or 403 = blocked; surface clearly.
3. Pre-race selection values (`statusCode:"A"`, `result:"-"`, market `statusCode:"A"`) come from S1's prose; every raw
   capture available was post-race (`S`/`R`). Scratched-runner representation pre-race (fixture: `isOut:true, result:"V", statusCode:"S"`)
   is a best-effort composite — verify on day one.
4. `MultipleRacecards` envelope, `NextEvents` envelope, `Events/{id}/Markets` envelope, populated `trackreport` and `lastStart` shapes are unverified.
5. `classId 3` for harness is an inference (not in S1's class table); greyhounds appear as both 4 and 112.
6. Rail position and weather are NOT reliably available from Sportsbet — source them elsewhere (Racing Australia / Racing.com / RSN / BOM) and only use `trackreport` opportunistically.
7. Rate limits are undocumented; the only hard datum is a WAF freeze after per-race polling every few seconds. Stay at <= 1 req/s sustained, batch with `MultipleRacecards`, cache AllRacing ~5 min, never cache prices.
8. The `apptoken` value `cxp-desktop-web` and the `/push` WebSocket come from one 2024 capture (S10) and may have rotated; they are not required for reads.
9. Horse names may contain apostrophes/diacritics (`Ruakāka`); normalise with NFKD + uppercase + strip non-alphanumerics before cross-source matching.
