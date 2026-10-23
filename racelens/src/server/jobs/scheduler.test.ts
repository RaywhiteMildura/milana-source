import { describe, expect, it } from 'vitest';
import type { MeetingPack, Race, RaceResult, ResultWatch } from '../../shared/types.js';
import { AutoRecheckScheduler, dueResultChecks } from './scheduler.js';
import { nextResultCheckAt, RESULT_WATCH } from './research.js';
import { DEFAULT_SETTINGS } from '../store/store.js';

function race(number: number, startIso: string | undefined, over: Partial<Race> = {}): Race {
  return { number, name: `R${number}`, distance: 1200, startTime: startIso, status: 'open', sourceRefs: {}, runners: [], sources: [], verification: { score: 1, sourceCount: 1, conflicts: [], checkedFields: 0, agreedFields: 0 }, fieldSize: 0, fetchedAt: startIso || 't', ...over };
}

function pack(races: Race[], results: MeetingPack['results'] = {}, resultWatch?: MeetingPack['resultWatch']): MeetingPack {
  return { id: 'p', createdAt: 't', updatedAt: 't', meeting: { id: 'p', date: '2026-10-24', venue: 'Flemington', venueSlug: 'flemington', raceType: 'thoroughbred', sourceRefs: {}, sources: [] }, races, predictions: {}, news: [], sourceStatuses: [], dayPatterns: [], results, history: [], verificationScore: 1, settings: DEFAULT_SETTINGS, ...(resultWatch ? { resultWatch } : {}) };
}

