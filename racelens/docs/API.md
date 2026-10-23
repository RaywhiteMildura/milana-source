# RaceLens HTTP API (served by src/server, consumed by src/web)

All responses are JSON. Types referenced are in `src/shared/types.ts`.

## Login (optional)

When `RACELENS_PASSWORD` is set the API requires a session. The session is a signed, HttpOnly cookie (`racelens_session`) that lasts 30 days and is renewed while in use, so a phone rarely has to sign in again. Without a password every request is treated as authenticated and the login endpoints are no-ops.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | /api/auth | – | `{ required: boolean, authenticated: boolean }` – whether a password is configured and whether this request carries a valid session |
| POST | /api/login | `{ password }` | `200 { ok: true }` and sets the cookie; `401 { error: 'Wrong password' }`; `429 { error }` after 5 failures within 10 minutes (locked for 60 s per address); `400 { error }` when the body is not `{ password: string }` of ≤ 200 characters |
| POST | /api/logout | – | `{ ok: true }` and clears the cookie |

**401 convention:** any other `/api` request made without a valid session while a password is required answers `401 { error: 'Login required', code: 'auth' }`. The web app treats `code: 'auth'` as "show the login screen", so clients should check for that code rather than the status alone. `GET /api/health`, `GET /api/auth`, `POST /api/login` and `POST /api/logout` are always reachable.

