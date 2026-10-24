import { describe, expect, it } from 'vitest';
import type { FieldAgreement, MeetingPack, Race, RaceRaw, RaceResult, ResultWatch, Runner, Settings } from '../../shared/types.js';
import type { FetchContext } from '../adapters/types.js';
import { AdapterRegistry } from '../adapters/registry.js';
import { silentLogger } from '../core/logger.js';
import { AutoRecheckScheduler, cardRefreshDue, dueResultChecks, RESULTS_RETRY_MS } from './scheduler.js';
import { JobManager } from './manager.js';
import { nextResultCheckAt, predictAll, RESULT_WATCH } from './research.js';
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
    ['settled early by two sources: its one late-correction look is not due before it is booked', pack([r1()], { 1: result(['a', 'b']) }, { 1: watch(4, 2, undefined, { note: 'Confirmed by 2 sources', correctionCheckAt: iso(30) }) }), 29, []],
    ['settled early by two sources: the late-correction look is due', pack([r1()], { 1: result(['a', 'b']) }, { 1: watch(4, 2, undefined, { note: 'Confirmed by 2 sources', correctionCheckAt: iso(30) }) }), 30, [1]],
    ['accepted one-source result: the late-correction look is due', pack([r1()], { 1: result(['a']) }, { 1: watch(8, 4, undefined, { note: 'One source only', correctionCheckAt: iso(30) }) }), 31, [1]],
    ['manual result: never a late-correction look', pack([r1()], { 1: { ...result(['manual']), source: 'manual' } }, { 1: watch(4, 2, undefined, { correctionCheckAt: iso(30) }) }), 31, []],
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

// ---------------------------------------------------------------------------
// Results jobs started by the scheduler
// ---------------------------------------------------------------------------

