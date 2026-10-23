# Entain Australia racing APIs — Ladbrokes.com.au / Neds.com.au (`entain`)

Research report for the RaceLens `entain` source adapter. Written 2026-10-23 from community code,
official affiliate documentation and raw JSON captures committed to public repositories. **This
container cannot reach any Entain host, so nothing below was fetched live by the author.** Every
fact carries a confidence tag:

- **high** = reproduced from the official docs, or from a raw response capture committed to a public repo
- **medium** = inferred from working client code that reads the field/endpoint; envelope not seen verbatim
- **low** = from a response hint, a single mention, or memory; verify on the user's machine before relying on it

Entain Australia & New Zealand runs one back-end for Ladbrokes.com.au, Neds.com.au, Bookmaker.com.au,
BetStar/Neds Pro and (since 2025) TAB NZ. Every UUID (race, meeting, entrant, market, product type) is
identical across `api.ladbrokes.com.au`, `api.neds.com.au` and the affiliate feed. **For RaceLens
cross-source verification, Ladbrokes and Neds must be counted as ONE source**, not two: agreement
between them proves nothing. They are, however, three *transports* onto the same data, which is useful
for availability fallback (if one host is down or rate-limited, the same race id works on the other).

## 1. Purpose and what this source gives RaceLens

| Need | Best Entain surface | Confidence |
|---|---|---|
| Meetings for a date (AU thoroughbred) | Affiliates `GET /affiliates/v1/racing/meetings?date_from=D&date_to=D&category=T&country=AUS` | high |
| Race card: number, name, barrier, jockey, trainer, weight, scratched flag, fixed odds | Affiliates `GET /affiliates/v1/racing/events/{race_id}` | high |
| Odds fluctuations (open/high/low/9am/last six, timestamped) | same event route (`runners[].flucs`, `flucs_with_timestamp`) | high |
| Form: last 20 starts string, age/sex/colour, sire/dam, career prize money, gear, jockey last-50 + jockey-for-trainer stats, speed-map label, form indicators, R&S race comment and tips, trackside picks | same event route with `include_form=true` etc. | high (fields seen live) |
| Past-start rows, track/dist/condition splits | **Not** in the affiliate JSON for AU (only aggregate `jockey_past_performances`); GraphQL `RacingRaceCardScreenWeb.finalField.runnerRows[].form{fields,tabs}` carries R&S form tables; full form is an HTML page `ladbrokesform.com.au/form/{race_id}` | medium / low |
| Results (positions + margins) | event route `results[]` once `race.status` is `Interim`/`Final` | high |
| Tote dividends, exotics | event route `dividends[]` (official docs); GraphQL `RacingRace.results` | medium |
| Track condition, weather, rail position, track direction, home straight | event route `race.track_condition`, `race.weather`, `race.rail_position`, `race.track_direction`, `race.track_home_straight`; `nextraces` `race_form.additional_data.revealed_race_info` | high |
| Next-to-go across all codes | `GET /rest/v1/racing/?method=nextraces&count=N` | high |
| Whole-day index with UUID-keyed tables (meetings/races/venues/compounds) | `GET /v2/racing/meeting?date=D&timezone=Australia%2FMelbourne` | medium |
| Full priced card with every product (84 product rows per runner) | `GET /rest/v1/racing/?method=racecard&id={race_id}` | medium |

Legal/ethical note: the affiliate API is **public and documented** by Entain ("for personal use only
and not to be republished without written permission from Entain Australia and New Zealand" — TAB NZ
sibling docs, high). It asks only for identifying `From`/`X-Partner` headers. The `api.*.com.au` web
gateways are undocumented front-end APIs; be polite, cache, and prefer the affiliate feed.

## 2. Evidence base (sources)

