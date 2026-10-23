# Source: `puntersracenet` — Punters.com.au + Racenet.com.au (News Corp Australia, shared "puntapi" backend)

Research date: 2026-10-23. The research container could **not** reach `punters.com.au`, `racenet.com.au`, `puntapi.com`, `api.punters.com.au`, `api.racenet.com.au`, `odds.com.au` or `puntcdn.com` (proxy block), and the WebSearch budget was exhausted before this task started, so **nothing below was fetched live from either site**. Every endpoint, header, field name and selector comes from reading public source code on GitHub (GitHub code search → `raw.githubusercontent.com`), plus **four real captured payloads** copied from public repos (one Racenet SSR page with `window.__NUXT__`, one Punters odds-comparison JSON in both encoded and decoded form, one odds.com.au meetings JSON). Confidence tags: **high** = seen in ≥2 independent working clients or in a real captured payload; **medium** = one working client, or the same GraphQL schema observed through a sibling surface; **low** = memory/inference — probe on the user's machine before relying on it.

> **Legal/ToS note (medium):** Both sites are commercial News Corp properties ("Punters Technology"); their terms prohibit automated access and both actively block it (CloudFront 403 on Punters, Kasada challenge on Racenet). Personal-use research scraping is widespread (dozens of public repos) but not permitted by the ToS. The adapter must be polite (single-threaded, 5–20 s gaps, stop on the first 401/403/429/202-challenge) and must treat these as **secondary/cross-check** sources behind the official racing-authority feeds, never as the only source.

---

## 0. TL;DR for the adapter author

| Need | Best endpoint | Format | Auth | Conf. |
|---|---|---|---|---|
| Meetings + races for a date (all countries, grouped) | `GET https://puntapi.com/graphql-horse-racing?operationName=meetingsIndexByStartEndTime&variables={"startTime":"<ISO Z>","endTime":"<ISO Z>","limit":100,"sportIds":1}&extensions={"persistedQuery":{"version":1,"sha256Hash":"<hash>"}}` → `data.meetingsGrouped[].group/meetings[].name,slug/events[].id,eventNumber,name,slug,startTime` | JSON | `authorization: Bearer none` + browser-ish headers, `origin/referer: https://www.racenet.com.au` | high |
| Same by local date | `operationName=meetingsByStartEndDate` (`startDate`,`endDate`) / `meetingsByStartEndDateAndCountryName` (`+country`) / `meetingsIndexByStartEndDate` (`startDate`,`endDate`,`limit`) | JSON | same | medium |
| Race card (runners, scratchings) | `operationName=eventById&variables={"eventId":"<id>"}` → `data.event.selections[]{id,competitor{name},status}` (+ more fields, §4.4) | JSON | same | high (paths listed) / medium (full field list) |
| Meeting by slug (all races) | `operationName=meetingBySlug&variables={"slug":"flemington-20261024"}` | JSON | same | medium |
| Full form / sectionals for runners | `operationName=fullFormsBySelectionIds&variables={"selectionIds":["..."],"limit":15}` and `getSectionalsBySelectionIds` | JSON (`data.competitorForms[].forms[]`, §6.3) | same | medium |
| Jockey/trainer/horse stats for a race | `operationName=statsByEventId&variables={"eventId":"<id>"}` | JSON | same | medium (shape unknown) |
| Odds (all bookmakers, flucs) | `GET https://puntapi.com/odds/au/event/<eventId>?betTypes=fixed-win,fixed-place,tote-win,exchange-win,exchange-win-lay&priceFluctuations=50&type=best,bookmaker&bookmaker=sportsbet,tabtouch,ladbrokes,neds,bet365,pointsbet,betr,unibet,bluebet,betfair,racenetstandard` → `odds[]{selectionId,bookmakerId,betType,price{value}}` | JSON | `accept: application/json, text/plain, */*` + origin/referer racenet | high |
| Racenet race page (SSR, no JS needed) | `GET https://www.racenet.com.au/form-guide/horse-racing/{venue}-{YYYYMMDD}/{race-slug}-race-{n}/overview` → ld+json + `window.__NUXT__` Apollo cache (§8) | HTML | none, but Kasada bot wall (HTTP **202** challenge) / CloudFront 403 | high |
| Racenet print form (deepest form) | `GET https://www.racenet.com.au/form-guide/horse-racing/print?meetingSlug={venue}-{YYYYMMDD}&eventSlug={race-slug}&printSlug=print-form` → `__NUXT__.fetch["FormGuidePrint…"].selections[].forms[]` | HTML/JS | same | high |
| Racenet results (positions, margins, SP, in-running, exotics) | `GET https://www.racenet.com.au/results/horse-racing/{venue}-{YYYYMMDD}/all-races` → `__NUXT__.apollo.defaultClient["$Selection:<id>.result"]` | HTML/JS | same | high |
| Racenet track condition / rail / weather | same pages: `apollo["$Event:<id>.trackCondition"]{overall,rating,surface}`, `apollo["$Event:<id>.weather"]{condition,temperature,wind,humidity}`, `apollo["Meeting:<id>"].railPosition/trackComments` | JSON in HTML | same | high |
| Punters race page | `GET https://www.punters.com.au/form-guide/horses/{venue}-{YYYYMMDD}/{race-slug}-race-{n}/` (tabs `#Overview`, `#OddsComparison`) → `table.form-guide-overview__table`, `table.compare-odds__table`, ld+json `performer` | HTML (SSR) | none; CloudFront bot wall; headless Firefox works | high |
| Punters odds comparison JSON | `GET https://www.punters.com.au/api/web/public/Odds/getOddsComparisonCacheable/?allowGet=true&APIKey=<sniffed>&eventId=<id>&betType=FixedWin` → `selections[]{competitorNumber,barrierNumber,name,jockeyName,weight,prices[]{bookmaker,bookmakerLower,odds,betType}}` | JSON (2018: `{"r": rot13(base64(json))}`) | `APIKey` query param copied from the page's own XHR | high (shape, real sample) / medium (key) |
| Punters first-party GraphQL (speed map `prediction`, official ratings, full form w/ sectionals, video comments, stewards) | `POST https://api.punters.com.au/racing` `{"query": "<document>", "variables": {...}, "operationName": "..."}` | JSON | **logged-in** Punters account: `Authorization: Bearer <rampart_token cookie>`; scripted POST gets CloudFront 403 — must run inside a real-Chrome page context | high (documents verbatim) |
| Racenet first-party GraphQL (`statsByTrack`, `statsByJockey`) | `POST https://api.racenet.com.au/racing` | JSON | hard 403 to scripts (headless too); only reachable from the site's own JS | medium |
| Tips | `GET https://www.racenet.com.au/horse-racing-tips` / `/horse-racing-tips/{venue}`; Punters tips on race page (`Punters Edge` is subscription) | HTML | none / subscription | low |
| News / rumours | `https://www.racenet.com.au/news/...` (content API `https://api.racenet.com.au/content`); `https://www.punters.com.au/news/`; RSS **not evidenced** | HTML/JSON | — | low |

**Join keys that the evidence supports:** the numeric **eventId** is identical across puntapi GraphQL (`event.id`), puntapi odds (`/odds/au/event/{id}`), the Punters legacy URL (`/form-guide/{venue}_{meetingId}/{race-slug}_{eventId}/` — real sample: `coffs-harbour_128612/sawtell-cup-july-22nd-maiden-plate_739023/` with `eventId: 739023`) and the Punters odds JSON (`eventId`); **selectionId** is identical across puntapi `event.selections[].id`, `odds[].selectionId`, Punters odds `selections[].selectionId` and Racenet Apollo `Selection:<id>`; **competitorId** (= horse id in `/horses/{slug}_{competitorId}/`) is shared too. The **meeting slug** `{venue-slug}-{YYYYMMDD}` is identical on Racenet and on the new Punters URLs. Against other RaceLens sources, join on (date, venue, raceNumber) + saddlecloth `competitorNumber` + normalised horse name (strip `(NZ)` etc.).

---

## 1. Evidence base

