import type { WeatherHour, WeatherSummary } from '../../../shared/types.js';
import type { FetchContext, SourceAdapter } from '../types.js';
import { summariseWeather } from '../../core/weather.js';
import { findVenue } from './venues.js';

/**
 * Open-Meteo: free, key-less weather API. We pull the 3 days before the
 * meeting (rain softens tracks) and the race-day forecast.
 * https://open-meteo.com/en/docs
 */
interface OpenMeteoResponse {
  hourly?: {
    time?: string[];
    temperature_2m?: Array<number | null>;
    precipitation?: Array<number | null>;
    precipitation_probability?: Array<number | null>;
    wind_speed_10m?: Array<number | null>;
    wind_direction_10m?: Array<number | null>;
  };
  timezone?: string;
}

export class OpenMeteoAdapter implements SourceAdapter {
  id = 'openmeteo';
  name = 'Open-Meteo weather';
  kind = 'weather' as const;
  capabilities = ['weather' as const];
  homepage = 'https://open-meteo.com';

  async fetchWeather(venue: string, date: string, ctx: FetchContext): Promise<WeatherSummary | null> {
    const v = findVenue(venue);
    if (!v) {
      ctx.log.warn(`openmeteo: unknown venue ${venue}`);
      return null;
    }
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${v.lat}&longitude=${v.lon}&hourly=temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m&past_days=3&forecast_days=3&timezone=${encodeURIComponent(v.tz)}`;
    const data = await ctx.http.getJson<OpenMeteoResponse>(url, { expect: 'json', timeoutMs: 10_000 });
    const h = data.hourly || {};
    const times = h.time || [];
    const hourly: WeatherHour[] = times.map((t, i) => ({
      time: t,
      tempC: num(h.temperature_2m?.[i]),
      rainMm: num(h.precipitation?.[i]),
      rainProb: num(h.precipitation_probability?.[i]),
      windKmh: num(h.wind_speed_10m?.[i]),
      windDir: num(h.wind_direction_10m?.[i]),
    }));
    return summariseWeather({ venue: v.name, source: this.id, fetchedAt: ctx.now().toISOString(), hourly, raceDayDate: date, timezone: v.tz });
  }
}

function num(v: number | null | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