| # | Source | What it contributed | Confidence |
|---|---|---|---|
| S1 | https://github.com/nedscode/affiliate-feeds (gh-pages branch, `index.html`; rendered at https://nedscode.github.io/affiliate-feeds/) | **Official Ladbrokes Affiliate API docs**: base URL, identification headers, `enc` formats, date keywords, `/meetings`, `/meetings/{id}`, `/events/{id}`, full schemas (ResponseHeader, Meeting, MeetingRace, Race, RaceResult, RaceDividend, RacePosition, RaceEntrant, RunnerWeight, RaceRunner, Odds), error codes, deep-link dividend codes | high |
| S2 | https://github.com/Josh9456/Racing-Form- (`ladbrokes_racing_scraper.py`, README, `racing_data/2026-10-23/**`) | Daily GitHub-Actions scraper of the affiliate API; **257 raw race captures from 2026-10-23** including Thoroughbred meetings (Ballarat, Cranbourne, Canberra, Gawler, Launceston, Mackay, Scone, Sunshine Coast). Two were copied verbatim into fixtures (Cranbourne R7 open; Ballarat R1 Interim with `results[]`). Shows the undocumented `include_*` query params and the `/events/{id}/form` and `/runners/{id}` probes | high (captures) / low (the extra routes) |
| S3 | https://raw.githubusercontent.com/Josh9456/Racing-Form-/HEAD/racing_data/2026-10-23/Cranbourne_Thoroughbred_AUS_VIC/Race_07_Ladbrokes%20Cox%20Plate%20%40%20Flemington%20(Bm70)%20Hcp.json | Raw event response, 13 runners, Open; every runner field name and type in section 4.3 was walked from this file | high |
| S4 | https://raw.githubusercontent.com/Josh9456/Racing-Form-/HEAD/racing_data/2026-10-23/Ballarat_Thoroughbred_AUS_VIC/Race_01_Epijoint%20F%26M%20Mdn%20Plate.json | Raw event response, status `Interim`, with `results[]`, `substitutions[]`, `derivatives[]` (Live Racing market) and a scratched runner | high |
| S5 | https://github.com/DanielTomaro13/sportsdata-mcp/blob/main/documentation/Entain.md | Unofficial reference for `api.ladbrokes.com.au` "verified against live traffic on 2026-05-25": required headers, go-micro error envelopes, racing category UUIDs, `/v2/racing/meeting`, `/v2/racing/next-races-category-group`, `/v2/racing/search`, `/rest/v1/racing/?method=future-markets`, `/gql/router` persisted-query mechanics and hash drift, `RacingRaceCardScreenWeb` sample, form-guide CDN proxy, Contentful CMS | high |
| S6 | https://raw.githubusercontent.com/DanielTomaro13/sportsdata-mcp/HEAD/src/sportsdata_mcp/specs/entain.yaml | Machine spec: default headers, `entain_racing_racecard` (`/rest/v1/racing/?method=racecard&id=`), response hints, `never_cache`, all 127 GraphQL operation names + variable signatures + bundle hashes | high |
| S7 | https://raw.githubusercontent.com/DanielTomaro13/sportsdata-mcp/HEAD/src/sportsdata_mcp/specs/entain.documents.json | Printed GraphQL documents for all 127 operations (used for `RacingRaceCardScreenWeb`, `RacingRace`, `RacingHomeMeetingsDesktopScreen`, `HomepageNextToJumpRaces`, `RacingEntrantInfo`, `RacingNextToGoFavourites` field names) | high (field names) |
| S8 | https://raw.githubusercontent.com/DanielTomaro13/sportsdata-agents/HEAD/src/sportsdata_agents/interfaces/racingboard/corporate.py | Production racing board (live 2026-08-31): Ladbrokes = 710 races/day, 0.08 s per racecard, anonymous; `/v2/racing/meeting` keys read (`meetings[].category_id/name/race_ids`, `races[].number/advertised_start/name`); racecard wrapped under `data`; `prices` keyed `<entrant_id>:<product_type_id>:`, ~84 products per runner; `entrants[].is_scratched/scratched_time/market_id`; decimal = num/den + 1 | high |
| S9 | https://raw.githubusercontent.com/DanielTomaro13/sportsdata-agents/HEAD/src/sportsdata_agents/operations/ingestion/normalizers.py | `price_fluctuations[entrant_id]` tail = live fixed-win; Fixed Win product `940b8704-e497-4a76-b390-00918ff7d282`, Fixed Place `7cf3eea6-5654-42be-9c2e-6de280e7bb34` (verified against a live card 2026-07-08); pseudo-runner names to drop | high |
| S10 | https://raw.githubusercontent.com/l0rdwalker/betshock_v2/HEAD/Arbie/engine/ladbrokes/sports/ladbrokes_horses.py | Browser header set; `/v2/racing/meeting?date&region=domestic&timezone`; `/rest/v1/racing/?method=racecard&id=`; reads `data.meetings[].advertised_date.seconds`, `data.entrants[].barrier/name/id`, `data.prices["<entrant>:<win_product>:"].odds.numerator/denominator`; GraphQL `RacingRaceScreen` `finalFieldMarket.nodes[].isScratched/isLateScratched` | medium |
| S11 | https://raw.githubusercontent.com/shaneHowearth/lb/HEAD/racingservice/raceservice/racing.go | `/rest/v1/racing/?method=nextraces-category-group&count=5&include_categories=[...]` URL; RaceSummary/RaceForm field list | medium |
| S12 | https://raw.githubusercontent.com/j-/next-to-go-react/HEAD/src/mocks/nextraces/payload-1768484374194.json | **Raw `method=nextraces` capture** (Jan 2026) — copied verbatim into fixtures | high |
| S13 | https://raw.githubusercontent.com/matt-shine/entain-technical-task/HEAD/src/types/racing.ts (+ emiller12/entain-coding-task `types.ts`, j-/next-to-go-react `api.ts`, allan-walker/next-to-go-races `neds.ts`, nathanvale/entain-next-to-go `handlers.ts`, 60+ other "Entain technical task" repos) | Zod/TS schemas of the `nextraces` response incl. `race_form.additional_data.revealed_race_info` (rail_position, track_surface, prizemonies...) and the three category UUIDs | high |
| S14 | https://raw.githubusercontent.com/zachgodsell93/lbw-mono/HEAD/apps/lbw-node-backend/src/services/ladbrokes-prices.ts (+ `ladbrokes-data-today.ts`) | Production cron against the affiliate feed: `meetings?date_from&date_to&format=json&country&category&limit=200`; reads `runner.flucs_with_timestamp.open.fluc`, `runner.favourite`, `runner.mover`, `results[].position`; polls at 9am/11am, T-2min and T-1min | high |
| S15 | https://raw.githubusercontent.com/tbh-brett/hk_racing_dashboard_26-27/HEAD/hkrd/ingest/ladbrokes.py | Affiliate feed on the `api.ladbrokes.com.au/affiliates/v1` host works from Singapore and a home PC (2026-09-23) with NO key; `race.tips[]` is an ORDERED list of entrant ids; "TBA" price is encoded as `0` | high |
| S16 | https://raw.githubusercontent.com/low-k3YLTD/horse_race_predictor_website/HEAD/business/api.tab.co.nz_affiliates_v1__tag_Events_operation_List_20of_20Races.md (+ `api.tab.co.nz_affiliates_v1_.md`) | ReDoc dump of the **TAB NZ** affiliates API (same Entain platform, newer docs): `with_*` query params, `X-Partner-ID` header, extra runner fields (`is_late_scratched`, `horse_id`, `dam_sire`, `last_starts[]`, track/condition split objects, `handicap_rating`), extra race fields (`rail_position`, `track_surface`, `track_circumference`, `protest`), `/racing/list`, `/racing/races?channel=`, `/racing/futures`, `/racing/extras` | medium (for the AU host) |
| S17 | https://raw.githubusercontent.com/jesseballnz/BETMAN_DATA/HEAD/scripts/load_tab_event_payloads.sql | SQL loader confirming `data.race`, `data.runners[].flucs_with_timestamp.last_six[].{fluc,timestamp}`, `data.results`, `data.tote_pools`, `data.money_tracker.entrants` paths on the TAB NZ sibling | medium |
| S18 | https://raw.githubusercontent.com/jamesbrown1417/AFL/HEAD/OddsScraper/Neds/neds_response.json | Raw Neds `/v2/sport/event-card` capture — proves the `price.id = "<entrant>:940b8704-...:"` key format and `odds{numerator,denominator}` shape on `api.neds.com.au` | high |
| S19 | https://raw.githubusercontent.com/Brett-Best/EntainTechnicalTask/HEAD/curl-output.txt | `curl -v` against `api.neds.com.au/rest/v1/racing/?method=nextraces&count=10`: Cloudflare in front (`cf-cache-status: HIT`, `cf-ray ...-MEL`), HTTP/2, works with no headers at all | high |
| S20 | https://github.com/ksulli123/NedsApp, https://github.com/RoscoeH/teds-racing, https://github.com/waelsaad/Entain-Neds-Level and ~90 other repos found by GitHub code search for `api.neds.com.au` | Independent confirmation that `api.neds.com.au/rest/v1/racing/?method=nextraces&count=N` is the public next-to-go endpoint used in Entain's own hiring task since ~2019 | high |

