/**
 * demo-official — the "stewards / racing authority" view of the demo meeting.
 *
 * Authoritative numbers, barriers, jockeys, trainers, weights and scratchings.
 * No form or odds. Supplies results for races 1–3 once their scheduled start
 * time has passed (per ctx.now()) or when RACELENS_DEMO_RESULTS_READY=all.
 */
import type { MeetingRaw, MeetingSummary, RaceRaw, RaceResult, RunnerRaw } from '../../../shared/types.js';
import type { FetchContext, SourceAdapter } from '../types.js';
import {
  DEMO_DATE,
  demoDelay,
  demoMeetingSummary,
  demoRaceSummary,
  emptyRaceRaw,
  findDemoRace,
  isDemoDate,
  isDemoMeeting,
  loadDemoPack,
  loadDemoResults,
  nowIso,
  type DemoRace,
  type DemoResult,
  type DemoRunner,
} from './pack.js';

export const DEMO_OFFICIAL_ID = 'demo-official';
const SOURCE_REF = 'FLE-20261024';

export function resultsReadyForAll(): boolean {
  return (process.env.RACELENS_DEMO_RESULTS_READY ?? '').trim().toLowerCase() === 'all';
}

/** A result is published only once the race has been run (scheduled start < now), or when forced via env. */
export function demoResultAvailable(race: DemoRace, result: DemoResult | undefined, ctx: FetchContext): boolean {
  if (!result) return false;
  if (resultsReadyForAll()) return true;
  const start = Date.parse(race.startTime);
  if (!Number.isFinite(start)) return false;
  return start < ctx.now().getTime();
}

export function findDemoResult(raceNumber: number): DemoResult | undefined {
  return loadDemoResults().results.find((r) => r.raceNumber === raceNumber);
}

function officialRunner(r: DemoRunner): RunnerRaw {
  const out: RunnerRaw = {
    number: r.number,
    name: r.name,
    barrier: r.barrier,
    jockey: r.jockey,
    trainer: r.trainer,
    weight: r.weight,
    scratched: Boolean(r.scratched),
    age: r.age,
    sex: r.sex,
    colour: r.colour,
    sire: r.sire,
    dam: r.dam,
    damSire: r.damSire,
    country: r.country,
  };
  if (r.claim !== undefined) out.claim = r.claim;
  if (r.emergency) out.emergency = true;
  if (r.gearChanges?.length) out.gearChanges = [...r.gearChanges];
  return out;
}

function toRaceResult(result: DemoResult, ctx: FetchContext): RaceResult {
  return {
    raceNumber: result.raceNumber,
    placings: structuredClone(result.placings),
    margins: [...result.margins],
    time: result.time,
    dividends: { ...result.dividends },
    recordedAt: nowIso(ctx),
    source: DEMO_OFFICIAL_ID,
  };
}

function buildRace(race: DemoRace, ctx: FetchContext): RaceRaw {
  const result = findDemoResult(race.number);
  const final = demoResultAvailable(race, result, ctx);
  const runners = race.runners.map(officialRunner);
  if (final && result) {
    result.finishingOrder.forEach((num, idx) => {
      const runner = runners.find((r) => r.number === num);
      if (!runner) return;
      runner.finishingPosition = idx + 1;
      if (idx < result.margins.length) runner.margin = result.margins[idx];
    });
  }
  const raw: RaceRaw = {
    ...demoRaceSummary(race, DEMO_OFFICIAL_ID, `${SOURCE_REF}-R${race.number}`, final ? 'final' : 'open'),
    runners,
    source: DEMO_OFFICIAL_ID,
    fetchedAt: nowIso(ctx),
  };
  if (final && result) raw.results = structuredClone(result.placings);
  return raw;
}

export const demoOfficialAdapter: SourceAdapter = {
  id: DEMO_OFFICIAL_ID,
  name: 'Demo Racing Authority (official)',
  kind: 'official',
  capabilities: ['meetings', 'racecard', 'conditions', 'results'],
  homepage: 'https://demo-official.racelens.local/',

  async listMeetings(date: string, ctx: FetchContext): Promise<MeetingSummary[]> {
    await demoDelay(ctx);
    if (!isDemoDate(date)) return [];
    return [demoMeetingSummary(loadDemoPack(), DEMO_OFFICIAL_ID, SOURCE_REF)];
  },

  async fetchMeeting(meeting: MeetingSummary, ctx: FetchContext): Promise<MeetingRaw> {
    await demoDelay(ctx);
    const fetchedAt = nowIso(ctx);
    if (!isDemoMeeting(meeting)) {
      ctx.log.debug(`${DEMO_OFFICIAL_ID}: no data for meeting ${meeting.id}`);
      return { meeting, races: [], source: DEMO_OFFICIAL_ID, fetchedAt };
    }
    const pack = loadDemoPack();
    return {
      meeting: demoMeetingSummary(pack, DEMO_OFFICIAL_ID, SOURCE_REF),
      races: pack.races.map((r) => buildRace(r, ctx)),
      source: DEMO_OFFICIAL_ID,
      fetchedAt,
    };
  },

  async fetchRace(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RaceRaw> {
    await demoDelay(ctx);
    const race = isDemoMeeting(meeting) ? findDemoRace(loadDemoPack(), raceNumber) : undefined;
    if (!race) {
      ctx.log.warn(`${DEMO_OFFICIAL_ID}: unknown race ${meeting.id} R${raceNumber}`);
      return emptyRaceRaw(DEMO_OFFICIAL_ID, raceNumber, nowIso(ctx));
    }
    return buildRace(race, ctx);
  },

  async fetchResults(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RaceResult | null> {
    await demoDelay(ctx);
    if (!isDemoMeeting(meeting)) return null;
    const race = findDemoRace(loadDemoPack(), raceNumber);
    const result = findDemoResult(raceNumber);
    if (!race || !result || !demoResultAvailable(race, result, ctx)) return null;
    return toRaceResult(result, ctx);
  },
};

export { DEMO_DATE };
