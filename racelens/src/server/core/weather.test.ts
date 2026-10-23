import { describe, expect, it } from 'vitest';
import type { Runner, WeatherHour } from '../../shared/types.js';
import { expectedTrackRating, rainDrift, summariseWeather, toLocalStamp, wetTrackFactor } from './weather.js';

const RACE_DAY = '2026-10-24';

/** One hourly entry per hour for `date` (local, zone-less timestamps) with the given rain spread evenly. */
function day(date: string, opts: { rainMm?: number; tempC?: number; windKmh?: number; hours?: number[] } = {}): WeatherHour[] {
  const hours = opts.hours ?? Array.from({ length: 24 }, (_, i) => i);
  const perHour = (opts.rainMm ?? 0) / hours.length;
  return hours.map((h) => ({
    time: `${date}T${String(h).padStart(2, '0')}:00`,
    rainMm: perHour,
    tempC: opts.tempC,
    windKmh: opts.windKmh,
  }));
}

function summarise(hourly: WeatherHour[], timezone?: string) {
  return summariseWeather({ venue: 'Flemington', source: 'test', fetchedAt: '2026-10-23T00:00:00Z', hourly, raceDayDate: RACE_DAY, timezone });
}

function runner(partial: Partial<Runner>): Runner {
  const agree = <T,>(value: T) => ({ value, agree: ['test'], disagree: [], confidence: 1 });
  return {
    id: 'r1',
    number: 1,
    name: 'Test Horse',
    scratched: false,
    form: [],
    gearChanges: [],
    comments: [],
    ratings: {},
    odds: [],
    fields: {
      barrier: agree<number>(1),
      jockey: agree<string>(''),
      trainer: agree<string>(''),
      weight: agree<number>(55),
      scratched: agree<boolean>(false),
      number: agree<number>(1),
    },
    sources: ['test'],
    verification: { score: 1, sourceCount: 1, conflicts: [], checkedFields: 0, agreedFields: 0 },
    news: [],
    ...partial,
  };
}

describe('toLocalStamp', () => {
  it('reads zone-less timestamps as local', () => {
    expect(toLocalStamp('2026-10-24T14:00')).toEqual({ date: '2026-10-24', hour: 14 });
    expect(toLocalStamp('2026-10-24T09:30:00')).toEqual({ date: '2026-10-24', hour: 9 });
    expect(toLocalStamp('2026-10-24')).toEqual({ date: '2026-10-24', hour: 0 });
  });

  it('converts zoned timestamps into the venue time zone', () => {
    // 23:00Z on the 23rd is 10:00 on the 24th in Melbourne (AEDT, +11)
    expect(toLocalStamp('2026-10-23T23:00:00Z', 'Australia/Melbourne')).toEqual({ date: '2026-10-24', hour: 10 });
    expect(toLocalStamp('2026-10-24T02:00:00+11:00', 'Australia/Melbourne')).toEqual({ date: '2026-10-24', hour: 2 });
  });

  it('returns undefined for junk', () => {
    expect(toLocalStamp('not a date')).toBeUndefined();
    expect(toLocalStamp('')).toBeUndefined();
  });
});

describe('rainDrift thresholds', () => {
  it('maps lead-up rain onto grades', () => {
    expect(rainDrift(0, 0)).toBe(0);
    expect(rainDrift(1.9, 0)).toBe(0);
    expect(rainDrift(2, 0)).toBe(1);
    expect(rainDrift(8, 0)).toBe(1);
    expect(rainDrift(8.1, 0)).toBe(2);
    expect(rainDrift(20, 0)).toBe(2);
    expect(rainDrift(20.1, 0)).toBe(3);
    expect(rainDrift(60, 0)).toBe(3);
  });

  it('adds a grade for race-day rain over 5mm and never goes negative', () => {
    expect(rainDrift(0, 5)).toBe(0);
    expect(rainDrift(0, 5.1)).toBe(1);
    expect(rainDrift(25, 12)).toBe(4);
    expect(rainDrift(-3, undefined)).toBe(0);
  });

  it('is undefined with no information at all', () => {
    expect(rainDrift(undefined, undefined)).toBeUndefined();
    expect(rainDrift(undefined, 0)).toBe(0);
  });
});