Field tables in sections 4 and 5 were produced by walking S3/S4/S12 programmatically (union of keys
and JSON types over all runners) and cross-checked against S1/S13.

## 3. Hosts, headers, bot protection, rate limits

### 3.1 Hosts (three transports, one data set)

| Host | What it is | Auth | Confidence |
|---|---|---|---|
| `https://api-affiliates.ladbrokes.com.au/affiliates/v1/racing/...` | Official **Affiliate API** (documented, S1). Used by S2, S14 in production daily | none; send `From` + `X-Partner` | high |
| `https://api.ladbrokes.com.au/affiliates/v1/racing/...` | Same affiliate API on the main API host (S1 says "base URL is https://api.ladbrokes.com.au/affiliates/v1"; S15 uses it from Singapore) | none | high |
| `https://api.neds.com.au/affiliates/v1/racing/...` | Presumed Neds mirror of the affiliate API | none | **low** (not seen in any repo; the Neds-branded docs site nedscode.github.io documents the Ladbrokes host) |
| `https://api.ladbrokes.com.au/rest/v1/racing/?method=...` and `https://api.neds.com.au/rest/v1/racing/?method=...` | Legacy go-micro JSON gateway used by the web/mobile apps (`nextraces`, `nextraces-category-group`, `racecard`, `future-markets`) | none | high |
| `https://api.ladbrokes.com.au/v2/racing/...` (and `api.neds.com.au`) | Newer REST gateway (`meeting`, `next-races-category-group`, `search`) | none | high (ladbrokes) / medium (neds mirror, inferred from S18 showing `/v2/sport/...` on neds) |
| `https://api.ladbrokes.com.au/gql/router` | Apollo persisted-query GraphQL gateway (127 ops) | none for public ops | high |
| `https://api.ladbrokes.com.au/graphql` | Older alias used by S10 (2024) with `RacingRaceScreen` op | none | low (may be retired) |
| `https://www.ladbrokes.com.au/cdn/ladbrokes/form/{race_id}` and `https://ladbrokesform.com.au/form/{race_id}` | Racing & Sports full-form HTML bundle (not JSON) | none | medium |
| `https://api.tab.co.nz/affiliates/v1/racing/...` | TAB NZ on the same platform; newest docs (S16). Global racing incl. AU meetings; 30 s cache; no key | none (asks for `From`, `X-Partner`, `X-Partner-ID`) | medium |

### 3.2 Headers

Affiliate API (S1, high): identification headers are requested, not enforced — but omitting them is
the documented path to a 429/block:

```
From: you@example.com
X-Partner: Your Name Pty Ltd
X-Partner-ID: <Entain-provided id>      # TAB NZ docs only; optional on AU (S16, medium)
Accept: application/json
User-Agent: RaceLens/0.1 (+contact email)
```

Web gateways (`api.ladbrokes.com.au`, `api.neds.com.au`) — S5 (high): **every request, including GET,
must send `Content-Type: application/json`**, otherwise the gateway answers `HTTP 500` with text body
`unsupported content-type`. S19 shows `api.neds.com.au/rest/v1/racing/?method=nextraces` answering a
bare `curl` with no special headers (high), so the rule may apply only to some routes; sending it always
is harmless. Browser-like headers used by working scrapers (S10):

```
Content-Type: application/json
Origin: https://www.ladbrokes.com.au        # or https://www.neds.com.au
Referer: https://www.ladbrokes.com.au/
User-Agent: Mozilla/5.0 (...)
Accept: */*
```

CORS allow-origin is the brand site only (not `*`), so these must be called server-side (Node), never
from the browser (S5, high; also why every Entain tech-task repo proxies `/rest/v1/racing` through Vite).

### 3.3 Bot protection, geo, caching, rate limits

- Cloudflare fronts `api.neds.com.au` (`cf-ray: ...-MEL`, `cf-cache-status: HIT` on `nextraces`, S19, high) and `api.ladbrokes.com.au` (`__cf_bm` cookie set on every response, S5, high). The data hosts answered anonymous scripted clients in every repo examined (S2 daily from GitHub Actions US runners; S8 710 races/day; S15 from Singapore). Only the **auth host** `authentication.neds.com` sits behind Kasada (S6) — irrelevant to RaceLens.
- Geo: the betting site is AU-licensed and geo-blocked for betting, but the data endpoints answered GitHub Actions (US) and Fly.io Singapore runners (S2, S15, high). TAB NZ sibling also answers from anywhere (S16/khi48, medium).
- Caching: `nextraces` is CDN-cached (`cf-cache-status: HIT`, S19). The racecard is treated as never-cacheable by S6 because prices move in seconds. TAB NZ affiliates documents a 30 s server cache (khi48/tab-scraper docstring, medium). Affiliate `events/{id}` in S2 captures were generated within ~1.5 s of each other with no throttling across 257 calls (high).
- Rate limits: undocumented. Affiliate docs list `429 Too Many Requests -- make sure you have set your identification headers and contact us` (S1, high). S2 sleeps 0.2-0.5 s between calls; S8 measured 0.08 s per racecard with no errors over 710 races. Recommended RaceLens budget: <= 2 req/s per host, cache meetings 10 min, events 30-60 s pre-race, 10 s inside T-5 min.
- Errors: affiliate `header.error` string + HTTP 400/404/429/500/503 (S1, high). Web gateway errors are go-micro envelopes `{code, detail, id, status}` (S5, high) — see `fixtures/entain/rest_error_go_micro_rpc_not_found.json`.

