# RaceLens HTTP API (served by src/server, consumed by src/web)

All responses are JSON. Types referenced are in `src/shared/types.ts`.

## Login (optional)

When `RACELENS_PASSWORD` is set the API requires a session. The session is a signed, HttpOnly cookie (`racelens_session` = `<id>.<issuedMs>.<expiresMs>.<sig>`) that lasts 30 days and is renewed while in use (when less than half of it is left), but never beyond 90 days after sign-in. The signing key is derived from the installation secret (`data/.secret`) **and** the password, so changing `RACELENS_PASSWORD` (or deleting `.secret`) invalidates every existing cookie. Sign-out revokes the session on the server (every cookie of that sign-in, renewed or not); revocations are kept in `<dataDir>/.revoked-sessions.json` so they survive a restart. Without a password every request is treated as authenticated and the login endpoints are no-ops.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | /api/auth | – | `{ required: boolean, authenticated: boolean }` – whether a password is configured and whether this request carries a valid session |
| POST | /api/login | `{ password }` | `200 { ok: true }` and sets the cookie; `401 { error: 'Wrong password' }`; `429 { error }` while locked (see below); `400 { error }` when the body is not `{ password: string }` of ≤ 200 characters |
| POST | /api/logout | – | `{ ok: true }`, clears the cookie and revokes that session server-side |

**Rate limit:** 5 failed logins from one address within 10 minutes lock that address for 60 s (each further failure while 5 are inside the window locks it again). On top of that, 30 failures from all addresses together within 10 minutes pause every login for 60 s. Requests answered 429 are not counted. Only `POST /api/login` is affected; signed-in clients keep working. The client address is the socket address unless a proxy is trusted (`RACELENS_TRUST_PROXY`, below).

**401 convention:** any other `/api` request made without a valid session while a password is required answers `401 { error: 'Login required', code: 'auth' }`. The web app treats `code: 'auth'` as "show the login screen", so clients should check for that code rather than the status alone. `GET /api/health`, `GET /api/auth`, `POST /api/login` and `POST /api/logout` are always reachable.

