# Weather & track-context sources — Open-Meteo (forecast / archive / geocoding) and BOM (fwo JSON observations, api.weather.bom.gov.au, DWO rainfall)

Source key: **`weather`** · Researched 2026-10-23 for RaceLens · Fixtures: `research/fixtures/weather/` (21 files, see §12)

> **Honesty note.** The research container could not open `api.open-meteo.com`, `archive-api.open-meteo.com`, `open-meteo.com`, `bom.gov.au`, `api.weather.bom.gov.au`, Wikipedia, Nominatim or Wikidata (proxy `CONNECT` 403 / DNS refused), so **nothing in this report was fetched live**. Evidence comes from: the Open-Meteo OpenAPI specs and website source on GitHub (read in full), real recorded responses checked into public repos (copied verbatim into the fixtures and marked `REAL`), the Home Assistant / bomrang / txBOM / bremor parsers, a 790-station BOM station list (opennem), ~40 web searches, and GitHub code search. The web-search budget ran out after the first 13 metro venues, so ~45 venue coordinates are **model memory cross-checked against locality centroids** (flagged `low`). Confidence tags: **high** = seen in a spec or a recorded response; **medium** = consistent across 2+ independent code bases / docs pages; **low** = single source, inference or memory. Verify the first live call on the user's machine against the fixtures.

---

## 1. Purpose and what this source gives RaceLens

This source does **not** carry meetings, race cards, runners, form, odds or results (those come from `tab`, `racingcom`, `sportsbet`, `news`). It supplies the **physical context** that drives track-condition drift and some race-dynamics factors:

| Need | Best source here | Endpoint | Conf. |
|---|---|---|---|
| Rain in the 72 h before the meeting (observed, mm, gauge) | **BOM fwo JSON** `rain_trace` at the nearest AWS (often < 5 km, on-course at Geelong & Canterbury) | §7 `http://www.bom.gov.au/fwo/{PROD}/{PROD}.{wmo}.json` | high (shape) / medium (access) |
| Rain in the 72 h before the meeting (model analysis, any point) | **Open-Meteo Forecast API** `past_days=3&hourly=precipitation` | §4 | high |
| Race-day hourly rain, probability, temperature, wind (speed/direction/gusts) | Open-Meteo Forecast API (`best_match`), optionally a second opinion from `models=bom_access_global` (BOM ACCESS-G) | §4 | high |
| BOM's own forecast text, rain chance / min–max mm per day, hourly | api.weather.bom.gov.au (unofficial, geohash) | §8 | medium |
| Daily 9am–9am rainfall totals for the current month at a station | BOM Daily Weather Observations (DWO) CSV | §9 | medium |
| Rainfall for older dates (back-testing) | Open-Meteo Archive API (ERA5, 5-day lag) / Historical Forecast API (from 2022) | §5 | high |
| Venue → coordinates, timezone, state, nearest BOM station, TAB mnemonic | `fixtures/weather/venues.json` (59 entries) | §10 | mixed, per row |
| Track condition rating, rail position, penetrometer | **not here** — TAB `meeting.trackCondition/railPosition/weatherCondition`, racing.com; this source predicts *drift* from rain | — | — |

Everything is **free, keyless and read-only**. Open-Meteo is CC-BY-4.0 and requires an attribution line ("Weather data by Open-Meteo.com") wherever the data is displayed [S1][S2]. BOM material is Crown copyright: fine for personal/internal use, "you may not supply that material to any other person or use it for any commercial purpose" without a licence [S14].

---

## 2. Hosts, auth, headers, rate limits (summary)

| Host | Role | Auth | Headers | Limits / blocking | Conf. |
|---|---|---|---|---|---|
| `https://api.open-meteo.com/v1/forecast` | forecast + recent past (`past_days` ≤ 92) | none (`apikey` only for commercial `customer-api.open-meteo.com`) | none needed | < 10 000 calls/day, 5 000/h, 600/min **per IP**, weighted by data volume; HTTP 429 JSON on breach | high [S1][S3][S4] |
| `https://archive-api.open-meteo.com/v1/archive` | ERA5/ERA5-Land reanalysis 1940→ (≈5-day lag) | none | none | same counters (separate host, shared per-IP daily quota reported) | high [S5][S6] |
| `https://historical-forecast-api.open-meteo.com/v1/forecast` | archived *forecast-model* data 2022→ (ACCESS-G from 2024-01-18) | none | none | same | high [S7] |
| `https://previous-runs-api.open-meteo.com/v1/forecast` | same models, `*_previous_day1..7` variables | none | none | same | medium [S8][S9] |
| `https://geocoding-api.open-meteo.com/v1/search` | place-name → lat/lon/timezone | none | none | same | high [S10] |
| `http(s)://www.bom.gov.au/fwo/IDx6080x/IDx6080x.{wmo}.json` | BOM observations JSON, 72 h × 30 min | none | **browser-like `User-Agent` required** (default python/curl UAs get HTTP 403 HTML) | no published limit; files refresh every 30 min (some stations 10 min) — poll ≤ 1/10 min | medium [S11][S12][S13] |
| `http://reg.bom.gov.au/fwo/IDx60920.xml`, `ftp://ftp.bom.gov.au/anon/gen/fwo/IDx60920.xml` | per-state station list (wmo-id, lat, lon) | none | same | — | medium [S15][S16] |
| `https://api.weather.bom.gov.au/v1/locations/{geohash}/…` | BOM app/website API (unofficial) | none | any UA works (HA integration sends `MakeThisAPIOpenSource/1.0.0`) | HA refreshes ≤ 1/5 min; undocumented, may change | medium [S17][S18][S19] |
| `https://api.bom.gov.au/apikey/v1/…` | **new** 2025 BOM site API (place/grid/station) | none seen | — | undocumented, documented by one community file only | low [S19] |
| `http://www.bom.gov.au/climate/dwo/{YYYYMM}/text/IDCJDW{code}.{YYYYMM}.csv` | Daily Weather Observations CSV | none | browser UA | — | medium (HTML page high, CSV path memory) [S20] |

**Open-Meteo 429 bodies (verbatim, key order `reason` then `error`)** [S4][S21][S22]:
`{"reason":"Minutely API request limit exceeded. Please try again in one minute.","error":true}` · `…"Hourly API request limit exceeded. Please try again in the next hour."…` · `…"Daily API request limit exceeded. Please try again tomorrow."…` · `Too many concurrent requests` (does not consume quota). The daily counter is per source IP, so a shared/VPN egress can exhaust it [S21][S22]. RaceLens's load (≈ 60 venues × a handful of calls/day) is < 1 % of the quota.

**Open-Meteo 400 body**: `{"error":true,"reason":"<text>"}` (schema high [S23]; wording low, e.g. a misspelt variable name or latitude out of −90…90).

---

## 3. Time zones and "today" for racing

| State | IANA zone | Notes | Conf. |
|---|---|---|---|
| VIC, NSW, ACT, TAS | `Australia/Melbourne`, `Australia/Sydney`, `Australia/Hobart` | AEST +10 / AEDT +11 (DST first Sunday Oct → first Sunday Apr) | high |
| QLD | `Australia/Brisbane` | AEST +10, **no DST** | high |
| SA | `Australia/Adelaide` | ACST +9:30 / ACDT +10:30 | high |
| WA | `Australia/Perth` | AWST +8 | high |
| NT | `Australia/Darwin` | ACST +9:30, no DST | high |

Always call Open-Meteo with `timezone=<venue IANA zone>` (or `auto`): all `time` strings then come back **local, without an offset suffix** (`"2025-10-25T06:21"`), and `utc_offset_seconds` tells you the offset in force (39600 = AEDT in the real Melbourne sample) [S24]. This matches `toLocalStamp()` in `src/server/core/weather.ts`, which treats zone-less strings as local. BOM `local_date_time_full` is also local (`yyyyMMddHHmmss`) with `aifstime_utc` alongside; BOM labels zones `EST/EDT/CST/CDT/WST` (its names for AEST/AEDT/ACST/ACDT/AWST) in `header[0].time_zone` [S25][S26].

---

## 4. Open-Meteo Forecast API — `GET https://api.open-meteo.com/v1/forecast`

Spec: `openapi/forecast.yml` in github.com/open-meteo/open-meteo (OpenAPI 3.1, licence CC BY 4.0, servers `https://api.open-meteo.com` and `https://customer-api.open-meteo.com`) [S23]; docs source in github.com/open-meteo/open-meteo-website [S27][S28].

