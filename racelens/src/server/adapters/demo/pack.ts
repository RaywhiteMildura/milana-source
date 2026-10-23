/**
 * Shared plumbing for the bundled DEMO sources.
 *
 * All demo adapters read the same fixture pack (fixtures/demo/*) but present it
 * as different sources with deliberate, deterministic disagreements so the
 * reconciliation engine has real work to do offline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CareerStats,
  MeetingSummary,
  RaceRaw,
  RaceStatus,
  RaceSummary,
  RunnerRaw,
  SourceId,
  SpeedMapPosition,
  SplitStats,
} from '../../../shared/types.js';
import type { FetchContext } from '../types.js';

export const DEMO_DATE = '2026-10-24';
export const DEMO_VENUE_SLUG = 'flemington';
export const DEMO_MEETING_ID = `${DEMO_DATE}:${DEMO_VENUE_SLUG}`;

export const DEMO_PACK_FILE = 'flemington-2026-10-24.json';
export const DEMO_RESULTS_FILE = 'results.json';
export const DEMO_NEWS_FILE = 'news.json';
export const DEMO_WEATHER_FILE = 'weather.json';

// ---------------------------------------------------------------------------
// Fixture shapes
// ---------------------------------------------------------------------------

export interface DemoFormLine {
  date: string;
  venue: string;
  distance: number;
  trackCondition: string;
  trackRating: number;
  position: number;
  starters: number;
  margin: number;
  weight?: number;
  barrier: number;
  jockey: string;
  raceClass: string;
  prize: number;
  startingPrice?: number;
  time: string;
  sectional600: string;
  winner?: string;
  second?: string;
  inRunning: string;
  comment: string;
}

export interface DemoOddsQuote {
  win: number;
  place: number;
  opening: number;
  flucs: Array<{ price: number; at: string }>;
}

export interface DemoRunner {
  number: number;
  name: string;
  barrier: number;
  jockey: string;
  trainer: string;
  weight: number;
  claim?: number;
  scratched?: boolean;
  emergency?: boolean;
  age: number;
  sex: string;
  colour: string;
  sire: string;
  dam: string;
  damSire: string;
  country: string;
  last5: string;
  career?: CareerStats;
  splits: SplitStats;
  daysSinceLastRun: number;
  speedMapPosition: SpeedMapPosition;
  ratings: Record<string, number>;
  comment: string;
  form: DemoFormLine[];
  odds: { tote?: DemoOddsQuote; alpha?: DemoOddsQuote; bravo?: DemoOddsQuote };
  gearChanges?: string[];
}

export interface DemoRace {
  number: number;
  name: string;
  distance: number;
  startTime: string;
  raceClass: string;
  group?: string;
  prize: number;
  ageRestriction: string;
  sexRestriction?: string;
  trackCondition: string;
  trackRating: number;
  runners: DemoRunner[];
}

export type DemoVariantField = 'jockey' | 'weight' | 'name' | 'scratched' | 'barrier' | 'trainer' | 'number';

export interface DemoRunnerOverride {
  race: number;
  number: number;
  field: DemoVariantField;
  value: string | number | boolean;
  /** The authoritative value, for documentation / tests. */
  official?: unknown;
  note?: string;
}

export interface DemoVariants {
  note?: string;
  runnerOverrides: DemoRunnerOverride[];
  omitRunners?: Array<{ race: number; number: number; name?: string; note?: string }>;
}

export type DemoMeeting = Omit<MeetingSummary, 'sourceRefs' | 'sources'>;

export interface DemoPack {
  _comment?: string;
  meeting: DemoMeeting;
  races: DemoRace[];
  /** Deliberate per-source disagreements keyed by adapter id. */
  variants: Record<SourceId, DemoVariants>;
}

export interface DemoResult {
  raceNumber: number;
  placings: number[][];
  finishingOrder: number[];
  margins: number[];
  time: string;
  sectional600?: string;
  dividends: Record<string, number>;
  inRunning: Record<string, string>;
  winnerName?: string;
  winnerBarrier?: number;
  winnerSpeedMapPosition?: SpeedMapPosition;
  favouriteNumber?: number;
  favouriteWon?: boolean;
  note?: string;
}