The cookie is marked `Secure` when the request arrived over HTTPS – directly, or with `x-forwarded-proto: https` from a proxy in front (a hosting platform, Tailscale Serve). This does not depend on `RACELENS_TRUST_PROXY`.

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | /api/health | – | Public: `{ ok: true, mode: 'live'\|'demo', version, time, authRequired: boolean }` (`time` is the server's clock; the web app aligns its countdowns to it). When authenticated (or no password is set) it also includes `dataDir`, `urls: string[]`, `publicUrl?: string` and `scheduler: SchedulerStatus` (see below). `urls` are the `http://<lan-ip>:port` addresses a phone on the same network can use: non-empty only when listening on `0.0.0.0` / `::`, re-read from the network interfaces at most every 30 s, and always `[]` when the server is hosted (`RACELENS_ALLOWED_HOSTS` contains `*`, or `FLY_APP_NAME` / `RENDER` is set). `publicUrl` is `RACELENS_PUBLIC_URL` if set, else `https://<FLY_APP_NAME>.fly.dev` on Fly.io, else `RENDER_EXTERNAL_URL` on Render, else absent |
| GET | /api/settings | – | `Settings` |
| PUT | /api/settings | `Partial<Settings>` | `Settings` – accepts `bankroll`, `unitAmount`, `riskProfile`, `jurisdiction`, `disabledSources`, `autoRecheckMinutesBeforeRace` (0 switches automatic pre-race checks off) and `autoResults: boolean` (automatic results polling, default `true`); unknown or invalid fields are ignored |
| GET | /api/sources | – | `{ sources: SourceInfo[] }` where `SourceInfo = { id, name, kind, capabilities, homepage?, enabled, lastStatus?: SourceStatus }` |
| POST | /api/sources/probe | – | `{ jobId }` (probe job; results land in `GET /api/sources`) |
| GET | /api/meetings?date=YYYY-MM-DD | – | `{ date, meetings: MeetingSummary[], sourceStatuses: SourceStatus[], fromCache: boolean }`; cached for 10 minutes, `&force=1` skips the cache; `400` for an implausible date |
| POST | /api/research | `{ date, venueSlug }` | `{ jobId, meetingId }` – full research job, creates/replaces a MeetingPack. Results, scorecards, history and the watcher's memory of an existing pack are carried over; a result typed in by hand always wins over what the sources say now. (A `force` flag is accepted and ignored.) |
| GET | /api/jobs | – | `JobProgress[]` (recent, newest first). `type` is `research` \| `recheck` \| `results` \| `probe`; jobs started by the scheduler appear here too |
| GET | /api/jobs/:id | – | `JobProgress`; `404` once the server no longer knows the job (e.g. after a restart) |
| GET | /api/packs | – | `PackListItem[]` = `{ id, createdAt, updatedAt, meeting, verificationScore, raceCount, predictedRaces, resultedRaces }` |
| GET | /api/packs/:id | – | `MeetingPack` (includes `resultWatch`, see below) |
| DELETE | /api/packs/:id | – | `{ ok }`. Runs through the meeting's job queue; if another job of that meeting is still running after 20 seconds it answers `202 { queued: true, jobId, message }` – the delete is accepted, stays queued and happens when that job ends; follow `jobId` with GET /api/jobs/:id |
| POST | /api/packs/:id/recheck | `{ raceNumber?: number }` | `{ jobId }` – pre-race recheck: refresh odds/scratchings/riders/track for one race (or all remaining), check the results that are due (same rules as the automatic watcher), detect day patterns, re-predict (that race, or every race still to run when a result came in). `400` for an unknown race or a race that already has a result |
| POST | /api/packs/:id/results | `{ raceNumber?: number, catchup?: boolean }` | Without `catchup` (the *Fetch results* button): `{ jobId }` – fetch results for one race (or every race that has jumped and is not settled), cross-check and record them, update day patterns, score the predictions and **re-rate the remaining races** when anything new landed. A result typed in by hand is never re-fetched; a final result confirmed by two sources is not re-fetched either, apart from its one late-correction look. With `catchup: true` (the phone's catch-up): only the races `dueResultChecks` says are due now (respecting `resultWatch[n].nextCheckAt`, `gaveUp` and settled results; `raceNumber` narrows it further) are checked, as an **automatic** check (same history line collapsing and one-source confirmation budget as the scheduler). Answers `200 { jobId: null, due: [] }` without starting a job when nothing is due, otherwise `{ jobId, due: number[] }`. `catchup` must be a boolean (`400` otherwise); `400` for an unknown race |
| POST | /api/packs/:id/results/manual | `{ raceNumber, placings: number[][] }` | `MeetingPack` – manual result entry (groups of runner numbers per placing, dead-heats as one group); settles that race for the watcher (`resultWatch[n]` loses `nextCheckAt`, `gaveUp` and `correctionCheckAt`, note `Result entered by hand`), updates day patterns and re-rates the remaining races. The same placings again are a no-op. `400` for an unknown race, unknown runners or malformed placings. Runs through the meeting's job queue: if another job of that meeting is still running after 20 seconds it answers `202 { queued: true, jobId, message }` – the result is accepted, stays queued and is saved when that job ends, so it need not be entered again (the web app shows the queued job and refreshes when it lands) |
| GET | /api/packs/:id/races/:n | – | `{ race: Race, prediction?: Prediction, result?: RaceResult }` |

Job polling: the UI polls `GET /api/jobs/:id` about once a second (the catch-up every 2 s) until `status` is `done` or `error`; after three `404`s in a row it treats the job as lost. `JobProgress.steps` gives a step list for a friendly progress panel; `percent` and `message` give the headline.

Host guard: requests whose `Host` header is not this machine (localhost, its own interface addresses – re-read every 30 s, and on an unknown name at most every 5 s – or a name listed in `RACELENS_ALLOWED_HOSTS`) answer `421 { error }`; `RACELENS_ALLOWED_HOSTS=*` disables the check for hosted platforms.

## The automatic race day

The server runs a scheduler (`src/server/jobs/scheduler.ts`) that looks at the saved packs once a minute (first pass 5 s after start-up, so a restart catches up at once):

* **Pre-race checks** – for meetings dated today or tomorrow (any Australian time zone): one `recheck` job when a race enters the window `settings.autoRecheckMinutesBeforeRace` minutes before its start, and one more inside the final 3 minutes.
* **Results polling** – for meetings dated today or yesterday, while `settings.autoResults` is true: one `results` job per meeting for the races `dueResultChecks` (in `src/server/jobs/research.ts`) says are due; the job re-reads what is due when it runs and skips races another job checked meanwhile. Checks are scheduled relative to each race's `startTime`: first at +2 min, then every 2 min to +30 min, every 5 min to +90 min, every 15 min to +4 h, after which the watcher gives up (`gaveUp`). Each results job also updates day patterns and re-rates the remaining races when something new arrived.
  * **Settling:** a final result agreed by two sources (or typed in manually) settles the race. A final result from a single source is recorded at once and re-checked up to 3 more times for a second source, then accepted. If any agreeing source reports the result as interim, it stays interim and is polled until final (or until +4 h).
  * **Late correction:** a source result settled before +30 min gets one more look at +30 min (`correctionCheckAt`) for a protest or amended placings; after that the race is not polled again. Results typed in by hand never get one.
  * **Abandonment:** while a race that is 20 min or more past its start has no result, the first check past each of the marks +20, 30, 45, 60, 90, 120, 180 and 240 min also asks the race-card sources for the race's status; if one says abandoned the race is marked `abandoned` and its watch entry is dropped.
  * **Unreachable sources:** when not one results source answers, the note says `No results source answered (TAB: HTTP 403; …)` rather than `Nothing published yet`, and the give-up note becomes `Could not reach the results sources for 4 hours - …`.
  * **Failures:** a results job that fails is logged as a warning, and that meeting is left alone for 5 minutes before the next attempt. If results are due but every results source is switched off, no job is started and a warning is logged once.

`MeetingPack.resultWatch?: Record<number, ResultWatch>` is the per-race memory of that watcher, saved with the pack:

```ts
interface ResultWatch {
  lastCheckedAt: string;       // last time the sources were asked
  attempts: number;            // checks so far
  nextCheckAt?: string;        // when the next automatic check is due (absent once settled or given up)
  gaveUp?: boolean;            // the watcher stopped trying (4 h after the jump)
  note?: string;               // human-readable state, e.g. "Result from TAB only - waiting for a second source (extra check 1 of 3)",
                               // "Nothing published yet", "No results source answered (…)", "Confirmed by 2 sources", "Result entered by hand"
  correctionCheckAt?: string;  // one late-correction look at +30 min for a result the sources settled earlier (not shown as a "next check")
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

The web app polls `/api/health` every 30 s while the Settings page is open to show "Watching Flemington R3 – next check in 1 min", and checks an open pack page every 30 s (`GET /api/packs`, then the pack when `updatedAt` or the result count changed). On a race page, once `/api/settings` says automatic results are on, it sends a catch-up `POST /packs/:id/results` with body `{ catchup: true }` (at most every 2 minutes, on load, on returning to the page and on moving to another race) when a race jumped more than 3 minutes ago, has no settled result, and either has no `resultWatch` entry or a `nextCheckAt` more than 90 s in the past; races the watcher gave up on or has no `nextCheckAt` for are left alone. `{ jobId: null }` means nothing was due.

## Modes and environment

`RACELENS_MODE=demo` registers only bundled demo sources (deterministic, offline) – used for tests and first-run demos. Default `live` registers the real adapters. In demo mode results for races 1–3 become available once each race's scheduled start has passed (or straight away with `RACELENS_DEMO_RESULTS_READY=all`), and `RACELENS_FAKE_NOW=<ISO date-time>` starts the server's clock at that moment so the race day can be rehearsed on any date.

| Variable | Meaning |
|---|---|
| `RACELENS_PORT` | default 4850 |
| `RACELENS_HOST` | `127.0.0.1` by default; `0.0.0.0` listens on every interface and makes `/api/health` report `urls` (unless hosted) |
| `RACELENS_DATA_DIR` | default `./data`; holds `packs/`, `cache/`, `settings.json`, `.secret` (signs the session cookies, together with the password) and `.revoked-sessions.json` |
| `RACELENS_PASSWORD` | enables the login described above; changing it signs every session out |
| `RACELENS_ALLOWED_HOSTS` | comma-separated extra hostnames for the host guard, or `*` (disables the guard and marks the server as hosted) |
| `RACELENS_PUBLIC_URL` | absolute http(s) URL reported as `publicUrl` (also on a non-hosted server, e.g. a Tailscale Serve name) |
| `RACELENS_TRUST_PROXY` | `1` sets Express `trust proxy` to 1, so client IPs (and the login rate limit) come from the proxy's `X-Forwarded-For`. Also on automatically when `FLY_APP_NAME` or `RENDER` is set; `RACELENS_ALLOWED_HOSTS=*` alone does not turn it on |
| `RACELENS_ALLOW_OPEN` | `1` lets a hosted server start without a password; otherwise it exits with "Refusing to start" |
| `FLY_APP_NAME`, `RENDER`, `RENDER_EXTERNAL_URL` | set by Fly.io / Render themselves: mark the server as hosted, turn on proxy trust and provide the default `publicUrl` |
| `RACELENS_QR` | `0` suppresses the start-up QR code (never printed when hosted) |
| `RACELENS_LOG` | `debug` / `info` (default) / `warn` / `error` |
| `RACELENS_RECORD` | `1` records raw HTTP responses into `fixtures/recorded/` |