describe('AutoRecheckScheduler results jobs', () => {
  function setup(opts: { results?: boolean; failSaves?: number } = {}) {
    let clock = at(3);
    let stored = pack([race(1, iso(0))]);
    let failSaves = opts.failSaves ?? 0;
    let fetches = 0;
    const registry = new AdapterRegistry();
    if (opts.results !== false)
      registry.register({
        id: 'a',
        name: 'a',
        kind: 'official',
        capabilities: ['results'],
        fetchResults: async (_m, n) => {
          fetches++;
          return { raceNumber: n, placings: [[1], [2], [3]], recordedAt: clock.toISOString(), source: 'a' };
        },
      });
    const ctx = { http: { bound: () => ({}) }, log: silentLogger, now: () => clock, jurisdiction: 'VIC' } as unknown as FetchContext;
    const store = {
      getSettings: () => DEFAULT_SETTINGS,
      listPacks: () => [{ id: stored.id, meeting: stored.meeting, updatedAt: stored.updatedAt }],
      getPack: () => structuredClone(stored),
      savePack: (p: MeetingPack) => {
        if (failSaves-- > 0) throw new Error('ENOSPC: no space left on device');
        stored = structuredClone(p);
      },
    };
    const jobs = new JobManager();
    const log = { infos: [] as string[], warns: [] as string[] };
    const sched = new AutoRecheckScheduler({
      store: store as never,
      jobs,
      researchDeps: () => ({ registry, ctx, settings: DEFAULT_SETTINGS, now: () => clock }),
      now: () => clock,
      log: { info: (m) => log.infos.push(m), warn: (m) => log.warns.push(m) },
    });
    const settle = async () => {
      for (const j of jobs.list()) await jobs.wait(j.id, 5_000);
    };
    return {
      sched,
      jobs,
      log,
      settle,
      stored: () => stored,
      setStored: (p: MeetingPack) => (stored = p),
      fetches: () => fetches,
      setClock: (min: number) => (clock = at(min)),
    };
  }

  it('a failed results job is logged as a warning, not as success, and the meeting rests a few minutes before the next try', async () => {
    const t = setup({ failSaves: 1 });
    expect(await t.sched.tick()).toBe(1);
    await t.settle();
    expect(t.jobs.list()[0].status).toBe('error');
    expect(t.log.warns).toEqual([`Auto results failed: Flemington R1 - trying again in ${RESULTS_RETRY_MS / 60_000} min: ENOSPC: no space left on device`]);
    expect(t.log.infos.some((m) => /recorded/.test(m))).toBe(false); // nothing was saved, so nothing is claimed
    expect(t.stored().results[1]).toBeUndefined();

    t.setClock(4);
    expect(await t.sched.tick()).toBe(0); // resting, not a new error job every minute
    t.setClock(3 + RESULTS_RETRY_MS / 60_000);
    expect(await t.sched.tick()).toBe(1);
    await t.settle();
    expect(t.stored().results[1]?.placings[0]).toEqual([1]);
    expect(t.log.infos.some((m) => /Flemington R1 recorded/.test(m))).toBe(true);
  });

  it('with every results source turned off it starts nothing and says so once', async () => {
    const t = setup({ results: false });
    expect(await t.sched.tick()).toBe(0);
    t.setClock(4);
    expect(await t.sched.tick()).toBe(0);
    expect(t.jobs.list()).toHaveLength(0);
    expect(t.log.warns).toHaveLength(1);
    expect(t.log.warns[0]).toMatch(/every results source is turned off/);
  });

  it('a results job queued behind another job re-reads the pack and skips races that were checked meanwhile', async () => {
    const t = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const blocker = t.jobs.start('recheck', { meetingId: 'p' }, async () => {
      await gate;
    });
    expect(await t.sched.tick()).toBe(1);
    // While it waits, something else settles R1 (two sources agree).
    const p = t.stored();
    p.results[1] = { ...result(['x', 'y']), raceNumber: 1 };
    p.resultWatch = { 1: watch(3, 1, undefined, { note: 'Confirmed by 2 sources' }) };
    t.setStored(p);
    release();
    await t.jobs.wait(blocker.id);
    await t.settle();
    const job = t.jobs.list().find((j) => j.type === 'results')!;
    expect(job.status).toBe('done');
    expect(job.steps.map((s) => s.status)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(t.fetches()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Race-day refresh of the whole card, and a pre-race check that runs late
// ---------------------------------------------------------------------------

/** Melbourne time on race day (AEDT, +11). */
const local = (hhmm: string) => new Date(`2026-10-24T${hhmm}:00.000+11:00`);
/** 20:00 the night before: when the card was researched. */
const NIGHT_BEFORE = '2026-10-23T09:00:00.000Z';

function agree<T>(value: T): FieldAgreement<T> {
  return { value, agree: ['card'], disagree: [], confidence: 1 };
}

function starter(number: number): Runner {
  const name = ['Alpha', 'Bravo', 'Charlie', 'Delta'][number - 1];
  return {
    id: `r${number}`,
    number,
    name,
    barrier: number,
    jockey: `Rider ${number}`,
    trainer: 'T Trainer',
    weight: 56,
    scratched: false,
    form: [],
    gearChanges: [],
    comments: [],
    ratings: { rating: 90 - number * 3 },
    odds: [],
    fields: { barrier: agree(number), jockey: agree(`Rider ${number}`), trainer: agree('T Trainer'), weight: agree(56), scratched: agree(false), number: agree(number) },
    sources: ['card'],
    verification: { score: 1, sourceCount: 1, conflicts: [], checkedFields: 6, agreedFields: 6 },
    news: [],
  };
}

/** R1 12:25, R2 13:00, R3 13:35 AEDT, researched the night before. */
function racedayPack(fetchedAt = NIGHT_BEFORE): MeetingPack {
  const p = pack(['12:25', '13:00', '13:35'].map((hhmm, i) => race(i + 1, local(hhmm).toISOString(), { runners: [1, 2, 3, 4].map(starter), fieldSize: 4, sources: ['card'], fetchedAt })));
  p.meeting.timezone = 'Australia/Melbourne';
  predictAll(p, DEFAULT_SETTINGS, new Date(NIGHT_BEFORE));
  return p;
}

describe('cardRefreshDue', () => {
  it.each<[string, string, MeetingPack, boolean]>([
    ['not before 07:30 track time', '07:29', racedayPack(), false],
    ['from 07:30 when the card was fetched the night before', '07:30', racedayPack(), true],
    ['not while the card is less than an hour old', '08:00', racedayPack(local('07:10').toISOString()), false],
    ['an hour after the card was fetched', '08:10', racedayPack(local('07:10').toISOString()), true],
    ['never within 15 minutes of a jump', '12:11', racedayPack(), false],
    ['between races, for the races still to run', '12:26', racedayPack(), true],
    ['the last race just past its start may be running late: still refreshed, and it never holds the refresh back', '13:36', racedayPack(), true],
    ['never once the last race is 30 minutes past its start', '14:05', racedayPack(), false],
    ['never once a feed reports the last race run', '13:36', (() => { const p = racedayPack(); p.races[2].status = 'interim'; return p; })(), false],
  ])('%s', (_name, hhmm, p, expected) => {
    expect(cardRefreshDue(p, local(hhmm))).toBe(expected);
  });

  it('only on the meeting\'s own date, by its own clock', () => {
    const tomorrow = racedayPack();
    tomorrow.meeting.date = '2026-10-25';
    expect(cardRefreshDue(tomorrow, local('09:00'))).toBe(false);
    const perth = racedayPack(); // 07:30 AWST is 10:30 AEDT
    perth.meeting.timezone = 'Australia/Perth';
    expect(cardRefreshDue(perth, local('10:29'))).toBe(false);
    expect(cardRefreshDue(perth, local('10:30'))).toBe(true);
  });
});

describe('AutoRecheckScheduler race-day refresh and late pre-race checks', () => {
  function setup(settings: Settings = DEFAULT_SETTINGS) {
    let clock = local('07:00');
    let stored = racedayPack();
    const calls: number[] = [];
    let scratched: number | undefined;
    let down = false;
    const registry = new AdapterRegistry();
    registry.register({
      id: 'card',
      name: 'card',
      kind: 'official',
      capabilities: ['racecard'],
      fetchRace: async (_m, n, c) => {
        calls.push(n);
        if (down) throw new Error('HTTP 503');
        const r = stored.races.find((x) => x.number === n)!;
        return {
          number: n,
          name: r.name,
          distance: r.distance,
          startTime: r.startTime,
          status: 'open',
          sourceRefs: {},
          runners: r.runners.map((x) => ({ number: x.number, name: x.name, barrier: x.barrier, jockey: x.jockey, trainer: x.trainer, weight: x.weight, ratings: x.ratings, scratched: n === 1 && x.number === scratched })),
          source: 'card',
          fetchedAt: c.now().toISOString(),
        } as RaceRaw;
      },
    });
    const ctx = { http: { bound: () => ({}) }, log: silentLogger, now: () => clock, jurisdiction: 'VIC' } as unknown as FetchContext;
    const store = {
      getSettings: () => settings,
      listPacks: () => [{ id: stored.id, meeting: stored.meeting, updatedAt: stored.updatedAt }],
      getPack: () => structuredClone(stored),
      savePack: (p: MeetingPack) => (stored = structuredClone(p)),
    };
    const jobs = new JobManager();
    const infos: string[] = [];
    const make = () => new AutoRecheckScheduler({ store: store as never, jobs, researchDeps: () => ({ registry, ctx, settings, now: () => clock }), now: () => clock, log: { info: (m) => infos.push(m), warn: () => undefined } });
    let sched = make();
    const tick = async (hhmm: string) => {
      clock = local(hhmm);
      const n = await sched.tick();
      for (const j of jobs.list()) await jobs.wait(j.id, 5_000);
      return n;
    };
    return {
      jobs,
      calls,
      infos,
      tick,
      stored: () => stored,
      scratch: (n: number) => (scratched = n),
      setDown: (v: boolean) => (down = v),
      setClock: (hhmm: string) => (clock = local(hhmm)),
      restart: () => (sched = make()),
      sched: () => sched,
    };
  }

  it('from 07:30 track time it refreshes every race still to run, at most hourly, so a morning scratching reaches the picks', async () => {
    const t = setup();
    expect(await t.tick('07:00')).toBe(0);
    expect(await t.tick('07:29')).toBe(0);
    const top = t.stored().predictions[3].top[0].number;
    expect(t.stored().predictions[1].top[0].number).toBe(top); // same field, same picks
    t.scratch(top); // scratched overnight in R1

    expect(await t.tick('07:30')).toBe(1);
    expect(t.calls).toEqual([1, 2, 3]);
    const p = t.stored();
    for (const r of p.races) expect(r.fetchedAt).toBe(local('07:30').toISOString());
    for (const n of [1, 2, 3]) expect(p.predictions[n].generatedAt).toBe(local('07:30').toISOString());
    expect(p.races[0].runners.find((r) => r.number === top)!.scratched).toBe(true);
    expect(p.predictions[1].ranked.map((r) => r.number)).not.toContain(top);
    expect(p.predictions[1].betting.suggestions.flatMap((b) => b.runners)).not.toContain(top);
    expect(p.history.at(-1)).toMatchObject({ type: 'recheck', summary: expect.stringMatching(/^Automatic race-day refresh \(every race still to run\): \d+ changes?/) });
    expect(p.history.at(-1)?.changes).toContain(`R1: ${p.races[0].runners.find((r) => r.number === top)!.name} (${top}) scratched`);
    expect(t.infos).toContain('Race-day refresh: Flemington (every race still to run)');

    expect(await t.tick('07:31')).toBe(0);
    expect(await t.tick('08:29')).toBe(0);
    expect(await t.tick('08:30')).toBe(1);
    expect(t.calls).toEqual([1, 2, 3, 1, 2, 3]);
  });

  it('waits while another job of the meeting is queued or running, costing nothing, and goes on the next tick', async () => {
    const t = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const blocker = t.jobs.start('research', { meetingId: 'p' }, async () => {
      await gate;
    });
    t.setClock('07:30');
    expect(await t.sched().tick()).toBe(0);
    expect(t.jobs.list()).toHaveLength(1);
    release();
    await t.jobs.wait(blocker.id);
    expect(t.calls).toEqual([]);
    expect(await t.tick('07:31')).toBe(1);
    expect(t.calls).toEqual([1, 2, 3]);
  });

  it('keeps the picks of races that have jumped (refreshing the card of one just past its start) and stops once the last race is over', async () => {
    const t = setup();
    const r1 = structuredClone(t.stored().predictions[1]);
    expect(await t.tick('12:11')).toBe(0); // R1 jumps within 15 minutes: its own pre-race checks are about to run
    expect(t.calls).toEqual([]);
    expect(await t.tick('12:26')).toBe(1);
    expect(t.calls).toEqual([1, 2, 3]); // R1 jumped a minute ago and may be running late: its card is looked at too
    expect(t.stored().predictions[1]).toEqual(r1); // the sources still give 12:25, so it keeps the picks it jumped with
    expect(t.stored().predictions[2].generatedAt).toBe(local('12:26').toISOString());
    expect(await t.tick('14:05')).toBe(0);
  });

  it('a refresh that reaches no source is not retried every minute, and a restarted server refreshes a stale card on its first tick', async () => {
    const t = setup();
    t.setDown(true);
    expect(await t.tick('07:30')).toBe(1);
    expect(t.stored().races[0].fetchedAt).toBe(NIGHT_BEFORE); // nothing new: the card keeps the time it was really fetched
    expect(await t.tick('07:31')).toBe(0);
    expect(await t.tick('08:29')).toBe(0);
    t.restart();
    expect(await t.tick('08:31')).toBe(1); // the card is still old: refreshed straight away
    t.setDown(false);
    t.restart();
    expect(await t.tick('08:32')).toBe(1);
    expect(t.stored().races[0].fetchedAt).toBe(local('08:32').toISOString());
    t.restart();
    expect(await t.tick('08:40')).toBe(0); // fresh card: nothing to do, whatever the scheduler remembers
  });

  it('is off together with the automatic pre-race checks', async () => {
    const t = setup({ ...DEFAULT_SETTINGS, autoRecheckMinutesBeforeRace: 0 });
    expect(await t.tick('07:30')).toBe(0);
    expect(t.calls).toEqual([]);
  });

  it('a pre-race check queued behind a long job until after the jump is skipped: the race keeps the picks it jumped with', async () => {
    const t = setup();
    const r1 = structuredClone(t.stored().predictions[1]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const blocker = t.jobs.start('research', { meetingId: 'p' }, async () => {
      await gate;
    });
    t.setClock('12:16'); // R1 jumps in nine minutes
    expect(await t.sched().tick()).toBe(1);
    const check = t.jobs.list().find((j) => j.type === 'recheck')!;
    expect(check.raceNumber).toBe(1);
    t.setClock('12:26'); // the long job ends after the jump
    release();
    await t.jobs.wait(blocker.id);
    const done = await t.jobs.wait(check.id);
    expect(done.status).toBe('done');
    expect(done.steps.map((s) => s.status)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(done.message).toBe('R1 has already jumped - picks left as they were');
    expect(t.calls).toEqual([]);
    expect(t.stored().predictions[1]).toEqual(r1);
    expect(t.infos).toContain('Auto pre-race check skipped: Flemington R1 has already jumped');
  });
});

describe('a race put back to a later start time', () => {
  it('gets its automatic pre-race checks again before the new jump', () => {
    const sched = new AutoRecheckScheduler({ store: {} as never, jobs: {} as never, researchDeps: () => ({}) as never });
    const pack = {
      id: 'p',
      meeting: { date: '2026-10-24', timezone: 'Australia/Melbourne' },
      races: [{ number: 7, startTime: '2026-10-24T04:40:00.000Z', status: 'open' }],
      results: {},
    } as never as Parameters<typeof sched.dueRaces>[0];
    expect(sched.dueRaces(pack, new Date('2026-10-24T04:31:00.000Z'), 10)).toEqual([7]);
    expect(sched.dueRaces(pack, new Date('2026-10-24T04:38:00.000Z'), 10)).toEqual([7]);
    expect(sched.dueRaces(pack, new Date('2026-10-24T04:39:00.000Z'), 10)).toEqual([]);
    // The sources now say 15:55 instead of 15:40.
    pack.races[0].startTime = '2026-10-24T04:55:00.000Z';
    expect(sched.dueRaces(pack, new Date('2026-10-24T04:46:00.000Z'), 10)).toEqual([7]);
    expect(sched.dueRaces(pack, new Date('2026-10-24T04:53:00.000Z'), 10)).toEqual([7]);
    expect(sched.dueRaces(pack, new Date('2026-10-24T04:54:00.000Z'), 10)).toEqual([]);
  });
});
