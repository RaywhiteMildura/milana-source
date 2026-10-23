# TAB (Tabcorp) public JSON API — `tab-info-service` and `historical-results-service`

Source key: **`tab`** · Researched 2026-10-23 for RaceLens · Fixtures: `research/fixtures/tab/`

> **Honesty note.** This container cannot reach `api.beta.tab.com.au` (proxy blocks racing hosts), so **nothing below was fetched live**. Every fact is reconstructed from community code, recorded responses and issue threads found on GitHub. Each fact carries a confidence: **high** = seen in a real recorded response or a Swagger spec posted by a user; **medium** = consistent across 2+ independent code bases that read the field; **low** = single source, a code comment, a "response_hint", or my own memory. Verify the first live call on the user's machine and compare against the fixtures.

---

## 1. Purpose and what this source gives RaceLens

TAB (Tabcorp) runs the state totalisator for NSW/VIC/ACT/QLD/SA/TAS/NT and its web/app front-end is driven by an anonymous, read-only JSON API (`api.beta.tab.com.au/v1/...`). For a thoroughbred (`R`) meeting it gives:

| Need | Available? | Where |
|---|---|---|
| Meetings for a date (venue, state, track condition, rail, weather) | **Yes** | `/racing/dates/{date}/meetings` |
| Race card (runner number, name, barrier, jockey, trainer, weight, scratched, silks) | **Yes** | `/races/{n}` |
| Odds: fixed win/place, flucs/opening price, tote win/place, market movers, favourite flags | **Yes** | `/races/{n}` → `runners[].fixedOdds`, `runners[].parimutuel` |
| TAB's own form ratings (`dfsFormRating`, `techFormRating`, `earlySpeedRating`, `totalRatingPoints`), last-5 string, T/C/D/W indicators | **Yes** | `/races/{n}` runners |
| TAB tips, ranked ratings lists, win/place probability "predictions" | **Yes** (seen 2019) | `/races/{n}` → `tips`, `ratings`, `predictions` |
| Detailed form (past starts, career, track/dist/condition stats, sire/dam, age/sex/colour) | **Partly / uncertain** | `/races/{n}/form` and `/form/{runnerNumber}` — shape only partially evidenced; may need OAuth client-credentials (see §6) |
| Results (finishing order, dividends) for finished races | **Yes** | `/races/{n}` once `raceStatus` is `Interim`/`Paying`; `historical-results-service` for past dates |
| Pools (Win/Place/Quinella/Exacta/Trifecta/First4/Quaddie totals), exotic approximates, jackpots | **Yes** | `pools[]`, `/pools/{product}/approximates`, `/racing/jackpots` |
| Sky Racing replay/preview URLs | **Yes** | `skyRacing{audio,video,previewVideo}` |

**Not** in TAB: sectional times, speed maps beyond `earlySpeedRating`, gear changes, stewards reports, pedigree (not evidenced), "online rumours". Cross-verify those from other RaceLens sources.

---

## 2. Hosts, auth, headers, bot protection

### 2.1 Hosts

| Host | Role | Confidence / source |
|---|---|---|
| `https://api.beta.tab.com.au/v1` | All public racing + sports info-service, historical results, recommendation-service, pricing-service | **high** — used by every community client [S1][S2][S5][S6][S7][S9][S13] |
| `https://api.tab.com.au/v1` | Same paths as `api.beta` (non-beta alias). Two 2025–26 code bases use it; one comments it has "DNS resolution issues in some environments" and prefers `api.beta` | **low** [S24] |
| `https://webapi.tab.com.au/v1` | Account/betting (`account-service`, `tab-betting-service`) — **out of scope** (places real bets) | high [S7][S9] |
| `https://cmsapi.tab.com.au` | CMS content feeds (promos, racing landing page) — not needed | medium [S7] |
| `https://api.beta.tab.com.au/oauth/token` | OAuth2 token endpoint (optional, see §2.3) | medium [S7][S18] |
| `https://mediatab.skyracing.com.au/...` | Replay/preview media referenced from `skyRacing` | high [S1] |

### 2.2 Mandatory `jurisdiction` query parameter

Every `tab-info-service` endpoint **requires** `?jurisdiction=` with one of `NSW, VIC, ACT, QLD, SA, NT, TAS` (**high**). Omitting it, or sending another value, returns **HTTP 400**:

```json
{"error":{"details":[{"path":"query.jurisdiction","message":"should be NSW, VIC, ACT, QLD, SA, NT or TAS"}],"code":"INVALID_SYNTAX_ERROR","message":"Invalid query string"}}
```
(verbatim from a developer's notes [S3]; also "Omitting it entirely yields INVALID_SYNTAX_ERROR (HTTP 400)" [S7]). **`WA` is not accepted** (WA has its own TAB/RWWA) — one project sends `jurisdiction=WA` and silently falls back when it fails [S27] (**medium**). The value changes little for racing data (one developer notes it "seems to be ignored but errors if it's not there" [S3]); the sportsdata-mcp docs say prices/market availability can differ by state for sports [S7]. RaceLens should use **`VIC`** as instructed and treat it as a required constant.

The **historical-results-service** puts jurisdiction in the **path** instead (`/historical-results-service/VIC/racing/...`) and takes **no** query params [S5][S10][S11] (**high**).

### 2.3 Auth

* **Public read data needs no auth** (**high**, all sources). Do **not** send an empty `Authorization: Bearer` header — "an empty Authorization: Bearer header makes a 200 endpoint 401" [S7].
* **Optional OAuth2 client-credentials tier**: `POST https://api.beta.tab.com.au/oauth/token` (form-encoded, `grant_type=client_credentials`, `client_id`, `client_secret`; JSON bodies rejected; ~3h tokens, `expires_in` 10800) then `Authorization: Bearer <token>` on the same endpoints [S7][S18] (**medium**). Credentials come from Tabcorp's "TAB Studio" developer program (application via help.tab.com.au — search snippet only, **low**). One project reports that **the `/form` route returns 401 on the anonymous tier** and only works with client credentials [S8] (**low–medium**, single source, 2026-07). Everything else works anonymously.
* A separate Auth0 account tier exists for betting — **ignore**.

### 2.4 Headers that work / Akamai bot protection (important for the user's machine)

The info-service host is **behind Akamai Bot Manager** and is **geo-restricted to Australian IPs** (**high**, [S7][S14][S15][S26]). Observed failure modes when a request "looks wrong":

| Symptom | Reported by |
|---|---|
| Connection reset / TLS RST with no HTTP status | [S7] "silently RST-drops any request missing a full browser header bundle" |
| **HTTP 403** with an **HTML** body (not JSON) | [S14] "a bare User-Agent gets 403"; [S23] detects `text.startsWith("<")` |
| Empty body (HTTP 200 with `""`) needing retry | [S10] loops up to 20 retries on empty content; [S13] |
| 401 when a stale/empty Bearer header is sent | [S7] |
| Requests from cloud/CI IPs blocked; proxies needed | [S10] README; [S15] "must run on a machine with an Australian IP" |
| Unannounced API changes broke a Selenium script (2024) | [S26] (forum snippet) |
| Older clients needed TLS 1.2/1.3 enabled | [S25] (forum snippet) |

What community clients send and report as working (**medium–high**, 2026 observations [S7][S13][S14]):

```http
GET /v1/tab-info-service/racing/dates/2026-10-24/meetings?jurisdiction=VIC HTTP/1.1
Host: api.beta.tab.com.au
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36
Accept: application/json, text/plain, */*
Accept-Language: en-AU,en;q=0.9
Origin: https://www.tab.com.au
Referer: https://www.tab.com.au/racing
sec-ch-ua: "Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"
sec-ch-ua-mobile: ?0
sec-ch-ua-platform: "macOS"
sec-fetch-dest: empty
sec-fetch-mode: cors
sec-fetch-site: same-site
```

Practical rules distilled from the sources:

1. Send the full browser-style header bundle above; make it look like the site's own XHR (`sec-fetch-mode: cors`, `Origin`/`Referer` = tab.com.au), **not** a page navigation (`Accept: text/html` + `sec-fetch-mode: navigate` got blocked) [S13].
2. **Do not persist cookies** between requests. Akamai sets `_abck`/`bm_*` cookies and later 403s clients that replay them without the JS sensor; cookie-less requests are served normally (verified 2026-07-25 by [S14]; `strip_cookies: true` in [S7]). If you do get a 403, **discard the HTTP client/session and build a fresh one** [S14].
3. **TLS fingerprint matters in 2026**: one author reports Apple URLSession passes while "curl and python are refused outright" [S14]; Python projects use `tls_client` (Chrome-118 impersonation) [S11] or `curl_cffi` [S24]. Node 22 `undici`/`fetch` worked for TypeScript projects [S16][S23] (a Node proxy also worked with iOS-style headers [S15]). If Node fetch gets 403, try a Chrome-impersonating TLS client or the user's browser session.
4. **Rate**: no published limit; community settles on **~2–2.5 req/s sustained** with retry on 429/5xx and 0.5–2 s back-off [S7][S13][S24]. Bursts get throttled/reset. A whole race day is ~20–30 meetings × ~8 races ≈ 250 race-card calls — pace them.
5. `Accept-Encoding: identity` avoided gzip-handling problems in one proxy [S15] (optional).
6. The API sets **no CORS headers** — browsers cannot call it directly; RaceLens must call from its Node server, never from the React page [S6][S15].
7. **Caching**: GETs are edge-cached; a response carries an `Age` header. One project rejects race data with `Age > 30` s and always sends `cache: 'no-store'` [S16]. Prices in a cached racecard are stale — don't cache racecards on your side for more than a few seconds pre-jump [S7][S14].
8. Status-check every response: a 200 can be the **wrong resource** in the historical service (§5.4) and a 403 can carry HTML. Validate `meeting.venueMnemonic`, `meeting.meetingDate`, `raceNumber` against what you asked for [S12][S16].

### 2.5 Conventions

* **HATEOAS**: responses carry `_links` (`self`, `form`, `bigBets`, `races`, `meetings`, `approximates`) and sometimes `selfTemplate` listing optional query params [S5][S6][S7] (**high**). Prefer following `_links.self`/`_links.form` to constructing URLs.
* **Times**: `raceStartTime`, `returnWinTime`, `oddsUpdateTime` etc. are ISO-8601 **UTC with milliseconds** (`2026-10-24T03:00:00.000Z`) [S1][S6][S14]. `meetingDate` is an **Australian-local calendar date** `YYYY-MM-DD` [S5][S8]. Date path segments accept `today` and `tomorrow` aliases as well as `YYYY-MM-DD` [S22][S23] (**medium**).
* **Race type codes**: `R` thoroughbred, `G` greyhound, `H` harness [S5][S7][S15] (**high**).
* **Venue mnemonic**: short code per venue, e.g. `FLM` Flemington, `M` (used by bettRtab for Moonee Valley/Melbourne? — unverified), `SSC` Sunshine Coast, `SCO` Scone, `MEN` Menangle, `RIC` Richmond (G), `DBN`/`DBM` Doomben, `HAW` Hawkesbury, `LIN` (QLD), `S` (NSW, 2025-01-13 Saturday metro), `J` Canberra, `ASC` Ascot UK, `NMT` Newmarket, `CHR` Chester, `GLP` Gloucester Park, `CNP` Cannington [S1][S4][S5][S6][S7][S10][S11][S12]. **Mnemonics are not unique across codes/countries** — always pair with `raceType` and verify `meetingName` (§5.4).
* **International meetings** (GBR, NZ, HKG, JPN, USA, RSA…) appear under `raceType: "R"` with `location` set to a country code; filter AU with `location ∈ {NSW,VIC,QLD,SA,WA,TAS,NT,ACT}` [S8][S14] (**high**).
* **Pagination**: none anywhere — each response is a complete document [all sources].

---

## 3. Endpoint catalogue (racing)

Base for this table: `https://api.beta.tab.com.au/v1/tab-info-service`. All `GET`, all JSON, all need `?jurisdiction=VIC` unless noted. URL templates in **bold** were copied from the API's own HATEOAS templates recorded by a developer [S2] (high for the path/param names; the `{&a,b,c}` part lists *optional* query params).

| # | Purpose | URL pattern | Optional query params (from selfTemplate) | Conf. |
|---|---|---|---|---|
| E1 | Race dates with meetings (today/tomorrow/futures) | **`/racing/dates?jurisdiction={j}`** | `channelType, cashSales, combineMeetings` | high [S2][S7][S10] |
| E2 | **Meetings for a date** (+ race summaries) | `/racing/dates/{YYYY-MM-DD}/meetings?jurisdiction={j}` | `returnOffers, returnPromo` (bool) | high [S1][S4][S5][S9][S13][S16] |
| E3 | Races for one meeting (summaries) | `/racing/dates/{date}/meetings/{R\|G\|H}/{venueMnemonic}/races?jurisdiction={j}` | `returnPromo, returnOffers` | high [S1 swagger][S10][S13] |
| E4 | **Race card / results** | **`/racing/dates/{date}/meetings/{raceType}/{venueMnemonic}/races/{raceNumber}?jurisdiction={j}`** | `fixedOdds, channelType, cashSales, homeState, returnPromo, returnOffers` | high [S1][S2][S4][S5][S9][S13][S14] |
| E5 | Race form (all runners) | **`.../races/{raceNumber}/form?jurisdiction={j}`** | `fixedOdds` | path high [S2][S5][S6]; **shape low** (§4.6) |
| E6 | Runner form (one runner) | **`.../races/{raceNumber}/form/{runnerNumber}?jurisdiction={j}`** | `fixedOdds` | path high [S2][S4][S5]; shape low |
| E7 | **Next to go** (all codes) | **`/racing/next-to-go/races?jurisdiction={j}`** | `channelType, cashSales, usePace, maxRaces, targetMeeting, includeRecentlyClosed, wageringProduct, nonTabVenue, includeFixedOdds, returnPromo, returnOffers` | high [S2][S5][S6][S9][S18] |
| E8 | Next to go anchored on a race | **`.../races/{raceNumber}/next-to-go/races?jurisdiction={j}&raceStartTime={iso}`** | `maxNextRaces, maxPrevRaces, …` as E7 | medium [S2] |
| E9 | Vision next-to-go (by TV channel) | **`/racing/vision-next-to-go/races?jurisdiction={j}&broadcastChannel={ch}`** | `maxRaces, nonTabVenue` | medium [S2] |
| E10 | Pool approximates (live exotic combos) | `.../races/{raceNumber}/pools/{Quinella\|Exacta\|Duet\|Trifecta\|FirstFour}/approximates?jurisdiction={j}` | — | path medium [S13][S18]; shape low |
| E11 | Pool results across a day | **`/racing/dates/{date}/meetings/pools/{wageringProduct}/results?jurisdiction={j}`** | `venueMnemonic` | path medium [S2]; shape unknown |
| E12 | Big bets on a race | `.../races/{raceNumber}/big-bets?jurisdiction={j}` (from `_links.bigBets`) | — | path high [S5][S6]; shape unknown |
| E13 | Jackpots | **`/racing/jackpots?jurisdiction={j}`**; **`/racing/dates/{date}/jackpot-pools?jurisdiction={j}`** | `nonTabVenue, channelType, cashSales` | medium [S2][S7][S18] |
| E14 | Futures meetings / markets | `/racing/dates/futures/meetings?jurisdiction={j}`; `/racing/dates/{date}/meetings/R/Racing Futures/races/{Race Name (All In)}?jurisdiction={j}&fixedOdds=true` | `fixedOdds` | medium [S7][S20] |
| E15 | Silk image | `/racing/silk/{URL-encoded silk description}` (older: `/racing/silk/{n}`) → image | — | high (as `silkURL` values) [S1][S4][S5] |
| E16 | Date-level document | `/racing/dates/{date}?jurisdiction={j}` (returns `{racingDates:[{…meetings}]}`?) | `returnOffers, returnPromo` | low [S13] (fallback code only) |
| E17 | Configuration | `/configuration` (no jurisdiction) | — | low [S2] |
| E18 | Proposition search | **`/search/proposition?jurisdiction={j}&number={n}`** | `channelType, cashSales, details` | low [S2] |

Historical results (separate service, base `https://api.beta.tab.com.au/v1/historical-results-service`):

| # | Purpose | URL pattern | Conf. |
|---|---|---|---|
| H1 | Meetings + race list for a past date | `/{jurisdiction}/racing/{YYYY-MM-DD}` (no query) | high [S5][S10][S11][S17] |
| H2 | One past race (card + results + dividends) | `/{jurisdiction}/racing/{date}/{venueMnemonic}/{raceType}/races/{raceNumber}` — **note venue BEFORE raceType** (opposite of E4). Prefer `races[]._links.self` from H1. | high for pattern [S11 (196 recorded URL files)][S12]; medium that `_links.self` exists [S5] |

Sports/other (not needed for RaceLens, listed for completeness, medium [S7][S2]): `/sports`, `/sports/{sport}`, `/sports/{sport}/competitions/{comp}`, `.../matches/{match}`, `.../matches/{match}/markets`, `/sports/nextToGo`, `/sports/results`, `/v1/recommendation-service/featured-events`, `/v1/recommendation-service/live-events?jurisdiction=` [S10], `/v1/trending-bets-service/propositions-sports`, `/v1/pricing-service/enquiry` (POST, prices a multi).

**Gotcha** [S7] (2026-06): E4's `selfTemplate` advertises `fixedOdds`, but sending `fixedOdds=true` on a race card returned `RESOURCE_NOT_FOUND_ERROR` (404). Don't send it; runners already contain both `fixedOdds` and `parimutuel`. (An MCP server still exposes `fixedOdds=false` by default [S18]; a 2018 futures example used `fixedOdds=true` [S20].) `returnPromo=false&returnOffers=false` are safe and shrink the payload [S9][S13][S14].

---

## 4. Response shapes — `tab-info-service`

Field tables list `name: type — meaning (confidence)`. "swagger" = the Swagger 2.0 spec a user generated from TAB's responses and posted in 2019 [S1]; "2019 sample", "2017 sample", "2023 sample" = real recorded JSON [S1][S5][S6][S4].

### 4.1 E1 `/racing/dates`

```json
{ "dates": [ { "meetingDate": "2026-10-24", "dateName": "Today", "_links": { "meetings": "https://api.beta.tab.com.au/v1/tab-info-service/racing/dates/2026-10-24/meetings?jurisdiction=VIC" } } ] }
```
`dates[]: {meetingDate: string(YYYY-MM-DD), dateName: string}` — swagger `RaceDayDates`/`RaceDate` (**high** for names; `_links.meetings` **medium** [S7]). Dates include today, tomorrow and futures [S7][S18].

### 4.2 E2 `/racing/dates/{date}/meetings` → `{ meetings: Meeting[] }`

**Meeting** (swagger `Meeting` + 2023 Kotlin DTO [S4] + 2017/2019 samples):

| field | type | notes | conf |
|---|---|---|---|
| `meetingName` | string | UPPERCASE venue, e.g. `"FLEMINGTON"`, `"GLOUCESTER PK"` | high |
| `displayMeetingName` | string | mixed-case display name | medium [S4] |
| `location` | string | AU state code or country (`"VIC"`, `"GBR"`, `"NZ"`) | high |
| `raceType` | `"R"\|"G"\|"H"` | | high |
| `meetingDate` | string | `YYYY-MM-DD` local | high |
| `venueMnemonic` | string\|null | e.g. `"FLM"` | high |
| `sellCode` | `{meetingCode: string, scheduledType: "R"\|"G"\|"H"}` | TAB selling code (e.g. `M`+`R` = "MR"); `scheduledType` can differ from `raceType` for foreign meetings sold under another code | high |
| `trackCondition` | string\|null | `"GOOD4"`, `"SOFT5"`, `"SOFT6"`, `"SOFT7"`, `"HVY8"`, `"HVY10"`, `"GOOD"`, `"FAST"`, `"DEAD"`, `"AWT"` (all-weather), `"SYNTHETIC"`; case varies (one DTO comment shows `"Good4"`) | high (values observed in [S4][S6][S11][S14]) |
| `weatherCondition` | string\|null | `"FINE"`, `"OCAST"`, `"SHWRY"`, (`"RAIN"`, `"STORM"` plausible) | high for first three |
| `railPosition` | string\|null | free text: `"True"`, `"Out 5m entire circuit"`, `"Winter course: Inside rail moved 3m from 800m to 400m with a 3m spur @ 400m"`; `null` for G/H | high |
| `prizeMoney` | string\|null | e.g. `"$135000.00"`; often null on meeting | medium |
| `exoticPools` | `Pool[]` | cross-race pools (Quaddie, Early Quaddie, Running Double) — swagger | medium |
| `races` | `RaceSummary[]` | see below | high |
| `_links` | `{races: string, self?: string}` | | medium [S7] |

**RaceSummary** inside `meetings[].races[]` (RaceDto [S4], swagger `Race`, [S16]):

| field | type | conf |
|---|---|---|
| `raceNumber` int, `raceName` string, `raceDistance` int (metres), `raceStartTime` ISO UTC, `raceStatus` string (§4.4), `raceClassConditions` string\|null (e.g. `"OPEN"`, `"BM70"`, `"MDN"`) | | high |
| `hasParimutuel`, `hasFixedOdds`, `willHaveFixedOdds`, `fixedOddsOnlineBetting`, `allIn`, `allowBundle` | bool | high |
| `broadcastChannel` string\|null, `broadcastChannels` string[] (`"Sky Racing 1"`, `"Sky Racing 2"`) | | high |
| `cashOutEligibility` string (`"Disabled"\|"Enabled"`), `matchName` string, `meetingDate` string | | medium [S4] |
| `scratchings` | `[{runnerNumber:int, runnerName:string, bettingStatus:string}]` — scratched runners listed on the summary | medium [S4][S10] |
| `results` | `int[][]` — present once resulted (same as §4.4) | medium [S4] |
| `multiLegApproximates` array, `skyRacing` object | | medium |
| `_links` | `{self, form, bigBets}` absolute URLs incl. `?jurisdiction=` | high [S5][S6] |

### 4.3 E7 `/racing/next-to-go/races` → `{ races: NextToGoRace[] }`

Real 2017 sample [S6] (29 races; fixture `next_to_go_2017-07-15_NSW_real.json`). Each race:

```json
{
  "raceStartTime": "2017-07-15T13:10:00.000Z", "raceNumber": 2, "raceName": "TOTESCOOP6 HERITAGE HANDICAP", "raceDistance": 1000,
  "broadcastChannel": "Sky Racing 1", "broadcastChannels": ["Sky Racing 1"],
  "meeting": { "sellCode": {"meetingCode": "L", "scheduledType": "G"}, "raceType": "R", "meetingName": "ASCOT UK", "location": "GBR",
               "weatherCondition": "OCAST", "trackCondition": "GOOD", "railPosition": "True", "venueMnemonic": "ASC", "meetingDate": "2017-07-15" },
  "_links": { "self": ".../racing/dates/2017-07-15/meetings/R/ASC/races/2?jurisdiction=NSW", "form": ".../races/2/form?jurisdiction=NSW", "bigBets": ".../races/2/big-bets?jurisdiction=NSW" }
}
```
All keys **high**. Ordered by `raceStartTime` ascending across R/G/H and countries. `maxRaces` limits count; `includeFixedOdds=true` is sent by some clients [S9] — whether it inlines runner prices is **unverified** (the 2017 sample without it has no runners). `includeRecentlyClosed=true` keeps just-run races [S18]. For RaceLens, use E2/E4 for the meeting day and E7 only for "what's jumping next".

### 4.4 E4 `/races/{raceNumber}` — the race card (also the results document)

Top level (swagger `Race` [S1] + 2019 sample + tab.client model [S9] + [S10]):

| field | type | meaning / observed values | conf |
|---|---|---|---|
| `raceNumber` | int | | high |
| `raceName` | string | `"WILLIAM NEWTON VC HANDICAP"` | high |
| `raceDistance` | int | metres (`2520`) | high |
| `trackDirection` | string | `"anticlockwise"` / `"clockwise"` | high |
| `meeting` | object | `{meetingName, venueMnemonic, meetingDate, location, raceType, sellCode}` (swagger `MeetingSummary`); in 2026 `trackCondition` was also present on `meeting` in the race card ("the going is published on the MEETING, never on the race" [S14]) and next-to-go includes `weatherCondition`/`railPosition` too — treat as optional | high / medium |
| `skyRacing` | `{audio: url, video: url, previewVideo: url}` | Sky Racing replay/preview media | high |
| `hasParimutuel`, `hasFixedOdds`, `hasForm`, `hasEarlySpeedRatings`, `allIn`, `allowBundle`, `willHaveFixedOdds`, `fixedOddsOnlineBetting`, `apprenticesCanClaim`, `allowMulti`, `allowParimutuelPlace`, `allowFixedOddsPlace` | bool | | high |
| `broadcastChannel` string\|null, `broadcastChannels` string[] | | | high |
| `cashOutEligibility` | string | `"Disabled"`/`"Enabled"` | high |
| `raceStartTime` | string ISO UTC | advertised jump time; **can move** (re-read before jump) | high |
| `raceClassConditions` | string | `"OPEN"`, `"BM70"`, `"MDN"`, `"3YO HCP"` … | high |
| `prizeMoney` | string | `"$135000.00"` | high |
| `raceStatus` | string | **`"Normal"`** = pre-race/open (2026 [S14][S16]); `"Open"` (reported [S13][S15], possibly older); `"Closed"` = betting closed/running; `"Interim"` = provisional result; `"Paying"` = final dividends; `"Resulted"` (reported [S15]); `"Abandoned"` [S15][S19]. Treat `Interim`/`Paying`/`Resulted` as "has results" | high for Normal/Closed/Interim/Paying/Abandoned; medium for Open/Resulted |
| `substitute` | string | `"NR"` or a runner number string (`"7"`) — TAB substitute runner for exotics | medium |
| `results` | `int[][]` | **finishing order**: outer index = position (0-based → 1st..4th), inner array = runner numbers (dead heats → >1 entry). `[[4],[3],[5],[2]]` ⇒ 1st #4, 2nd #3, 3rd #5, 4th #2. Empty `[]` before result. Only placings (usually 4) are given, not the full field | high [S1][S5][S13][S15][S17] |
| `pools` | `Pool[]` | §4.4.3 | high |
| `dividends` | `Dividend[]` | §4.4.4, present once `Interim`/`Paying` | high |
| `parimutuelPlaceStatus` | string | `"Open"`/`"Closed"` | high |
| `numberOfPlaces` | int | tote places paid (2 or 3) | high |
| `numberOfFixedOddsPlaces` | int | | high |
| `runners` | `Runner[]` | §4.4.1 | high |
| `oddsUpdateTime`, `fixedOddsUpdateTime` | ISO UTC | | high |
| `tips` | `{tipType: "Standard", tipster: "Matthew Hill", tipRunnerNumbers: [7,2,1,4]}` | TAB tipster's top 4 | high (2019) |
| `ratings` | `[{ratingType, ratingRunnerNumbers:int[]}]` | `ratingType ∈ Rating, Last12Months, Recent, Distance, Class, Time, Overall` — each a ranked top-4 list | high (2019) |
| `predictions` | `[{betType: "Win"\|"Place", runners: [{runnerNumber, probability: float, runnerName}]}]` | TAB model probabilities (Win probs sum ≈ 1) | high (2019); still present 2026? unverified |
| `multiLegApproximates` | array | | medium |
| `betTypes` | `[{wageringProduct, firstLeg?…}]` | bet types offered | medium [S9][S22] |
| `scratchings` | `[{runnerNumber, runnerName, bettingStatus}]` | seen on historical race docs | medium [S10] |
| `resultedTime` | ISO UTC | when resulted (historical docs) | medium [S10] |
| `winBook` | string/number | tote win book % (historical docs) | low [S10] |
| `_links` | `{self, form, bigBets, …}` | | high |

#### 4.4.1 Runner (`runners[]`) — real samples 2017 (G) [S5], 2019 (R) [S1], 2023 (R) [S4]; types from swagger [S1] and C# model [S9]

| field | type | meaning / values | conf |
|---|---|---|---|
| `runnerNumber` | int | saddlecloth / box | high |
| `runnerName` | string | UPPERCASE horse name (`"SELF SENSE"`) | high |
| `barrierNumber` | int | barrier draw (greyhounds: box) | high |
| `riderDriverName` | string | short form `"D Oliver"`; `""` for greyhounds | high |
| `riderDriverFullName` | string\|null | `"DAMIEN OLIVER"` | high |
| `trainerName` | string | `"D Brideoake"`, `"David & B Hayes & T Dabernig"` | high |
| `trainerFullName` | string | `"DAVID BRIDEOAKE"`, mixed case in 2023 (`"Stuart Kendrick"`) | high |
| `handicapWeight` | number | kg (`61`, `58.5`); `0` for greyhounds | high |
| `harnessHandicap` | string\|null | harness only (front/second row marks) | high (null observed) |
| `blinkers` | bool | | high |
| `claimAmount` | number | apprentice claim kg; `0`, `-1` seen | high |
| `last5Starts` | string | last five placings as a string, e.g. `"97115"`, `"x4362"`, `"7x008"`; `x` = spell break, `0` = finished 10th+ (AU form convention). **Order**: TAB form guides print oldest→most recent left→right, so the **rightmost char is the latest start** — treat order as **medium**/verify | high for field; medium for semantics |
| `tcdwIndicators` | string | up to 4 letters `T` `C` `D` `W`: Track winner, Course-and-distance (track+distance) winner, Distance winner, Wet-track winner; **upper = won, lower = placed**, space = none (`"tCDW"`, `"t dW"`, `"Dw"`, `"tc"`) | high for field; medium for semantics (TAB form-guide convention) |
| `emergency` | bool | emergency runner | high |
| `vacantBox` | bool | greyhounds; exclude when true | medium [S4][S15] |
| `penalty` | number\|null | | high |
| `dfsFormRating` | int | TAB/"DFS" form rating 0–100, 0 = none | high |
| `techFormRating` | int | TAB "Tech Form" rating 0–100, 0 = none | high |
| `totalRatingPoints` | int | points from the `ratings` lists | high |
| `earlySpeedRating` | int | 0–100 early speed | high |
| `earlySpeedRatingBand` | string | `"LEADER"`, `"MIDFIELD"`, `"BACKMARKER"` (likely also on-pace variants) | high for 3 values |
| `silkURL` | string | **key casing is `silkURL`**; image URL; description-encoded in 2023 (`/racing/silk/GREY%2C%20KREW%20RACING...`) | high |
| `fixedOdds` | object | §4.4.2 | high |
| `parimutuel` | object | §4.4.2 | high |
| `scratched` | bool | referenced by one 2026 project alongside `vacantBox`/`emergency` [S15]; **not** in 2017/2019/2023 samples — derive scratched from `bettingStatus` instead | low |
| `_links` | `{form: url}` | runner form link (E6) | high |

**Scratched detection** (high, combined): `fixedOdds.bettingStatus ∈ {"Scratched","LateScratched"}` **or** `parimutuel.bettingStatus == "Scratched"` **or** runner appears in `scratchings[]` [S4][S14][S16][S19]. Scratched runners stay in `runners[]` with `returnWin: 0`. Late scratchings carry `fixedOdds.winDeduction` / `placeDeduction` (deduction in cents-per-dollar or %) and `scratchedTime` [S1][S9][S14].

#### 4.4.2 `fixedOdds` and `parimutuel`

`fixedOdds` (swagger `FixedOdds` + samples):

| field | type | notes | conf |
|---|---|---|---|
| `returnWin` | number | decimal win price; `0` when scratched/no price | high |
| `returnPlace` | number | decimal place price | high |
| `returnWinTime` | ISO UTC | time of current price | high |
| `returnWinOpen` | number | opening fixed price (first quoted) | high |
| `returnWinOpenDaily` | number | opening price on race day | high |
| `flucs` | `[{returnWin, returnWinTime}]` | recent fluctuations, **newest first** (3–4 entries) | high |
| `returnHistory` | `[{returnWin, returnWinTime}]` | full price history (27 entries in 2023 sample), **oldest first** (not strictly sorted) | high (2023) |
| `isFavouriteWin`, `isFavouritePlace` | bool | | high |
| `bettingStatus` | string | `"Open"`; after race `"Winner"`, `"Placing"`, `"Loser"`; `"Scratched"`, `"LateScratched"`; (`"Closed"`, `"Suspended"` plausible) | high for listed |
| `propositionNumber` | int | TAB proposition id | high |
| `differential` | null\|number | | high (null) |
| `percentageChange` | number | % move (negative = firming) | high |
| `allowPlace` | bool | | high |
| `winDeduction`, `placeDeduction`, `scratchedTime` | number, number, ISO | present on late scratchings | medium [S1][S9] |

`parimutuel` (tote):

| field | type | notes | conf |
|---|---|---|---|
| `returnWin`, `returnPlace` | number | approximate tote dividends; final after `Paying` | high |
| `returnExact2` | number | | high |
| `isFavouriteWin`, `isFavouritePlace`, `isFavouriteExact2` | bool | | high |
| `bettingStatus` | string | `"Open"`, `"Closed"`, `"Scratched"` | high |
| `marketMovers` | `[{returnWin, returnWinTime, specialDisplayIndicator: bool}]` | newest first; `specialDisplayIndicator: true` marks the opening/"special" price | high |
| `percentageChange` | int\|null | | high |

#### 4.4.3 `pools[]` (swagger `Pool` + 2019 sample)

| field | type | notes |
|---|---|---|
| `wageringProduct` | string | `Win, Place, Quinella, Exacta, Duet, Trifecta, FirstFour, RunningDouble, DailyDouble, EarlyQuaddie, Quaddie, Trio, BigSix…` (first ten observed) |
| `legNumber` | int | leg within multi-leg pool |
| `poolStatusCode` | string | `"Open"`/`"Closed"` |
| `poolTotal` | number | $ (`44943.5`) |
| `jackpot` | number | $ carried in |
| `poolCloseTime` | ISO UTC | (swagger) |
| `cashOutEligibility` | string | |
| `cominglingGuests` | bool | comingled with other totes |
| `substitute` | string | `"NR"`/runner number |
| `legs` | `[{legNumber, raceNumber, venueMnemonic, raceType, startTime, poolTotal?, jackpot?, cominglingGuests?}]` | legs (one for single-race pools) |
| `poolHistory` | `[{poolTotal, poolTotalTime, specialDisplayIndicator}]` | Win pool only |
| `mergePool` | string[] | e.g. Trifecta ↔ `["Trio"]` |
| `mergePoolTotal` | number | |
| `_links` | `{approximates: url}` | Quinella/Exacta/Duet (E10) |
All **high** except `poolCloseTime` (medium).

#### 4.4.4 `dividends[]` (swagger `Dividend` + 2019 sample)

```json
{ "wageringProduct": "Trifecta", "poolStatusCode": "Closed", "countBackLevelDescription": null, "jackpotCarriedOver": 0,
  "poolDividends": [ { "selections": [4, 3, 5], "amount": 822.1 } ] }
```
`selections` is `int[]` **except** that unfilled Duet dividends were `["F","F"]` (strings) with `amount: 0` — the very bug in [S1]; parse selections as `(number|string)[]`. Win/Place have one `poolDividends` entry per placed runner (`Place` → 2–3 entries). **high**.

### 4.5 E3 `/meetings/{raceType}/{venue}/races` → `{ races: RaceSummary[] }` (swagger `MeetingRaces`) — same race summaries as §4.2 with `_links.self/form` (**high**).

### 4.6 E5/E6 Form — **low-confidence shape; verify live first**

Evidence available:

* The path and its `_links.form` presence are certain [S2][S5][S6]. The 2017/2019 race cards carried `hasForm: true`.
* sportsdata-mcp (probed live 2026-06) describes E5 as "Detailed form guide for one race (past performances, ratings, comments per runner)" with hint `{raceNumber, formData:[{runnerNumber, runnerName, pastPerformances:[]}]}` and E6 as "full past-start history with positions, margins, distances and dates" with hint `{runnerName, runnerNumber, previousStarts/pastPerformances:[{position, fieldSize?, distance, date, margin, ...}]}`; it also says E6 covers "recent starts, times, track and distance records" [S7]. These are *hints*, not recorded responses (**low**).
* sportsdata-agents (2026-07) reads the E5 response as `guide.form` ("the live key — response_hint said formData; live says form") falling back to `formData`, and per runner reads: `runnerNumber`, `runnerName`, `barrierNumber` (or `barrier`), `handicapWeight` (or `weight`), `riderDriverName` (or `rider`/`driver`), `trainerName`, **`last20Starts`** (or `lastStarts`), **`formComment`** (string) / **`formComments: [{comment}]`** (prose sentences like "3rd of 7 at Warwick Farm 2yo F Osc on June 24 over 1100m"), `techFormRating` (or `rating`), `daysSinceLastRun`, `runsSinceSpell`, `bestTime`, `age`, `scratched`/`isScratched` [S8]. Because it uses fallbacks for most keys, only `form`, `runnerNumber`, `runnerName`, `last20Starts`, `formComments[].comment`, `techFormRating` are **medium**; the rest **low**. Its docstring says the form route **401s on the anonymous tier** and needs `TAB_CLIENT_ID/SECRET` (**low–medium**, single source).
* No community code reads **sire, dam, age, sex, colour, career record, track/distance/condition statistics** from TAB. They *may* exist in E6 (TAB's web form guide shows career/track/distance/condition records and pedigree), but I found **no field names** — treat as **unknown**; source pedigree/career stats from another RaceLens provider and use TAB form only as corroboration.

Fixtures `race_form_…json` and `runner_form_…json` are **constructed** from the above and clearly labelled. The adapter should (a) try anonymously, (b) on 401 try OAuth client-credentials if configured, (c) otherwise degrade gracefully (race card already carries `last5Starts`, ratings, T/C/D/W).

### 4.7 E10 approximates (low)

One client parses `{ approximates: [ { selections: [9,3], return: 7.4 }, … ] }` and skips `return == 0` (scratched combos) [S13]; its own comment says "Structure TBC". Fixture labelled constructed.

### 4.8 Error bodies

* 400 `INVALID_SYNTAX_ERROR` — see §2.2 (**high**, verbatim).
* 404 `RESOURCE_NOT_FOUND_ERROR` (info-service, e.g. bad race number or `fixedOdds=true`) [S7]; `NOT_FOUND_ERROR` string appears in historical-results bodies [S10][S12] (**medium**). Likely shape `{"error":{"code":"...","message":"..."}}` (**low**, by analogy with the 400 body).
* 403 → HTML page (Akamai) [S14][S23]; 401 with stray `Authorization` [S7].

---

## 5. Response shapes — `historical-results-service`

### 5.1 H1 `/{jurisdiction}/racing/{date}` → `{ meetings: HistMeeting[] }`

Fields read by three independent clients [S5][S11][S17] + bettRtab's stored data frames [S10]:

`meetings[]: { meetingName, location, raceType, venueMnemonic, meetingDate?, weatherCondition, trackCondition, railPosition?, sellCode?, races: [ { raceNumber, raceName, raceStartTime?, raceStatus?, raceDistance?, _links: { self } } ] }`

* `meetingName`, `raceType`, `venueMnemonic`, `weatherCondition` (`"FINE"`), `trackCondition` (`"SOFT7"`), `races[].raceNumber`, `races[].raceName`, `races[]._links.self` — **high** (read directly [S5][S11][S17]).
* `location`, `meetingDate`, `railPosition`, `sellCode`, race `raceStartTime`/`raceStatus` — **medium** (bettRtab drops `sellCode` columns from the meeting frame, implying it is present [S10]; others by analogy with E2).
* bettRtab has daily snapshots for calendar year 2022 onward and tabby used the service in 2017 → history depth is **at least 2017→present** (**medium**). Empty body / `NOT_FOUND_ERROR` for dates with no data; bettRtab retries up to 20× with 2 s sleeps because the service intermittently returns empty bodies [S10].

### 5.2 H2 race document

Same shape as the E4 race card (§4.4) in its final state: `meeting{meetingDate, venueMnemonic, raceType, meetingName, location}`, `raceNumber`, `raceName`, `raceStartTime`, `raceStatus` (`"Paying"`), `raceDistance`, `raceClassConditions`, `runners[]` (full runner objects incl. final `fixedOdds`/`parimutuel`, `barrierNumber`, `riderDriverName`, `trainerName`), `results[][]`, `dividends[]`, `pools[]`, `scratchings[]`, `resultedTime`, `substitute`, `winBook`, `skyRacing` [S5][S10][S11][S17] (**high** for runners/results/dividends/meeting; **medium** for `resultedTime`, `winBook`, `scratchings`). A 2025 CSV built from it shows `fixedOdds.returnWin` used as the SP and `raceClassConditions` like `"MDN"` [S11].

**Finishing position per runner** is *not* a runner field: derive it from `results[][]` (position index) — runners absent from `results` are unplaced [S11][S17]. (The task's `finishingPosition` field name was **not** found in any TAB response; do not rely on it.)

### 5.3 Headers for the historical service

Same Akamai front. 2025 clients used `tls_client` Chrome impersonation with browser headers [S11]; bettRtab uses only a Chrome User-Agent with `httr::RETRY` (5 tries, exponential pause) [S10].

### 5.4 Identity caveat (important)

A 2026 issue [S12] found that constructed H2 URLs can **return HTTP 200 for a different meeting**: `/VIC/racing/2025-11-04/J/R/races/7` (intended Canberra) returned `{"meeting":{"meetingName":"Funabashi","location":"Japan","venueMnemonic":"Funabashi"},"raceNumber":7}` while races 1–5 404'd. Rules: prefer `races[]._links.self` from H1; **always assert** `meeting.meetingName`/`venueMnemonic`/`meetingDate`/`raceNumber` match the request before accepting a 200; note that in this service `venueMnemonic` can be a full name for international venues.

---

## 6. How RaceLens should use it (recipes)

**A. Meetings for a date (user picks the meet)**
`GET E2 /racing/dates/{date}/meetings?jurisdiction=VIC&returnPromo=false&returnOffers=false` → keep `raceType=="R"` and `location ∈ AU states`; show `meetingName`, `trackCondition`, `railPosition`, `weatherCondition`, `races[].{raceNumber,raceName,raceStartTime,raceDistance,raceClassConditions,raceStatus}`; remember `venueMnemonic`+`raceType`+`meetingDate`.

**B. Race card** `GET E4 …/races/{n}?jurisdiction=VIC&returnPromo=false&returnOffers=false` → map runners as in §4.4.1; `scratched` per the combined rule; odds = `fixedOdds.returnWin/returnPlace` (+ `returnWinOpen`, `flucs` for market move) and `parimutuel.returnWin/returnPlace`; TAB signals = `dfsFormRating`, `techFormRating`, `earlySpeedRating(+Band)`, `totalRatingPoints`, `last5Starts`, `tcdwIndicators`, `ratings[]`, `tips`, `predictions[]`.

**C. Form** try `GET E5 …/form?jurisdiction=VIC` then `E6 …/form/{runnerNumber}`; parse defensively (`form` or `formData`; fields in §4.6); on 401 → OAuth client-credentials if the user has TAB Studio credentials, else skip. Never make the pipeline depend on it.

**D. Results / pre-race re-check** Poll E4 (≤ 1 req / 10–30 s per race near jump); race is done when `raceStatus ∈ {Interim, Paying, Resulted}` and `results.length > 0`; final when `Paying`. `dividends[]` gives Win/Place/Quinella/Exacta/Trifecta/First4 payouts. For earlier days use H1→H2 (jurisdiction in path, verify identity §5.4).

**E. Track / rail / weather** meeting-level only (E2 `meetings[]`, E7 `races[].meeting`, and `meeting` on E4/H2 when present). Re-read E2 on the day: `trackCondition` is upgraded/downgraded during the meeting.

**F. Day-pattern detection** after each race, H2/E4 `results`, `dividends`, `runners[].barrierNumber`, `earlySpeedRatingBand`, `fixedOdds.returnWin` (SP), `parimutuel.returnWin` (tote SP) give what's needed for rail/barrier/pace bias stats across the meeting.

**G. Operational**: AU IP (user's machine is fine), header bundle §2.4, no cookies, ≤ 2 rps, retry 429/5xx/empty-body with back-off, rebuild client on 403, reject HTML bodies and `Age > 30` s for prices, validate identity fields, cite `_links.self` as provenance in the verification engine.

---

## 7. Field-name quick index (what the adapter should look for)

Meeting: `meetingName, displayMeetingName, location, raceType, meetingDate, venueMnemonic, sellCode{meetingCode,scheduledType}, trackCondition, weatherCondition, railPosition, prizeMoney, exoticPools[], races[], _links`
Race: `raceNumber, raceName, raceDistance, trackDirection, raceStartTime, raceStatus, raceClassConditions, prizeMoney, hasParimutuel, hasFixedOdds, hasForm, hasEarlySpeedRatings, willHaveFixedOdds, fixedOddsOnlineBetting, allIn, allowBundle, allowMulti, allowParimutuelPlace, allowFixedOddsPlace, parimutuelPlaceStatus, numberOfPlaces, numberOfFixedOddsPlaces, apprenticesCanClaim, cashOutEligibility, broadcastChannel, broadcastChannels[], skyRacing{audio,video,previewVideo}, substitute, results[][], pools[], dividends[], runners[], tips, ratings[], predictions[], betTypes[], multiLegApproximates[], scratchings[], resultedTime, winBook, oddsUpdateTime, fixedOddsUpdateTime, meeting{}, _links{self,form,bigBets}`
Runner: `runnerNumber, runnerName, barrierNumber, riderDriverName, riderDriverFullName, trainerName, trainerFullName, handicapWeight, harnessHandicap, blinkers, claimAmount, penalty, emergency, vacantBox, last5Starts, tcdwIndicators, dfsFormRating, techFormRating, totalRatingPoints, earlySpeedRating, earlySpeedRatingBand, silkURL, fixedOdds{returnWin,returnPlace,returnWinTime,returnWinOpen,returnWinOpenDaily,flucs[],returnHistory[],isFavouriteWin,isFavouritePlace,bettingStatus,propositionNumber,differential,percentageChange,allowPlace,winDeduction,placeDeduction,scratchedTime}, parimutuel{returnWin,returnPlace,returnExact2,isFavouriteWin,isFavouritePlace,isFavouriteExact2,bettingStatus,marketMovers[],percentageChange}, _links{form}`
Form (unverified): `form[] | formData[]: {runnerNumber, runnerName, barrierNumber, handicapWeight, riderDriverName, trainerName, last20Starts, formComment, formComments[{comment}], techFormRating, daysSinceLastRun, runsSinceSpell, bestTime, age, isScratched, pastPerformances[] | previousStarts[]}`

---

## 8. Sources (all fetched 2026-10-23 via GitHub; racing/bookmaker hosts were unreachable from this container)

| id | URL | what it contributed |
|---|---|---|
| S1 | https://github.com/go-swagger/go-swagger/issues/1932 | **Swagger 2.0 spec of `tab-info-service` racing paths/definitions + a complete real race-card JSON (Flemington R1, 2019-04-25, `raceStatus: Paying`)** — definitive for §4.4 field names/types |
| S2 | https://raw.githubusercontent.com/mattcs2401/RaceDay/HEAD/TAB%20various%20URLs.txt | HATEOAS URL templates with optional query params for dates, race details, form, runner form, next-to-go (3 variants), pool results, jackpots, search, configuration, sports |
| S3 | https://raw.githubusercontent.com/mattcs2401/RaceDay/HEAD/RaceDay%20Notes.txt | verbatim 400 `INVALID_SYNTAX_ERROR` body; status codes |
| S4 | https://github.com/mattcs2401/RaceDay (`app/src/main/java/com/mcssoft/raceday/domain/dto/{MeetingDto,RaceDto,RunnerDto,ScratchingDto}.kt`, `domain/model/Runner.kt`) | 2023 Kotlin DTOs for meeting/race/runner incl. `scratchings`, `displayMeetingName`; **real 2023-09-24 Sunshine Coast runner JSON with `returnHistory`, `marketMovers`, `vacantBox`** |
| S5 | https://github.com/Tjorriemorrie/tabby (`tabby/tab/tasks.py`, `legacy/data/scraper.py`, `legacy/data/race.py`) | next-to-go + race-card consumer (2017–19); **historical-results-service** usage; real 2017 next-to-go race + greyhound runner JSON (`flucs`, `marketMovers`, `_links.form`) |
| S6 | https://github.com/shaunmarx/next-to-go (`src/races/schema/data.json`, README) | **real full next-to-go response (2017-07-15, 29 races)**; CORS note |
| S7 | https://github.com/DanielTomaro13/sportsdata-mcp (`src/sportsdata_mcp/specs/tab.yaml`, `documentation/TAB.md`) | 2026 live-probed notes: Akamai RST drops, header bundle, 2.5 rps, cookie stripping, `jurisdiction` 400, HATEOAS `selfTemplate`, `fixedOdds=true` 404 gotcha, OAuth client-credentials (optional), form/runner-form/futures/jackpots endpoints and response hints |
| S8 | https://github.com/DanielTomaro13/sportsdata-agents (`src/sportsdata_agents/operations/ingestion/form.py`, `tests/integration/test_race_form.py`) | E5 form keys actually read in 2026 (`form[]`, `last20Starts`, `formComments`, `techFormRating`, …), "form route 401s anonymously" note |
| S9 | https://github.com/bitcoinbrisbane/tab.client (`tab.client/Models/Common/{Runner,Odds,Race,BetType}.cs`, `Models/Meeting/Meeting.cs`, `TabClient.cs`) | C# types for runner/odds/parimutuel/race/meeting; `includeFixedOdds=true&returnPromo=false&returnOffers=false` usage; `winDeduction/placeDeduction/scratchedTime` |
| S10 | https://github.com/JaseZiv/bettRtab (`R/get_race_meets.R`, `R/get_race_data.R`, `R/parse_race_data.R`, `R/internals.R`, `R/loading.R`, `vignettes/using-bettRtab.Rmd`) | historical-results-service by date (VIC), `_links.self` per race, race fields `resultedTime/substitute/winBook/scratchings/skyRacing.audio`, nested `fixedOdds`/`parimutuel` columns, `pools.legs`, `dividends.poolDividends`; retry/empty-body behaviour; yearly archives from 2022 |
| S11 | https://github.com/xx36Mostafa/horse-racing-ml-pipeline (`data-extraction/extract-day.py`, `extract-data.py`, `racing-apis/2025-01/2025-01-13.json`, `2025-06-16.csv`, README) | 2025 historical URL pattern `/{jur}/racing/{date}/{venue}/{raceType}/races/{n}` (196 recorded daily URL lists), fields read (`meetingDate`, `meetingName`, `raceClassConditions`, `results`, runner `barrierNumber/riderDriverName/trainerName/fixedOdds.returnWin`), `tls_client` Chrome impersonation headers |
| S12 | https://github.com/rorygleeson/TabAPIvbeta2/issues/15 | historical URL identity collision (Canberra `J` → Funabashi 200), `NOT_FOUND_ERROR` 404s, "never trust status alone" |
| S13 | https://github.com/neil-pearson/tab-extractor (`tab_client.py`, `scheduler.py`) | 2026 header bundle that passes Akamai (XHR-style), `returnOffers/returnPromo`, approximates endpoint + parsing, `raceStatus` values, results/dividends parsing, cookie refresh via headless browser |
| S14 | https://github.com/RatterAU/Bookie (`Sources/BookieCore/Feed.swift`) | 2026-07 Akamai behaviour (403 to bare UA, cookie poisoning, TLS fingerprint), no-cache rule, `trackCondition` on `meeting`, `raceStatus: "Normal"`, `LateScratched`, deductions |
| S15 | https://github.com/bgm2fz2bps-dev/sweep-web (README) | 2026-03 e2e: geo-restriction to AU IPs, iOS header proxy, `raceStatus` list, `results[][]` semantics, `vacantBox/emergency/scratched`, polling cadence |
| S16 | https://github.com/danielboasemammoth/racing-predictor (`src/lib/tab-races.ts`, `src/lib/betting/tab-batch-source.ts`) | Node `fetch` usage with `cache:'no-store'`, `Age` header check, `raceStatus ∈ {Normal, Open}`, `hasParimutuel/hasFixedOdds/willHaveFixedOdds`, `sellCode`, `pools[].poolStatusCode` |
| S17 | https://github.com/hblunt/historical-sports-bet-extractor (`sportsbet_extractor.py`) | historical-results consumer: `meetings[].raceType/meetingName`, race `results`, runner fields |
| S18 | https://github.com/bencousins22/tab-mcp (`src/tab_mcp/server.py`, README) | OAuth (`/oauth/token`, password/refresh/client-credentials), `maxRaces`, `includeRecentlyClosed`, approximates/jackpot-pools paths, valid jurisdictions |
| S19 | https://github.com/horse-link/sdk.horse.link (`src/types/index.ts`), https://github.com/horse-link/horse.link (`src/types/meets.ts`) | `RaceStatus` enum (Interim/Abandoned/Closed/Normal/Paying), `RunnerStatus` (Open/Scratched/LateScratched), meeting fields incl. `railPosition` |
| S20 | https://github.com/mrgla55/Tabapi (README) | 2018 futures URL shape (`/meetings/R/Racing - Futures/races/Melbourne Cup (All In)?jurisdiction=VIC&fixedOdds=true`), `webapi` account endpoints |
| S21 | https://github.com/dy27/sportsbetting-apis (`apis/tab/tab_api.py`) | plain meetings→race-odds flow (2022), jurisdiction list |
| S22 | https://github.com/gamblebox/irace (`daemon/auto_regi_race_data_os_j.php`, `public/common/scrap.php`) | `dates/today/meetings`, `dates/tomorrow/meetings`, `betTypes[]`, `broadcastChannel` |
| S23 | https://github.com/vamuq999/voltara-racing (`app/api/races/route.ts`) | HTML body returned when blocked; `dates/today` |
| S24 | https://github.com/Ross-Ward/oddsedge (`lib/scrapers/tab-au.ts`, `horse-racing.ts`), https://github.com/masonj0/fortuna (`fortuna.py`) | `api.tab.com.au` host alias, `curl_cffi` impersonation, rate limit 2 rps (low; fortuna's `meetingType` field and `/meetings/{type}/{name}` URL contradict all other sources — treated as wrong) |
| S25 | https://forums.whirlpool.net.au/archive/97xxmkv3 (search snippet only; host unreachable) | TLS 1.2/1.3 needed for older PowerShell/Python clients |
| S26 | http://www.ozmium.com.au/forums/showthread.php?t=32280 (search snippet only) | 2024 report of unannounced endpoint changes |
| S27 | https://github.com/iamjohnnymac/perthpintprices (`src/app/api/race-meets/route.ts`) | `jurisdiction=WA` attempted with fallback (WA not in accepted list) |

---

## 9. Fixture index (`research/fixtures/tab/`)

| file | endpoint | status |
|---|---|---|
| `dates_VIC.json` | E1 `/racing/dates` | constructed (swagger field names) |
| `meetings_2026-10-24_VIC.json` | E2 meetings for 2026-10-24 (Flemington R + Meadows G + Menangle H + Doncaster GBR) | constructed |
| `meeting_races_2026-10-24_R_FLM.json` | E3 races for FLM | constructed |
| `race_2026-10-24_R_FLM_7_open.json` | E4 race card, pre-race (`Normal`), 9 runners incl. late scratching + emergency, full pools/tips/ratings/predictions | constructed (keys from real samples) |
| `race_2019-04-25_R_FLM_1_paying_real.json` | E4 race card, resulted (`Paying`) | **reconstructed from a real response** (go-swagger #1932); filled-in parts listed in its note |
| `runner_2023-09-24_R_SSC_1_real.json` | one `runners[]` element | **real**, unmodified (RaceDay repo) — has `returnHistory` |
| `runner_2017-09-12_G_GOS_7_1_real.json` | one `runners[]` element (greyhound, pre-race) | **real**, unmodified (tabby repo) |
| `next_to_go_2017-07-15_NSW_real.json` | E7 next-to-go (first 10 of 29 races) | **real**, unmodified (shaunmarx repo) |
| `next_to_go_race_2017-09-12_H_MEN_6_real.json` | one E7 `races[]` element | **real**, unmodified (tabby repo) |
| `race_form_2026-10-24_R_FLM_7.json` | E5 race form | constructed, **low confidence** |
| `runner_form_2026-10-24_R_FLM_7_1.json` | E6 runner form | constructed, **low confidence**; pedigree/career blocks unevidenced |
| `approximates_2026-10-24_R_FLM_7_Quinella.json` | E10 pool approximates | constructed, low confidence |
| `historical_meetings_2026-10-24_VIC.json` | H1 | constructed |
| `historical_race_2026-10-24_FLM_R_7_paying.json` | H2 (includes dead heat, `resultedTime`, `winBook`, `scratchings`) | constructed |
| `error_400_invalid_jurisdiction.json` | any endpoint without valid `jurisdiction` | **real** body |
| `error_404_not_found.json` | 404 | constructed (codes real) |
| `blocked_403_akamai.html` | Akamai block page (HTML, not JSON) | constructed |

Suggested adapter tests: parse all `*_real.json` without loss; derive scratched/placings from the two `race_*` fixtures; reject `blocked_403_akamai.html` as non-JSON; reject H2 responses whose `meeting.venueMnemonic` ≠ requested; tolerate `selections: ["F","F"]` in dividends; handle `results` dead heats (`[[2],[1],[3,5]]`).