## 4. Surface A — Affiliate API (primary for RaceLens)

Base: `https://api-affiliates.ladbrokes.com.au/affiliates/v1/racing` (alias `https://api.ladbrokes.com.au/affiliates/v1/racing`).
All GET, JSON by default. Envelope on every route (S1, S3, high):

```jsonc
{
  "header": { "title": "Race Meetings", "generated_time": "2026-10-23T01:43:15.500677935Z", "url": "/affiliates/v1/racing/events/<id>?enc=json&...", "error": "..." /* only on error */ },
  "params": { /* echo of the parsed query, incl. defaults */ },
  "data":   { /* route payload */ }
}
```

Common query params (S1, high): `enc` = `json|xml|html|help` (`?enc=help` returns the parameter list and
`Choices` for that route). Date params accept `YYYY-MM-DD` or keywords `now|today|week|month|all`; ranges
are inclusive. All times UTC ISO-8601 except `race.advertised_start`/`actual_start` which are Unix seconds.

### 4.1 `GET /meetings` — meetings for a date (S1 high; S2/S14 live usage high)

| Param | Default | Notes |
|---|---|---|
| `date_from` | `week` | use `2026-10-24` |
| `date_to` | `now` | use the same date for one day (S2); S14 uses yesterday..tomorrow and filters client-side |
| `category` | all | `T` (Thoroughbred), `H`, `G` |
| `country` | all | `AUS`, `NZ`/`NZL`, `HK`, `UK`, `FR`, `SGP`, `JPN`, ... (`?enc=help` lists the full set). S2 observed both alpha-2 and alpha-3 spellings accepted for some countries |
| `limit` | 100 | max 200 |
| `offset` | 0 | pagination with `limit` |
| `id` | | alternative to the `/meetings/{id}` path form |
| `futures`, `ids`, `meeting_numbers` | | TAB NZ docs only (S16, low for AU) |

Example: `GET /meetings?enc=json&date_from=2026-10-24&date_to=2026-10-24&category=T&country=AUS&limit=200`

Response `data.meetings[]` (S1 high, status key from S2 live captures high):

| Field | Type | Notes |
|---|---|---|
| `meeting` | string UUID **v5** | meeting id (same id across all Entain hosts) |
| `name` | string | venue name e.g. `Flemington` |
| `date` | string | `YYYY-MM-DDT00:00:00Z` |
| `category` / `category_name` | string | `T` / `Thoroughbred Horse Racing` |
| `country`, `state` | string | `AUS`, `VIC` |
| `races[]` | array | `id` (race UUID v4 = affiliate `event_id` = `rest/v1` race id = GraphQL `RacingRace:<id>`), `race_number` (0 = special e.g. Jockey Challenge), `name`, `start_time` (ISO), `track_condition` (`Good4`, `Soft5`...), `distance` (m), `weather` (`FINE`/`Fine`/`Overcast` — inconsistent case), `country`, `state`, `status` (`Open`, `Interim`, `Final`, `Closed`, `Abandoned`, `Live`) |

Not in the response: rail position, meeting-level track condition (take it from `races[0].track_condition`
or the event route), prize money, scratchings. `races[]` is the authoritative race list for the day.

### 4.2 `GET /meetings/{meeting_id}` — one meeting (S1, high)

Same envelope and `MeetingsResponse` shape with exactly one meeting; `params.id` echoes the id. Fixture:
`affiliates_meeting_by_id_flemington_2026-10-24.json` (constructed).

### 4.3 `GET /events/{race_id}` — race card, form, odds, flucs, results (S1 high; S3/S4 live high)

Official params: `enc`, `id`. Undocumented but accepted (echoed in `params` of S3, high): `present_overlay`,
`with_big_bets`, `with_live_bets`, `with_money_tracker`, `with_biggest_bet`, `will_pays`,
`with_tote_trends_data`, `bet_type_filter`, `bets_limit` (=10 default) — these match the TAB NZ docs (S16).
S2 also sends `include_form`, `include_odds`, `include_flucs`, `include_speedmap`, `include_past_performances`,
`include_form_indicators`, `include_jockey_stats`, `include_trainer_stats` = `true`; they are echoed in
`header.url` but **not** in `params`, so they are probably ignored (the same fields are present in the
official 2020 example without them) — low confidence that they change anything.

`data` keys (S3/S4 high): `race`, `favourite`, `runners[]`, `derivatives[]|null`, `mover`, `big_bets`,
`live_bets`, `biggest_bet`, `money_tracker` (all `null` unless the `with_*` flags are on), `error` (`""`),
plus when resulted: `results[]`, `substitutions[]`, and per S1 `dividends[]` (omitted when empty).

`data.race` (S3 high unless noted):

| Field | Type | Example / notes |
|---|---|---|
| `event_id` | UUID | race id |
| `meeting_name`, `display_meeting_name`, `meeting_id` | string | `Cranbourne`, meeting UUID v5 |
| `status` | string | `Open`, `Closed`, `Abandoned`, `Live`, `Interim`, `Final` (S1) |
| `description` | string | race name `Ladbrokes Cox Plate @ Flemington (Bm70) Hcp` |
| `advertised_start`, `actual_start` | int Unix seconds | equal until the race jumps |
| `advertised_start_string`, `actual_start_string` | string | `2026-10-23 10:15:00 +0000 UTC` |
| `race_number` | int | |
| `type` | string | `T`/`G`/`H` |
| `start_type` | string | usually `""` |
| `country`, `state` | string | `AUS`, `VIC` |
| `distance` | int metres | |
| `weather` | string | `FINE` / `Fine` |
| `form_guide` | string | `""` in captures |
| `comment` | string | Racing & Sports race preview naming the top 4 in order |
| `silk_base_url`, `silk_url` | string | sprite sheet of 64x64 silks ordered by runner number |
| `track_condition` | string | `Soft5`, `Good4` |
| `track_direction` | string | `Left` / `Right` |
| `entrant_count`, `positions_paid` | int | 13, 3 |
| `video_channels[]`, `video_channels_meta{}` | | `Live1` etc.; meta has `UtcRaceStartTime`, `SchedulerNote` (`P1 [Provincial] Prize Money: $60,000`), `VenueProviderName` (`RACING.COM`) |
| `tips[]` | UUID[] | **ordered** R&S tips (entrant ids, 1st pick first) (S3, S15 high) |
| `rail_position` | string | `True Entire Circuit. (Pent: 5.51)` — includes penetrometer when published |
| `group` | string | `""` or Group/Listed label |
| `prize_monies{}` | object | `1st`..`10th`, `total_value` (ints, AUD) |
| `track_home_straight` | int | metres (0 when unknown) |
| TAB NZ-only (S16, low for AU): `class`, `age_conditions`, `gender_conditions`, `jockey_conditions`, `weight_and_handicap_conditions`, `special_conditions`, `track_surface`, `track_circumference`, `protest`, `protest_reason`, `gait`, `mile_rate_400/800` | | may appear on AU too since open-schema |

