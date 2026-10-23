/**
 * Weather summary and wet-track suitability.
 *
 * `summariseWeather` folds hourly observations/forecasts into rain totals for
 * the 72 hours before race day and for race day itself (before 18:00 local),
 * the race-day maximum temperature and wind, a one-line summary and an
 * expected drift in track rating. `expectedTrackRating` applies that drift and
 * `wetTrackFactor` scores a runner's record on the expected going.
 *
 * Pure functions: no I/O, no clock.
 */
import type { CareerStats, Runner, WeatherHour, WeatherSummary } from '../../shared/types.js';
import { clamp, round, trackRatingLabel } from '../../shared/util.js';

export interface WeatherInput {
  venue: string;
  source: string;
  fetchedAt: string;
  hourly: WeatherHour[];
  /** Local race-day date YYYY-MM-DD */
  raceDayDate: string;
  /** IANA time zone used to localise hourly timestamps that carry an offset (default Australia/Melbourne). */
  timezone?: string;
}

export interface WetTrackFactor {
  /** -1 .. 1 */
  score: number;
  evidence: string;
  /** 0..1 */
  dataQuality: number;
}

const DEFAULT_TZ = 'Australia/Melbourne';
/** Race-day rain is counted up to (but excluding) this local hour. */
const RACE_DAY_CUTOFF_HOUR = 18;
/** Race-day rain above this (mm) adds a further grade to the drift. */
const RACE_DAY_RAIN_EXTRA_MM = 5;

// ---------------------------------------------------------------------------
// Time handling
// ---------------------------------------------------------------------------

interface LocalStamp {
  /** YYYY-MM-DD in the venue's local time */
  date: string;
  /** 0..23 local hour */
  hour: number;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2})(?::(\d{2}))?(?::(\d{2}))?(?:\.\d+)?)?$/;
const ZONED_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Local date and hour of an hourly timestamp. Strings without a zone
 * ("2026-10-23T14:00") are already local and read directly; strings with a
 * zone or "Z" are converted into `tz`.
 */
export function toLocalStamp(time: string, tz: string = DEFAULT_TZ): LocalStamp | undefined {
  if (!time) return undefined;
  const trimmed = time.trim();
  if (!ZONED_RE.test(trimmed)) {
    const m = LOCAL_RE.exec(trimmed);
    if (m) {
      const hour = m[4] === undefined ? 0 : Number(m[4]);
      if (hour < 0 || hour > 23) return undefined;
      return { date: `${m[1]}-${m[2]}-${m[3]}`, hour };
    }
  }
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return undefined;
  const d = new Date(ms);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    const hour = Number(get('hour')) % 24;
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number.isNaN(hour) ? 0 : hour };
  } catch {
    // Unknown time zone: fall back to UTC.
    return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
  }
}