### 4.1 Query parameters (all **high**, from the spec unless noted)

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `latitude`, `longitude` | string (float or comma-list) | **yes** | — | WGS84. "Multiple coordinates can be comma separated" → response becomes a **JSON array** of per-location objects (medium [S29]). Use this to fetch every meeting of the day in one call. |
| `hourly` | comma list (`explode: false`) | no | — | 147 enum values in the spec; the ones RaceLens needs: `precipitation` (mm, **preceding-hour sum**, = rain+showers+snow), `rain`, `showers`, `precipitation_probability` (%), `temperature_2m`, `apparent_temperature`, `relative_humidity_2m`, `dew_point_2m`, `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`, `weather_code`, `cloud_cover`, `visibility`, `pressure_msl`, `soil_moisture_0_to_1cm`…`27_to_81cm`, `soil_temperature_0cm`, `et0_fao_evapotranspiration`, `is_day`, `uv_index`. Legacy spellings (`relativehumidity_2m`, `windspeed_10m`, `winddirection_10m`, `windgusts_10m`, `cloudcover`, `dewpoint_2m`) are still accepted and echoed back as requested (high, real NYC sample [S30]). |
| `daily` | comma list | no | — | 22 enum values: `weather_code, temperature_2m_max, temperature_2m_min, apparent_temperature_max/min, sunrise, sunset, daylight_duration, sunshine_duration, uv_index_max, uv_index_clear_sky_max, rain_sum, showers_sum, snowfall_sum, precipitation_sum, precipitation_hours, precipitation_probability_max, wind_speed_10m_max, wind_gusts_10m_max, wind_direction_10m_dominant, shortwave_radiation_sum, et0_fao_evapotranspiration`. The website also offers `temperature_2m_mean`, `precipitation_probability_mean/min`, `cloud_cover_mean/max/min`, `relative_humidity_2m_mean…`, `wind_speed_10m_mean`, `wet_bulb_temperature_2m_*` (medium [S27]). |
| `current` | comma list | no | — | `temperature_2m, relative_humidity_2m, apparent_temperature, is_day, precipitation, rain, showers, snowfall, weather_code, cloud_cover, pressure_msl, surface_pressure, wind_speed_10m, wind_direction_10m, wind_gusts_10m` (+ `uv_index` seen live [S31]). |
| `minutely_15` | comma list | no | — | 15-minute data (mostly Europe/N-America; not useful in AU). |
| `past_days` | int 0–92 | no | 0 | "Return past days of data" — adds whole local days before today. |
| `forecast_days` | int 0–16 | no | 7 | ACCESS-G only reaches 10 days [S32]. |
| `past_hours`, `forecast_hours` | int | no | — | hour-granular alternative. |
| `start_date`, `end_date` | ISO date | no | — | explicit window instead of past/forecast days. |
| `timezone` | string | no | GMT | "Any IANA time zone name is supported. Use `auto` to resolve the local time zone." |
| `timeformat` | `iso8601` \| `unixtime` | no | iso8601 | with `unixtime` all times are epoch seconds (UTC — apply `utc_offset_seconds` yourself). |
| `temperature_unit` | `celsius` \| `fahrenheit` | no | celsius | |
| `wind_speed_unit` | `kmh` \| `ms` \| `mph` \| `kn` | no | kmh | |
| `precipitation_unit` | `mm` \| `inch` | no | mm | |
| `models` | comma list | no | `best_match` | includes **`bom_access_global`** (BOM ACCESS-G, 0.15° ≈ 15 km, hourly, updated every 6 h at 00/06/12/18 Z, 10-day) [S23][S32], `ecmwf_ifs025`, `ncep_gfs_global`, `icon_global`, `ukmo_global_deterministic_10km`, `cma_grapes_global`, `ecmwf_aifs025_single`, `ncep_aigfs025`, … Requesting several models suffixes variables with `_<model>` (medium, memory). |
| `cell_selection` | `land` \| `sea` \| `nearest` | no | land-preferring | keep default for racecourses. |
| `elevation` | float | no | grid | overrides downscaling elevation. |
| `temporal_resolution` | `hourly_3` \| `hourly_6` \| `native` | no | 1-hourly | website option (medium). |
| `apikey` | string | no | — | "Only required for commercial subscriptions." |

### 4.2 Response shape (high — spec [S23] + three real samples [S24][S30][S31])

```jsonc
{
  "latitude": -37.75,                // grid-cell centre actually used (NOT your input; snapped)
  "longitude": 144.875,
  "generationtime_ms": 0.199,
  "utc_offset_seconds": 39600,       // offset of `timezone` at request time
  "timezone": "Australia/Melbourne",
  "timezone_abbreviation": "GMT+11", // seen as "GMT+11"/"GMT+2"/"GMT-4"/"GMT+5:45", not "AEDT"
  "elevation": 19,                   // grid-cell elevation (m)
  "hourly_units": { "time": "iso8601", "precipitation": "mm", "precipitation_probability": "%", "temperature_2m": "°C", "wind_speed_10m": "km/h", "wind_direction_10m": "°" },
  "hourly": {                        // every array has identical length = 24 × (past_days + forecast_days)
    "time": ["2026-10-20T00:00", "2026-10-20T01:00", ...],   // local, no offset; starts at local midnight of (today − past_days)
    "precipitation": [0.0, 0.0, 0.6, ...],                   // float; mm in the hour ENDING at `time`? -> docs: "preceding hour sum" (see §4.3)
    "precipitation_probability": [0, 0, 35, ...],            // integer %
    "temperature_2m": [10.9, ...], "wind_speed_10m": [14.2, ...], "wind_direction_10m": [214, ...]
  },
  "daily_units": { "time": "iso8601", "precipitation_sum": "mm", "sunrise": "iso8601", ... },
  "daily": { "time": ["2026-10-20", ...], "precipitation_sum": [3.0, ...], "sunrise": ["2025-10-25T06:21", ...], "weather_code": [53, ...] },
  "current_units": { "time": "iso8601", "interval": "seconds", "temperature_2m": "°C", ... },
  "current": { "time": "2026-10-08T14:45", "interval": 900, "temperature_2m": 15.6, "is_day": 1, "weather_code": 61, ... }
}
```

Field types per spec: `latitude/longitude/elevation/generationtime_ms` number, `utc_offset_seconds` integer, `timezone/timezone_abbreviation` string; `hourly.time` items are `[string, integer]` (string unless `timeformat=unixtime`); numeric arrays are floats except **integer** arrays `weather_code`, `is_day`, `precipitation_type`; `daily.sunrise/sunset` are strings; `current.interval` is the seconds the current block represents (900) and has **no** `current_units` entry [S23]. **`null` appears inside numeric arrays** when a value is missing (real sample: `cloud_cover_mean: [88, 88, null, 10, …]`) — treat as unknown, not 0 [S24]. Only requested variables appear; `daily.weather_code` appeared without a `daily_units` entry in one real sample [S24]. Units echo the request (`"°F"`, `"inch"`, `"mp/h"`) [S30].

### 4.3 Semantics that matter for RaceLens

