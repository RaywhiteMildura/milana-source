# Fixtures for source `racingcom` (racing.com GraphQL, Racing Australia FreeFields, Racing NSW, Racing Queensland)

See `research/racingcom.md` for the endpoint documentation and evidence. Every file states its provenance in a top-level
`_fixtureNote` (JSON) or a leading comment (HTML/XML/CSV). Only ONE file is a real capture; everything else is constructed
to match field names / markup that public client code demonstrably parses.

| File | Models | Provenance |
|---|---|---|
| `graphql-GetMeetingByDate.json` | `POST https://graphql.rmdprod.racing.com/` → `GetMeetingByDate(date)` | constructed; field names from KaiYingWinning (high) |
| `graphql-GetRaceMeetingsByStateNew.json` | `GetRaceMeetingsByStateNew(states, daysBack, daysForward, userDate)` | constructed; racing-predictor (medium) |
| `graphql-getMeeting-getRacesForMeet.json` | `getMeeting(id)` + `getRacesForMeet(meetCode)` (race list, conditions) | constructed; KaiYingWinning (high) |
| `graphql-getRaceForm-prerace.json` | `getRaceForm(meetCode, raceNumber)` pre-race: `raceEntries` (scratchings only) + `formRaceEntries` (full field, form, stats, odds, jockey/trainer) | constructed; KaiYingWinning + racing-predictor (high) |
| `graphql-getRacesForMeet-results.json` | `getRacesForMeet` after the race: `formRaceEntries.position/margin/winningTime/positionAt*`, `raceEntryTimes` sectionals, `stewardsReport.htmlCode`, `prizeMoney[]` | constructed; racing-predictor (medium) |
| `graphql-error.json` | AppSync error envelopes (401 bad key, validation error) | constructed from AppSync conventions (medium) |
| `graphql-news-getNewsList.json` | `GET https://graphql.api.racing.com?query=...` news list (RSS substitute) | constructed; HorseRacingNewsPortal (medium) |
| `racingaustralia-Results.aspx-REAL-caulfield-2025-10-18.html` | `GET https://racingaustralia.horse/FreeFields/Results.aspx?Key=2025Oct18,VIC,Caulfield` | **REAL** (Wayback capture republished in a public repo; archive prefixes stripped) |
| `racingaustralia-Form.aspx-flemington-2026-10-24.html` | `GET .../FreeFields/Form.aspx?Key=2026Oct24,VIC,Flemington` (2 races × 3 runners, pedigree, records, run lines) | constructed; verified to parse with the real KaiYingWinning `ra.js` parser and horseride cheerio selectors |
| `racingaustralia-Acceptances.aspx-flemington-2026-10-24.html` | `GET .../FreeFields/Acceptances.aspx?Key=...` (styled) | constructed; Kelvin-Agents / Bookie regexes |
| `racingaustralia-ozracing-Acceptances-taree-2026-07-21.html` | `GET https://www.racingaustralia.horse/ozracing/Acceptances.aspx?key=2026Jul21,NSW,Taree` | developer transcription copied from RatterAU/Bookie tests |
| `racingaustralia-Calendar.aspx-VIC.html` | `GET .../FreeFields/Calendar.aspx?State=VIC` | constructed; anchor grammar from 3 parsers |
| `racingnsw-XML.aspx-Acceptances.xml` | `GET https://racing.racingnsw.com.au/FreeFields/XML.aspx?Key=...&stage=Acceptances` | constructed; only `race@number`, `nomination@horse/@number/@jockeynumber` are evidenced (tmstipping) |
| `racingqld-GetMeetingsForDate.xml` | `GET https://www.racingqueensland.com.au/OpenDataWebServices/Meetings.asmx/GetMeetingsForDate?meetingDate=YYYY-MM-DD` | constructed; element names from keiba parser/tests (medium) |
| `racingqld-GetRacesForMeeting.xml` | `.../Meetings.asmx/GetRacesForMeeting?meetingId=N` | constructed; keiba (medium) |
| `racingqld-GetHorsesForRace.xml` | `.../Meetings.asmx/GetHorsesForRace?raceId=N` | constructed; keiba (medium) |
| `racingqld-sectional-20261024_Eagle_Farm_T.csv` + `racingqld-sectional-README.txt` | `GET https://www.racingqueensland.com.au/RacingFile.ashx?path=/Sectional/YYYYMMDD_<Venue>_T.csv` | constructed; format described by keiba |

Invented venue/date for constructed examples: **Flemington, 2026-10-24** (Royal Randwick / Eagle Farm for NSW/QLD examples). Horse, jockey
and trainer names in constructed files are illustrative only.