`data.runners[]` (and `favourite`, `mover`, `derivatives[]` which are the same object minus the
market fields) — union over 21 real runners (S3/S4, high):

| Field | Type | Notes |
|---|---|---|
| `entrant_id` | UUID | same id as `rest/v1` `entrants{}` key and GraphQL `RacingEntrant:<id>` |
| `market_name`, `primary_market` | string, bool | `Final Field`/`true` for real runners; `Live Racing`/`false` rows appear in `derivatives` |
| `name` | string | |
| `is_scratched` | bool | **scratched flag** |
| `scratch_time` | int Unix seconds | `0` if not scratched |
| `scr_time` | string ISO or `null` | |
| `deduction{win,place}` | floats | present on scratched runners (and seen on some others): deductions in $ per $1 for bets taken before the scratching (S3/S4 high that the key exists; semantics medium) |
| `odds{fixed_win,fixed_place}` | number | decimal prices. `0` = no price / TBA (S15). Frozen at close once resulted |
| `flucs[]` | number[] | ordered Fixed Win fluctuation history (oldest first, last = current) |
| `flucs_with_timestamp{}` | object | `last_six[]{timestamp,fluc}`, `open{}`, `high{}`, `low{}`, `nine_am{}` (9 am AEST price) |
| `barrier` | int | |
| `runner_number` | int | saddlecloth |
| `prize_money` | string | career earnings `"152650"` |
| `age` | int | `sex` string `G/M/H/C/F`, `colour` string `B/BR`, `country` string |
| `silk_colours`, `silk_url_64x64`, `silk_url_128x128` | string | |
| `form_comment` | string or null | null in AU captures (comment lives in `race.comment`) |
| `class_level` | string | `""` |
| `jockey` | string | rider name |
| `apprentice_indicator` | string | `"A"` when apprentice |
| `allowance_weight` | string | claim in kg `"3"` |
| `weight{allocated,total}` | strings | `"58.5"`, `"61.5"` (total = allocated + claim?? in the capture total > allocated; treat `allocated` as the handicap weight) |
| `owners` | string | |
| `trainer_name`, `trainer_location` | string | `Ben, Will & Jd Hayes`, `Pakenham 3` |
| `last_twenty_starts` | string | e.g. `13117x22` — most recent on the RIGHT, `x` = spell, `0` = 10th+ (S2 README) |
| `sire`, `dam`, `breeding` | string | `BLUE POINT (IRE)`, `DANAAT (AUS)`, `4 g BLUE POINT (IRE)-DANAAT (AUS)` |
| `favourite`, `mover` | bool | market favourite / biggest firmer |
| `speedmap{settling_lengths,entrant_id,label}` | | `label` in `Leader`, `On Pace`, `Midfield`, `Back Marker` (S2 README lists `Front Runner` too) |
| `form_indicators[]` or null | | `{group, name, negative, priority}` e.g. `Nearing Another Win`, `Form on Good` |
| `past_performances{jockey{number_of_starts,number_of_wins,number_of_placings,number_of_seconds,number_of_thirds}}` | | this jockey on this horse |
| `jockey_past_performances{last_50_starts{...}, trainer{...}}` | | jockey last 50 rides; jockey-for-this-trainer record |
| `picks[]` | | `{name, rank, selector_type: "trackside", comment}` expert picks |
| `meta` | null/object | |
| `competitor_id` | string | `""` ("Unused" per S1) |
| `ride_guide_exists`, `ride_guide_thumbnail`, `ride_guide_file` | | |
| TAB NZ-only (S16, low for AU): `is_late_scratched`, `is_emergency`, `emergency_position`, `horse_id`, `dam_sire`, `dam_dam`, `foaling_date`, `handicap`, `handicap_rating`, `rating`, `last_starts[]`, `runner_win_history[]`, `best_time`, `best_mile_rate`, `first_start_indicator`, `form_comment_short`, `preview`, `predictors[]`, `win_p`, `place_p`, `last_12_w`, `last_12_p`, and condition/track split objects `overall`, `track`, `distance`, `track_distance`, `good`, `soft`, `heavy`, `firm`, `synthetic`, `turf`, `first_up`, `second_up`, `third_up`, `fourth_up`, `fresh_30`, `fresh_90`, `left_handed`, `right_handed`, `weight_for_age` | | if present these are exactly the track/dist/condition stats RaceLens wants; check with `?enc=help` and a live call |

`data.results[]` (S4 live high; S1): `{position, name, barrier, runner_number, margin_length, entrant_id}`;
"typically up to the first 4 positions". `margin_length` was `0` for all four in the Interim capture (S4)
and `0.37` in the docs example — expect lengths behind the winner once Final.

`data.dividends[]` (S1 high, not seen live): `{id, tote (VIC|NSW|QLD|UNKNOWN), product_name (Tote Win,
Tote Place, Exacta, Quinella, Trifecta, First Four...), status (Interim|Final), dividend, pool_size,
jackpot_size, positions[]{runner_number, position}}`.

