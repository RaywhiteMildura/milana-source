# RaceLens HTTP API (served by src/server, consumed by src/web)

All responses are JSON. Types referenced are in `src/shared/types.ts`.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | /api/health | – | `{ ok: true, mode: 'live'|'demo', version, time, dataDir }` |
| GET | /api/settings | – | `Settings` |
| PUT | /api/settings | `Partial<Settings>` | `Settings` |
| GET | /api/sources | – | `{ sources: SourceInfo[] }` where `SourceInfo = { id, name, kind, capabilities, homepage?, enabled, lastStatus?: SourceStatus }` |
| POST | /api/sources/probe | – | `{ jobId }` (probe job; results land in `GET /api/sources`) |
| GET | /api/meetings?date=YYYY-MM-DD | – | `{ date, meetings: MeetingSummary[], sourceStatuses: SourceStatus[], fromCache: boolean }` |
| POST | /api/research | `{ date, venueSlug, force?: boolean }` | `{ jobId, meetingId }` – full research job, creates/replaces a MeetingPack |
| GET | /api/jobs | – | `JobProgress[]` (recent, newest first) |
| GET | /api/jobs/:id | – | `JobProgress` |
| GET | /api/packs | – | `PackListItem[]` = `{ id, createdAt, updatedAt, meeting, verificationScore, raceCount, predictedRaces, resultedRaces }` |
| GET | /api/packs/:id | – | `MeetingPack` |
| DELETE | /api/packs/:id | – | `{ ok }` |
| POST | /api/packs/:id/recheck | `{ raceNumber?: number }` | `{ jobId }` – pre-race recheck: refresh odds/scratchings/conditions, pull results of finished races, detect day patterns, re-predict (one race or all remaining) |
| POST | /api/packs/:id/results | `{ raceNumber?: number }` | `{ jobId }` – fetch results from sources and score predictions |
| POST | /api/packs/:id/results/manual | `{ raceNumber, placings: number[][] }` | `MeetingPack` – manual result entry |
| GET | /api/packs/:id/races/:n | – | `{ race: Race, prediction?: Prediction, result?: RaceResult }` |

Job polling: the UI polls `GET /api/jobs/:id` about once a second until `status` is `done` or `error`. `JobProgress.steps` gives a step list for a friendly progress panel; `percent` and `message` give the headline.

Modes: `RACELENS_MODE=demo` registers only bundled demo sources (deterministic, offline) – used for tests and first-run demos. Default `live` registers the real adapters. Env: `RACELENS_PORT` (default 4850), `RACELENS_DATA_DIR` (default ./data), `RACELENS_RECORD=1` records raw HTTP responses into `fixtures/recorded/`.