| Repo / file | What it proves | URL |
|---|---|---|
| `afobsidian/Racenet-API` — `api_queries.py`, `query_hashes.json`, `refresh_query_hashes.py`, `README.md` (PySide6 desktop app, 2025-26) | Complete client of `puntapi.com/graphql-horse-racing` + `/odds/au/event`: 9 operation names, variable names, headers, persisted hashes, hash-refresh via Playwright request interception on racenet.com.au | https://github.com/afobsidian/Racenet-API/blob/87777e041408fd40c84a2ed22230f33f7a83749c/api_queries.py , …/query_hashes.json , …/refresh_query_hashes.py , …/README.md |
| `l0rdwalker/betshock_v2` — `Arbie/engine/racenet/sports/racenet_horses.py`, `testing/testing_racenet.py` (2024) | Independent second client: `meetingsIndexByStartEndTime` (ISO `startTime/endTime`, `sportIds`), `eventById`, odds URL with full bookmaker list; response paths `data.meetingsGrouped[].group/meetings/events`, `data.event.selections[].id/competitor.name/status`, `odds[].betType/price.value/selectionId/bookmakerId`; full header set | https://github.com/l0rdwalker/betshock_v2/blob/5ab9224a78abebd5da400737f8ce2ab9ad105fbc/Arbie/engine/racenet/sports/racenet_horses.py , …/testing/testing_racenet.py |
| `datawookie/stackoverflow` — `78597613/scrape.py` (2024-06) | Third client: `meetingsIndexByStartEndDate` with `startDate/endDate/limit`, `authorization: Bearer none`, results URL `/results/horse-racing/{meeting.slug}/{event.slug}`, selector `h4.selection-result__info-competitor-name` | https://github.com/datawookie/stackoverflow/blob/17557588b07d47fbe9d023dff4471d87c56d7074/78597613/scrape.py |
| `Kelvin1761/Kelvin-Agents` (HEAD `1fa3e4f…`, 2026-10) — `.agents/skills/au_racing/punters/punters_fetch.py`, `punters_session.py`, `punters_store.py`, `punters_backfill.py` | Punters first-party GraphQL `https://api.punters.com.au/racing`: two full query documents (`meetingsIndexByStartEndTime`, `getSectionalsBySelectionIds`) with every field, auth via `rampart_token` cookie, CloudFront 403 on scripted POST, pacing rules, SQLite ingest of every field | https://github.com/Kelvin1761/Kelvin-Agents/blob/1fa3e4fa8afefd4dee6e9e6ff6784144d602962b/.agents/skills/au_racing/punters/punters_fetch.py , …/punters_session.py , …/punters_store.py |
| same repo — `racenet_overview.html` (= `racenet_print.html`, identical) | **REAL** Racenet SSR page (2026-08-03) with `window.__NUXT__` IIFE → `config` (API hosts), `apollo.defaultClient` (39 `Bookmaker` objects), Nuxt store module names | https://github.com/Kelvin1761/Kelvin-Agents/blob/1fa3e4fa8afefd4dee6e9e6ff6784144d602962b/racenet_overview.html |
| same repo — `scratch/au_extract_racenet_sp.py`, `au_extract_finishes.py`, `au_extract_positions.py`, `au_pf_backfill_driver.py`, `au_starters_backfill.py`, `au_profile_fetch.py`, `scratch/reflect_rose.log`, `Guides_and_Plans/Crawler_Code_Manual.txt` | Racenet Apollo keys for results (`Event.selections`, `Selection.startingPrice`, `$Selection.result.finishPosition/-1`, `competitorPositionSummary{distance,position,distanceText}`, `CompetitorFormBenchmark.runnerTimeDifferenceL600…`), print-form `fetch.FormGuidePrint*`, profile `Stats` keys, `api.racenet.com.au/racing` 403, block log (`curl_cffi chrome136 … without __NUXT__`, `chrome131 … 403`, `Playwright … 202`) | https://github.com/Kelvin1761/Kelvin-Agents/blob/1fa3e4fa8afefd4dee6e9e6ff6784144d602962b/scratch/au_extract_racenet_sp.py , …/scratch/au_extract_positions.py , …/scratch/au_pf_backfill_driver.py , …/scratch/au_profile_fetch.py , …/scratch/reflect_rose.log |
| same repo at commit `e1e0195` (2026-05-22, before the Racenet code was deleted on 2026-08-03) — `.agents/skills/au_racing/racenet_transport.py`, `au_race_extractor/scripts/extractor.py`, `au_race_extractor/SKILL.md`, `claw_racenet_scraper.py`, `claw_racenet_results.py`, `claw_profile_scraper.py` | The most complete Racenet extractor: transport (curl_cffi impersonation ladder → Playwright live Chrome), block markers, `Meeting/Event/$Event.weather/$Event.trackCondition/Selection/Competitor/Jockey/Trainer/Stats/ExoticResult` fields, print-form `forms[]` fields, HTML classes `racing-full-form-details`, `horse-racing-previous-runs-row` | https://github.com/Kelvin1761/Kelvin-Agents/blob/e1e0195/.agents/skills/au_racing/racenet_transport.py , …/au_race_extractor/scripts/extractor.py , …/claw_racenet_results.py , …/claw_racenet_scraper.py , …/claw_profile_scraper.py |
| `krozlink/oddzy` — `services/srv/race-scraper/testdata/race_card_decoded.json`, `race_card_encoded.json`, `race_schedule_decoded.json`, `scraper.go`, `response.go` (2018) | **REAL** Punters/odds.com.au odds-comparison JSON (10 runners × 19 agencies, flucs) + the `{"r": rot13(base64)}` wrapper + decoder; rot13-obfuscated endpoint strings `…/api/web/public/Racing/getUpcomingRaces/?sport=%s&date=%s` and `…/api/web/public/Odds/getOddsComparisonCacheable/?eventId=%s&includeTAB=1&includeOdds=1&arrangeOdds=0&betType=FixedWin&includeTote=true&allowGet=true`; Go structs for the schedule | https://github.com/krozlink/oddzy/blob/6b161e3881bc2247d1152576086a503b939472a7/services/srv/race-scraper/testdata/race_card_decoded.json , https://github.com/krozlink/oddzy/blob/master/services/srv/race-scraper/scraper.go , …/response.go |
| `kayceem/race-odds-scraper` — `main.py`, `utils.py` (2025) | Modern use of `https://www.punters.com.au/api/web/public/Odds/getOddsComparisonCacheable/` with `allowGet=true&APIKey=…&eventId=…&betType=FixedWin`; APIKey sniffed from the page's XHR; fields read; sister endpoints `odds.com.au/api/web/public/Meetings/getDataByRangeCacheable/`, `Event/getEventHeaderCacheable/` (`venueName,distance,distanceTrackCondition,groupType,prizeMoney,weather`); `Host: www.punters.com.au`, `Origin: https://www.odds.com.au` | https://github.com/kayceem/race-odds-scraper/blob/b194b3000d387baa6698c1f62e51c84ae0d9b7c0/main.py , …/utils.py |
| `equinegpt/tips-results-service` — `scripts/lifeboat/lifeboat_card_adapter.py` (2026-10-23, production) | Racenet SSR parsing without JS: ld+json `description` regex, `event-selection-row-container`, `selection-scratched`, `horseracing-selection-details-name`, barrier/weight regexes, `/profiles/jockey|trainer/<slug>`; Kasada **HTTP 202** challenge semantics; residential-proxy requirement; pacing | https://github.com/equinegpt/tips-results-service/blob/d9a4104653b187ced53bcffbfa1663d1ae5b02b5/scripts/lifeboat/lifeboat_card_adapter.py |
| `visuatec/races` — `scrape_race_list.py`, `scrape_race_horses.py` (2024) | Racenet index `a[data-analytics="Upcoming Race Table : Australia : Meeting Link"]`, race page container `div.form-guide-page__overview.form-guide__content`, runner links `a[href*="/profiles/horse"]` "N. Name" | https://github.com/visuatec/races/blob/7b5b2be0e324b5a03403e1299f5915aeecd82db0/scrape_race_list.py , …/scrape_race_horses.py |
| `jacklot1122/racing-value-finder` — `racingwebsite.py`, `app.py` (2026-01) | Punters new URL grammar `/form-guide/horses/{venue}-{YYYYMMDD}/{slug}-race-{n}/`, `#OddsComparison`, `table.compare-odds__table` selectors, PDF form download (`puntcdn.com/form-guides/*.pdf`), Cloudflare/CloudFront "checking your browser" heuristic, Playwright Firefox | https://github.com/jacklot1122/racing-value-finder/blob/277e5991c133b3d096fb143fa25caf231e4418a7/racingwebsite.py , …/app.py |
| `jacklot1122/race` — `race.py` (2026) | Punters ld+json `performer[].name` = "Horse - J: Jockey - T: Trainer"; "Compare Odds" tab; bookmaker column order | https://github.com/jacklot1122/race/blob/2613a1737e70cfc41ab66542aab7712a9b525c29/race.py |
| `SaurabhAkolkar/web_scriping` — `GoutteController.php` (2025-07) | Punters header selectors `.form-guide-event-header__main/__race-title/__detail-inner/__detail-time`, `.event-number__pill--active`, `.meetings-selector__label`, `.selection-runner__info`, horse page `.timeline-box .placed .dist` | https://github.com/SaurabhAkolkar/web_scriping/blob/ff1d82f861a694ff451be032061f70a4665688d7/app/Http/Controllers/GoutteController.php |
| `predictive-punter/punters_client` — `punters_client/scraper.py` + tests (2016, PyPI `punters-client`) | Legacy Punters URL grammar `/form-guide/{Venue}_{meetingId}/{Race-Slug}_{raceId}/`, `/racing-results/{date}/`, full selector set for meets/races/runners/profiles/performances | https://github.com/predictive-punter/punters_client/blob/master/punters_client/scraper.py , https://github.com/predictive-punter/punters_client/blob/87fa0ba29f716937ae2a602b6946662f79b3452d/tests/scraper/scrape_runners_test.py |
| `JayTeeGeezy/pypunters` — `pypunters/scraper.py` (2016) | Same selectors, independent | https://github.com/JayTeeGeezy/pypunters/blob/ddda5c89e8c70c187920b9e02f3faed738968eaf/pypunters/scraper.py |
| `tom773/pyHcp` — `parTimes.py` (2022-23) | Punters selectors still alive: `a.form-guide-overview__horse-link`, `a.form-overview__full-form-link`, `li.timeline-disc`, `span.badge`, `span.dist.simlight`, `span.timeline-right.placed`, `tr.isPlaced`, `abbr[data-type=distance]`, `li.latest-result` | https://github.com/tom773/pyHcp/blob/60ba1517e8747fdd609fc9c97d8bd4c6c48726af/parTimes.py |
| `konandodev7/web-scraping-hub` — `sites/Punters/punters.com.au.py` (2023) | Punters `/racing-results/` table parsing (`results-table__details`, `results-table__capital`, `abbr.conversion`, `data-utime`), ScrapeOps proxy | https://github.com/konandodev7/web-scraping-hub/blob/d6de484bb3774ecefc55cfd531ba73b0a0078e54/sites/Punters/punters.com.au.py |
| `jkentjnr/kaggle` — `arbitrage/punters/lib/punters.js` (2018) | Punters odds widget `GET /widgets/OddsComparison.php?type=OddsComparison&sport=&group=&limit=` + selectors | https://github.com/jkentjnr/kaggle/blob/26ac5516a775c954e2a2a3326bdefe4306af6d5d/arbitrage/punters/lib/punters.js |
| `RPPandey02/webscraping_idealbet` — `mainn.py` (2024) | Racenet results selectors `h4.selection-result__info-competitor-name`, `h1.meeting-selector__meeting-name`, `/results/greyhounds/`, `a[data-analytics="Results : Tab Group : Today"]` | https://github.com/RPPandey02/webscraping_idealbet/blob/732face2401ff2b220d6955446770ee89705870b/mainn.py |
| `clairegrady/betfair-greyhound` — `shared/greyhound_race_scraper_postgres.py` (2025) | Racenet `/form-guide/greyhounds` list: `a.upcoming-race-table__event-link[data-analytics="Race Event Link : Greyhounds : <Venue> R<n>"]`, `abbr.relative-time__inner` | https://github.com/clairegrady/betfair-greyhound/blob/96c1cb6409df9724364724aaaca8ac163171b2be/shared/greyhound_race_scraper_postgres.py |
| `369ed/hkjc-predictor` — `scraper.py` (2026) | Racenet tips URL `/horse-racing-tips/sha-tin`, plain `requests` often blocked | https://github.com/369ed/hkjc-predictor/blob/f784cddec3dac49641d901ca9230c35c8e6d88ad/scraper.py |
| `WhoKnowsGroup/WKG-Scarp` — `PuntersDataScraper.java` (2016) | Punters per-meeting results URL `/racing-results/new-south-wales/Taree/2016-11-28/` | https://github.com/WhoKnowsGroup/WKG-Scarp/blob/dc966ca4af4bb9fdcc37780cfaa0b2231dec9683/src/main/java/com/webscrapper/batch/PuntersDataScraper.java |
| `nordteamdev/bots.hub` Embera provider; `reconsumeralization/webduhny` oEmbed providers | Punters oEmbed `https://www.punters.com.au/api/oembed/?format=json` for `https://www.punters.com.au/*` | https://github.com/reconsumeralization/webduhny/blob/main/packages/api-page-builder/src/graphql/graphql/pages/oEmbed/providers.ts |
| `gladiopeace/Files-Indexer` `M/Misbegin/XML_files.csv` | Racenet sitemap `https://www.racenet.com.au/sitemap-sts-horse-1.xml` (horse-profile sitemaps) | https://github.com/gladiopeace/Files-Indexer/blob/b272558c486188ea8516b4aa65b65baeee1b0248/M/Misbegin/XML_files.csv |
| `danielboasemammoth/racing-predictor` `PROJECT_BRIEF.md`; `rumca-js/RSS-Link-Database-2025` (r/webscraping 2025-05-02) | "Punters.com.au (form guides) — CloudFront protected, may need headers"; hobbyists failing to scrape `/odds-comparison/horse-racing/` with Selenium | https://github.com/danielboasemammoth/racing-predictor/blob/6b2ad1691497ec8efb4129617f9b4693f53f11f9/PROJECT_BRIEF.md |
| Apify actor `lexis-solutions/racenet-au-scraper` (listed in `cporter202/openclaw-api-list`) | A paid scraper exists for Racenet horse profiles ("horse stats, breeding details, ownership, race history, connections") — confirms the profile pages are rich | https://apify.com/lexis-solutions/racenet-au-scraper |