export interface DemoResultsFile {
  _comment?: string;
  meetingId: string;
  results: DemoResult[];
}

export interface DemoNewsRaw {
  id?: string;
  title: string;
  url: string;
  outlet?: string;
  publishedAt?: string;
  snippet?: string;
  /** Curated -1..1 sentiment; when absent the adapter scores it from a small lexicon. */
  sentiment?: number;
  tags?: string[];
}

export interface DemoNewsFile {
  _comment?: string;
  items: DemoNewsRaw[];
}

export interface DemoWeatherFile {
  _comment?: string;
  latitude: number;
  longitude: number;
  timezone: string;
  utc_offset_seconds?: number;
  venue: string;
  venueSlug: string;
  hourly: {
    time: string[];
    temperature_2m: number[];
    precipitation: number[];
    precipitation_probability?: number[];
    wind_speed_10m: number[];
    wind_direction_10m?: number[];
    relative_humidity_2m?: number[];
    weather_code?: number[];
  };
}

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

let fixtureDirCache: string | undefined;

/**
 * Locate fixtures/demo whether we run from src (tsx) or dist (compiled). Both
 * live at <root>/{src|dist}/server/adapters/demo so the relative depth is the
 * same; we still fall back to cwd and a walk-up so unusual launch dirs work.
 */
export function resolveDemoFixtureDir(): string {
  if (fixtureDirCache) return fixtureDirCache;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates: string[] = [];
  if (process.env.RACELENS_DEMO_FIXTURES_DIR) candidates.push(path.resolve(process.env.RACELENS_DEMO_FIXTURES_DIR));
  candidates.push(fileURLToPath(new URL('../../../../fixtures/demo/', import.meta.url)));
  candidates.push(path.resolve(process.cwd(), 'fixtures', 'demo'));
  let dir = here;
  for (let i = 0; i < 7; i++) {
    candidates.push(path.join(dir, 'fixtures', 'demo'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, DEMO_PACK_FILE))) {
        fixtureDirCache = c;
        return c;
      }
    } catch {
      /* try next */
    }
  }
  throw new Error(`RaceLens demo fixtures not found (looked for ${DEMO_PACK_FILE} in: ${candidates.join(', ')})`);
}

const fileCache = new Map<string, unknown>();

function readFixture<T>(name: string): T {
  const hit = fileCache.get(name);
  if (hit) return hit as T;
  const file = path.join(resolveDemoFixtureDir(), name);
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  fileCache.set(name, data);
  return data;
}

/** The full demo meeting pack (cached; treat as read-only). */
export function loadDemoPack(): DemoPack {
  return readFixture<DemoPack>(DEMO_PACK_FILE);
}

export function loadDemoResults(): DemoResultsFile {
  return readFixture<DemoResultsFile>(DEMO_RESULTS_FILE);
}

export function loadDemoNews(): DemoNewsFile {
  return readFixture<DemoNewsFile>(DEMO_NEWS_FILE);
}

export function loadDemoWeather(): DemoWeatherFile {
  return readFixture<DemoWeatherFile>(DEMO_WEATHER_FILE);
}

/** Drop cached fixtures (tests / hot reload). */
export function clearDemoFixtureCache(): void {
  fileCache.clear();
  fixtureDirCache = undefined;
}

// ---------------------------------------------------------------------------
// Env-driven behaviour: latency and simulated outages
// ---------------------------------------------------------------------------

export class DemoTransportError extends Error {
  readonly code = 'ECONNRESET';
  constructor(public readonly sourceId: SourceId) {
    super(`${sourceId}: simulated transport failure (RACELENS_DEMO_FAIL includes "${sourceId}")`);
    this.name = 'DemoTransportError';
  }
}

export function demoLatencyMs(): number {
  const v = Number(process.env.RACELENS_DEMO_LATENCY_MS ?? 0);
  return Number.isFinite(v) && v > 0 ? Math.min(v, 60_000) : 0;
}