function dateToUtcMs(date: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return undefined;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Whole calendar days `date` falls before `raceDayDate` (0 = race day, 1 = the day before, negative = after). */
function daysBefore(date: string, raceDayDate: string): number | undefined {
  const a = dateToUtcMs(date);
  const b = dateToUtcMs(raceDayDate);
  if (a === undefined || b === undefined) return undefined;
  return Math.round((b - a) / 86400000);
}

// ---------------------------------------------------------------------------
// Drift & summary
// ---------------------------------------------------------------------------

/**
 * Expected change in track rating from rain: 0 below 2mm in the 72h lead-up,
 * +1 for 2–8mm, +2 for 8–20mm, +3 above 20mm, plus 1 when more than 5mm falls
 * on race day before 18:00. Never negative; undefined when nothing is known.
 */
export function rainDrift(rainLast72hMm: number | undefined, rainRaceDayMm: number | undefined): number | undefined {
  if (rainLast72hMm === undefined && rainRaceDayMm === undefined) return undefined;
  const lead = Math.max(0, rainLast72hMm ?? 0);
  let drift = lead < 2 ? 0 : lead <= 8 ? 1 : lead <= 20 ? 2 : 3;
  if ((rainRaceDayMm ?? 0) > RACE_DAY_RAIN_EXTRA_MM) drift += 1;
  return Math.max(0, drift);
}

function fmtMm(mm: number): string {
  const r = round(mm, 1);
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function windDescription(windKmh: number | undefined): string | undefined {
  if (windKmh === undefined) return undefined;
  if (windKmh < 20) return 'light winds';
  if (windKmh < 35) return 'a moderate breeze';
  if (windKmh < 50) return `fresh winds (${Math.round(windKmh)} km/h)`;
  return `strong winds (${Math.round(windKmh)} km/h)`;
}

interface SummaryParts {
  venue: string;
  hasData: boolean;
  rainLast72hMm?: number;
  rainPrevDayMm: number;
  rainRaceDayMm?: number;
  maxTempC?: number;
  windKmhMax?: number;
  drift?: number;
}

function buildSummary(p: SummaryParts): string {
  if (!p.hasData) return `No hourly weather data available for ${p.venue}`;

  const lead = p.rainLast72hMm;
  const day = p.rainRaceDayMm;
  const drift = p.drift ?? 0;

  let rainText: string;
  if (lead === undefined) {
    rainText = 'No lead-up rain data';
  } else if (lead < 2) {
    rainText = `Dry lead-up (${fmtMm(lead)}mm in 72h)`;
  } else if (p.rainPrevDayMm >= 0.7 * lead) {
    rainText = `${fmtMm(lead)}mm overnight`;
  } else {
    rainText = `${fmtMm(lead)}mm in the 72h lead-up`;
  }

  if (day !== undefined) {
    if (day > 15) rainText += ` and heavy rain forecast on race day (${fmtMm(day)}mm)`;
    else if (day > RACE_DAY_RAIN_EXTRA_MM) rainText += ' and showers forecast';
    else if (day >= 1) rainText += ' and a few light showers possible';
  }

  const pieces = [rainText];
  if (p.maxTempC !== undefined) pieces.push(`${Math.round(p.maxTempC)}°C`);
  const wind = windDescription(p.windKmhMax);
  if (wind) pieces.push(wind);

  const conclusion =
    drift <= 0
      ? 'track should hold its rating'
      : drift === 1
        ? 'track may ease a grade'
        : drift === 2
          ? 'expect the track to soften a grade or two'
          : 'expect a genuinely wet track, likely a Heavy';

  return `${pieces.join(', ')} — ${conclusion}`;
}

/**
 * Summarise hourly weather for a race day. Rain totals are undefined when no
 * hours fall in the relevant window; temperature and wind use race-day hours
 * when present, else every hour supplied.
 */
export function summariseWeather(input: WeatherInput): WeatherSummary {
  const tz = input.timezone || DEFAULT_TZ;
  const hourly = Array.isArray(input.hourly) ? input.hourly : [];

  let rainLast72hMm: number | undefined;
  let rainPrevDayMm = 0;
  let rainRaceDayMm: number | undefined;
  let raceDayMaxTemp: number | undefined;
  let raceDayMaxWind: number | undefined;
  let anyMaxTemp: number | undefined;
  let anyMaxWind: number | undefined;
  let parsed = 0;

  for (const h of hourly) {
    if (!h) continue;
    const local = toLocalStamp(h.time, tz);
    if (!local) continue;
    const before = daysBefore(local.date, input.raceDayDate);
    if (before === undefined) continue;
    parsed++;

    if (h.tempC !== undefined && Number.isFinite(h.tempC)) anyMaxTemp = Math.max(anyMaxTemp ?? -Infinity, h.tempC);
    if (h.windKmh !== undefined && Number.isFinite(h.windKmh)) anyMaxWind = Math.max(anyMaxWind ?? -Infinity, h.windKmh);

    const rain = h.rainMm !== undefined && Number.isFinite(h.rainMm) ? Math.max(0, h.rainMm) : 0;
    if (before >= 1 && before <= 3) {
      rainLast72hMm = (rainLast72hMm ?? 0) + rain;
      if (before === 1) rainPrevDayMm += rain;
    } else if (before === 0) {
      rainRaceDayMm = rainRaceDayMm ?? 0;
      if (local.hour < RACE_DAY_CUTOFF_HOUR) rainRaceDayMm += rain;
      if (h.tempC !== undefined && Number.isFinite(h.tempC)) raceDayMaxTemp = Math.max(raceDayMaxTemp ?? -Infinity, h.tempC);
      if (h.windKmh !== undefined && Number.isFinite(h.windKmh)) raceDayMaxWind = Math.max(raceDayMaxWind ?? -Infinity, h.windKmh);
    }
  }

  const maxTempC = raceDayMaxTemp ?? anyMaxTemp;
  const windKmhMax = raceDayMaxWind ?? anyMaxWind;
  if (rainLast72hMm !== undefined) rainLast72hMm = round(rainLast72hMm, 1);
  if (rainRaceDayMm !== undefined) rainRaceDayMm = round(rainRaceDayMm, 1);
  const conditionDrift = rainDrift(rainLast72hMm, rainRaceDayMm);

  const summary = buildSummary({
    venue: input.venue,
    hasData: parsed > 0,
    rainLast72hMm,
    rainPrevDayMm,
    rainRaceDayMm,
    maxTempC,
    windKmhMax,
    drift: conditionDrift,
  });

  return {
    source: input.source,
    venue: input.venue,
    fetchedAt: input.fetchedAt,
    rainLast72hMm,
    rainRaceDayMm,
    maxTempC: maxTempC === undefined ? undefined : round(maxTempC, 1),
    windKmhMax: windKmhMax === undefined ? undefined : round(windKmhMax, 1),
    hourly,
    summary,
    conditionDrift,
  };
}

/** Declared rating plus expected drift, clamped to 1..10. */
export function expectedTrackRating(declared: number | undefined, drift: number | undefined): number | undefined {
  if (declared === undefined || !Number.isFinite(declared)) return undefined;
  const d = drift !== undefined && Number.isFinite(drift) ? drift : 0;
  return clamp(Math.round(declared + d), 1, 10);
}

// ---------------------------------------------------------------------------
// Wet-track factor
// ---------------------------------------------------------------------------

function addStats(a: CareerStats | undefined, b: CareerStats | undefined): CareerStats {
  return {
    starts: (a?.starts ?? 0) + (b?.starts ?? 0),
    wins: (a?.wins ?? 0) + (b?.wins ?? 0),
    seconds: (a?.seconds ?? 0) + (b?.seconds ?? 0),
    thirds: (a?.thirds ?? 0) + (b?.thirds ?? 0),
  };
}

function describeStats(label: string, s: CareerStats | undefined): string | undefined {
  if (!s || s.starts <= 0) return undefined;
  return `${label}: ${s.wins} win${s.wins === 1 ? '' : 's'} from ${s.starts} start${s.starts === 1 ? '' : 's'}`;
}

/** Baseline strike rates used when a runner has no career record to compare against. */
const BASELINE_WIN_RATE = 0.15;
const BASELINE_PLACE_RATE = 0.4;

/**
 * Suitability of a runner for the expected going, in -1..1.
 *
 * Rating >= 6 uses the soft + heavy record (heavy listed first on 8+), rating
 * <= 5 the good + firm record. The score blends the runner's win/place rates
 * on that going against its own career rates (70%) and against field
 * baselines of 15% / 40% (30%), shrunk towards zero for fewer than 4 starts.
 * No starts on the going gives score 0 with dataQuality 0.2.
 */
export function wetTrackFactor(runner: Runner, expectedRating: number | undefined): WetTrackFactor {
  if (expectedRating === undefined || !Number.isFinite(expectedRating)) {
    return { score: 0, evidence: 'Track condition unknown', dataQuality: 0 };
  }
  const wet = expectedRating >= 5; // Soft 5 and worse count as wet (Australian rating scale)
  const splits = runner.splits ?? {};
  const label = trackRatingLabel(expectedRating);

  const parts = wet
    ? expectedRating >= 8
      ? [describeStats('Heavy', splits.heavy), describeStats('Soft', splits.soft)]
      : [describeStats('Soft', splits.soft), describeStats('Heavy', splits.heavy)]
    : [describeStats('Good', splits.good), describeStats('Firm', splits.firm)];
  const stats = wet ? addStats(splits.soft, splits.heavy) : addStats(splits.good, splits.firm);

  if (stats.starts <= 0) {
    return {
      score: 0,
      evidence: `Unproven on ${wet ? 'wet' : 'good/firm'} tracks (0 starts; expected ${label})`,
      dataQuality: 0.2,
    };
  }

  const winRate = stats.wins / stats.starts;
  const placeRate = (stats.wins + stats.seconds + stats.thirds) / stats.starts;
  const career = runner.career;
  const careerWin = career && career.starts > 0 ? career.wins / career.starts : BASELINE_WIN_RATE;
  const careerPlace =
    career && career.starts > 0 ? (career.wins + career.seconds + career.thirds) / career.starts : BASELINE_PLACE_RATE;

  const relative = clamp(2 * (winRate - careerWin) + 1.2 * (placeRate - careerPlace), -1, 1);
  const absolute = clamp(2 * (winRate - BASELINE_WIN_RATE) + 1.2 * (placeRate - BASELINE_PLACE_RATE), -1, 1);
  const raw = 0.7 * relative + 0.3 * absolute;
  const confidence = Math.min(1, stats.starts / 4);
  const score = round(clamp(raw * (0.5 + 0.5 * confidence), -1, 1), 2);
  const dataQuality = round(Math.min(1, 0.3 + 0.175 * stats.starts), 2);

  const evidence = `${parts.filter((p): p is string => p !== undefined).join('; ')} (expected ${label})`;
  return { score, evidence, dataQuality };
}
