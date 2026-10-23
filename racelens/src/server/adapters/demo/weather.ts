/**
 * demo-weather — an Open-Meteo-shaped forecast/archive for the demo meeting.
 *
 * Builds a WeatherSummary (rain in the 72h before race day, race-day rain, max
 * temperature, max wind, hourly series, prose summary and an expected track
 * condition drift) from fixtures/demo/weather.json.
 */
import type { WeatherHour, WeatherSummary } from '../../../shared/types.js';
import { normaliseName, round } from '../../../shared/util.js';
import type { FetchContext, SourceAdapter } from '../types.js';
import { DEMO_VENUE_SLUG, demoDelay, loadDemoWeather, nowIso, type DemoWeatherFile } from './pack.js';

export const DEMO_WEATHER_ID = 'demo-weather';

const DAY_MS = 86400000;

function offsetSuffix(seconds: number | undefined): string {
  const s = seconds ?? 0;
  const sign = s < 0 ? '-' : '+';
  const abs = Math.abs(s);
  const hh = String(Math.floor(abs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

function windLabel(deg: number | undefined): string {
  if (deg === undefined || !Number.isFinite(deg)) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function weekday(date: string): string {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'UTC' });
}

/** Expected drift in track rating from rain (positive = softer). */
export function conditionDriftFor(rainLast72hMm: number, rainRaceDayMm: number): number {
  let drift = 0;
  if (rainLast72hMm >= 25) drift += 2;
  else if (rainLast72hMm >= 10) drift += 1;
  if (rainRaceDayMm >= 15) drift += 2;
  else if (rainRaceDayMm >= 5) drift += 1;
  return drift;
}

export function buildWeatherSummary(file: DemoWeatherFile, venue: string, date: string, fetchedAt: string): WeatherSummary | null {
  const h = file.hourly;
  if (!h?.time?.length) return null;
  const suffix = offsetSuffix(file.utc_offset_seconds);
  const raceDayStart = Date.parse(`${date}T00:00:00${suffix}`);
  if (!Number.isFinite(raceDayStart)) return null;
  const raceDayEnd = raceDayStart + DAY_MS;
  const windowStart = raceDayStart - 3 * DAY_MS;

  const hourly: WeatherHour[] = [];
  let rainLast72h = 0;
  let rainRaceDay = 0;
  let maxTemp = -Infinity;
  let windMax = 0;
  let windDirAtMax: number | undefined;
  let raceDayHours = 0;
  let rainHoursInWindow = 0;
  let lastRainMs: number | undefined;

  for (let i = 0; i < h.time.length; i++) {
    const iso = `${h.time[i]}:00${suffix}`;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) continue;
    const hour: WeatherHour = { time: iso };
    const temp = h.temperature_2m?.[i];
    const rain = h.precipitation?.[i];
    const prob = h.precipitation_probability?.[i];
    const wind = h.wind_speed_10m?.[i];
    const dir = h.wind_direction_10m?.[i];
    if (typeof temp === 'number') hour.tempC = temp;
    if (typeof rain === 'number') hour.rainMm = rain;
    if (typeof prob === 'number') hour.rainProb = prob;
    if (typeof wind === 'number') hour.windKmh = wind;
    if (typeof dir === 'number') hour.windDir = dir;
    if (t >= windowStart && t < raceDayEnd) hourly.push(hour);
    if (t >= windowStart && t < raceDayStart && typeof rain === 'number') {
      rainLast72h += rain;
      if (rain > 0) {
        rainHoursInWindow++;
        lastRainMs = t;
      }
    }
    if (t >= raceDayStart && t < raceDayEnd) {
      raceDayHours++;
      if (typeof rain === 'number') rainRaceDay += rain;
      if (typeof temp === 'number') maxTemp = Math.max(maxTemp, temp);
      if (typeof wind === 'number' && wind >= windMax) {
        windMax = wind;
        windDirAtMax = dir;
      }
    }
  }
  if (!raceDayHours) return null;

  rainLast72h = round(rainLast72h, 1);
  rainRaceDay = round(rainRaceDay, 1);
  const conditionDrift = conditionDriftFor(rainLast72h, rainRaceDay);
  const dryHours = lastRainMs !== undefined ? Math.round((raceDayStart - lastRainMs) / 3600000) : undefined;

  const parts: string[] = [];
  parts.push(
    rainRaceDay >= 5
      ? `Showers at ${venue} on ${weekday(date)} (${rainRaceDay}mm expected)`
      : rainRaceDay > 0
        ? `Mostly fine at ${venue} on ${weekday(date)} with a light shower possible (${rainRaceDay}mm)`
        : `Fine and dry at ${venue} on ${weekday(date)}`,
  );
  if (Number.isFinite(maxTemp)) parts.push(`top of ${Math.round(maxTemp)}°C`);
  if (windMax > 0) parts.push(`${windLabel(windDirAtMax)} wind to ${Math.round(windMax)} km/h`.trim());
  let sentence = parts.join(', ') + '.';
  if (rainLast72h > 0) {
    sentence += ` ${rainLast72h}mm fell in the previous 72h over ${rainHoursInWindow} hours${dryHours !== undefined ? `, with ${dryHours} dry hours since` : ''}.`;
  } else {
    sentence += ' No rain in the previous 72 hours.';
  }
  sentence +=
    conditionDrift === 0
      ? ' Track rating expected to hold.'
      : ` Expect the track to ease about ${conditionDrift} point${conditionDrift === 1 ? '' : 's'}.`;

  return {
    source: DEMO_WEATHER_ID,
    venue,
    fetchedAt,
    rainLast72hMm: rainLast72h,
    rainRaceDayMm: rainRaceDay,
    maxTempC: Number.isFinite(maxTemp) ? round(maxTemp, 1) : undefined,
    windKmhMax: round(windMax, 1),
    hourly,
    summary: sentence,
    conditionDrift,
  };
}

function venueMatches(venue: string, file: DemoWeatherFile): boolean {
  const v = normaliseName(venue);
  if (!v) return false;
  const slug = normaliseName(file.venueSlug || DEMO_VENUE_SLUG);
  return v.includes(slug) || slug.includes(v);
}

export const demoWeatherAdapter: SourceAdapter = {
  id: DEMO_WEATHER_ID,
  name: 'Demo Weather (Open-Meteo style)',
  kind: 'weather',
  capabilities: ['weather'],
  homepage: 'https://demo-weather.racelens.local/',

  async fetchWeather(venue: string, date: string, ctx: FetchContext): Promise<WeatherSummary | null> {
    await demoDelay(ctx);
    const file = loadDemoWeather();
    if (!venueMatches(venue, file)) {
      ctx.log.debug(`${DEMO_WEATHER_ID}: no data for venue ${venue}`);
      return null;
    }
    return buildWeatherSummary(file, file.venue || venue, date, nowIso(ctx));
  },
};