/** Await a tiny simulated network delay when RACELENS_DEMO_LATENCY_MS is set. */
export async function demoDelay(ctx?: Pick<FetchContext, 'signal'>): Promise<void> {
  const ms = demoLatencyMs();
  if (ms <= 0) return;
  if (ctx?.signal?.aborted) throw new Error('aborted');
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    ctx?.signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

export function demoShouldFail(sourceId: SourceId): boolean {
  const v = process.env.RACELENS_DEMO_FAIL ?? '';
  return v.includes(sourceId) || v.trim() === '*';
}

/** Throw a transport error when this source is configured to be down. */
export function assertDemoSourceUp(sourceId: SourceId): void {
  if (demoShouldFail(sourceId)) throw new DemoTransportError(sourceId);
}

// ---------------------------------------------------------------------------
// Builders shared by the adapters
// ---------------------------------------------------------------------------

export function isDemoDate(date: string): boolean {
  return date === DEMO_DATE;
}

export function isDemoMeeting(meeting: Pick<MeetingSummary, 'date' | 'venueSlug' | 'id'>): boolean {
  if (meeting.id === DEMO_MEETING_ID) return true;
  return meeting.date === DEMO_DATE && (meeting.venueSlug === DEMO_VENUE_SLUG || !meeting.venueSlug);
}

export function demoMeetingSummary(pack: DemoPack, sourceId: SourceId, sourceRef: string): MeetingSummary {
  return {
    ...structuredClone(pack.meeting),
    sourceRefs: { [sourceId]: sourceRef },
    sources: [sourceId],
  };
}

export function findDemoRace(pack: DemoPack, raceNumber: number): DemoRace | undefined {
  return pack.races.find((r) => r.number === raceNumber);
}

export function demoRaceSummary(race: DemoRace, sourceId: SourceId, sourceRef: string, status: RaceStatus = 'open'): RaceSummary {
  const s: RaceSummary = {
    number: race.number,
    name: race.name,
    distance: race.distance,
    startTime: race.startTime,
    raceClass: race.raceClass,
    prize: race.prize,
    ageRestriction: race.ageRestriction,
    trackCondition: race.trackCondition,
    trackRating: race.trackRating,
    status,
    sourceRefs: { [sourceId]: sourceRef },
  };
  if (race.group) s.group = race.group;
  if (race.sexRestriction) s.sexRestriction = race.sexRestriction;
  return s;
}

/** An empty RaceRaw for an unknown race number: adapters never throw on bad input. */
export function emptyRaceRaw(sourceId: SourceId, raceNumber: number, fetchedAt: string): RaceRaw {
  return {
    number: raceNumber,
    name: `Race ${raceNumber}`,
    distance: 0,
    status: 'unknown',
    sourceRefs: {},
    runners: [],
    source: sourceId,
    fetchedAt,
  };
}

/**
 * Apply this source's deliberate disagreements to a race's runners: field
 * overrides (older jockey booking, weight typo, name spelling, stale scratching,
 * barrier typo) and omitted runners.
 */
export function applyDemoVariants(raceNumber: number, runners: RunnerRaw[], variants: DemoVariants | undefined): RunnerRaw[] {
  if (!variants) return runners;
  const omitted = new Set((variants.omitRunners ?? []).filter((o) => o.race === raceNumber).map((o) => o.number));
  const out = runners.filter((r) => r.number === undefined || !omitted.has(r.number));
  for (const o of variants.runnerOverrides ?? []) {
    if (o.race !== raceNumber) continue;
    const runner = out.find((r) => r.number === o.number);
    if (!runner) continue;
    switch (o.field) {
      case 'jockey':
      case 'trainer':
      case 'name':
        runner[o.field] = String(o.value);
        break;
      case 'weight':
      case 'barrier':
      case 'number':
        runner[o.field] = Number(o.value);
        break;
      case 'scratched':
        runner.scratched = Boolean(o.value);
        break;
      default:
        break;
    }
  }
  return out;
}

export function demoVariantsFor(pack: DemoPack, sourceId: SourceId): DemoVariants | undefined {
  return pack.variants?.[sourceId];
}

/** Lightweight sleep without touching Date.now (adapters use ctx.now()). */
export const nowIso = (ctx: FetchContext): string => ctx.now().toISOString();
