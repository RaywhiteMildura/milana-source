import type {
  Capability,
  MeetingRaw,
  MeetingSummary,
  NewsItem,
  RaceRaw,
  RaceResult,
  RunnerRaw,
  SourceId,
  SourceKind,
  WeatherSummary,
} from '../../shared/types.js';
import type { HttpClient } from '../core/http.js';

export interface Logger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  debug(msg: string, meta?: unknown): void;
}

export interface FetchContext {
  http: HttpClient;
  log: Logger;
  now: () => Date;
  jurisdiction: string;
  signal?: AbortSignal;
}

/**
 * Every data source implements this. All methods are optional; declare what
 * you support in `capabilities` so the orchestrator knows what to ask for.
 * Adapters must NEVER throw on malformed payloads: parse defensively and return
 * partial data. Throw only for transport failures (the orchestrator records
 * them as a source outage).
 */
export interface SourceAdapter {
  id: SourceId;
  name: string;
  kind: SourceKind;
  capabilities: Capability[];
  /** Base URL(s) used, for the health panel. */
  homepage?: string;
  /** Discover meetings for a date (local AU date). */
  listMeetings?(date: string, ctx: FetchContext): Promise<MeetingSummary[]>;
  /** Fetch the full meeting: races with runners (card, odds, possibly form). */
  fetchMeeting?(meeting: MeetingSummary, ctx: FetchContext): Promise<MeetingRaw>;
  /** Fetch one race (lighter refresh for pre-race recheck). */
  fetchRace?(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RaceRaw>;
  /** Deep form for runners of a race. */
  fetchForm?(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RunnerRaw[]>;
  /** Results for a finished race, or null when not yet available. */
  fetchResults?(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RaceResult | null>;
  /** News / rumours matching a free-text query. */
  searchNews?(query: string, ctx: FetchContext): Promise<NewsItem[]>;
  /** Weather at a venue for a date. */
  fetchWeather?(venue: string, date: string, ctx: FetchContext): Promise<WeatherSummary | null>;
}

export function hasCapability(a: SourceAdapter, c: Capability): boolean {
  return a.capabilities.includes(c);
}