describe('summariseWeather', () => {
  it('handles an empty hourly array', () => {
    const s = summarise([]);
    expect(s.rainLast72hMm).toBeUndefined();
    expect(s.rainRaceDayMm).toBeUndefined();
    expect(s.maxTempC).toBeUndefined();
    expect(s.windKmhMax).toBeUndefined();
    expect(s.conditionDrift).toBeUndefined();
    expect(s.summary).toMatch(/No hourly weather data/);
    expect(s.venue).toBe('Flemington');
    expect(s.hourly).toEqual([]);
  });

  it('sums rain over the three days before race day only', () => {
    const hourly = [
      ...day('2026-10-20', { rainMm: 100 }), // 4 days out: ignored
      ...day('2026-10-21', { rainMm: 1 }),
      ...day('2026-10-22', { rainMm: 0.5 }),
      ...day('2026-10-23', { rainMm: 0.5 }),
      ...day('2026-10-24', { rainMm: 0, tempC: 19, windKmh: 12 }),
    ];
    const s = summarise(hourly);
    expect(s.rainLast72hMm).toBe(2);
    expect(s.rainRaceDayMm).toBe(0);
    expect(s.maxTempC).toBe(19);
    expect(s.windKmhMax).toBe(12);
    expect(s.conditionDrift).toBe(1);
  });

  it('describes a dry lead-up with temperature and light winds', () => {
    const hourly = [...day('2026-10-23', { rainMm: 0.4 }), ...day('2026-10-24', { tempC: 19, windKmh: 12 })];
    const s = summarise(hourly);
    expect(s.conditionDrift).toBe(0);
    expect(s.summary).toBe('Dry lead-up (0.4mm in 72h), 19°C, light winds — track should hold its rating');
  });

  it('counts race-day rain only before 18:00 and flags showers', () => {
    const hourly = [
      ...day('2026-10-23', { rainMm: 12 }),
      ...day('2026-10-24', { rainMm: 6, hours: [8, 10, 12, 14, 16, 17] }), // 1mm each, all before 18:00
      ...day('2026-10-24', { rainMm: 40, hours: [18, 19, 20, 21] }), // evening: ignored for race-day total
    ];
    const s = summarise(hourly);
    expect(s.rainLast72hMm).toBe(12);
    expect(s.rainRaceDayMm).toBe(6);
    expect(s.conditionDrift).toBe(3); // 8–20mm -> +2, race-day > 5mm -> +1
    expect(s.summary).toContain('12mm overnight');
    expect(s.summary).toContain('showers forecast');
    expect(s.summary).toContain('genuinely wet');
  });

  it('uses "soften a grade or two" wording for a +2 drift', () => {
    const hourly = [...day('2026-10-22', { rainMm: 10 }), ...day('2026-10-24', { tempC: 15, windKmh: 40 })];
    const s = summarise(hourly);
    expect(s.conditionDrift).toBe(2);
    expect(s.summary).toContain('10mm in the 72h lead-up');
    expect(s.summary).toContain('soften a grade or two');
    expect(s.summary).toContain('fresh winds (40 km/h)');
  });

  it('prefers race-day temperature and wind but falls back to any hour', () => {
    const leadOnly = summarise(day('2026-10-23', { tempC: 30, windKmh: 55 }));
    expect(leadOnly.maxTempC).toBe(30);
    expect(leadOnly.windKmhMax).toBe(55);
    expect(leadOnly.rainRaceDayMm).toBeUndefined();

    const both = summarise([...day('2026-10-23', { tempC: 30 }), ...day('2026-10-24', { tempC: 21 })]);
    expect(both.maxTempC).toBe(21);
  });

  it('handles zoned timestamps via the venue time zone', () => {
    // 2026-10-23T20:00Z = 07:00 local on race day (AEDT); 2026-10-23T05:00Z = 16:00 local the day before.
    const s = summarise(
      [
        { time: '2026-10-23T05:00:00Z', rainMm: 3 },
        { time: '2026-10-23T20:00:00Z', rainMm: 1, tempC: 17 },
      ],
      'Australia/Melbourne',
    );
    expect(s.rainLast72hMm).toBe(3);
    expect(s.rainRaceDayMm).toBe(1);
    expect(s.maxTempC).toBe(17);
  });

  it('skips unparseable hours and treats missing rain as zero', () => {
    const s = summarise([{ time: 'garbage', rainMm: 50 }, { time: '2026-10-23T10:00' }, { time: '2026-10-24T10:00' }]);
    expect(s.rainLast72hMm).toBe(0);
    expect(s.rainRaceDayMm).toBe(0);
    expect(s.conditionDrift).toBe(0);
  });
});