`data.substitutions[]` (S4 high): `{entrant_id, tote, product_name}` — tote substitute runner.

Other routes on the same platform (S16, TAB NZ docs; **low** confidence for the AU host): `GET /list`
(flat race list, `countries`, `meet_types`, `date_from/to`, `order_by`, `page_token`, `limit`),
`GET /races?channel=Live1&date=...&type=T`, `GET /futures`, `GET /extras`. S2 also probes
`/events/{id}/form` and `/runners/{id}?race_id=` — no evidence either exists on AU (low).

## 5. Surface B — web gateway REST (`api.ladbrokes.com.au` = `api.neds.com.au`)

### 5.1 `GET /rest/v1/racing/?method=nextraces&count=N` (S12 raw capture, S13, S19, S20 — high)

`count` is required (S20 kodee-koder). Returns the next N races to jump across ALL three codes; filter
by `category_id` client-side. Envelope `{status: 200, message: "Next 10 races from each category", data: {next_to_go_ids: [raceId...], race_summaries: {raceId: RaceSummary}}}` (S12 verbatim). The capture with `count=10` held exactly 10 races across the three codes (5 greyhound, 4 horse, 1 harness), so despite the wording treat `count` as the total returned and request a larger `count` (50-100, as most clients do) before filtering to `category_id`. S19 shows the first request can answer `301` with `location` equal to the same path: follow redirects.
`next_to_go_ids` is the ordering; `race_summaries` is a map.

RaceSummary (S12/S13 high):

| Field | Type |
|---|---|
| `race_id`, `race_name`, `race_number`, `meeting_id`, `meeting_name`, `category_id` | string/int |
| `advertised_start` | `{ "seconds": 1792750500 }` (Protobuf timestamp) |
| `venue_id`, `venue_name`, `venue_state`, `venue_country` | string |
| `race_form.distance`, `distance_type{id,name,short_name}`, `distance_type_id` | |
| `race_form.track_condition{id,name,short_name}`, `track_condition_id` | may be absent before published |
| `race_form.weather{id,name,short_name,icon_uri}`, `weather_id` | optional |
| `race_form.race_comment`, `race_comment_alternative` | R&S preview |
| `race_form.additional_data` | **JSON-encoded string** (S12 verbatim): `{"revealed_race_info":{track_name,state,country,number,race_name,time (ISO),class ("HCP CL3","D2","BM84"),start_type,prizemonies{1st..,total_value},localised_prizemonies{AUD{...},NZD{...}},rail_position,track_direction ("Left"),track_surface ("Turf","All Weather"),group,gait ("Gallop"),track_home_straight_metres,track_circumference,race_comment_provider ("racingandsports")}}` — `prizemonies` may hold only `total_value` for overseas races |
| `race_form.generated`, `silk_base_url` | int, string |

Racing category UUIDs (S5, S13, S8 — high): Horse `4a2788f8-e825-4d36-9894-efd4baf1cfae`,
Greyhound `9daef0d7-bf3c-4f50-921d-8e818c60fe61`, Harness `161d9be2-e909-4326-8c2c-35ed71fb460b`.
(S5's table swaps the harness/greyhound labels; S8 identified them from live meeting names and the 60+
tech-task repos agree with the mapping above.)

### 5.2 `GET /rest/v1/racing/?method=nextraces-category-group&count=5&include_categories=["<uuid>",...]` (S11 medium)

Same summaries, grouped per category: `{status, data:{category_race_map:{<category_id>:{race_ids[]}}, race_summaries{}}, message}`
(inner shape verified on the v2 twin by S5; v1 wrapping medium). The v2 twin is
`GET /v2/racing/next-races-category-group?count=5&categories=["<uuid>"]` with RFC3339 `advertised_start` (S5 high).

### 5.3 `GET /rest/v1/racing/?method=racecard&id={race_id}` — full priced card (S6, S8, S9, S10 — medium)

Response `{status, data:{meetings{}, races{}, markets{}, entrants{}, prices{}, price_fluctuations{}}, message}` (S6).
Evidence per table:
- `data.meetings[<id>].advertised_date.seconds` (S10).
- `data.entrants[<entrant_id>]`: `name`, `number`, `barrier`, `market_id`, `visible`, `is_scratched`, `scratched_time` (S8/S9/S10). Entrants span EVERY market on the race (Final Field AND Live Racing) — pick the biggest `market_id` group as the field (S8).
- `data.prices["<entrant_id>:<product_type_id>:"]` → `{odds:{numerator, denominator}}`; **decimal = numerator/denominator + 1** (S8/S9/S5 high). ~84 product rows per runner; Fixed Win = `940b8704-e497-4a76-b390-00918ff7d282`, Fixed Place = `7cf3eea6-5654-42be-9c2e-6de280e7bb34` (S9/S10 high).
- `data.price_fluctuations[<entrant_id>]` = `[float...]`, last element = live fixed-win (S6/S9 high).
- Jockey/trainer/weight/form are NOT confirmed in this payload (low) — use the affiliate route or GraphQL for those.
Never cache (S6). Fixture: `rest_v1_racecard_flemington_r7.json` (constructed, medium).

### 5.4 `GET /v2/racing/meeting?date=YYYY-MM-DD&timezone=Australia%2FMelbourne[&region=domestic]` (S5 high for top level; S8/S10 medium for rows)

~415 KB. `{compounds{}, domestic_countries:"AUS,NZ,HK", meetings{}, races{}, venues{}}`, all UUID-keyed.
`meetings[id]`: `name`, `category_id`, `country`, `race_ids[]` (S8/S10). `races[id]`: `number` (NOT `race_number`),
`name`, `advertised_start` (S8). `compounds[id]`: `{id, meeting_id, product_type_id, name (Quadrella|EarlyQuadrella|RunningDouble|BigSix|DailyDouble), race_ids[]}` (S5).
Good for a single-call day index and for exotic (quaddie) leg mapping. Fixture `v2_racing_meeting_2026-10-24.json` (constructed; row fields beyond those named are low).

### 5.5 `GET /v2/racing/search` (S5 high) — facets `barrier/country/jockey/trainer` buckets; `q=`, `category_ids=` for full text (medium). Not needed by RaceLens.