---

## 2. Architecture in one paragraph

Punters.com.au (launched 2008, acquired by News Corp 2017) and Racenet.com.au (News Corp since 2016) run on one data platform. Racenet is a **Nuxt 2 server-side-rendered Vue app** (`data-server-rendered="true" id="__nuxt"`, `window.__NUXT__=(function(a,b,…){…})(…)`, assets on `https://assets2.racenet.com.au/_nuxt/`) whose runtime `config` (real capture) names three first-party backends — `NUXT_ENV_RACING_API_URL: https://api.racenet.com.au/racing` (GraphQL), `NUXT_ENV_CONTENT_API_URL: https://api.racenet.com.au/content`, `NUXT_ENV_REST_API_URL: https://api.racenet.com.au/rest-services-sts` — and an auth stack (`https://auth.racenet.com.au/webtoken`, token cookie `npat`, News Corp "rampart" identity script from `news.com.au`). The browser additionally calls the **public, unauthenticated** GraphQL gateway `https://puntapi.com/graphql-horse-racing` with **Apollo persisted queries** and the odds service `https://puntapi.com/odds/au/event/{id}` (both with `origin: https://www.racenet.com.au`). Punters uses the same GraphQL schema on `https://api.punters.com.au/racing` (frontend `bs()` sends `Authorization: Bearer <$rampart.token || rampart_token cookie>`), a legacy PHP layer `https://www.punters.com.au/api/web/public/{Odds,Racing,Meetings,Event}/…` shared with sister site `odds.com.au`, HTML widgets under `/widgets/*.php`, and a CDN at `https://puntcdn.com` (silks `…/silks/horse-racing/{competitorId}_{slug}.png`, bookmaker logos `…/Logos/{bookie}/…`, full-form PDFs `…/form-guides/*.pdf`; older `//dnu5embx6omws.cloudfront.net/…`). The Racenet Apollo cache (`apollo.defaultClient`) and the Punters GraphQL responses expose the **same types**: `Meeting`, `Event`, `Selection`, `Competitor`, `Jockey`, `Trainer`, `Stats`, `SelectionResult`, `CompetitorPositionSummary`, `CompetitorForm`, `CompetitorFormBenchmark`, `Bookmaker`, `ExoticResult`, `Weather`, `TrackCondition` — so field names learned on one surface transfer to the other (that is the basis of every "medium" tag below).

---

## 3. puntapi GraphQL gateway — `https://puntapi.com/graphql-horse-racing` — **PRIMARY for machine access**

### 3.1 Transport

| Item | Value | Conf. | Evidence |
|---|---|---|---|
| Method/URL | `GET https://puntapi.com/graphql-horse-racing?operationName=…&variables=<url-encoded JSON>&extensions=<url-encoded JSON>` | high | Racenet-API `api_queries.py` L270-278; betshock `racenet_horses.py`; datawookie `scrape.py` |
| `extensions` | `{"persistedQuery":{"version":1,"sha256Hash":"<64 hex>"}}` (Apollo APQ). A raw `query=` document is "also accepted" per the Racenet-API README ("requires either a raw GraphQL document or a persisted-query hash") but **no client was seen sending one** — probe `?query={__typename}` first | medium | README "Refreshing Persisted Query Hashes" |
| Required headers | `authorization: Bearer none` (literal string "none"), `accept: */*`, `content-type: application/json`. All three clients also send `origin: https://www.racenet.com.au`, `referer: https://www.racenet.com.au/`, a Chrome UA, `sec-fetch-*: empty/cors/cross-site`, `sec-ch-ua*`. datawookie succeeded with only UA + `Accept` + `authorization`, so origin/referer are probably optional — keep them anyway | high | all three |
| Response | `{"data": {...}}`; failure `{"errors":[…]}` (Racenet-API: any non-null `errors` → treat as failure, retry ≤5 × 2 s). Stale hash is the common failure mode | high | `api_queries.py` `send_request()` |
| Rate limit | None documented. betshock ran with **no delay** between hundreds of calls (2024) without special handling; Racenet-API retries non-200 5× with 2 s sleep. Be polite anyway: ≤1 req/s, exponential backoff on 429/403 | medium | both |
| Hosting | `puntapi.com` is a third-party domain seen loading on 2–3 AU sites (DuckDuckGo Tracker Radar, prevalence 2021-10 ≈ 2e-5 AU) | medium | tracker-radar entries |

### 3.2 Operations and variables (two generations of hashes)

| operationName | Variables (exact keys) | Purpose | sha256Hash (Racenet-API `query_hashes.json`, 2025-26) | Older hash | Conf. |
|---|---|---|---|---|---|
| `meetingsByStartEndDate` | `startDate: "YYYY-MM-DD"`, `endDate` | meetings for a local-date range | `223af3d0cbfa0a25e744c34941835eca3a91e6dbc8f121128fa2acd7361c2062` | — | medium |
| `meetingsByStartEndDateAndCountryName` | `startDate`, `endDate`, `country` (e.g. `"Australia"`) | same, one country | `7e3f50657b051fdfd5059245f55682fba76f14c6898e6f9de3b7653205195f0c` | — | medium |
| `meetingsIndexByStartEndTime` | `startTime`, `endTime` (ISO `YYYY-MM-DDTHH:MM:SS.mmmZ`), `limit: 100`, `sportIds: 1` (1 = horse racing; betshock sends the scalar `1`, Racenet-API the same) | index of meetings+events in a UTC window | `80eb89d41ec583cd84078e2ee7eaa572bcdaae0432ee70c4fda1eb8bda246e8d` | `b8b5bef7544da6d9bc3f601bf6e030a3de79ca24e168186b110692a4302bcbfb` (betshock 2024) | high |
| `meetingsIndexByStartEndDate` | `startDate`, `endDate`, `limit: 100` | same by date | — | `998212fede87c9261e0f18e9d8ced2ed04a915453dcd64ae1b5cf5a72cf25950` (datawookie 2024-06) | medium |
| `meetingBySlug` | `slug: "flemington-20261024"` | one meeting, all events | `e353a397746c38cbbc7efdf98495314692e10654532d8cc26fe0aeae7aa97058` | — | medium |
| `eventById` | `eventId: "<numeric string>"` | race card | `8fff49d83321193fce3b3a0c39bdcff4c74dc0725feede61b6b726c84d76845d` | `0029451798d3780a964eef179e79ddad1f1074c93038774ec8626b8b22999e6d` (betshock 2024) | high |
| `fullFormsBySelectionIds` | `selectionIds: ["…"]`, `limit: int` | full past-run form per runner | `ed7986a7b3dfaafe2e3801a9b04e7941c2e5291ef97d2cb6d2de2a1b9c6662f1` | — | medium |
| `getSectionalsBySelectionIds` | `selectionIds` | sectional times per past run | `05aba715ad18f10f5b526c18f109cd37dbbc7f20655d6b6822941e9b9086ae00` | — | medium |
| `statsByEventId` | `eventId` | runner/jockey/trainer stats for a race | `5e6e59dd2725d40f214cc3d4680b9934660f9fd1b89c2d8111b22d30f8c03dc6` | — | medium |
| `predictorSettingsDefaults` | (none sent; `brand: "punters"` exists in the client model) | Punters "predictor" default weights | `b3c0e6a5157e60028513deb46b643cfcc464fda6cc10bc58ebcce6c21d4f4c0c` | — | low |

