# Fixtures for source `racingaustralia` (Racing Australia "Free Fields", racingaustralia.horse)

Documentation and evidence: `research/racingaustralia.md`. Every HTML file starts with a comment stating its provenance; every JSON file
carries a top-level `_fixtureNote`. **Three pages are REAL captures** (copied from public GitHub repos that captured the live site);
everything else is CONSTRUCTED for Flemington 2026-10-24 to match the exact regexes/selectors used by public parsers of the live site.
Nothing in this directory was fetched live by the RaceLens researcher (the research container cannot reach racingaustralia.horse).

| File | Models | Provenance / confidence |
|---|---|---|
| `Results.aspx-REAL-thevalley-2025-10-25.html` | `GET /FreeFields/Results.aspx?Key=2025Oct25,VIC,The Valley` - whole-meeting results page (4 of 10 races kept by the capturing author) | **REAL** (Umanewsbot, captured 2026-09-27). Contains `DQ`, `SB`, empty-Finish scratched rows, `Official Comments`, GROUP 1/2, `(NZ)`/`(IRE)` suffixes, `$2.25F` |
| `Results.aspx-REAL-caulfield-2025-10-18-race7.html` | same page type, one race (Thousand Guineas) | **REAL** (Wayback snapshot republished by Umanewsbot; archive prefixes stripped by sibling research) |
| `Results.aspx-REAL-not-available-flemington-2025-11-04.html` | `Results.aspx` for a meeting outside the ~11-month retention window / not yet published: HTTP 200 + "Results for this meeting are not currently available." | **REAL** (Umanewsbot) |
| `Group_ListedRaceDates-REAL-2025-2026-trimmed.html` | `GET /arb/Group_ListedRaceDates/2025-2026.aspx` black-type calendar (`table.tableizer-table`) | **REAL**, trimmed to 9 rows (Umanewsbot) |
| `Group_ListedRaceDates-REAL-404-2026-2027.html` | the ASP.NET 404 page served before a season table exists | **REAL** (Umanewsbot) |
| `Form.aspx-flemington-2026-10-24-constructed.html` | `GET /FreeFields/Form.aspx?Key=2026Oct24,VIC,Flemington` (2 races, 8 runners: pedigree, gear, records, run lines, trial/jump-out, emergency, scratching, apprentice claim) | constructed; **parses with the unmodified KaiYingWinning `ra.js`, horseride cheerio selectors, Bookie + tmstipping regexes** (high for the parts those parsers read) |
| `Acceptances.aspx-flemington-2026-10-24-constructed.html` | `GET /FreeFields/Acceptances.aspx?Key=...` (No / Horse / Trainer / Jockey / Barrier / Weight / Probable Weight / Penalty / Hcp Rating / Last 10) | constructed; passes a 1:1 port of Kelvin-Agents `acceptances()` (medium) |
| `ozracing-Acceptances.aspx-flemington-2026-10-24-constructed.html` | `GET /ozracing/Acceptances.aspx?key=...` bare 22 KB variant | constructed from RatterAU/Bookie grammar + its Taree transcription (medium) |
| `Scratchings.aspx-flemington-2026-10-24-constructed.html` | `GET /FreeFields/Scratchings.aspx?Key=...` | constructed; passes Kelvin-Agents `scratchings()` grammar (medium for grammar, low for table classes) |
| `GearChanges.aspx-flemington-2026-10-24-constructed.html` | `GET /FreeFields/GearChanges.aspx?Key=...` | constructed, **low** (page existence evidenced by indexed URLs only; no parser found) |
| `Calendar.aspx-VIC-constructed-2026-10-24.html` | `GET /FreeFields/Calendar.aspx?State=VIC` | constructed; anchor grammar high (4 parsers), layout invented. Uses VIC single-quoted hrefs on purpose |
| `Calendar_Results.aspx-VIC-constructed.html` | `GET /FreeFields/Calendar_Results.aspx?State=VIC` ("Available Now" links) | constructed (medium) |
| `HorseFullForm.aspx-constructed.html` | `GET /InteractiveForm/HorseFullForm.aspx?horsecode=...` horse profile + full form | constructed from WKG-Scarp (2016) + SteamatipAi (2025) selectors (**low/medium**) |
| `Premierships.aspx-VIC-constructed.html` | `GET /FreeServices/Premierships.aspx?State=VIC[&Season=&Table=Trainer]` | constructed from SteamatipAi column indices (**low/medium**) |
| `parsed/Form.aspx-flemington-2026-10-24.parsed-by-kyw-ra.json` | output of the unmodified KaiYingWinning `ra.js` `parseForm()` on the Form fixture | generated 2026-10-23 under Node 22 |
| `parsed/Acceptances.aspx-flemington-2026-10-24.parsed-kelvin-style.json` | Kelvin `acceptances()` logic on the Acceptances fixture | generated |
| `parsed/Results.aspx-REAL-thevalley-2025-10-25.normalized.json` | RaceLens-shaped normalisation of the REAL The Valley page (finish codes, SP/fav flags, codes, silks ids, race header fields) | generated from the real capture - use as expected output in adapter tests |
| `parsed/Results.aspx-REAL-caulfield-2025-10-18-race7.normalized.json` | same for the Caulfield race 7 capture | generated |

Invented venue/date for constructed pages: **Flemington, Saturday 24 October 2026** (`Key=2026Oct24,VIC,Flemington`). Horse, jockey, trainer
names and all base64 codes in constructed files are illustrative only. The validator that produced the `parsed/` files lives outside the
repo because it embeds third-party parser code (KaiYingWinning `ra.js`, licence unknown); its checks are listed in `research/racingaustralia.md` section 12.