describe('AutoRecheckScheduler.dueRaces', () => {
  const sched = new AutoRecheckScheduler({ store: {} as never, jobs: {} as never, researchDeps: () => ({}) as never });
  const now = new Date('2026-10-24T03:00:00.000Z');

  it('fires exactly twice per race: on entering the window and inside the final three minutes, never after the jump', () => {
    const p = pack([race(1, '2026-10-24T02:30:00.000Z'), race(2, '2026-10-24T03:08:00.000Z'), race(3, '2026-10-24T03:40:00.000Z'), race(4, '2026-10-24T03:05:00.000Z')], { 4: { raceNumber: 4, placings: [[1]], recordedAt: 't', source: 'x' } });
    expect(sched.dueRaces(p, now, 10)).toEqual([2]); // R1 jumped, R3 too far, R4 already resulted
    expect(sched.dueRaces(p, new Date('2026-10-24T03:01:00.000Z'), 10)).toEqual([]);
    expect(sched.dueRaces(p, new Date('2026-10-24T03:05:30.000Z'), 10)).toEqual([2]); // final-3-minutes check
    expect(sched.dueRaces(p, new Date('2026-10-24T03:07:00.000Z'), 10)).toEqual([]);
    expect(sched.dueRaces(p, new Date('2026-10-24T03:08:30.000Z'), 10)).toEqual([]); // jumped: nothing
    expect(sched.dueRaces(p, new Date('2026-10-24T03:10:00.000Z'), 10)).toEqual([]);
  });

  it('is disabled when minutes is 0 and ignores abandoned races', () => {
    const p = pack([race(1, '2026-10-24T03:05:00.000Z'), race(2, '2026-10-24T03:06:00.000Z', { status: 'abandoned' })]);
    expect(sched.dueRaces(p, now, 0)).toEqual([]);
    expect(sched.dueRaces(p, now, 10)).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// Automatic results
// ---------------------------------------------------------------------------

const START = Date.parse('2026-10-24T02:00:00.000Z');
const at = (min: number) => new Date(START + min * 60_000);
const iso = (min: number) => at(min).toISOString();
const ON = { autoResults: true };

function result(sources: string[], status: RaceResult['status'] = 'final', raceNumber = 1): RaceResult {
  return { raceNumber, placings: [[6], [2], [9]], recordedAt: iso(3), source: sources[0], status, confirmedBy: sources };
}

function watch(checkedMin: number, attempts: number, nextMin?: number, extra: Partial<ResultWatch> = {}): ResultWatch {
  return { lastCheckedAt: iso(checkedMin), attempts, ...(nextMin !== undefined ? { nextCheckAt: iso(nextMin) } : {}), ...extra };
}

describe('dueResultChecks', () => {
  const r1 = () => race(1, iso(0));

  it.each<[string, MeetingPack, number, number[]]>([
    ['not due before start + 2 min', pack([r1()]), 1.9, []],
    ['first check due at start + 2 min', pack([r1()]), 2, [1]],
    ['not due at +3 after a check at +2 booked the next look for +4', pack([r1()], {}, { 1: watch(2, 1, 4) }), 3, []],
    ['due at +4', pack([r1()], {}, { 1: watch(2, 1, 4) }), 4, [1]],
    ['due when the booked slot is long past (server was off)', pack([r1()], {}, { 1: watch(2, 1, 4) }), 95, [1]],
    ['no entry hours later: one catch-up check is due', pack([r1()]), 300, [1]],
    ['gave up: left alone', pack([r1()], {}, { 1: watch(240, 37, undefined, { gaveUp: true, note: 'No result published after 4 hours - enter it manually or press Fetch results' }) }), 300, []],
    ['settled when final and confirmed by two sources, even with a stale nextCheckAt', pack([r1()], { 1: result(['a', 'b']) }, { 1: watch(4, 2, 6) }), 6, []],
    ['settled when final and confirmed by two sources with no watch entry', pack([r1()], { 1: result(['a', 'b']) }), 6, []],
    ['keeps polling an interim result', pack([r1()], { 1: result(['a'], 'interim') }, { 1: watch(4, 2, 6) }), 6, [1]],
    ['keeps polling an interim result even from two sources', pack([r1()], { 1: result(['a', 'b'], 'interim') }, { 1: watch(4, 2, 6) }), 6, [1]],
    ['one-source final with confirmation checks remaining', pack([r1()], { 1: result(['a']) }, { 1: watch(4, 2, 6, { note: 'Result from a only - waiting for a second source (extra check 1 of 3)' }) }), 6, [1]],
    ['one-source final with no watch entry yet (result came from research): confirmation checks start', pack([r1()], { 1: result(['a']) }), 6, [1]],
    ['one-source final accepted after its extra checks', pack([r1()], { 1: result(['a']) }, { 1: watch(8, 4, undefined, { note: 'One source only' }) }), 10, []],
    ['manual result counts as settled', pack([r1()], { 1: { ...result(['manual']), source: 'manual' } }), 5, []],
    ['abandoned race: nothing', pack([race(1, iso(0), { status: 'abandoned' })]), 5, []],
    ['no start time: nothing', pack([race(1, undefined)]), 5, []],
    ['several races, each on its own clock', pack([r1(), race(2, iso(35)), race(3, iso(70))], {}, { 1: watch(2, 1, 4) }), 37.5, [1, 2]],
  ])('%s', (_name, p, min, expected) => {
    expect(dueResultChecks(p, at(min), ON)).toEqual(expected);
  });

  it('autoResults=false means nothing is ever due', () => {
    expect(dueResultChecks(pack([r1()]), at(5), { autoResults: false })).toEqual([]);
    expect(dueResultChecks(pack([r1()], {}, { 1: watch(2, 1, 4) }), at(10), { autoResults: false })).toEqual([]);
  });

  it('does not mutate the pack', () => {
    const p = pack([r1()], {}, { 1: watch(2, 1, 4) });
    const snapshot = JSON.stringify(p);
    dueResultChecks(p, at(10), ON);
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});

describe('results check schedule (nextResultCheckAt)', () => {
  it.each<[number, number | undefined]>([
    [0, 2],
    [1.5, 2],
    [2, 4],
    [3, 4],
    [4, 6],
    [29.5, 30],
    [30, 35], // 5-minute cadence after 30 min
    [31, 35],
    [34.9, 35],
    [35, 40],
    [89, 90],
    [90, 105], // 15-minute cadence after 90 min
    [91, 105],
    [104, 105],
    [105, 120],
    [239, 240],
    [240, undefined], // gives up after 4 h
    [300, undefined],
  ])('after a check at +%s min the next check is at +%s min', (nowMin, nextMin) => {
    expect(nextResultCheckAt(START, START + nowMin * 60_000)).toBe(nextMin === undefined ? undefined : START + nextMin * 60_000);
  });

  it('walking the schedule minute by minute makes 37 checks over four hours and then gives up', () => {
    const p = pack([race(1, iso(0))]);
    const checks: number[] = [];
    for (let min = 0; min <= 300; min++) {
      if (!dueResultChecks(p, at(min), ON).includes(1)) continue;
      // Stand-in for collectAndRerate with nothing published: book the next slot or give up.
      checks.push(min);
      const w = (p.resultWatch ??= {})[1] ?? { lastCheckedAt: iso(min), attempts: 0 };
      p.resultWatch[1] = w;
      w.lastCheckedAt = iso(min);
      w.attempts += 1;
      const next = nextResultCheckAt(START, at(min).getTime());
      if (next) w.nextCheckAt = new Date(next).toISOString();
      else {
        delete w.nextCheckAt;
        w.gaveUp = true;
      }
    }
    expect(checks.slice(0, 15)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]);
    expect(checks.slice(15, 27)).toEqual([35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90]);
    expect(checks.slice(27)).toEqual([105, 120, 135, 150, 165, 180, 195, 210, 225, 240]);
    expect(checks).toHaveLength(37);
    expect(p.resultWatch![1].attempts).toBe(37);
    expect(p.resultWatch![1].gaveUp).toBe(true);
    expect(at(240).getTime() - START).toBe(RESULT_WATCH.giveUpMs);
  });
});

describe('AutoRecheckScheduler.start', () => {
  it('runs a first tick shortly after start, reports its timing, and stops cleanly', async () => {
    const store = { getSettings: () => DEFAULT_SETTINGS, listPacks: () => [], getPack: () => undefined } as never;
    const jobs = { list: () => [], start: () => undefined } as never;
    const clock = new Date('2026-10-24T02:00:00.000Z');
    const sched = new AutoRecheckScheduler({ store, jobs, researchDeps: () => ({}) as never, now: () => clock });
    expect(sched.status()).toMatchObject({ running: false, autoResults: true, autoRecheckMinutes: DEFAULT_SETTINGS.autoRecheckMinutesBeforeRace, watching: [] });
    sched.start(60_000, 5);
    expect(sched.status().running).toBe(true);
    expect(sched.status().nextTickAt).toBe(new Date(clock.getTime() + 5).toISOString());
    await new Promise((r) => setTimeout(r, 60));
    const status = sched.status();
    expect(status.lastTickAt).toBe(clock.toISOString());
    expect(status.nextTickAt).toBe(new Date(clock.getTime() + 60_000).toISOString());
    sched.stop();
    expect(sched.status().running).toBe(false);
    expect(sched.status().nextTickAt).toBeUndefined();
  });
});