### 5.6 `GET /rest/v1/racing/?method=future-markets&exclude={"markets":true,"prices":true,"entrants":true}` (S5 high) — futures races; not needed.

### 5.7 Variants named in the task brief that I could NOT find in any repo (low): `/v2/racing/meetings?...` (plural)
and `/v2/racing/next-to-go/races?method=nextraces&limit=100&category_ids=[...]`. The verified spellings are
`/v2/racing/meeting` (singular, `date`+`timezone`) and `/v2/racing/next-races-category-group` (`count`+`categories`),
plus `/rest/v1/racing/?method=nextraces&count=`. Treat the brief's spellings as unverified; probe with `?enc=help`-style
curiosity on the user's machine and fall back to the verified ones.

## 6. Surface C — GraphQL `/gql/router` (persisted queries)

`GET https://api.ladbrokes.com.au/gql/router?operationName=<Op>&variables=<urlenc JSON>&extensions=<urlenc {"persistedQuery":{"version":1,"sha256Hash":"<hex>"}}>`
with `Content-Type: application/json` (S5 high). IDs are type-prefixed for `ID!` variables
(`RacingRaceCard:<uuid>`, `RacingRace:<uuid>`, `RacingMeeting:<uuid>`) and bare for `UUID!` (S5).

**Hash drift (critical, S5 high):** the registered sha256 changes on every front-end deploy and the
gateway's APQ cache is evictable (113/127 ops flushed on 2026-07-07). Recovery = standard Apollo APQ:
on `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`
POST `{operationName, query:<full document>, variables}` to `/gql/router`; the pair only needs to be
self-consistent (`sha256Hash == sha256(query)`), not bundle-matching. The printed documents for all 127
ops are in S7 (`entain.documents.json`), so RaceLens can vendor the racing ones. S8 notes Entain racing
GraphQL was "blocked on persisted-query registration drift" for weeks in mid-2026 — treat GraphQL as an
enrichment layer, never the only path.

Racing operations worth using (S6 names/variables high; S7 documents high; response samples medium):

| Operation | Variables | Gives |
|---|---|---|
| `RacingHomeMeetingsDesktopScreen` | `date: Date!, categories: [HORSE], regions: [DOMESTIC,INTERNATIONAL], shouldFetchPools` | `racingDay.meetings[]{id,isAbandoned,name,hasVideo,meetingCode,venue{country,state},races[]{id,advertisedStart,number,name,finalFieldMarket{status},resultsSummary},compounds}` — meetings for a date |
| `HomepageNextToJumpRaces` / `RacingSideMenuNextToJumpRaces` | `first, categories` | next-to-go |
| `RacingRaceCardScreenWeb` | `id: "RacingRaceCard:<race>", isLoggedIn:false, includePlaceExtra` | header (`distance, trackCondition "Good 4", weatherIcon, name, advertisedStart, fullForm URL, number, status OPEN/CLOSED/..., protestReason, meeting{category HORSE, venue{country}}, tips[]{author racingandsports, entrants[], summary}`), `raceSelector[]`, `finalField.runnerRows[]{id, barrierLabel, jockeyName, trainerName, name, number, isMarketMover, recentResults, silkUrl, scratchedTimestamp, scratchedDeduction, fluctuations[]{decimal}, prices[]{id, odds{numerator,denominator,decimal}}, speedMap{label,markerColour,progress,settlingLengths}, trackerInfo{betCountPercent,betStakePercent}, form{comment, fields[]{label,value,highlighted}, tabs[]{title,data[]}}}`, `results{...}`, `totePools`, `betTypeSelectors` (names the product ids: productTypeName "Fixed Win"/"Fixed Place") |
| `RacingRace` | `raceId: "RacingRace:<id>", shouldFetchPools` | `results{entrants[]{barrier,name,number,form{trainer,jockey},results{position,winDividends[],placeDividends[],fixedWin{num,den},fixedPlace,fixedTop3}}, exoticsAndCompounds[]{name,entrantsSummary,dividends[]{description,dividend,tote,variant}}, substitutions[]}` — results + dividends |
| `RacingEntrantInfo` | `raceIds: [ID!]!` | `finalFieldMarket.nodes[].entrants.nodes[]{id,name,barrier,barrierPosition,isScratched}` — cheap scratchings check for many races |
| `RacingNextToGoFavourites` | `first, categories` | favourite per upcoming race with `isLateScratched`, jockey/trainer, prices |
| `RacingBackupRunners`, `RacingListPools`, `RacingListPopularSameRaceMultis`, `RacingRaceAskFormAssistant` (UUID!, LLM form assistant) | | optional |

`fullForm` = `https://ladbrokesform.com.au/form/<race_id>` (R&S HTML form guide; also proxied at
`https://www.ladbrokes.com.au/cdn/ladbrokes/form/<race_id>`) — parse only as a last resort (medium).

## 7. Recipes for RaceLens

1. **Meetings for a date** — `GET /affiliates/v1/racing/meetings?date_from=D&date_to=D&category=T&country=AUS&limit=200`
   (fallback host `api.ladbrokes.com.au/affiliates/v1/...`; second fallback `GET /v2/racing/meeting?date=D&timezone=Australia%2FMelbourne`
   filtered to `category_id == 4a2788f8-...` and `country == "AUS"`; third fallback GraphQL `RacingHomeMeetingsDesktopScreen`).
   Normalise `name` to RaceLens venue (`Flemington`), keep `meeting` and each `races[].id`.
2. **Race card** — `GET /affiliates/v1/racing/events/{race_id}`. Runner = `runners[]` where `primary_market == true`
   (drop `Live Racing` rows and pseudo-runners named `Odds`, `Evens`, `Favourite`, `Field`, `Any Other Runner` — S9).
   Map: `runner_number`→number, `name`, `barrier`, `jockey`, `trainer_name`, `weight.allocated` (kg, string→float),
   `is_scratched` (+ `scratch_time`), `odds.fixed_win`/`fixed_place` (0 ⇒ null), `flucs[]`/`flucs_with_timestamp`.