**Hashes rotate with site deploys** (two different `eventById` hashes 2024 vs 2025-26). Keep them in config and implement the refresh procedure from `refresh_query_hashes.py`: launch Playwright Chromium, visit `https://www.racenet.com.au/form-guide/horse-racing`, `/results/horse-racing`, `/horse-racing-tips`, click up to three `a[href*="/all-races/overview"]`, dismiss `.campaign-modal__overlay / .campaign-modal__close / .np-web-widget-campaign-modal .close`, and on every request whose URL contains `puntapi.com/graphql-horse-racing` read `operationName` and `JSON.parse(extensions).persistedQuery.sha256Hash` from the query string (or from the POST body). Alternatively try a raw `query` document (medium) — if that works, no hashes are needed at all.

### 3.3 `meetingsIndexByStartEndTime` / `…Date` response (high)

```
data.meetingsGrouped[]            # one entry per region group
  .group        string            # "Australia" | "International" (betshock filters == 'Australia')
  .meetings[]
    .name       string            # "Flemington"
    .slug       string            # "flemington-20261024"  (same slug Racenet URLs use)
    .events[]
      .id          string|number  # eventId, e.g. "1691579" — used by eventById and /odds/au/event/{id}
      .eventNumber int            # race number
      .name        string         # race name
      .slug        string         # "<race-name-slug>-race-N"  (Racenet URL segment)
      .startTime   string         # "YYYY-MM-DDTHH:MM:SS.mmmZ" (UTC)
```
Fixture: `fixtures/puntersracenet/puntapi_graphql_meetingsIndexByStartEndTime_2026-10-24.json`. Unknown (probe): whether meetings carry `id`, `venue`, `country`, `trackCondition`, and whether `events[]` carry `status`/`distance`/`isResulted`.

### 3.4 `eventById` response

High-confidence paths (betshock reads them): `data.event.selections[]` with `.id` (selectionId), `.competitor.name`, `.status` (`"SCRATCHED"` for scratchings; Punters store code also sees `"RESULTED"`; Racenet also shows `statusAbv` `"S"`/`"LR"`). Medium-confidence additional fields, taken from the same types as rendered by Racenet's Apollo cache and Punters' GraphQL (§6, §8): `event.{eventNumber,name,slug,startTime,distance,distanceUnit,eventClass,racePrizeMoney,trackType,isResulted,starters,pace,winningTime,weather{condition,temperature,wind,humidity,feelsLike,conditionIcon},trackCondition{overall,rating,surface},meeting{name,slug,railPosition,meetingDateLocal,trackComments}}` and `selections[].{competitorNumber,barrierNumber,weight,jockeyWeightClaim,ratingOfficial,startingPrice,statusAbv,competitor{id,name,slug,age,sexShort,colour,sire,dam,sireOfDam,owner},jockey{id,name,slug,stats},trainer{id,name,slug,stats},stats{career{starts,wins,seconds,thirds},lastTenFigure,winPercentage,placePercentage,totalPrizeMoney,roi,track,distance,trackDistance,firm,good,soft,heavy,synthetic,class,firstUp,secondUp,thirdUp,currentSeason,lastYear,fav},flucOdds[].value,prediction{…}}`. Fixture: `puntapi_graphql_eventById_flemington_r7_2026-10-24.json`.

### 3.5 Error envelope
`{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}` — standard Apollo Server text, **low** confidence on exact wording; the clients only test `errors != null`. Fixture: `puntapi_graphql_error_PersistedQueryNotFound.json`.

---

## 4. puntapi odds service — `GET https://puntapi.com/odds/au/event/{eventId}` (high)

| Param | Values seen | Notes |
|---|---|---|
| `betTypes` | `fixed-win,tote-win,exchange-win,exchange-win-lay` (betshock); `fixed-win,fixed-place` (Racenet-API) | comma list |
| `bookmaker` | `ubet,sportsbet,bet365,betm,ladbrokes,betfair,boombet,tabtouch,pointsbet,neds,racenetstandard` | slugs; `racenetstandard` = Racenet's own "standard" price (Racenet-API default); the real Racenet `Bookmaker` list (39 slugs, real capture) is: `ladbrokes, sportsbet, crownbet, unibet, pointsbet, palmerbet, bet365, betfair, ubet, nswtab, stab, neds, betwayuk, bluebet, ladbrokesuk, coraluk, topsport, betfairuk, realbookie, boombet, betright, crossbet, colossalbet, betr, tabtouch, picklebet, dabble, blondebet, mintbet, betestate, baggybet, betchamps, next2go, ripperbet, betmax, betdragon, puntx, betfocus, bearbet` |
| `priceFluctuations` | `50`, `4` | how many flucs to include |
| `type` | `best,bookmaker` | include a best-of row |