The cookie is marked `Secure` when the request arrived over HTTPS (directly, or via `x-forwarded-proto: https` from a hosting platform's proxy – see `RACELENS_TRUST_PROXY` below).

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | /api/health | – | Public: `{ ok: true, mode: 'live'\|'demo', version, time, authRequired: boolean }`. When authenticated (or no password is set) it also includes `dataDir`, `urls: string[]` (the `http://<lan-ip>:port` addresses a phone can use – non-empty only when listening on `0.0.0.0`) and `scheduler: SchedulerStatus` (see below) |
| GET | /api/settings | – | `Settings` |
| PUT | /api/settings | `Partial<Settings>` | `Settings` – accepts `bankroll`, `unitAmount`, `riskProfile`, `jurisdiction`, `disabledSources`, `autoRecheckMinutesBeforeRace` (0 switches automatic pre-race checks off) and `autoResults: boolean` (automatic results polling, default `true`); unknown or invalid fields are ignored |
| GET | /api/sources | – | `{ sources: SourceInfo[] }` where `SourceInfo = { id, name, kind, capabilities, homepage?, enabled, lastStatus?: SourceStatus }` |
| POST | /api/sources/probe | – | `{ jobId }` (probe job; results land in `GET /api/sources`) |
| GET | /api/meetings?date=YYYY-MM-DD | – | `{ date, meetings: MeetingSummary[], sourceStatuses: SourceStatus[], fromCache: boolean }` |
| POST | /api/research | `{ date, venueSlug, force?: boolean }` | `{ jobId, meetingId }` – full research job, creates/replaces a MeetingPack (results, scorecards and history of an existing pack are carried over) |
| GET | /api/jobs | – | `JobProgress[]` (recent, newest first). `type` is `research` \| `recheck` \| `results` \| `probe`; jobs started by the scheduler appear here too |
| GET | /api/jobs/:id | – | `JobProgress` |
| GET | /api/packs | – | `PackListItem[]` = `{ id, createdAt, updatedAt, meeting, verificationScore, raceCount, predictedRaces, resultedRaces }` |
| GET | /api/packs/:id | – | `MeetingPack` (includes `resultWatch`, see below) |
| DELETE | /api/packs/:id | – | `{ ok }` |
| POST | /api/packs/:id/recheck | `{ raceNumber?: number }` | `{ jobId }` – pre-race recheck: refresh odds/scratchings/conditions, pull results of finished races, detect day patterns, re-predict (one race or all remaining). `400` for a race that already has a result |
| POST | /api/packs/:id/results | `{ raceNumber?: number }` | `{ jobId }` – fetch results from the sources for one race (or every unresulted race), cross-check and record them, update day patterns, score the predictions and **re-rate the remaining races** when anything new landed. The web app calls this for its catch-up when it notices a race that jumped a while ago with no result |
| POST | /api/packs/:id/results/manual | `{ raceNumber, placings: number[][] }` | `MeetingPack` – manual result entry (groups of runner numbers per placing, dead-heats as one group); settles that race for the watcher, updates day patterns and re-rates the remaining races |
| GET | /api/packs/:id/races/:n | – | `{ race: Race, prediction?: Prediction, result?: RaceResult }` |

Job polling: the UI polls `GET /api/jobs/:id` about once a second until `status` is `done` or `error`. `JobProgress.steps` gives a step list for a friendly progress panel; `percent` and `message` give the headline.

Host guard: requests whose `Host` header is not this machine (localhost, its own interface addresses, or a name listed in `RACELENS_ALLOWED_HOSTS`) answer `421 { error }`; `RACELENS_ALLOWED_HOSTS=*` disables the check for hosted platforms.

## The automatic race day

The server runs a scheduler (`src/server/jobs/scheduler.ts`) that looks at the saved packs once a minute (first pass 5 s after start-up, so a restart catches up at once):

* **Pre-race checks** – for meetings dated today or tomorrow (any Australian time zone): one `recheck` job when a race enters the window `settings.autoRecheckMinutesBeforeRace` minutes before its start, and one more inside the final 3 minutes.
* **Results polling** – for meetings dated today or yesterday, while `settings.autoResults` is true: a `results` job for every race that is due. Checks are scheduled relative to each race's `startTime`: first at +2 min, then every 2 min to +30 min, every 5 min to +90 min, every 15 min to +4 h, after which the watcher gives up. A result confirmed by two sources (or typed in manually) settles the race; a final result from a single source is re-checked up to 3 more times for a second source. Each results job also updates day patterns and re-rates the remaining races.

`MeetingPack.resultWatch?: Record<number, ResultWatch>` is the per-race memory of that watcher, saved with the pack:

```ts
interface ResultWatch {
  lastCheckedAt: string;  // last time the sources were asked
  attempts: number;       // automatic checks so far
  nextCheckAt?: string;   // when the next automatic check is due (absent once settled or given up)
  gaveUp?: boolean;       // the watcher stopped trying (4 h after the jump with nothing published)
  note?: string;          // human-readable state, e.g. "Result from tab only - waiting for a second source (extra check 1 of 3)"
}
```

`GET /api/health` (authenticated) reports what the scheduler is doing as `scheduler: SchedulerStatus`:

```ts
interface SchedulerStatus {
  running: boolean;             // the timer is active
  lastTickAt?: string;
  nextTickAt?: string;
  autoResults: boolean;         // settings.autoResults
  autoRecheckMinutes: number;   // settings.autoRecheckMinutesBeforeRace
  watching: Array<{ meetingId: string; venue: string; raceNumber: number; attempts: number; lastCheckedAt?: string; nextCheckAt?: string }>;
}
```

The web app polls `/api/health` while the Settings page is open to show "Watching Flemington R3 – next check in 1 min", refreshes an open pack page every 30 s, and fires a catch-up `POST /packs/:id/results` when a race jumped more than 3 minutes ago, has no settled result and `resultWatch[n].lastCheckedAt` is older than 2 minutes (or missing).

## Modes and environment

`RACELENS_MODE=demo` registers only bundled demo sources (deterministic, offline) – used for tests and first-run demos. Default `live` registers the real adapters. In demo mode results for races 1–3 become available once each race's scheduled start has passed (or straight away with `RACELENS_DEMO_RESULTS_READY=all`).

| Variable | Meaning |
|---|---|
| `RACELENS_PORT` | default 4850 |
| `RACELENS_HOST` | `127.0.0.1` by default; `0.0.0.0` listens on every interface and makes `/api/health` report `urls` |
| `RACELENS_DATA_DIR` | default `./data`; holds `packs/`, `settings.json` and `.secret` (signs the session cookies) |
| `RACELENS_PASSWORD` | enables the login described above |
| `RACELENS_ALLOWED_HOSTS` | comma-separated extra hostnames for the host guard, or `*` |
| `RACELENS_TRUST_PROXY` | `1` sets Express `trust proxy` so `req.secure` / client IPs come from the platform's proxy; implied by `RACELENS_ALLOWED_HOSTS=*` |
| `RACELENS_QR` | `0` suppresses the start-up QR code |
| `RACELENS_RECORD` | `1` records raw HTTP responses into `fixtures/recorded/` |