* **`precipitation` is an hourly accumulation** ("Total precipitation (rain, showers, snow) sum of the preceding hour") [S6][S27]. Daily `precipitation_sum` = Σ of the local day's 24 hourly values (verified in the constructed fixture). Our `summariseWeather()` sums `rainMm` per local day — consistent.
* **`precipitation_probability`** is a 0–100 integer derived from an **ensemble** (for the BOM model page: "precipitation probability comes from the ACCESS-GE ensemble") [S32]. In the past-days part of the array it is not meaningful (expect 0/100 or null) — ignore it before "now".
* **Past days are model analyses/short forecasts, not gauges.** For "how wet is the track really", prefer BOM `rain_trace` (§7) and use Open-Meteo past data as the cross-check / fallback when the nearest AWS is > ~10 km away or offline.
* **Grid snapping**: `best_match` in Australia is a ~9–11 km global backbone (ECMWF IFS / GFS / ICON) [S28]; ACCESS-G is 0.15°. Coordinates accurate to a few km are plenty (so `low`-confidence venue coordinates are still fine for weather; they are *not* fine for picking the nearest BOM station, where distance matters).
* **BOM open-data caveat**: the Open-Meteo BOM page carries a warning that BOM's "open-data delivery has been temporarily suspended" during BOM's platform upgrade — `models=bom_access_global` may return stale/absent data; always keep `best_match` as primary (medium [S32]).
* **Cross-verification pattern** (fits RaceLens's multi-source rule): call `best_match` **and** `models=bom_access_global,ecmwf_ifs025` (one call, suffixed variables) and compare race-day `precipitation_sum`; disagreement > 5 mm → lower weather confidence.

### 4.4 Recommended calls

1. **Research pass (day before / morning of)** — one call per venue (or one multi-coordinate call for all meetings):
   `GET /v1/forecast?latitude={lat}&longitude={lon}&hourly=precipitation,precipitation_probability,temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code&daily=precipitation_sum,precipitation_hours,precipitation_probability_max,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant&past_days=3&forecast_days=3&timezone={iana}` → fixture `open-meteo-forecast.flemington-2026-10-24.json` (constructed).
2. **Pre-race recheck (≤ 60 min before the jump)** — `current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=precipitation,temperature_2m&forecast_days=1` (+ optionally `models=bom_access_global`) → fixture `open-meteo-forecast.flemington-current-bom_access_global.json` (constructed).
3. Cache responses for ≥ 15 min (`current` is 15-min data; models update hourly at most).

---

## 5. Open-Meteo historical APIs

### 5.1 Archive (reanalysis) — `GET https://archive-api.open-meteo.com/v1/archive` [S5][S6]

* **Required**: `latitude`, `longitude`, `start_date`, `end_date` (ISO dates). "Historical weather data from ERA5 and ERA5-Land reanalysis going back to 1940." Spec servers `archive-api.open-meteo.com`, `customer-archive-api.open-meteo.com`.
* `models` enum: `best_match, era5_seamless, era5, era5_land, ecmwf_ifs, cerra, era5_ensemble, ecmwf_ifs_analysis_long_window`. **Delay**: ERA5/ERA5-Land/ERA5-Ensemble "Daily with 5 days delay"; ECMWF IFS 9 km "every 6 hours with no delay"; IFS long-window "daily with 2 days delay" [S6].
* `hourly` enum (59): `temperature_2m, relative_humidity_2m, dew_point_2m, apparent_temperature, precipitation, rain, snowfall, snow_depth, weather_code, pressure_msl, surface_pressure, cloud_cover(_low/_mid/_high), et0_fao_evapotranspiration, vapour_pressure_deficit, wind_speed_10m, wind_speed_100m, wind_direction_10m, wind_direction_100m, wind_gusts_10m, soil_temperature_0_to_7cm … 100_to_255cm, soil_moisture_0_to_7cm … 100_to_255cm, soil_moisture_index_*, boundary_layer_height, wet_bulb_temperature_2m, total_column_integrated_water_vapour, is_day, sunshine_duration, growing_degree_days_base_0_limit_50, leaf_wetness_probability, wave_*, sea_surface_temperature, shortwave_radiation…`.
* `daily` enum (38): `weather_code, temperature_2m_mean/max/min, apparent_temperature_mean/max/min, sunrise, sunset, daylight_duration, sunshine_duration, precipitation_sum, rain_sum, snowfall_sum, precipitation_hours, wind_speed_10m_max, wind_gusts_10m_max, wind_direction_10m_dominant, shortwave_radiation_sum, et0_fao_evapotranspiration, cloud_cover_mean, dew_point_2m_mean/max/min, relative_humidity_2m_mean/max/min, pressure_msl_mean, wind_speed_10m_mean, wet_bulb_temperature_2m_mean, vapour_pressure_deficit_max, soil_moisture_*_mean, soil_temperature_*_mean`.
* Same optional params as the forecast API (`timezone`, units, `timeformat`, `cell_selection`, `apikey`); `forecast_days` is fixed at 0. **Response shape identical** (`latitude, longitude, elevation, generationtime_ms, utc_offset_seconds, timezone, timezone_abbreviation, hourly, hourly_units, daily, daily_units`); 400 `{error, reason}` [S5]. Fixture: `open-meteo-archive.flemington-2026-10-14_2026-10-18.json` (constructed).
* **Use**: back-testing the drift model against historical track ratings; **not** for the 72 h before tomorrow's meeting (5-day lag) — the docs themselves say to use the Forecast API's `past_days` for recent days [S6].

### 5.2 Historical Forecast API — `GET https://historical-forecast-api.open-meteo.com/v1/forecast` [S7]
Same request/response as §4 but archived model output: "Past weather forecasts from 2022 onwards" (some models 2021), **ACCESS-G available since 2024-01-18**, `start_date/end_date` drive the window. Best choice when you want historical data in exactly the live shape (e.g., to replay what the forecast said the morning of a past meeting).

### 5.3 Previous Runs API — `GET https://previous-runs-api.open-meteo.com/v1/forecast` [S8][S9]
Adds variables `temperature_2m_previous_day1` … `_previous_day7` ("the value that was predicted 24 h before valid time"; `_previous_day0` = current run); data from January 2024 for most models. Useful for a "forecast stability" signal: if race-day rain predicted yesterday ≈ today's, raise confidence. Host confirmed by a 2026 recorded 200 (medium).

---

## 6. Open-Meteo Geocoding API — `GET https://geocoding-api.open-meteo.com/v1/search` [S10]

Params: `name` (required; place or postcode), `count` (default 10, max 100), `language` (default `en`), `format` (`json`|`protobuf`), `countryCode` (ISO-2, e.g. `AU`), `apikey`. Each `results[]` item: `id, name, latitude, longitude, elevation, feature_code, country_code, country, country_id, admin1..admin4, admin1_id..admin4_id, timezone, population, postcodes[]` — "empty fields are not returned". Top-level also `generationtime_ms`. It geocodes **suburbs/towns (GeoNames), not racecourses**: use it only as a fallback when a venue is missing from `venues.json`, and never for BOM-station selection. Fixture: `open-meteo-geocoding.flemington.json` (constructed).

---

## 7. BOM "fwo" JSON observations — `http://www.bom.gov.au/fwo/{PROD}/{PROD}.{wmo}.json`

### 7.1 URL pattern, products, discovery

* Pattern (high, 7 independent parsers): `http://www.bom.gov.au/fwo/{PROD}/{PROD}.{WMO}.json` where `{PROD}` is a state product id and `{WMO}` the 5-digit WMO station number — e.g. `http://www.bom.gov.au/fwo/IDV60901/IDV60901.95936.json` (Melbourne Olympic Park) [S11][S13][S33]. HA built it as `"http://www.bom.gov.au/fwo/{}/{}.{}.json".format(zone, zone, wmo)` [S11]. `https://` also works for `www.bom.gov.au` (product pages are served over https in search results; medium).
* **Products** (all confirmed by live product pages found in search [S34]–[S41]):

| State | All-stations "Weather Observations" | "Capital City Observations" (metro subset) | Station list XML |
|---|---|---|---|
| VIC | `IDV60801` (main `IDV60800`) | `IDV60901` (main `IDV60900`) | `IDV60920` |
| NSW | `IDN60801` | `IDN60901` (Sydney) | `IDN60920` |
| ACT | `IDN60801` | `IDN60903` (Canberra, e.g. `IDN60903.94926`) | `IDN60920` |
| QLD | `IDQ60801` | `IDQ60901` (e.g. `.94576` Brisbane) | `IDQ60920` |
| SA | `IDS60801` | `IDS60901` (e.g. `.94648` Adelaide West Terrace) | `IDS60920` |
| WA | `IDW60801` | `IDW60901` (e.g. `.94608` Perth Metro) | `IDW60920` |
| TAS | `IDT60801` | `IDT60901` (e.g. `.94970` Hobart Ellerslie Rd) | `IDT60920` |
| NT | `IDD60801` | `IDD60901` (e.g. `.94120` Darwin Airport) | `IDD60920` |

  The same station is served under both products where it is in the metro set (Essendon `IDV60901.95866` and `IDV60801.95866` both exist [S36]); **use the `…60801` all-stations product for everything** — it covers every AWS. `IDx60701` is the coastal variant (adds sea/swell) [S35]. Border stations are listed under two states (Mildura, Swan Hill, Albury appear in both `IDV60801` and `IDN60801`) [S42].
* **Station discovery**: (a) the per-state XML `IDx60920.xml` at `http://reg.bom.gov.au/fwo/IDV60920.xml` or `ftp://ftp.bom.gov.au/anon/gen/fwo/IDV60920.xml` — `<station wmo-id=".." lat=".." lon=".." stn-height="..">` with `<period time-utc="..">` children (attributes confirmed [S15][S16]; `bom-id`, `stn-name`, `tz` from memory, low); (b) HA scraped `http://www.bom.gov.au/{state}/observations/{state}all.shtml` and the sitelist zip `ftp.bom.gov.au/anon2/home/ncc/metadata/sitelists/stations.zip`, picking the closest by squared lat/lon distance [S11]; (c) **pre-computed**: `venues.json` already lists the 3 nearest AWS per venue with their JSON URLs (from the 790-station opennem list [S42]).
* **Access / bot protection (medium)**: BOM returns **HTTP 403 with an HTML body** for non-browser `User-Agent`s (bomrang 2021: custom UA → 403, blank UA worked [S12]; later reports: python-requests/curl defaults blocked). Send `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36`, `Accept: application/json,text/plain,*/*`, `Accept-Language: en-AU,en`. Treat any non-JSON body as "blocked" (fixture `bom-fwo-403-forbidden.html`, constructed). Files are regenerated every **30 min** (HA: "BOM provides updated data every 30 minutes", refreshes after 35 min [S11]; product pages say issued every 10 min for some AWS [S36]) — poll every 10–30 min at most, honour `Last-Modified`/`ETag` if present.

### 7.2 Response shape (high — three real files [S25][S26][S43], HA/bomrang/txBOM parsers [S11][S44][S45])

```jsonc
{ "observations": {
    "notice": [ { "copyright": "Copyright Commonwealth of Australia 2026, Bureau of Meteorology. For more information see: http://www.bom.gov.au/other/copyright.shtml http://www.bom.gov.au/other/disclaimer.shtml",
                  "copyright_url": "http://www.bom.gov.au/other/copyright.shtml", "disclaimer_url": "http://www.bom.gov.au/other/disclaimer.shtml", "feedback_url": "http://www.bom.gov.au/other/feedback" } ],
    "header": [ { "refresh_message": "Issued at  6:52 pm EST Wednesday 15 May 2024",   // note the double space before single-digit hours
                  "ID": "IDV60801", "main_ID": "IDV60800", "name": "Essendon Airport", "state_time_zone": "VIC",
                  "time_zone": "EST",                 // BOM's label: EST/EDT = AEST/AEDT; CST/CDT; WST
                  "product_name": "Weather Observations", "state": "Victoria" } ],
    "data": [ /* newest first; 144 rows (= 72 h × 30 min) for an AWS; [] when the station is offline */
      { "sort_order": 0, "wmo": 95866, "name": "Essendon Airport", "history_product": "IDV60801",
        "local_date_time": "24/01:00pm",            // "dd/hh:mmam|pm"
        "local_date_time_full": "20261024130000",   // yyyyMMddHHmmss LOCAL  (HA: strptime "%Y%m%d%H%M%S")
        "aifstime_utc": "20261024020000",           // same instant, UTC
        "lat": -37.7, "lon": 144.9,                 // 1-decimal! use the station list / venues.json for real coords
        "apparent_t": 15.2, "cloud": "-", "cloud_base_m": null, "cloud_oktas": null, "cloud_type_id": null, "cloud_type": "-",
        "delta_t": 4.4, "gust_kmh": 31, "gust_kt": 17, "air_temp": 17.9, "dewpt": 9.1,
        "press": 1017.4, "press_qnh": 1017.4, "press_msl": 1017.6, "press_tend": "-",   // press_tend: "-", "R" (rising), "F", "S"
        "rain_trace": "0.0",                        // STRING, mm since 9am local; "-" when not measured; resets at 09:00
        "rel_hum": 56, "sea_state": "-", "swell_dir_worded": "-", "swell_height": null, "swell_period": null,
        "vis_km": "-", "weather": "-",              // weather: "-", "Fine", "Showers", "Recent precip.", ...
        "wind_dir": "SW",                           // 16-point compass or "CALM" or "-"
        "wind_spd_kmh": 19, "wind_spd_kt": 10 } ] } }
```

Types observed across real files: `sort_order,wmo,rel_hum,wind_spd_kmh,wind_spd_kt,gust_kmh,gust_kt,cloud_base_m,cloud_oktas,cloud_type_id` → integer or `null`; `lat,lon,air_temp,apparent_t,delta_t,dewpt,press,press_qnh,press_msl` → float or `null`; `rain_trace,vis_km,cloud,cloud_type,press_tend,weather,wind_dir,sea_state,swell_dir_worded,local_date_time*,aifstime_utc,name,history_product` → **string** (`"-"` = none; txBOM maps `"-"`/`"None"` → null [S45]); `swell_height,swell_period` → number or null. Key order is stable (constructed Essendon fixture matches the 2013 real file key-for-key). The 32-field list is identical to HA's `SENSOR_TYPES` [S11].

### 7.3 Deriving what RaceLens needs

* **Rain last 72 h (observed)**: rows are every 30 min, newest first. `rain_trace` is cumulative **since 9 am local** and resets at the 09:00 row. 24 h rainfall to now = `rain_trace(now)` + `rain_trace(last row before today's 09:00)`; 72 h = sum of the three 9am-day maxima (the row just before each 09:00 reset) plus today's current value. Rows with `"-"` → unknown (not 0). Cross-check against Open-Meteo `past_days` hourly sums; flag if they differ by > 5 mm.
* **Current conditions for the pre-race recheck**: `data[0]` (`air_temp`, `rel_hum`, `wind_dir`, `wind_spd_kmh`, `gust_kmh`, `rain_trace`, `weather`), freshness from `local_date_time_full` vs now (stale if > 60 min).
* **Wind for race dynamics**: `wind_dir` + `wind_spd_kmh`/`gust_kmh` at the AWS; Flemington's straight-six runs roughly SE→NW, so a strong N/NW wind is a headwind in the straight (venue-specific heuristics belong in the analysis layer).
* **Which station**: `venues.json → bomStations[0]`. On-course AWS exist at **Geelong Racecourse (94857)**, **Canterbury Racecourse (94766)**, Strathalbyn Racecourse (94814), Mortlake Racecourse (94840). Flemington's nearest are Essendon Airport (6.7 km) and Melbourne Olympic Park (7.4 km) — fetch both and average/flag disagreement.
* **Edge cases**: `data: []` (station offline — real Heywood 2024 fixture) → fall back to the next-nearest station; duplicate rows after a 30→10 min cadence change; `sort_order` gaps.

Fixtures: `bom-fwo-observations.REAL-IDV60901.94868-melbourne-2013-03-18.json` (144 rows, real), `…REAL-IDV60801.94864-coldstream-2015-03-24.json` (real, gusts/compass winds, trimmed to 24 rows), `…REAL-IDV60801.94824-heywood-empty-2024-05-15.json` (real, empty data, 2024 header), `…IDV60801.95866-essendon-2026-10-24.json` (constructed, race-day), `bom-fwo-station-list.IDV60920.xml` (constructed), `bom-fwo-403-forbidden.html` (constructed).

---

## 8. BOM app/website API — `https://api.weather.bom.gov.au/v1/…` (unofficial, medium)

Reverse-engineered from the BOM beta website; used by the Home Assistant `bureau_of_meteorology` integration (bremor) [S17][S18] and tonyallan/weather-au [S14]. Endpoints (verbatim from bremor `api doc/API.md`):

| Endpoint | Returns |
|---|---|
| `GET /v1/locations?search={text or "lat,lon"}` | `metadata{response_timestamp, copyright}`, `data[]{geohash (7 chars), id, name, postcode, state}` |
| `GET /v1/locations/{geohash7}` | `data{geohash, timezone, latitude, longitude, marine_area_id, tidal_point, has_wave, id, name, state}` |
| `GET /v1/locations/{geohash6}/observations` | `metadata{issue_time, observation_time}`, `data{temp, temp_feels_like, wind{speed_kilometre, speed_knot, direction}, gust{speed_kilometre, speed_knot}, max_gust, max_temp, min_temp, rain_since_9am, humidity, station{bom_id, name, distance}}` |
| `GET /v1/locations/{geohash6}/forecasts/daily` | `data[7]{rain{amount{min,max,units}, chance}, uv{category,max_index,start_time,end_time}, astronomical{sunrise_time,sunset_time}, date, temp_max, temp_min, extended_text, short_text, icon_descriptor, fire_danger, fire_danger_category, now{is_night,now_label,later_label,temp_now,temp_later} (first day only)}` |
| `GET /v1/locations/{geohash6}/forecasts/hourly` | `data[168]{rain{amount{min,max}, chance}, temp, temp_feels_like, wind{speed_kilometre,speed_knot,direction}, relative_humidity, uv, icon_descriptor, is_night, time}` |
| `GET /v1/locations/{geohash6}/warnings`, `GET /v1/warnings/{id}` | `data[]{id,type,title,short_title,state,warning_group_type,issue_time,expiry_time,phase}`; detail adds `message` (HTML) |

* **Geohash**: locations use 7 characters; observations/forecasts/warnings use the **first 6** (`geohash7[:6]`) [S18]. Flemington (−37.7903, 144.9125) → `r1r1186` / `r1r118` (computed here). Times are UTC ISO strings. `icon_descriptor` values: `sunny, clear, mostly_sunny, partly_cloudy, cloudy, hazy, light_rain, windy, fog, shower, rain, dusty, frost, snow, storm, light_shower, heavy_shower, cyclone, tropical_cyclone` [S18].
* **Headers**: the HA integration sends `User-Agent: MakeThisAPIOpenSource/1.0.0` and works → no browser UA needed (medium). Refresh ≤ once per 5 min [S17]. The `metadata.copyright` text says the API "is owned by the Bureau … You must not use, copy or share it" — personal use only; it can change without notice.
* **New 2025 BOM site API** (`https://api.bom.gov.au/apikey/v1/…`, documented in bremor `NewAPI.md` only, **low**): `GET /locations/places/autocomplete`, `/forecasts/daily/{x}/{y}?timezone=`, `/forecasts/1hourly/{x}/{y}`, `/observations/latest/{station_id}/atm/surf_air?include_qc_results=false` (fields `stn.identity{bom_stn_num,bom_stn_name,wmo_stn_id}`, `obs.precip.since_0900lct_total_mm`, `obs.temp.dry_bulb_1min_cel`, `obs.wind.speed_10m_mps/dirn_10m_ord/gust_speed_10m_max_mps`), `/warnings/list?area_type=coordinate&area_code={lon},{lat}` [S19]. Treat as a watch item — the fwo JSON (§7) is the stable path.

Fixtures (all constructed from the documented fields): `bom-api-weather.locations-search.flemington.json`, `…observations.flemington.json`, `…forecasts-daily.flemington.json`, `…forecasts-hourly.flemington.json`.

---

## 9. BOM Daily Weather Observations (DWO) — monthly station tables (medium)

HTML pages `https://www.bom.gov.au/climate/dwo/{YYYYMM}/html/IDCJDW{code}.{YYYYMM}.shtml` exist for stations near racecourses and were seen in search results: `IDCJDW3050` Melbourne (Olympic Park) [S35], `IDCJDW3026` Essendon Airport [S36], `IDCJDW3030` Geelong Racecourse [S46], `IDCJDW2025` Canterbury Racecourse [S47], `IDCJDW2124` Sydney Observatory Hill [S37], `IDCJDW8014` Darwin [S40], `IDCJDW2801` Canberra [S41]. Each gives one row per day of the current month with **Rainfall (mm) = 24 h to 9 am**, min/max temp, 9am/3pm wind and pressure. The CSV twin at `…/text/IDCJDW{code}.{YYYYMM}.csv` (path from memory, medium) starts with ~4 quoted note lines, a blank line, then a header row beginning with an empty column (`,"Date","Minimum temperature (°C)","Maximum temperature (°C)","Rainfall (mm)",…`). Browser UA required as in §7. Good as a third, slow-changing rainfall source for the 3 days before a meeting (updated daily ~05:30 UTC). Fixture: `bom-dwo-daily.IDCJDW3026.202610.essendon.csv` (constructed).

---

## 10. Venue table — `research/fixtures/weather/venues.json` (59 entries)

Built by `venues_build.py`/`gen_fixtures.py` (scratchpad). Each entry: `key, name, aliases[], state, timezone, timezoneNote, lat, lon, surface, coord{source, confidence, description, coordCheck{locality, localityCentroid, postcodes, distanceKm}}, bomStations[≤3]{name, bomSiteId, wmoId, distanceKm, lat, lon, fwoProduct, fwoJsonUrl, fwoJsonUrlHttps, fwoPageUrl}, tab{venueMnemonic, confidence, evidence}, notes`. Nearest stations were computed by haversine from the 790-station opennem list [S42] (coordinates to 2 dp → distances ±1 km). Locality centroids from matthewproctor/australianpostcodes [S48] were used only to sanity-check memory coordinates (all within 6.5 km except three false matches on duplicate locality names, noted per venue).

| Venue | State | TZ | Lat, Lon | Coord conf. | Nearest BOM AWS (km) → fwo JSON | TAB mnemonic |
|---|---|---|---|---|---|---|
| Flemington | VIC | Melbourne | −37.79028, 144.91250 | high [S49] | Essendon Airport 6.7 → `IDV60801.95866`; Melbourne (Olympic Park) 7.4 → `IDV60801.95936` | **FLM** (high) |
| Caulfield | VIC | Melbourne | −37.881, 145.040 | high [S50] | St Kilda Harbour 7.4 → `.95864`; Olympic Park 7.7 → `.95936`; Moorabbin 12.2 → `.94870` | — |
| Moonee Valley | VIC | Melbourne | −37.7656, 144.9300 | medium | Essendon Airport 4.3 → `.95866` | — |
| Sandown (Hillside/Lakeside) | VIC | Melbourne | −37.95222, 145.1638 | high (grandstand) [S51] | Moorabbin Airport 6.4 → `.94870`; Scoresby 12.4 → `.95867` | — |
| Randwick | NSW | Sydney | −33.91083, 151.23028 | high [S52] | Fort Denison 5.7 → `IDN60801.94769`; Observatory Hill 6.3 → `.94768`; Sydney Airport 7.1 → `.94767` | RAN (low) |
| Rosehill | NSW | Sydney | −33.82417, 151.02667 | high [S53] | Parramatta North 3.8 → `.94764`; Sydney Olympic Park 4.1 → `.95765` | — |
| Warwick Farm | NSW | Sydney | −33.91083, 150.94528 | high [S54] | Bankstown Airport 3.4 → `.94765` | — |
| Canterbury | NSW | Sydney | −33.906824, 151.115398 | high [S55] | **Canterbury Racecourse AWS 0.6 → `.94766`** | — |
| Kembla Grange | NSW | Sydney | −34.4700, 150.8181 | medium (station proxy) [S56] | Port Kembla 8.4 → `.95745`; Shellharbour Airport 10.3 → `.95748` | — |
| Newcastle (Broadmeadow) | NSW | Sydney | −32.92944, 151.74111 | high [S57] | Newcastle University 5.3 → `.94781`; Nobbys 5.6 → `.94774` | — |
| Gosford | NSW | Sydney | −33.4290, 151.3240 | low | Gosford AWS 3.6 → `.94782` | GOS (low; greyhound code) |
| Hawkesbury (Clarendon) | NSW | Sydney | −33.6080, 150.7840 | medium [S58] | Richmond RAAF 1.0 → `.95753` | HAW (low) |
| Eagle Farm | QLD | Brisbane | −27.428337, 153.067130 | medium [S59] | Brisbane 6.3 → `IDQ60801.94576`; Brisbane Aero 7.5 → `.94578` | — |
| Doomben | QLD | Brisbane | −27.4263194, 153.0760333 | high [S60] | Brisbane Aero 6.7 → `.94578`; Brisbane 6.9 → `.94576` | DBN (low) |
| Gold Coast (Bundall) | QLD | Brisbane | −28.0029, 153.4050 | high [S61] | Gold Coast Seaway 7.4 → `.94580` | — |
| Sunshine Coast (Corbould Park) | QLD | Brisbane | −26.7730, 153.0680 | low | Sunshine Coast Airport 19.4 → `.94569`; Nambour 19.5 → `.95572` | **SSC** (medium) |
| Ipswich (Bundamba) | QLD | Brisbane | −27.6090, 152.8130 | low | Amberley AMO 10.4 → `.94568` | — |
| Toowoomba (Clifford Park) | QLD | Brisbane | −27.5450, 151.9700 | low | Toowoomba Airport 5.9 → `.95551` | — |
| Morphettville | SA | Adelaide | −34.9790, 138.5430 | low | Adelaide Airport 3.8 → `IDS60801.94672`; West Terrace 6.4 → `.94648` | — |
| Murray Bridge (Gifford Hill) | SA | Adelaide | −35.1575, 139.2600 | low | Murray Bridge 4.2 → `.95812`; Pallamana 11.2 → `.95818` | — |
| Gawler | SA | Adelaide | −34.6250, 138.7350 | low | Roseworthy 13.7 → `.95671`; Edinburgh RAAF 14.1 → `.95676` | — |
| Ascot | WA | Perth | −31.9330, 115.9270 | low | Perth Airport 5.0 → `IDW60801.94610`; Perth Metro 5.6 → `.94608` | — |
| Belmont | WA | Perth | −31.9560, 115.8930 | low | Perth Metro 4.6 → `.94608` | — |
| Pinjarra | WA | Perth | −32.6340, 115.8900 | low | Dwellingup 18.0 → `.94620`; Mandurah 21.1 → `.94605` | — |
| Bunbury | WA | Perth | −33.3600, 115.6740 | low | Bunbury 3.2 → `.94604` | — |
| Hobart (Elwick) | TAS | Hobart | −42.8245, 147.2660 | low | Hobart (Ellerslie Rd) 9.0 → `IDT60801.94970`; kunanyi 8.7 (mountain, ignore) | — |
| Launceston (Mowbray) | TAS | Hobart | −41.4120, 147.1510 | low | Launceston (Ti Tree Bend) 2.7 → `.94969` | — |
| Canberra (Thoroughbred Park) | ACT | Sydney | −35.2590, 149.1335 | low | Canberra Airport 8.3 → `IDN60801.94926` | — |
| Darwin (Fannie Bay) | NT | Darwin | −12.4230, 130.8420 | low | Darwin Airport 5.2 → `IDD60801.94120`; Darwin NTC 5.3 → `.95122` | — |
| Alice Springs (Pioneer Park) | NT | Darwin | −23.7560, 133.8700 | low | Alice Springs Airport 5.3 → `.94326` | — |
| Geelong | VIC | Melbourne | −38.1700, 144.3800 | high (on-course AWS) | **Geelong Racecourse 0.0 → `IDV60801.94857`** | — |
| Ballarat (Dowling Forest) / Ballarat Synthetic | VIC | Melbourne | −37.4780, 143.7960 | low | Ballarat Aerodrome 3.6 → `.94852` | — |
| Bendigo | VIC | Melbourne | −36.7120, 144.3080 | low | Bendigo Airport 3.7 → `.94855` | — |
| Cranbourne | VIC | Melbourne | −38.1190, 145.2850 | low | Frankston (Ballam Park) 11.5 → `.94876` | — |
| Pakenham (Tynong) / Pakenham Synthetic | VIC | Melbourne | −38.0930, 145.6220 | low | Nilma North (Warragul) 32.5 → `.99806` — **no close AWS; rely on Open-Meteo** | — |
| Mornington | VIC | Melbourne | −38.2290, 145.0740 | low | Frankston Beach 9.7 → `.94871` | — |
| Sale | VIC | Melbourne | −38.0870, 147.0620 | low | East Sale Airport 7.0 → `.95907` | — |
| Kilmore | VIC | Melbourne | −37.3030, 144.9620 | low | Kilmore Gap 8.6 → `.94860` | — |
| Seymour | VIC | Melbourne | −37.0280, 145.1390 | low | Puckapunyal Lyon Hill 12.6 → `.94858`; Mangalore 16.0 → `.94874` | — |
| Wangaratta | VIC | Melbourne | −36.3760, 146.3030 | low | Wangaratta Aero 4.9 → `.94889` | — |
| Mildura | VIC | Melbourne | −34.2300, 142.1670 | low | Mildura Airport 7.2 → `.94693` (also in `IDN60801`) | — |
| Swan Hill | VIC | Melbourne | −35.3460, 143.5400 | low | Swan Hill Aerodrome 3.8 → `.94843` | — |
| Warrnambool | VIC | Melbourne | −38.3730, 142.4560 | low | Warrnambool Airport 9.2 → `.94837` | — |
| Hamilton | VIC | Melbourne | −37.7540, 142.0170 | low | Hamilton Airport 12.2 → `.94829` | — |
| Echuca | VIC | Melbourne | −36.1400, 144.7420 | low | Echuca Aerodrome 2.7 → `.94861` | — |
| Kyneton | VIC | Melbourne | −37.2470, 144.4460 | low | Redesdale 26.1 → `.94859` — rely on Open-Meteo | — |
| Werribee | VIC | Melbourne | −37.9060, 144.6650 | low | Laverton RAAF 9.8 → `.94865` | — |
| Yarra Valley (Yarra Glen) | VIC | Melbourne | −37.6650, 145.3700 | low | Coldstream 7.1 → `.94864` | — |
| Moe | VIC | Melbourne | −38.1660, 146.2520 | low | Latrobe Valley Airport 19.7 → `.94891` | — |
| Traralgon | VIC | Melbourne | −38.2050, 146.5650 | low | Latrobe Valley Airport 8.3 → `.94891` | — |
| Bairnsdale | VIC | Melbourne | −37.8200, 147.6320 | low | Bairnsdale Airport 8.6 → `.94912` | — |
| Donald | VIC | Melbourne | −36.3680, 142.9640 | low | Charlton 34.2 → `.94839` — rely on Open-Meteo | — |
| Horsham | VIC | Melbourne | −36.6980, 142.1940 | low | Horsham Aerodrome 3.8 → `.95839` | — |
| Ararat | VIC | Melbourne | −37.2860, 142.9480 | low | Ararat Prison 2.9 → `.94834` | — |
| Stawell | VIC | Melbourne | −37.0420, 142.7700 | low | Stawell Aerodrome 4.1 → `.94836` | — |
| Benalla | VIC | Melbourne | −36.5420, 145.9960 | low | Benalla Airport 1.0 → `.94884` | — |
| Wodonga | VIC | Melbourne | −36.1370, 146.8800 | low | Albury Airport 9.7 → `IDV60801.95896` / `IDN60801.95896` | — |

**TAB mnemonics**: only `FLM` is proven by a recorded response (2019 race card [S62]); `SSC` from a recorded 2023 runner response [S63]; `RAN`, `HAW`, `DBN`, `GOS` are low-confidence community/test values (the tab-mcp test fixture that uses `RAN` also uses the wrong `FLE` for Flemington [S64]). The TAB historical-results-service uses **single-letter meeting codes** (`S, M, C, E, P, …`) that change day to day — not venue mnemonics [S65]. **Resolve mnemonics at runtime** from `GET /v1/tab-info-service/racing/dates/{date}/meetings?jurisdiction=VIC` by matching `meetingName`/`location` (upper-case, e.g. `"FLEMINGTON"`, `"SUNSHINE COAST"`) against `aliases[]`, then cache per venue.

---

## 11. How RaceLens should combine these (proposed adapter behaviour)

1. **Resolve venue** → `venues.json` entry (by alias, case-insensitive; strip sponsor prefixes like `Sportsbet-`). Unknown venue → Open-Meteo geocoding (`countryCode=AU`) and nearest station from the IDx60920 XML; mark coordinate confidence `low`.
2. **Observed rain (primary for drift)**: fetch `bomStations[0]` fwo JSON (browser UA). Compute rain since 9am today, and the three previous 9am-day totals; if `data` is empty, stale (> 90 min) or the station is > 12 km away, also fetch `bomStations[1]`. Record `source: bom:IDV60801.95866`, distance and age in the evidence string.
3. **Modelled rain + forecast (always)**: Open-Meteo `best_match` with `past_days=3&forecast_days=3` → `WeatherHour[]` (`time`, `rainMm=precipitation`, `rainProb=precipitation_probability`, `tempC=temperature_2m`, `windKmh=wind_speed_10m`, `windDir=wind_direction_10m`) → `summariseWeather()`. Where BOM observed 72 h rain exists, **override the past-day hourly totals with the gauge figure** (scale the hourly shape) and note the delta between gauge and model as a verification signal.
4. **Second model opinion**: same call with `models=bom_access_global` (and/or `ecmwf_ifs025`); if race-day `precipitation_sum` differs from `best_match` by > 5 mm or probability by > 40 points, drop weather confidence and say so in the summary.
5. **BOM forecast text (optional, display only)**: api.weather.bom.gov.au daily `extended_text` + `rain.chance` + `rain.amount.min/max` for the venue geohash — humans trust BOM wording; show it alongside.
6. **Pre-race recheck** (T-60 and T-15 min): Open-Meteo `current` + BOM `data[0]`; if rain has started (`current.precipitation > 0` or `rain_trace` increased since last poll), re-run the drift and flag "track may be downgraded".
7. **Caching/limits**: Open-Meteo responses 15 min; BOM fwo 10 min; never more than 1 request/s to either; back off 60 s on 429/403.
8. **Attribution**: show "Weather data by Open-Meteo.com" and "Observations © Bureau of Meteorology" in the UI.

---

## 12. Fixtures written (`research/fixtures/weather/`)

| File | Real / constructed | What it shows |
|---|---|---|
| `venues.json` | compiled | 59 venues (incl. Ballarat/Pakenham Synthetic) with coordinates, tz, nearest BOM stations + URLs, TAB mnemonic evidence, aliases; embedded `sampleOpenMeteoRequest`/`sampleOpenMeteoResponse` |
| `open-meteo-forecast.flemington-2026-10-24.json` | constructed | the exact RaceLens request (hourly precipitation/probability/temp/wind, daily sums, `past_days=3`, Melbourne tz): 240 hourly rows 2026-10-20…29, 10 daily rows; 72 h lead-up 6.3 mm, race-day 0.6 mm |
| `open-meteo-forecast.flemington-current-bom_access_global.json` | constructed | `current` block (`interval: 900`) + 24 h hourly with `models=bom_access_global` |
| `open-meteo-forecast.REAL-melbourne-daily-2025-10-25.json` | **real** [S24] | Australia/Melbourne daily response: `utc_offset_seconds 39600`, `GMT+11`, `null` in arrays, sunrise/sunset strings |
| `open-meteo-forecast.REAL-nyc-hourly-legacy-names-2025-06-05.json` | **real** [S30] | hourly `precipitation_probability`, legacy aliases echoed, imperial units |
| `open-meteo-forecast.REAL-berlin-current-hourly-daily-2026-10-08.json` | **real** [S31] | `current` + 168 h hourly + daily in one response |
| `open-meteo-archive.flemington-2026-10-14_2026-10-18.json` | constructed | archive API daily + hourly, 5-day-lag note |
| `open-meteo-error-400.json`, `open-meteo-error-429.json` | schema real / wording: 429 verbatim, 400 low | error bodies |
| `open-meteo-geocoding.flemington.json` | constructed | geocoding result fields |
| `bom-fwo-observations.REAL-IDV60901.94868-melbourne-2013-03-18.json` | **real** [S25] | full 144-row fwo JSON (capital-city product) |
| `bom-fwo-observations.REAL-IDV60801.94864-coldstream-2015-03-24.json` | **real**, trimmed [S26] | all-stations product, gusts, compass winds, `press_msl` |
| `bom-fwo-observations.REAL-IDV60801.94824-heywood-empty-2024-05-15.json` | **real** [S43] | 2024 header, `data: []` |
| `bom-fwo-observations.IDV60801.95866-essendon-2026-10-24.json` | constructed | race-day Essendon (nearest to Flemington), 144 rows, 9am `rain_trace` reset, key order identical to the real file |
| `bom-fwo-station-list.IDV60920.xml` | constructed | station-list XML shape (3 stations) |
| `bom-fwo-403-forbidden.html` | constructed | blocked-UA response |
| `bom-api-weather.locations-search/observations/forecasts-daily/forecasts-hourly.flemington.json` | constructed | api.weather.bom.gov.au shapes (fields from bremor API.md) |
| `bom-dwo-daily.IDCJDW3026.202610.essendon.csv` | constructed | DWO monthly CSV shape |

All constructed files carry a top-level `_fixtureNote` (JSON) or a leading comment (HTML/XML/CSV); real files carry a `_fixtureNote` naming the repo they were copied from (otherwise byte-identical).

---

## 13. Gotchas checklist

* Open-Meteo `time` is local **only if** you pass `timezone=`; otherwise GMT. `utc_offset_seconds` changes across the DST switch (first Sunday of October) — a meeting on 2026-10-04 straddles it.
* `precipitation` can be `null` (missing) → not 0. `precipitation_probability` before "now" is meaningless.
* Open-Meteo returns the **grid-cell** `latitude/longitude/elevation`, not yours — don't "verify" coordinates against them.
* Multi-coordinate requests return an **array**; single requests an object. Branch on `Array.isArray`.
* 429 bodies put `reason` before `error`; 400 bodies the other way round — parse by key, not position.
* BOM `rain_trace` is a **string** and resets at 09:00 local; `"-"` ≠ 0; `lat/lon` in rows are 1-decimal.
* BOM `time_zone: "EST"` means AEST, not US Eastern.
* BOM 403s are HTML — check `Content-Type` before `JSON.parse`. Rotate to the next station when `data` is `[]`.
* Border stations appear under two state products; dedupe by `wmo`.
* Several Victorian provincials (Pakenham, Kyneton, Donald, Moe, Pinjarra) have no AWS within 15 km — weight Open-Meteo higher there and say so.
* Venue coordinates marked `low` are fine for the ~10 km weather grid but should be confirmed before any finer use (e.g., wind direction relative to the straight).

---

## 14. Sources

| # | URL | Used for |
|---|---|---|
| S1 | https://github.com/open-meteo/open-meteo (README) | free/non-commercial terms, "contact us above 10 000 requests/day", attribution text |
| S2 | https://raw.githubusercontent.com/open-meteo/open-meteo/main/openapi/forecast.yml (header) | CC BY 4.0 licence, termsOfService link |
| S3 | https://open-meteo.com/en/terms (search snippet) · https://openmeteo.substack.com/p/weather-data-for-multiple-locations | 10 000/day, 5 000/h, 600/min limits |
| S4 | https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Helper/Vapor/RateLimiter.swift (code-search fragment) | verbatim "Minutely API request limit exceeded…", weighted counting, free-API host check |
| S5 | https://raw.githubusercontent.com/open-meteo/open-meteo/main/openapi/historical-weather.yml | archive params, enums, response, 400 schema |
| S6 | https://raw.githubusercontent.com/open-meteo/open-meteo-website/main/src/routes/en/docs/historical-weather-api/+page.svelte | ERA5 5-day delay, "use Forecast API past_days", precipitation = preceding-hour sum |
| S7 | https://raw.githubusercontent.com/open-meteo/open-meteo-website/main/src/routes/en/docs/historical-forecast-api/+page.svelte | host, 2022 coverage, ACCESS-G since 2024-01-18 |
| S8 | https://raw.githubusercontent.com/open-meteo/open-meteo-website/main/src/routes/en/docs/previous-runs-api/+page.svelte | `_previous_dayN` naming, Jan-2024 start |
| S9 | github.com/louistouquet/PowAtlas docs/sources/open-meteo.md (code-search fragment) | recorded `previous-runs-api.open-meteo.com` 200 and verbatim daily-limit 429 body (2026-10-21) |
| S10 | https://raw.githubusercontent.com/open-meteo/open-meteo-website/main/src/routes/en/docs/geocoding-api/+page.svelte | geocoding params and result fields |
| S11 | https://raw.githubusercontent.com/home-assistant/core/0.100.0/homeassistant/components/bom/sensor.py | `_RESOURCE` URL template, 32 `SENSOR_TYPES`, `observations.data[0]` newest, strptime format, 30-min update, station discovery |
| S12 | https://github.com/ropensci/bomrang/issues/137 | 2021: custom UA → 403, blank UA worked |
| S13 | https://pypi.org/project/weather-au/0.0.3/ · https://github.com/tonyallan/weather-au | `IDV60901.95936.json` example URL, BOM copyright quote, api.weather.bom.gov.au mention |
| S14 | same as S13 | BOM copyright/no-commercial-use text |
| S15 | https://raw.githubusercontent.com/Kevin-McIsaac/paragliding_site_federation/main/src/bom.py | `http://reg.bom.gov.au/fwo/{IDx60920}.xml`, `<station wmo-id lat lon stn-height>`, `<period time-utc>` |
| S16 | https://cfs.geohub.sa.gov.au/…/Australia_Weather_Observations/MapServer/0/iteminfo (search snippet) | `ftp://ftp.bom.gov.au/anon/gen/fwo//IDS60920.xml` station lists per state |
| S17 | https://github.com/bremor/bureau_of_meteorology (README) · PyBoM/const.py | `URL_BASE`, `/observations`, `/forecasts/daily`, `/forecasts/hourly`, `/warnings`, icon descriptors, 5-min refresh |
| S18 | https://raw.githubusercontent.com/bremor/bureau_of_meteorology/master/custom_components/bureau_of_meteorology/PyBoM/collector.py · `api doc/API.md` | geohash 7→6, User-Agent `MakeThisAPIOpenSource/1.0.0`, all response field names |
| S19 | https://raw.githubusercontent.com/bremor/bureau_of_meteorology/master/api%20doc/NewAPI.md | new `api.bom.gov.au/apikey/v1` endpoints and fields |
| S20 | BOM DWO pages found in search: IDCJDW3050, IDCJDW3026, IDCJDW3030, IDCJDW2025, IDCJDW2124, IDCJDW8014, IDCJDW2801 | existence/naming of monthly daily-observation products |
| S21 | github.com/ContextLab/hypertools notes/audit/climate_hierarchy_feasibility.md (fragment) | verbatim minutely/hourly 429 bodies |
| S22 | github.com/zimmertr/bluebird docs/decisions/0203 … · github.com/slayer8366/Forager scripts/verify-open-meteo-historical-fields.sh · github.com/marola-dev/marola-app docs (fragments) | per-IP daily quota on shared egress, concurrent-request behaviour |
| S23 | https://raw.githubusercontent.com/open-meteo/open-meteo/main/openapi/forecast.yml | every parameter, enum, response property/type, 400 schema |
| S24 | https://raw.githubusercontent.com/mt-empty/pi-inky-weather-epd/master/misc/showcase_fixtures/gif/open_meteo_daily_forecast.json | REAL Melbourne daily response |
| S25 | https://raw.githubusercontent.com/benmcevoy/benmcevoy.github.io/master/projects/metro-weather/observations.json (+ sydney_observations.json) | REAL IDV60901/IDN60901 JSON, 144 rows, notice/header |
| S26 | https://raw.githubusercontent.com/aabs/meteogram/master/coldstream.observations.json | REAL IDV60801 JSON (147 rows) |
| S27 | https://raw.githubusercontent.com/open-meteo/open-meteo-website/main/src/routes/en/docs/options.ts | full hourly/daily/current/model option lists incl. `bom_access_global`, `past_days` 0–92, `cell_selection`, `temporal_resolution` |
| S28 | https://raw.githubusercontent.com/open-meteo/open-meteo-website/main/src/routes/en/docs/+page.svelte | best_match description, forecast_days 16, timezone auto |
| S29 | https://openmeteo.substack.com/p/weather-data-for-multiple-locations (search snippet) + spec "Multiple coordinates can be comma separated" | multi-location requests |
| S30 | https://raw.githubusercontent.com/climate-cache/nyc-weather/main/2025/06/NYC_2025-06-05.json | REAL hourly response, legacy names, imperial units |
| S31 | https://raw.githubusercontent.com/georgevibing/conch-agent/main/apps/server/src/research/fixtures/weather-forecast.json | REAL current+hourly+daily response |
| S32 | https://raw.githubusercontent.com/open-meteo/open-meteo-website/main/src/routes/en/docs/bom-api/+page.svelte · https://openmeteo.substack.com/p/new-models-bom-cma-meteofrance-and | ACCESS-G 0.15°, 6-hourly, 10 days, probability from ACCESS-GE, open-data suspension notice |
| S33 | https://raw.githubusercontent.com/claws/txBOM/master/README.md · txbom/observations.py | `IDS60901.94675.json` example, every notice/header/data key, 30-min publish cadence |
| S34 | https://www.bom.gov.au/products/IDQ60901/IDQ60901.94576.shtml | Brisbane 94576 |
| S35 | https://www.bom.gov.au/products/IDV60901/IDV60901.95936.shtml · IDV60801.95936 · IDV60701.95936 · climate/dwo IDCJDW3050 | Melbourne (Olympic Park) 95936 / site 086338; coastal product |
| S36 | https://www.bom.gov.au/products/IDV60901/IDV60901.95866.shtml · IDV60801.95866 · IDCJDW3026 | Essendon Airport 95866 / site 086038, 10-min issue |
| S37 | https://www.bom.gov.au/products/IDN60901/IDN60901.94768.shtml · IDN60801.94768 · IDN60901.95765 | Sydney Observatory Hill 94768 / site 066214; Sydney Olympic Park 95765 |
| S38 | https://www.bom.gov.au/products/IDS60901/IDS60901.94648.shtml · IDS60801.94648 · IDS60901.95812 | Adelaide West Terrace 94648; Murray Bridge 95812 |
| S39 | https://www.bom.gov.au/products/IDW60901/IDW60901.94608.shtml · IDW60801.94610 · IDW60901.94151 | Perth Metro 94608 (site 009225); Perth Airport moved to 94151 |
| S40 | https://www.bom.gov.au/products/IDT60901/IDT60901.94970.shtml · https://www.bom.gov.au/products/IDD60901/IDD60901.94120.shtml | Hobart (Ellerslie Rd) 94970 / site 094029; Darwin Airport 94120 / site 014015 |
| S41 | https://www.bom.gov.au/products/IDN60903/IDN60903.94926.shtml | Canberra Airport 94926 / site 070351, ACT product IDN60903 |
| S42 | https://raw.githubusercontent.com/opennem/opennem/master/opennem/data/bom_stations.json | 790 stations: name_full, code (BOM site), lat/lng, json_feed (IDx60801 URLs); duplicates across states |
| S43 | https://raw.githubusercontent.com/BunniYubel/CloudComputingA2/master/Data/IDV60801-94824 | REAL 2024 fwo JSON with empty data |
| S44 | https://raw.githubusercontent.com/ropensci/bomrang/master/R/get_current_weather.R | `observations$data` parsing, `%Y%m%d%H%M%OS` time format, url field per station |
| S45 | https://raw.githubusercontent.com/claws/txBOM/master/txbom/observations.py | "-"/"None" → null handling |
| S46 | https://www.bom.gov.au/products/IDV60901/IDV60901.94857.shtml (+ IDV60801.94857, IDCJDW3030) | Geelong Racecourse AWS 94857 / site 087184 |
| S47 | https://www.bom.gov.au/products/IDN60901/IDN60901.94766.shtml (+ IDN60801.94766, IDCJDW2025) | Canterbury Racecourse AWS 94766 / site 066194 |
| S48 | https://raw.githubusercontent.com/matthewproctor/australianpostcodes/master/australian_postcodes.csv | locality centroids for coordinate sanity checks |
| S49 | https://en.wikipedia.org/wiki/Flemington_Racecourse (search snippet) | 37°47′25″S 144°54′45″E |
| S50 | https://en.wikipedia.org/wiki/Caulfield_Racecourse (snippet) | 37.881°S 145.040°E |
| S51 | https://en.wikipedia.org/wiki/List_of_places_on_the_Victorian_Heritage_Register_in_the_City_of_Greater_Dandenong (snippet) | Sandown Park Racecourse grandstand 37°57′08″S 145°09′50″E |
| S52 | https://en.wikipedia.org/wiki/Randwick_Racecourse (snippet) | 33°54′39″S 151°13′49″E |
| S53 | https://en.wikipedia.org/wiki/Rosehill_Gardens_Racecourse (snippet) | 33°49′27″S 151°01′36″E |
| S54 | https://en.wikipedia.org/wiki/Warwick_Farm_Racecourse (snippet) | 33°54′39″S 150°56′43″E |
| S55 | https://en.wikipedia.org/wiki/Canterbury_Park_Racecourse (snippet) | 33.906824°S 151.115398°E |
| S56 | https://en.wikipedia.org/wiki/Kembla_Grange_railway_station (snippet) | station 34°28′12″S 150°49′05″E "across the road" from the racecourse |
| S57 | https://en.wikipedia.org/wiki/Broadmeadow_Racecourse (snippet) | 32°55′46″S 151°44′28″E |
| S58 | https://en.wikipedia.org/wiki/Clarendon_railway_station (snippet) | 33°36′32″S 150°47′17″E, opened as "Hawkesbury Racecourse" |
| S59 | https://mobile.translink.com.au/plan-your-journey/event-transport/1068901 (snippet) | Eagle Farm Racecourse marker −27.428337, 153.067130 |
| S60 | https://en.wikipedia.org/wiki/Doomben_Racecourse (snippet) | 27°25′34.75″S 153°4′33.72″E |
| S61 | https://en.wikipedia.org/wiki/Gold_Coast_Turf_Club · https://en.wikipedia.org/wiki/Bundall,_Queensland (snippets) | 28.0029°S 153.4050°E / 28.005°S 153.408°E |
| S62 | research/fixtures/tab/race_2019-04-25_R_FLM_1_paying_real.json (from https://github.com/go-swagger/go-swagger/issues/1932) | `venueMnemonic: "FLM"`, `meetingName: "FLEMINGTON"` |
| S63 | research/fixtures/tab/runner_2023-09-24_R_SSC_1_real.json (from https://github.com/mattcs2401/RaceDay) | `SSC` Sunshine Coast |
| S64 | https://raw.githubusercontent.com/bencousins22/tab-mcp/main/tests/conftest.py · github.com/DanielTomaro13/sportsdata-agents tests/integration/test_race_form.py | `RAN` (and wrong `FLE`, `RAND`) in test fixtures |
| S65 | https://raw.githubusercontent.com/xx36Mostafa/horse-racing-ml-pipeline/main/racing-apis/2025-01/2025-01-04.json (+ 01-01, 01-08, 01-25) | historical-results-service single-letter meeting codes |
| S66 | https://raw.githubusercontent.com/Kelvin1761/Kelvin-Agents/main/.agents/archive/au_retired_meeting_intel_20260821/generate_meeting_intel.py | independent VIC/NSW venue lat/lon table (used as a second opinion; its Sandown/Pakenham/Mornington points are off by 4–9 km) |