Headers: `accept: application/json, text/plain, */*` (no `authorization`), plus the racenet origin/referer/UA set. Response (high for these paths): `{"odds":[{"selectionId": <id>, "bookmakerId": <id-or-slug>, "betType": "fixed-win", "price": {"value": 4.6}, …}]}` — betshock keys a dict by `price['bookmakerId']` and `str(price['selectionId'])`; Racenet-API reads `response_json["odds"]`. **Unknown/low:** whether `bookmakerId` is the slug or the numeric `Bookmaker.id`; the fluctuation sub-structure (nobody read it back; Racenet's Apollo `Selection.flucOdds[]` has `value`, so expect `[{value, …time}]`); the `best` row shape. Fixture: `puntapi_odds_event_flemington_r7_2026-10-24.json` (constructed; verify on first live call and update).

---

## 5. Punters legacy JSON API — `https://www.punters.com.au/api/web/public/…` (shared with odds.com.au)

| Endpoint | Params | Returns | Conf. | Evidence |
|---|---|---|---|---|
| `GET /api/web/public/Odds/getOddsComparisonCacheable/` | 2025: `allowGet=true&APIKey=<key>&eventId=<id>&betType=FixedWin` ; 2018: `eventId=<id>&includeTAB=1&includeOdds=1&arrangeOdds=0&betType=FixedWin&includeTote=true&allowGet=true` | race header + `agencies[]` + `selections[]` with per-bookmaker `prices[]` and `flucs` | high (REAL sample) | kayceem `main.py`; oddzy `scraper.go` (rot13 strings) + `race_card_decoded.json` |
| `GET https://www.odds.com.au/api/web/public/Racing/getUpcomingRaces/` | `sport=1&date=YYYY-MM-DD` | `{hasResults, isHorseRacingFutures, regionGroups[]{regionGroup, meetings[]{meetingName, regionDescription, regionIconURL, events[]{eventId, eventNumber, eventName, startTime(unix), dateWithYear, isImminent, isAbandoned(0/1), resulted(0/1), results("2,5,11" | int | null), eventUrl, selections}}}}` — **meetings for a date** on the sister host; very likely also served by punters.com.au under the same path | high (REAL sample; odds.com.au) / medium (on punters host) | oddzy `response.go`, `race_schedule_decoded.json` |
| `GET https://www.odds.com.au/api/web/public/Meetings/getDataByRangeCacheable/` | `allowGet=true&APIKey=…` (+ range params the page adds) | `events[]{id, url, name, regionName ("Australia" or "1")}` | medium | kayceem |
| `GET https://www.odds.com.au/api/web/public/Event/getEventHeaderCacheable/` | `allowGet=true&APIKey=…&eventId=…` | `venueName, distance, distanceTrackCondition ("1200m, Good 4"), groupType, prizeMoney, weather` | medium | kayceem |
| `GET /api/oembed/?format=json&url=…` | oEmbed | embed JSON for Punters URLs | medium | oEmbed provider lists |

**Transport quirks (high):** in 2018 the body was `{"r": "<rot13(base64(json))>"}` — decode with rot13 then base64 (oddzy `decode()`; verified locally: the real encoded fixture decodes to the real decoded fixture). In 2025 kayceem parsed plain JSON — so detect `r` and decode when present. The `APIKey` is a per-page value: kayceem loads `https://www.odds.com.au/horse-racing/` in headless Chromium, waits for `div.racing-meeting-rows__main`, and copies `APIKey=` from the URL of the page's own `getDataByRangeCacheable` XHR; headers used for the odds call: `Host: www.punters.com.au`, `Origin: https://www.odds.com.au`, `Referer: https://www.odds.com.au/`, `Accept: application/json, text/plain, */*`, random desktop/mobile UA, HTTP/2. Pacing in that client: 2–5 s random between events.

**Response shape of `getOddsComparisonCacheable` (REAL, 2018; field names also read by the 2025 client):**
```
eventId int, eventName "Coffs Harbour R1", eventNameFull "Coffs Harbour Race 1 - 810m", eventDesc (race name, upper), eventDistance "810",
startTime unix, sportId 1, status "open", resultState "unresulted", isHorseRacing/isGreyhounds/isHarness/isRacing/isWin/isForm/showTote/… bools,
formGuideUrl "https://www.punters.com.au/form-guide/coffs-harbour_128612/sawtell-cup-july-22nd-maiden-plate_739023/",
agencies[] { agencyName, displayName, nameLowercase, betType ("DivWin"|"FixedWin"|"ExchangeBack"|"ExchangeLay"), betTypeGeneral ("Tote"|"Win"|"Back"|"Lay"),
             quickbetEnabled, marketPercentage, lastUpdated unix, logoUrl, oddsLogo, oddsLogoCircle, logoForeground, logoBackground, claimUrl "/link/<bookie>/?eid=<eventId>",
             colors{primary,secondary,font,secondaryFont}, deal, dealSubtext, dealTerms, freebet }
selections[] { selectionId "7424349", competitorId "627808", competitorNumber "1", barrierNumber "5", name, weight "59.0kg", jockeyName, jockeyUrl, jockeyWeight "52.0kg",
               hasWeightClaim, jockeyWeightClaim, isEmergency, result null|int, resultOrdinal, profileUrl "https://www.punters.com.au/horses/feline-fantastic_627808/",
               imageUrl (silk), bestOdds, bestOddsBookie, flucs "[[unix,price],…]" (JSON **string**), flucsKey "<selectionId>-Average-FixedWin",
               prices[] { bookmaker, bookmakerLower, betType, odds (absent when no price), hasOdds, isBest, oddsKey "<selectionId>-<Bookie>-<BetType>", betUrl, quickbetEnabled, bookmakerColors (single-quoted pseudo-JSON string), exchangeSuffix "_back"|"_lay" (2025) } }
```
Fixtures: `punters_odds_getOddsComparisonCacheable_REAL_coffs-harbour_r1_2018-06-14.json`, `…_REAL_encoded-wrapper_…json`, constructed modern `…_flemington_r7_2026-10-24.json`, `oddscomau_getUpcomingRaces_REAL_2018-06-10.json`.

---

## 6. Punters first-party GraphQL — `POST https://api.punters.com.au/racing` (field names high, access medium)

### 6.1 Access (Kelvin-Agents `punters_session.py`, 2026-10-13, high)
* Scripted `POST` from Python → **CloudFront 403**; in-browser `fetch()` from a punters.com.au page works. The client launches **headed real Chrome** (`channel="chrome"`, persistent profile, `ignore_default_args=["--use-mock-keychain","--password-store=basic"]`), navigates to `https://www.punters.com.au/form-guide/`, waits 3–9 s, then `page.evaluate(fetch(RACING_API, {method:'POST', credentials:'include', headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok}, body: JSON.stringify({query, variables, operationName})}))`.
* `tok` = value of cookie **`rampart_token`** (the frontend's `bs()` uses `$rampart.token || rampart_token cookie`). The user logs in once manually in a normal Chrome window; the Punters login page rejects automation-controlled Chrome. Headless is blocked.
* `TypeError: Failed to fetch` in the page = CloudFront interstitial without CORS headers → treat as blocked, stop. Also stop on HTTP 401/403/429/5xx and on GraphQL `errors[].message` containing `auth|forbidden|subscri|premium|permission|rate`.
* Pacing the author settled on after being refused once: **12–20 s between requests, 60–180 s pause every 20–30 requests, ≤250 requests per run, single Chrome, cache every (operation, variables) forever**.

### 6.2 `meetingsIndexByStartEndTime` document (verbatim, high)
```graphql
query meetingsIndexByStartEndTime($startDate: String, $endDate: String) {
  meetings(startDate: $startDate, endDate: $endDate) {
    id slug venue { name }
    events { id eventNumber
      selections { id competitorNumber barrierNumber status selectionResult officialMargin
        ratingOfficial
        competitor { id name slug }
        prediction { normSpeedMeasure speedMeasureRatingName barrierSpeedRating closingSpeedRating
          modelOutput modelRank width length winningChance speedMeasure finishSpeed } } } } }
```
Variables `{"startDate":"2026-10-24","endDate":"2026-10-24"}`. Notes from the ingest code: `status` ∈ {`RESULTED`, `SCRATCHED`, …}; `selectionResult` is the integer finish position once resulted; `officialMargin`; `ratingOfficial` = official handicap rating; meeting `slug` ending `-bt` = barrier trials; `prediction` is the **Punters speed-map model** (`speedMeasureRatingName` e.g. leader/on-pace/midfield/backmarker label, `modelRank`, `winningChance`) — the author warns it is not proven to be the pre-race version for historical events. Fixture: `punters_api_racing_meetingsIndexByStartEndTime_2026-10-24.json`.

### 6.3 `getSectionalsBySelectionIds` document (verbatim, high) — full form + sectionals
```graphql
query getSectionalsBySelectionIds($selectionIds: [String!]!, $limit: Int) {
  competitorForms(selectionIds: $selectionIds, limit: $limit) {
    count selectionId
    forms { id isTrial statusAbv finishPosition eventStarters meetingDate meetingName
      eventDistance eventDistanceUnit trackType trackCondition trackConditionRating
      eventNumber eventNameForm groupType finishTime venue { name }
      margin secondMarginDecimal weight barrier barrierRow barrierHandicap
      prizeMoney startingWinPriceDecimal daysSinceLastRun isFirstUp isSecondUp isThirdUp
      videoComment videoNote stewardsReport
      jockey { id name } trainer { id name }
      winnerName secondName thirdName
      formLine { places { finishPosition competitorName competitorId details } }
      sectionalTimeSummary { earlySpeed midSpeed lateSpeed averageSpeed averageTime }
      sectionalTime { l800 { split speed } l600 { split speed } l400 { split speed }
                      l200 { split speed } finish { split speed } } } } }
```
Variables `{"selectionIds":["9931201"],"limit":15}`. Races and barrier trials are returned together — split on `isTrial`. `startingWinPriceDecimal` = SP. This is the richest per-run record on either site (comments, stewards, 200 m splits). The puntapi persisted `fullFormsBySelectionIds(selectionIds, limit)` almost certainly returns the same `CompetitorForm` type (medium). Fixture: `punters_api_racing_getSectionalsBySelectionIds_flemington_r7.json`.

### 6.4 Racenet first-party GraphQL — `https://api.racenet.com.au/racing` (medium)
Real `config` confirms the host. Kelvin's note (2026): it exposes `statsByTrack` / `statsByJockey`, but the host returns **hard 403** to scripts (POST, GET, headless Playwright) and the punters mirror likewise; only the rendered HTML profile pages worked (`curl_cffi impersonate=chrome120`, ~1 in 3 success). Treat as unreachable; get the same data from the SSR pages (§8).

---

## 7. Racenet website — URL grammar (high unless noted)

| Page | URL pattern | Evidence |
|---|---|---|
| Form guide index (today's meetings, AU + international) | `https://www.racenet.com.au/form-guide/horse-racing` (also `/form-guide/greyhounds`, `/form-guide/harness`) | visuatec, Racenet-API, betfair-greyhound |
| Meeting, all races | `https://www.racenet.com.au/form-guide/horse-racing/{venue-slug}-{YYYYMMDD}/all-races/overview` | Racenet-API `a[href*="/all-races/overview"]`; lifeboat |
| Race | `https://www.racenet.com.au/form-guide/horse-racing/{venue-slug}-{YYYYMMDD}/{race-name-slug}-race-{n}/overview` (e.g. `caulfield-heath-20260304/briga-fliedner-2026-lady-of-racing-finalist-race-1/overview`, `pakenham-20240201/evergreen-turf-hcp-64-race-5/overview`); the short form `/{venue}-{YYYYMMDD}/race-{n}/overview` is accepted (Kelvin `extract_race` uses `eventSlug=race-{n}`) | Kelvin test_racenet.py, visuatec, lifeboat |
| Other race tabs | the overview page's Nuxt store has `OddsComparisonTable`, `FormGuide.selectedFormOptions:["field_comments"]`, `RealtimeInsights`, `SelectionResults`; betting link `https://www.racenet.com.au/odds-comparison/horse-racing` (real `fetch` data). Tab paths such as `/speed-map`, `/odds-comparison`, `/sectionals` are **not evidenced** (low) | real capture |
| Print form (full form for one race, server-rendered) | `https://www.racenet.com.au/form-guide/horse-racing/print?meetingSlug={venue-slug}-{YYYYMMDD}&eventSlug={race-slug}&printSlug=print-form` | Kelvin ×4 |
| Results, meeting | `https://www.racenet.com.au/results/horse-racing/{venue-slug}-{YYYYMMDD}/all-races` | Kelvin scratch scripts |
| Results, race | `https://www.racenet.com.au/results/horse-racing/{meeting.slug}/{event.slug}` (slugs straight from puntapi) | datawookie |
| Results index | `https://www.racenet.com.au/results/horse-racing` (tabs `a[data-analytics="Results : Tab Group : Today"]`) | Racenet-API, RPPandey02 |
| Profiles | `https://www.racenet.com.au/profiles/horse/{slug}` (e.g. `impose-toi-fr`), `/profiles/jockey/{slug}`, `/profiles/trainer/{slug}`; older `/horse/{slug}` | lifeboat, Kelvin, search-result URLs |
| Tips | `https://www.racenet.com.au/horse-racing-tips`, `/horse-racing-tips/{venue-slug}`; `/premium-racing-tips` (paywall) | Racenet-API, hkjc-predictor, real `fetch` nav |
| Sitemaps | `https://www.racenet.com.au/sitemap-sts-horse-1.xml` (horse profiles; expect `sitemap-sts-*` siblings) | Files-Indexer |
| Meeting slug rule | lowercase venue, drop non-alphanumerics, spaces→`-`, append `-YYYYMMDD` (Kelvin `slug()`), e.g. `rosehill-gardens-20260801`, `moonee-valley-…`, `newcastle-uk-20251129` for UK Newcastle | Kelvin, search URLs |

---

## 8. Racenet website — what is in the HTML

### 8.1 Rendering
Fully **server-side rendered** (`<div data-server-rendered="true" id="__nuxt">`), so runner rows exist in the raw HTML (lifeboat parses them with regex only). The same HTML embeds `<script>window.__NUXT__=(function(a,b,c,…){return {layout,data,fetch,error,state,serverRendered,routePath,config,apollo}}(…positional args…));</script>` — a **minified IIFE, not JSON** (real capture: 39,820 chars on the homepage). Decode by evaluating it in a sandbox (`node:vm` — done for the real fixture) or by loading the saved HTML in headless Playwright and reading `window.__NUXT__` (Kelvin's approach). `apollo.defaultClient` is an **Apollo Client 2 normalized cache**: keys `Type:id` (`Meeting:238907`, `Event:1788421`, `Selection:9931201`, `Competitor:…`, `Jockey:…`, `Trainer:…`, `Bookmaker:2`, `ExoticResult:1`, `SelectionResult:…`), generated keys `$Type:id.field` (`$Event:1788421.weather`, `$Event:1788421.trackCondition`, `$Selection:9931201.result`, `$Selection:….result.competitorPositionSummary.0`), references `{"type":"id","generated":false,"id":"Bookmaker:2","typename":"Bookmaker"}`, and `ROOT_QUERY` with keys like `bookmakers({"removed":false})`. Kelvin also looked at `apollo.horseClient` as a fallback cache name (low). Nuxt `fetch` holds component data keyed `<Component>:<n>` (real: `"0"`, `"data-v-2410c970:0"`; print page: a key starting `FormGuidePrint`).

### 8.2 Apollo cache fields (from the extractors that read them; high unless noted)

**`Meeting:<id>`** — `id, name, slug, railPosition` ("True Entire Course"…), `meetingDateUtc, meetingDateLocal, trackComments, events[]` (refs).
**`Event:<id>`** — `id, eventNumber, name, slug, startTime (ISO Z), distance (int), distanceUnit ("metres"), eventClass, racePrizeMoney, trackType, isResulted, starters, pace, winningTime, selections[] (refs), weather (ref → $Event:<id>.weather), trackCondition (ref → $Event:<id>.trackCondition)`. Older/alt names seen as fallbacks: `class`, `prizeMoney`.
**`$Event:<id>.weather`** — `condition` ("fine", "partly cloudy"…), `temperature, feelsLike, wind, humidity, conditionIcon, trackConditionRating, trackConditionOverall`.
**`$Event:<id>.trackCondition`** — `overall` ("Good"), `rating` (4), `surface` ("Turf"). Track condition is per-event (it can be upgraded mid-meeting); the first event's values are used as the meeting value.
**`Selection:<id>`** — `id, competitorNumber, barrierNumber, status, statusAbv` (`"S"` scratched, `"LR"` late reserve), `weight, jockeyWeightClaim` (negative kg), `ratingOfficial, startingPrice` (CLOSING price = SP; -1/≤1.0 = none), `comments`, `competitor/jockey/trainer` (refs), `result` and/or `selectionResult` (ref → `$Selection:<id>.result`), `flucOdds[]{value}`, `stats{…}` (print page), `forms[]` (print page). Selection keys carry **no event prefix** — always walk `Event.selections` to map runner→race.
**`$Selection:<id>.result`** (`SelectionResult`) — `finishPosition` (**-1 = scratched/no result**), `margin, finishTime, competitorPositionSummary[]` (refs) → `{distanceText ("Settled","800m","400m"), positionText ("4th"), distance (0/800/400), position (int), time}`. Profile pages carry `SelectionResult:<id>` objects with `meetingDate, meetingName, finishPosition, eventStarters, competitorId, isTrial, competitorFormBenchmark`.
**`Competitor:<id>`** — `id, name, slug, age, sexShort, colour, sire, dam, sireOfDam, owner` (strings).
**`Jockey:<id>` / `Trainer:<id>`** — `id, name, slug, stats` (ref) → **`Stats`**: `lastYear` (string like "118-104-97/812"), `totalRuns, lastYearRuns, lastTenRuns, lastTenFigure, winPercentage, placePercentage, currentSeasonRuns, roi, lastYearRoi, seasonRoi`, optionally `lastYearPlaces, lastTenPlaces, currentSeasonPlaces, totalPlaces`; profile pages are matched on `__typename == "Stats"` and `winPercentage`. Page-level `Stats.avgL600` is computed live and **leaks post-race runs** (Kelvin) — do not use it for pre-race features.
**Runner `stats{}`** (print page selections) — `career{starts,wins,seconds,thirds}` (or a string), `lastTenFigure, winPercentage, placePercentage, totalPrizeMoney, roi`, and per-category `{starts,wins,seconds,thirds}` objects: `track, distance, trackDistance, firm, good, soft, heavy, synthetic, class, firstUp, secondUp, thirdUp, currentSeason, lastYear, fav`.
**Runner `forms[]`** (print page past runs) — `meetingDate, meetingName, eventNumber, eventDistance, eventStarters, finishPosition, margin, trackConditionRating, racePrizeMoney, weightCarried, barrier, handicapRating, jockey{name}, openPrice, startingWinPriceDecimal, winnerTime, isTrial, competitorPositionSummary[]{distanceText,positionText,distance,position,time}, winnerName, winnerWeightCarried, secondName, secondWeightCarried, secondMarginDecimal, thirdName, thirdWeightCarried, thirdMarginDecimal, videoComment, videoNote, stewardsReport, sectionalTime{l600{time},finish{time}}, competitorFormBenchmark{runnerTimeDifference, runnerTimeDifferenceL800, runnerTimeDifferenceL600, runnerTimeDifferenceL400, runnerTempoLabel, leaderTempoLabel}, rtRating` (Punting Form "RT" metrics; some only in the HTML `div.racing-full-form-details` / `div.horse-racing-previous-runs-row` text as "Last600: … Runner Time: … Race Time: … Early Runner Pace: … Early Race Pace: … RT Rating: …").
**`ExoticResult:<id>`** — `tote, exoticMarket` ("Quinella", "Trifecta", "First Four"…), `amount, results` ("1,2,3"); not linked to the event in the cache — match by page context.
**`Bookmaker:<id>`** (REAL) — `id, name (slug), displayName, fontColor, primaryColor, secondaryColor, secondaryFontColor, logoCircle, logoRectangle (puntcdn.com), bettingPromotionOrder`.

Fixtures: `racenet_form-guide_print_window-NUXT-decoded_flemington_r7_2026-10-24.json`, `racenet_results_window-NUXT-decoded_flemington_r1_2026-10-24.json`, REAL `racenet_homepage_REAL_window-NUXT-decoded_2026-08-03.json` (+ raw HTML).

### 8.3 HTML selectors (no-JS fallback)

| Target | Selector / regex | Conf. | Evidence |
|---|---|---|---|
| Meeting links on `/form-guide/horse-racing` | `a[data-analytics="Upcoming Race Table : Australia : Meeting Link"]`, `a[data-analytics="Upcoming Race Table : International : Meeting Link"]`; `href` ends `/overview`; `img[alt]` = country | high | visuatec |
| Any race-page link on the index | `a[href*="/all-races/overview"]`; race paths match `/form-guide/horse-racing/[a-z0-9\-]+-\d{8}/[a-z0-9\-]*race-\d+[a-z0-9\-/]*` | high | Racenet-API, lifeboat |
| Race metadata | ld+json: `"description":"Track Condition:\s*([^,"]+),\s*Race number:\s*(\d+)[^"]*?Race Distance:\s*(\d+)m"`, `"startDate":"([^"]+)"`; class: `\d{3,4}m[^<]{0,40}Class:\s*([A-Z][A-Za-z0-9 ,&+\-]{1,50})` on tag-stripped text | high | lifeboat |
| Runner rows | split on `(?=<div[^>]*class="event-selection-row-container)`; scratched if `selection-scratched` in first 400 chars; number+name `horseracing-selection-details-name(?:[^"]*)">\s*(\d+)\.\s*([^<]+?)\s*<`; barrier `<span>\((\d+)\)</span>`; weight `\((\d{2}(?:\.\d)?)kg\)`; jockey/trainer `/profiles/(jockey|trainer)/([a-z0-9\-]+)` (slug = full name) | high | lifeboat |
| Runner links (older) | container `div.form-guide-page__overview.form-guide__content`, `a[href*="/profiles/horse"]` text "N. Name (…)" | medium | visuatec |
| Results | `h4.selection-result__info-competitor-name` (finisher names, in order), `h1.meeting-selector__meeting-name` | high | datawookie, RPPandey02 |
| Greyhound/horse race list items | `a.upcoming-race-table__event-link[data-analytics="Race Event Link : Greyhounds : <Venue> R<n>"]`, time `abbr.relative-time__inner span` | medium | betfair-greyhound |
| Full-form blocks (print page) | `div.racing-full-form-details`, `div.horse-racing-previous-runs-row` | medium | claw_racenet_scraper |
| Modal junk to dismiss | `.campaign-modal__overlay`, `.campaign-modal__close`, `.np-web-widget-campaign-modal .close` | high | Racenet-API |

Fixtures: `racenet_form-guide_race_page_flemington_r7_2026-10-24.html`, `racenet_results_page_flemington_r1_2026-10-24.html`, `racenet_form-guide_index_links_2026-10-24.html`.

### 8.4 Bot protection and what actually works (high — multiple production logs)
* Front door is **Kasada** (lifeboat: "Racenet's Kasada challenge blocks datacenter IPs"; a challenged response is **HTTP 202** with no card — transient, retry later) over **CloudFront** (403 "The request could not be satisfied"). Block markers used by `racenet_transport.py`: status ∈ {401,403,429,503} or body containing `403 error`, `the request could not be satisfied`, `request blocked`, `generated by cloudfront`, `access denied`, `just a moment`, `cf-chl`, `captcha`.
* Observed outcomes from a residential Mac (2026-08-01 log): `curl_cffi impersonate=chrome136` → 200 but **HTML without `__NUXT__`** (a challenge shell); `chrome131` → 403; live Playwright Chrome → **202**. Earlier (2026-03..05) `curl_cffi impersonate="chrome120"` from a home IP fetched real pages reliably; Kelvin's transport tried the ladder `chrome136 → chrome131 → chrome124 → chrome120`, then a real Chrome via Playwright (`channel="chrome"`, `--disable-blink-features=AutomationControlled`, `locale en-AU`, `timezone Australia/Sydney`, optional real user profile `RACENET_USE_LOCAL_CHROME=1`, optional proxy), waiting 4 s after `domcontentloaded`. Headers used: `Accept: text/html,…`, `Accept-Language: en-AU,en;q=0.9`, `Cache-Control: no-cache`, Chrome 136 UA.
* Production users (lifeboat) gave up on direct fetches and route through a residential proxy (`https://api.scrape.do/?token=…&url=…&super=true`), 1 s between pages, index retried up to 10× with 60 s backoff, race pages 3× with 15 s backoff; a thin card (<70 % runner match) is treated as failure.
* Kelvin's pacing for direct access: random 7–16 s (results) / 20–35 s (race overview) gaps, ≤20 requests per run, abort on first block signal or 3 consecutive misses; Punters: 12–20 s. Kelvin **removed Racenet as a source on 2026-08-02** ("Racenet 三條 transport 全封" — all three transports blocked) and moved to Sportsbet.
* Therefore for RaceLens: use **puntapi.com** (no bot wall observed by any client) as the Racenet-data path; use the Racenet HTML only as a cross-check with low frequency, from the user's residential IP, with a real Chrome profile when challenged; never retry a 202/403 in a tight loop.

---

## 9. Punters website — URL grammar and HTML

### 9.1 URLs (high unless noted)
| Page | Pattern | Era / evidence |
|---|---|---|
| Form guide index | `https://www.punters.com.au/form-guide/` (meeting cards `a.event-card[href*="/form-guide/"]`, `a[href*="/form-guide/horses/"]`) | 2026 racing-value-finder |
| Meeting (new) | `https://www.punters.com.au/form-guide/horses/{venue-slug}-{YYYYMMDD}/` (e.g. `canterbury-20260116`, `albury-20250718`) | 2025-26 |
| Race (new) | `https://www.punters.com.au/form-guide/horses/{venue-slug}-{YYYYMMDD}/{race-name-slug}-race-{n}/` + tabs `#Overview`, `#OddsComparison` (jacklot1122 also saw `/race-1/` work as a short form, and a fallback `/{venue}-race-{n}-race-{n}/`, medium) | 2025-26 |
| Meeting / race (legacy, still resolvable in 2023) | `https://www.punters.com.au/form-guide/{Venue}_{meetingId}/` and `/form-guide/{Venue}_{meetingId}/{Race-Name-Slug}_{eventId}/` (REAL: `coffs-harbour_128612/sawtell-cup-july-22nd-maiden-plate_739023/`, `newcastle_236489/`) | 2016–2023; `formGuideUrl` in the real odds JSON |
| Odds comparison hub | `https://www.punters.com.au/odds-comparison/horse-racing/` | reddit 2025 |
| Horse / jockey / trainer profile | `https://www.punters.com.au/horses/{slug}_{competitorId}/` (REAL `feline-fantastic_627808`, `impose-toi_933302`), `/jockeys/{slug}_{id}/` (REAL `matthew-paget_1006`), `/trainers/{slug}_{id}/` | REAL odds JSON, punters_client |
| Results | `https://www.punters.com.au/racing-results/` (today), `/racing-results/{YYYY-MM-DD}/`, `/racing-results/{state-slug}/{Venue}/{YYYY-MM-DD}/`; track page `…/{Venue}_{id}/results` | punters_client, WKG-Scarp, pyHcp |
| Full form PDF | `https://puntcdn.com/form-guides/*.pdf` via `button[data-analytics="Form Guide : Form : Download Form"]` / `a[href*="puntcdn.com/form-guides/"][href$=".pdf"]` | 2026 |
| Odds widget (HTML) | `https://www.punters.com.au/widgets/OddsComparison.php?type=OddsComparison&sport={sportId}&group=-1&limit=100&searchType=&searchVal1=&searchVal2=` | 2018 (low that it survives) |
| Affiliate click-outs | `/link/{bookie}/?eid={eventId}` | REAL odds JSON |
| News | `https://www.punters.com.au/news/` (feed URL not evidenced) | low |
| Forum (rumour source) | `https://www.punters.com.au/forum/…` (e.g. `/forum/afl/`) | medium (JHull1234/SGM-Builder lists it) |

### 9.2 Rendering and selectors
Punters race pages are **server-rendered HTML** (Goutte/BeautifulSoup parse them without JS; the odds-comparison table also renders server-side in 2026 per racingwebsite.py's `wait_for_selector('table.compare-odds__table')` after `domcontentloaded`). No `__NEXT_DATA__`/`__NUXT__` blob was reported by any Punters scraper; structured data is in **ld+json** (`SportsEvent` with `performer[]` names formatted `"<Horse> - J: <Jockey> - T: <Trainer>"`).

| Target | Selector | Era / conf. |
|---|---|---|
| Race header | `.form-guide-event-header__main`, `.form-guide-event-header__race-title`, `.form-guide-event-header__detail-inner` (nth = time / condition / distance …), `.form-guide-event-header__detail-time`, `.event-number__pill--active` (race no.), `.meetings-selector__label` (venue), `.form-guide-meeting-upcoming-meetings__meeting-events a` (race links) | 2025, medium-high |
| Runner table | `table.form-guide-overview__table tbody tr`; `td.form-guide-overview__competitor-number`; row class contains `scratched`; `a.form-guide-overview__horse-link` (href `/horses/{slug}_{id}/`); `div.has-blinkers`; `a.form-guide-overview__jockey-link` (child `span` "(a2)" = apprentice claim); `a.form-guide-overview__trainer-link`; `td.form-guide-overview__competitor-weight`; `td.form-guide-overview__competitor-barrier`; `a.form-overview__full-form-link` | 2016 (two clients) + horse-link/full-form-link confirmed 2022-23; high for class names, medium that the table layout is unchanged in 2026 |
| Runner block (2025) | `.selection-runner__info` (text "N. Name … 57.5kg"; child `a` → horse page) | medium |
| Odds comparison | `table.compare-odds__table`; `thead th img[alt]` = bookmaker names (column order); `tbody tr.compare-odds-selection`; `.compare-odds-selection__runner .selection-runner__competitor` = `"(\d+)\.\s*(.+?)\s*\((\d+)\)"` (number, name, barrier); `.selection-runner__jockey a`; `.selection-runner__trainer a`; `.compare-odds-selection__cell` (skip first) with `a.compare-odds-selection__cell--link` "$4.60"; `.compare-odds-selection__cell--best-pill` | 2026, high |
| Visible bookmaker columns (2026) | Punters(avg), TAB, Sportsbet, Ladbrokes, Neds, PointsBet, Unibet, BlueBet, Betr, bet365, Betfair | jacklot1122/race `BOOKMAKER_ORDER`, medium |
| Results tables | `table.results-table`; header `thead tr th`: `b.capitalize` race no., `span.event-name-title strong` (group), `span.distance abbr.conversion[data-value]` / `abbr[data-type=distance]`, `span.results-table__capital` (prize, condition), `div.details-line` / `div.results-table__details` with `abbr.timestamp[data-utime]` and `span.capitalize a[href]`; rows `tr.isPlaced`, `tr.isFirst.results-table__isPlaced`, `td:nth(0) span` rank, `td:nth(1) span` horse (+`a.form-guide-overview__horse-link`), `td:nth(2)` top tote; meet links `a.label-link`; track page `li.latest-result` | 2016–2023, medium |
| Race detail (legacy) | `div.event-details span.entry-conditions-text span`, `div.event-details-bottom div span` label/value pairs (circumference, straight via `abbr.conversion[data-value]`, rail as text) | 2016, low-medium |
| Horse/jockey/trainer profile | `h1` (name; `h1 span` = country), `div.moduleItem table tr th/td` (`profile` "N year old <colour> <sex>", `pedigree` "<Sire> x <Dam>", `country`, `foaled` dd/mm/yyyy); past runs `ul.timeline li.timeline-disc`: `b span.simlight` track, `span.date` dd-Mon-yy, `span.dist` distance, `span.badge` condition, text `\$([\d,.]+) \(of \$([\d,.]+)`, `Barrier (\d+)`, `Winning Time: ([\d:.]+)`, `SP: \$([\d.]+)`, "In-running:", `span.formSummaryPosition` (finish; "Abn" abandoned), `span.timeline-right.placed` (placings: `a[href*=horses]`, `a[href*=jockeys]`, `abbr[data-type=weight][data-value]`, `([\d.]+)L`), `span.starters`; `ul.timeline` containing "TRIAL" = barrier trial; 2025 variant `.timeline-box .placed .dist` | 2016 + 2022-23 + 2025, medium-high |
| Odds widget | `.js-oc-tables-inner .oc-table.ocEvent[data-event]`, `.oc-table__timestamp.timestamp[data-utime]`, `.oc-table__event-name-full`, `.oc-table__event-description`, `.oc-table-head .agency-logo img[title]`, `.oc-table-body .competitor-info__horse-name`, `.oc-table-cont--right .oc-table-body .oc-table-tr.gutter .ppodds a` | 2018, low |

Fixtures: `punters_form-guide_race_page_flemington_r7_2026-10-24.html`, `punters_racing-results_page_2026-10-24.html`, `punters_horse_profile_page_riverina-dawn.html`, `punters_widgets_OddsComparison_php.html`.

### 9.3 Bot protection (high)
Punters sits behind **CloudFront** ("CloudFront protected, may need headers"; scripted POSTs to `api.punters.com.au` → 403; `requests.get` with a plain Chrome UA in 2016–2023 worked, several 2025 hobbyists needed a proxy such as ScrapeOps/ScrapingBee with `country_code=au, stealth_proxy=true`). What worked in 2026 without proxies: **Playwright headless Firefox** (UA `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0`, viewport 1920×1080, `domcontentloaded`, 2–3 s settle) with a Chromium `--disable-blink-features=AutomationControlled` fallback; challenge heuristic = body contains "checking your browser" or is <5000 chars → sleep 5 s and re-read. Punters' **login** page rejects automation-controlled Chrome. Pacing used: 0.5–3 s between pages; the 2026 Punters-API author uses 12–20 s. ToS forbids scraping; keep volumes tiny (one race page + one odds page per race, cached).

---

## 10. Tips, ratings, speed maps, news, rumours

| Item | Where | Conf. |
|---|---|---|
| Punters speed map / model | `Selection.prediction{speedMeasureRatingName, speedMeasure, normSpeedMeasure, barrierSpeedRating, closingSpeedRating, modelOutput, modelRank, winningChance, width, length, finishSpeed}` via `api.punters.com.au/racing` (login) — probably also present in puntapi `eventById` (probe) | high (field names) |
| Official ratings | `Selection.ratingOfficial`; Racenet `Selection.ratingOfficial`; past-run `handicapRating` | high |
| Punting Form "RT" metrics on Racenet | `forms[].competitorFormBenchmark{runnerTimeDifference*, runnerTempoLabel, leaderTempoLabel}`, `rtRating`, `sectionalTime.l600.time`; HTML `div.horse-racing-previous-runs-row` text | medium-high |
| Racenet free tips | `/horse-racing-tips`, `/horse-racing-tips/{venue}` (SSR; class names unknown — hkjc-predictor just grepped `class~=tip|pick|select|runner`); Nuxt store `FreeTips{events,selectedDate}`; `RealtimeInsights` filters (day/state/trackCondition/bettingOption) | low-medium |
| "Punters Edge" / premium | subscription content (`Subscriptions.isSubscriber`, `PRO_TIPS_BREACH` feature flag with `BLUR` variation on Racenet) — not accessible anonymously | medium |
| Racenet "Standard" price | bookmaker slug `racenetstandard` in `/odds/au/event` | high |
| Video comments, stewards, notes | `forms[].videoComment / videoNote / stewardsReport` (both sites) | high |
| News | Racenet `/news/{slug}` articles (content API `https://api.racenet.com.au/content`, hosts unknown GraphQL); Punters `/news/`. **No RSS URL was evidenced**; probe `https://www.racenet.com.au/rss`, `/news/rss`, `/feed`, `https://www.punters.com.au/news/feed/`, `/rss.xml`, and the `<link rel="alternate" type="application/rss+xml">` tag on the news index first | low |
| Rumours | Punters forum `/forum/…` threads; Racenet article comments are Disqus (`NUXT_ENV_DISQUS_SHORTNAME: racenet`) → `https://disqus.com/embed/comments/?base=default&f=racenet&t_u=<article url>` (low) | low |

---

## 11. How to get each RaceLens need (recommended order; all keyed by date → meeting slug → eventId)

| Need | Primary | Fallback 1 | Fallback 2 |
|---|---|---|---|
| Meetings for a date | puntapi `meetingsIndexByStartEndTime` (UTC window = AU date 13:00Z→13:00Z; filter `group == "Australia"`) | puntapi `meetingsByStartEndDateAndCountryName(country:"Australia")` | Racenet index HTML `a[data-analytics="Upcoming Race Table : Australia : Meeting Link"]`; odds.com.au `Racing/getUpcomingRaces/?sport=1&date=` |
| Race card (number, name, barrier, jockey, trainer, weight, scratched) | puntapi `eventById` (verify which fields are present on first call; `status == "SCRATCHED"` / `statusAbv == "S"|"LR"`) | Racenet race page: ld+json + `__NUXT__.apollo` `Selection`/`Competitor`/`Jockey`/`Trainer` or the regex row parser | Punters race page `table.form-guide-overview__table` / ld+json `performer`; Punters odds JSON `selections[]` (has number, barrier, jockey, weight) |
| Odds (multi-bookmaker, flucs) | puntapi `/odds/au/event/{id}` | Punters `getOddsComparisonCacheable` (APIKey sniff) | Punters `table.compare-odds__table`; Racenet `Selection.flucOdds` |
| Form (past starts, SP, margins, sectionals, comments) | puntapi `fullFormsBySelectionIds` / `getSectionalsBySelectionIds` | Racenet print page `fetch.FormGuidePrint*.selections[].forms[]` | Punters `api.punters.com.au` (login) `getSectionalsBySelectionIds`; Punters horse profile `ul.timeline` |
| Career / track / distance / condition stats, sire/dam | puntapi `statsByEventId` (shape unknown) + `eventById` `competitor{sire,dam,sireOfDam,age,sexShort,colour}` | Racenet print page `Selection.stats{…}` + `Competitor` | Punters profile `div.moduleItem` pedigree |
| Jockey / trainer stats | Racenet `Jockey/Trainer.stats` (`lastYear`, `winPercentage`…) in print page; profile pages `/profiles/jockey/{slug}` (`Stats` object) | puntapi `statsByEventId` | — |
| Results (positions, margins, SP, in-running, exotics) | Racenet `/results/horse-racing/{slug}/all-races` `__NUXT__` (`$Selection.result`, `Selection.startingPrice`, `ExoticResult`) | puntapi `eventById` after the race (`isResulted`, `selectionResult`, `officialMargin`, `winningTime`) | Punters `/racing-results/` tables; odds.com.au `getUpcomingRaces` `results:"2,5,11"` |
| Track condition / rail / weather | Racenet `__NUXT__` `$Event.trackCondition{overall,rating,surface}`, `$Event.weather{…}`, `Meeting.railPosition`, `Meeting.trackComments` | puntapi `eventById` (probe for `weather`/`trackCondition`/`meeting.railPosition`) | Racenet ld+json "Track Condition: Good 4"; Punters header `.form-guide-event-header__detail-inner`; odds.com.au `getEventHeaderCacheable` `distanceTrackCondition`, `weather` |

Cross-verification rules that follow from the evidence: (1) the puntapi **eventId/selectionId/competitorId** tie Racenet, Punters and odds.com.au together exactly — a mismatch there is a bug, not a data conflict; (2) scratchings appear as `status: "SCRATCHED"` (API), `statusAbv: "S"/"LR"`, `finishPosition: -1`, row class `selection-scratched` (Racenet HTML) or `scratched` (Punters HTML), `SCR` cells in odds tables — treat any one as scratched but require two for "confirmed"; (3) track condition on Racenet is **per event** and can change during the meeting — always re-read before each race; (4) `startingPrice` / `startingWinPriceDecimal` is the **closing** price, not the price available the day before.

---

## 12. Rate limits, blocking and adapter behaviour (summary)

| Surface | Observed limits | Adapter policy |
|---|---|---|
| `puntapi.com/graphql-horse-racing`, `/odds/au/event` | none observed; stale persisted hash → `errors`; clients retry 5× / 2 s | ≤1 req/s, cache per (op, variables) for the session, backoff 20 s×n on 429/403, auto-refresh hashes via Playwright when `errors` appear for all ops |
| `api.punters.com.au/racing` | CloudFront 403 for scripts; fine in-page with login; one author was refused once at 8–15 s pacing | optional, user-enabled, in-page fetch through user's own Chrome profile; 12–20 s gaps; stop on first refusal |
| `api.racenet.com.au/*` | hard 403 | do not call |
| `www.racenet.com.au` pages | Kasada 202 challenge; CloudFront 403; datacenter IPs blocked; residential IP + real Chrome needed in 2026-08 | low-frequency cross-check only (≤1 page / 10–30 s), residential IP, real Chrome profile; treat 202 as "try again in ≥15 min"; never from a cloud box |
| `www.punters.com.au` pages / `/api/web/public/*` | CloudFront; "checking your browser" interstitial; headless Firefox OK in 2026-01 | ≤1 page / 3–5 s, Firefox UA, re-read after 5 s on challenge; sniff `APIKey` once per session |

---

## 13. Fixtures delivered (`research/fixtures/puntersracenet/`, see its README for the provenance table)

REAL: `punters_odds_getOddsComparisonCacheable_REAL_coffs-harbour_r1_2018-06-14.json`, `…_REAL_encoded-wrapper_coffs-harbour_r1.json`, `oddscomau_getUpcomingRaces_REAL_2018-06-10.json`, `racenet_homepage_REAL_nuxt-ssr_2026-08-03.html`, `racenet_homepage_REAL_window-NUXT-decoded_2026-08-03.json`.
CONSTRUCTED (Flemington 2026-10-24): `puntapi_graphql_meetingsIndexByStartEndTime_2026-10-24.json`, `puntapi_graphql_eventById_flemington_r7_2026-10-24.json`, `puntapi_odds_event_flemington_r7_2026-10-24.json`, `puntapi_graphql_error_PersistedQueryNotFound.json`, `punters_api_racing_meetingsIndexByStartEndTime_2026-10-24.json`, `punters_api_racing_getSectionalsBySelectionIds_flemington_r7.json`, `punters_odds_getOddsComparisonCacheable_flemington_r7_2026-10-24.json`, `racenet_form-guide_print_window-NUXT-decoded_flemington_r7_2026-10-24.json`, `racenet_results_window-NUXT-decoded_flemington_r1_2026-10-24.json`, `racenet_form-guide_race_page_flemington_r7_2026-10-24.html`, `racenet_results_page_flemington_r1_2026-10-24.html`, `racenet_form-guide_index_links_2026-10-24.html`, `punters_form-guide_race_page_flemington_r7_2026-10-24.html`, `punters_racing-results_page_2026-10-24.html`, `punters_horse_profile_page_riverina-dawn.html`, `punters_widgets_OddsComparison_php.html`.

---

## 14. Open questions — probes to run on the user's machine before trusting the adapter

1. `GET https://puntapi.com/graphql-horse-racing?query={__typename}` with `authorization: Bearer none` — does the gateway accept raw documents (then no hashes needed) and does `__schema` introspection work?
2. Are the 2025-26 persisted hashes in §3.2 still valid today? If `errors`, run the Playwright hash refresher.
3. Exact field list returned by `eventById`, `meetingBySlug`, `statsByEventId`, `fullFormsBySelectionIds` — dump one response of each and reconcile with the constructed fixtures (update `_fixtureNote`).
4. `/odds/au/event/{id}`: is `bookmakerId` a slug or numeric; what does the `priceFluctuations` array look like; is `type=best` a separate row?
5. Does `https://www.punters.com.au/api/web/public/Racing/getUpcomingRaces/?sport=1&date=YYYY-MM-DD` answer on the punters host (it does on odds.com.au), and does it still need `APIKey`? Is the body plain JSON or `{"r": …}`?
6. Racenet race page from the user's residential IP with a normal browser UA: do we get 200 + `__NUXT__`, 202 (Kasada) or 403? Decide whether Racenet HTML is worth keeping as a cross-check.
7. RSS: check `<link rel="alternate" type="application/rss+xml">` on `https://www.racenet.com.au/news` and `https://www.punters.com.au/news/`.
8. Confirm the current Punters race-page selectors (`table.form-guide-overview__table` vs a newer layout) by saving one page; the odds table selectors are from 2026-01 and are the most trustworthy.