3. **Form** — from the same payload: `last_twenty_starts`, `age/sex/colour`, `sire/dam`, `prize_money`, `gear`,
   `speedmap.label/settling_lengths`, `form_indicators[]`, `jockey_past_performances`, `past_performances.jockey`,
   `race.comment` + ordered `race.tips[]`, `picks[]`. For per-start history and track/distance/going splits use
   GraphQL `RacingRaceCardScreenWeb.finalField.runnerRows[].form.tabs` (medium) or other RaceLens sources (racing.com, Sportsbet form) — Entain is weak here.
4. **Results** — poll the event route after `advertised_start`; `race.status` moves `Open → Closed → Interim → Final`
   (`Abandoned` possible). Read `results[]` (position, runner_number, margin_length) and `dividends[]`. Cross-check with
   GraphQL `RacingRace.results` and non-Entain sources.
5. **Track/rail/weather** — `race.track_condition` (`Good4` style, no space), `race.rail_position` (free text incl. penetrometer),
   `race.weather`, `race.track_direction`, `race.track_home_straight`; from `nextraces`, `race_form.additional_data`
   (parse the JSON string) adds `track_surface`, `track_circumference`, `track_home_straight_metres`, `class`, `prizemonies`.
6. **Odds for the market/consensus layer** — `odds.fixed_win` is Ladbrokes' fixed price (decimal). From `rest/v1 racecard`
   use `price_fluctuations[entrant][-1]` or `prices["<entrant>:940b8704-...:"]` with `+1`. Opening price =
   `flucs_with_timestamp.open.fluc`; 9am price = `nine_am.fluc`.
7. **Verification** — Entain data (incl. the R&S comment/tips/speedmap) originates from Racing & Sports + BetMakers/PriceKinetics
   silks; Sportsbet's form is also R&S, so agreement between Entain and Sportsbet on *form text* is not independent either.
   Independent facts to cross-check against racing.com / Racing Australia / TAB: barrier, jockey, weight, scratchings, results.

## 8. Fixture index (`research/fixtures/entain/`)

| File | Provenance | Confidence |
|---|---|---|
| `affiliates_event_REAL_cranbourne_r7_open_2026-10-23.json` | VERBATIM raw `GET /events/{id}` capture (S3), Cranbourne R7 2026-10-23, Open, 13 runners, flucs, speedmap, tips, picks, rail/penetrometer | high |
| `affiliates_event_REAL_ballarat_r1_interim_results_2026-10-23.json` | VERBATIM raw capture (S4), Ballarat R1 2026-10-23, `status: Interim`, `results[]`, `substitutions[]`, `derivatives[]`, scratched runner with `deduction` | high |
| `rest_v1_nextraces_REAL_j-next-to-go-react_2026-01-15.json` | VERBATIM raw `method=nextraces&count=10` capture (S12), mixed codes | high |
| `v2_sport_event_card_REAL_neds_price_table_shape.json` | VERBATIM Neds `/v2/sport/event-card` capture (S18) — shows the `<entrant>:<product>:` price key + fractional odds (sport, not racing) | high |
| `affiliates_meetings_2026-10-24_T_AUS.json` | constructed (Flemington + Doomben) from S1 example + S2 live keys | high (shape) |
| `affiliates_meeting_by_id_flemington_2026-10-24.json` | constructed from S1 | high (shape) |
| `affiliates_event_flemington_r7_open_2026-10-24.json` | constructed; runner/race objects templated 1:1 from S3 with invented values; includes one scratched runner | high (shape) |
| `affiliates_event_flemington_r1_final_results_dividends_2026-10-24.json` | constructed; `results[]` from S4, `dividends[]` from S1 schema | medium (dividends unseen live) |
| `affiliates_error_404_not_found.json` | constructed from S1 error table | low (wording) |
| `rest_v1_nextraces_count10.json` | constructed from S13 schemas, Flemington 2026-10-24, with `additional_data` string | high (keys) |
| `rest_v1_nextraces_category_group.json` | constructed (S11 URL, S5 inner shape) | medium |
| `rest_v1_racecard_flemington_r7.json` | constructed from S6/S8/S9/S10 | medium |
| `v2_racing_meeting_2026-10-24.json` | constructed from S5/S8/S10 | medium (top level) / low (row extras) |
| `v2_racing_next_races_category_group.json` | constructed from S5 | medium-high |
| `gql_RacingRaceCardScreenWeb_flemington_r7.json` | constructed from S7 document + S5 sample | medium |
| `gql_RacingRace_results_flemington_r1.json` | constructed from S7 document | medium-low |
| `gql_error_PersistedQueryNotFound.json`, `rest_error_go_micro_rpc_not_found.json`, `rest_error_unsupported_content_type.txt` | verbatim from S5 | high |

Every constructed file carries a top-level `_fixtureNote` saying so; the adapter should ignore keys
starting with `_`.

## 9. Caveats and open questions to verify on the user's machine (first run)

1. Confirm the affiliate host works without `X-Partner-ID` and whether `api.neds.com.au/affiliates/v1` exists (low).
2. Run `GET /affiliates/v1/racing/events/{id}?enc=help` once to list every accepted parameter and whether AU payloads carry the TAB NZ-documented extra form fields (`last_starts[]`, `good/soft/heavy{}` splits, `is_late_scratched`, `handicap_rating`).
3. `weight.total` vs `weight.allocated`: in the real capture an apprentice with a 3 kg claim shows allocated 58.5 / total 61.5, which is the opposite of the usual "carried = allocated − claim". Decide which to display after one live check; RaceLens should store both.
4. `advertised_start` on `/v2/racing/meeting` races: RFC3339 string per S5 convention for v2, but S8 parses it with a generic epoch helper — handle both string and `{seconds}`.
5. GraphQL hashes in S6 are from the 2026-05-25 bundle and are almost certainly stale; implement the APQ POST fallback from day one or skip GraphQL.
6. The brief's `/v2/racing/meetings?` and `/v2/racing/next-to-go/races?...category_ids=` spellings were not found anywhere; the verified routes are in sections 5.1–5.4.
7. All Entain brands are one source for verification purposes (section 0). Count Entain once in any "N sources agree" score.