describe('expectedTrackRating', () => {
  it('adds drift and clamps to 1..10', () => {
    expect(expectedTrackRating(4, 2)).toBe(6);
    expect(expectedTrackRating(9, 3)).toBe(10);
    expect(expectedTrackRating(4, undefined)).toBe(4);
    expect(expectedTrackRating(undefined, 2)).toBeUndefined();
    expect(expectedTrackRating(0, -5)).toBe(1);
  });
});

describe('wetTrackFactor', () => {
  const career = { starts: 12, wins: 3, seconds: 2, thirds: 1 };

  it('is neutral with no expected rating', () => {
    const f = wetTrackFactor(runner({ career }), undefined);
    expect(f.score).toBe(0);
    expect(f.dataQuality).toBe(0);
  });

  it('gives score 0 and dataQuality 0.2 for a horse unproven on wet tracks', () => {
    const f = wetTrackFactor(runner({ career, splits: { good: { starts: 8, wins: 3, seconds: 1, thirds: 1 } } }), 7);
    expect(f.score).toBe(0);
    expect(f.dataQuality).toBe(0.2);
    expect(f.evidence).toMatch(/Unproven on wet tracks/);
    const noSplits = wetTrackFactor(runner({ career }), 6);
    expect(noSplits.score).toBe(0);
    expect(noSplits.dataQuality).toBe(0.2);
  });

  it('rewards proven wet form on a soft track', () => {
    const f = wetTrackFactor(runner({ career, splits: { soft: { starts: 3, wins: 2, seconds: 1, thirds: 0 } } }), 6);
    expect(f.score).toBeGreaterThan(0.6);
    expect(f.score).toBeLessThanOrEqual(1);
    expect(f.evidence).toContain('Soft: 2 wins from 3 starts');
    expect(f.evidence).toContain('Soft 6');
    expect(f.dataQuality).toBeGreaterThan(0.7);
  });

  it('penalises poor wet form and combines soft with heavy', () => {
    const f = wetTrackFactor(
      runner({ career, splits: { soft: { starts: 3, wins: 0, seconds: 0, thirds: 0 }, heavy: { starts: 1, wins: 0, seconds: 0, thirds: 0 } } }),
      8,
    );
    expect(f.score).toBeLessThan(-0.6);
    expect(f.evidence).toContain('Heavy: 0 wins from 1 start');
    expect(f.evidence).toContain('Soft: 0 wins from 3 starts');
    expect(f.evidence.indexOf('Heavy')).toBeLessThan(f.evidence.indexOf('Soft')); // heavy listed first on 8+
    expect(f.dataQuality).toBe(1);
  });

  it('uses good/firm form for a dry expected rating', () => {
    const good = wetTrackFactor(runner({ career, splits: { good: { starts: 6, wins: 3, seconds: 2, thirds: 0 }, soft: { starts: 2, wins: 0, seconds: 0, thirds: 0 } } }), 4);
    expect(good.score).toBeGreaterThan(0.3);
    expect(good.evidence).toContain('Good: 3 wins from 6 starts');
    const none = wetTrackFactor(runner({ career, splits: { soft: { starts: 4, wins: 2, seconds: 1, thirds: 0 } } }), 3);
    expect(none.score).toBe(0);
    expect(none.dataQuality).toBe(0.2);
    expect(none.evidence).toMatch(/Unproven on good\/firm/);
  });

  it('shrinks a single-start record and uses baselines when career is missing', () => {
    const one = wetTrackFactor(runner({ splits: { heavy: { starts: 1, wins: 1, seconds: 0, thirds: 0 } } }), 9);
    const four = wetTrackFactor(runner({ splits: { heavy: { starts: 4, wins: 4, seconds: 0, thirds: 0 } } }), 9);
    expect(one.score).toBeGreaterThan(0);
    expect(four.score).toBeGreaterThan(one.score);
    expect(one.dataQuality).toBeLessThan(four.dataQuality);
    expect(four.score).toBeLessThanOrEqual(1);
  });

  it('is roughly neutral when wet form mirrors career form', () => {
    const f = wetTrackFactor(runner({ career: { starts: 20, wins: 4, seconds: 4, thirds: 2 }, splits: { soft: { starts: 5, wins: 1, seconds: 1, thirds: 0 } } }), 6);
    expect(Math.abs(f.score)).toBeLessThan(0.2);
  });
});
