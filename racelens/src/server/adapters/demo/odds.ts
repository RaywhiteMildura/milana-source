/**
 * demo-odds-a / demo-odds-b — two fictional fixed-odds bookmakers.
 *
 * Both price the same meeting a little differently (and carry flucs). Bookmaker
 * B additionally has one barrier typo and is missing one runner, and it can be
 * taken "offline" with RACELENS_DEMO_FAIL=demo-odds-b to exercise outage
 * handling (it then throws a transport error from every method).
 */
import type { MeetingRaw, MeetingSummary, OddsQuote, RaceRaw, RunnerRaw } from '../../../shared/types.js';
import type { FetchContext, SourceAdapter } from '../types.js';
import {
  applyDemoVariants,
  assertDemoSourceUp,
  demoDelay,
  demoMeetingSummary,
  demoRaceSummary,
  demoVariantsFor,
  emptyRaceRaw,
  findDemoRace,
  isDemoDate,
  isDemoMeeting,
  loadDemoPack,
  nowIso,
  type DemoOddsQuote,
  type DemoPack,
  type DemoRace,
  type DemoRunner,
} from './pack.js';

export const DEMO_ODDS_A_ID = 'demo-odds-a';
export const DEMO_ODDS_B_ID = 'demo-odds-b';

interface BookmakerSpec {
  id: string;
  name: string;
  bookmaker: string;
  homepage: string;
  sourceRef: string;
  /** Which price column of the fixture this bookmaker publishes. */
  column: 'alpha' | 'bravo';
  /** Whether this bookmaker lists the trainer (B only lists the jockey). */
  includeTrainer: boolean;
}

function fixedQuote(spec: BookmakerSpec, q: DemoOddsQuote | undefined, fetchedAt: string): OddsQuote | undefined {
  if (!q) return undefined;
  return {
    source: spec.id,
    bookmaker: spec.bookmaker,
    type: 'fixed',
    win: q.win,
    place: q.place,
    opening: q.opening,
    flucs: q.flucs.map((f) => ({ price: f.price, at: f.at })),
    fetchedAt,
  };
}

function oddsRunner(spec: BookmakerSpec, r: DemoRunner, fetchedAt: string): RunnerRaw {
  const out: RunnerRaw = {
    number: r.number,
    name: r.name,
    barrier: r.barrier,
    jockey: r.jockey,
    weight: r.weight,
    scratched: Boolean(r.scratched),
  };
  if (spec.includeTrainer) out.trainer = r.trainer;
  if (r.emergency) out.emergency = true;
  const quote = r.scratched ? undefined : fixedQuote(spec, r.odds?.[spec.column], fetchedAt);
  out.odds = quote ? [quote] : [];
  return out;
}

function buildRace(spec: BookmakerSpec, pack: DemoPack, race: DemoRace, ctx: FetchContext): RaceRaw {
  const fetchedAt = nowIso(ctx);
  const runners = applyDemoVariants(
    race.number,
    race.runners.map((r) => oddsRunner(spec, r, fetchedAt)),
    demoVariantsFor(pack, spec.id),
  );
  return {
    ...demoRaceSummary(race, spec.id, `${spec.sourceRef}/race-${race.number}`, 'open'),
    runners,
    source: spec.id,
    fetchedAt,
  };
}

export function createDemoOddsAdapter(spec: BookmakerSpec): SourceAdapter {
  return {
    id: spec.id,
    name: spec.name,
    kind: 'odds',
    capabilities: ['meetings', 'racecard', 'odds'],
    homepage: spec.homepage,

    async listMeetings(date: string, ctx: FetchContext): Promise<MeetingSummary[]> {
      assertDemoSourceUp(spec.id);
      await demoDelay(ctx);
      if (!isDemoDate(date)) return [];
      return [demoMeetingSummary(loadDemoPack(), spec.id, spec.sourceRef)];
    },

    async fetchMeeting(meeting: MeetingSummary, ctx: FetchContext): Promise<MeetingRaw> {
      assertDemoSourceUp(spec.id);
      await demoDelay(ctx);
      const fetchedAt = nowIso(ctx);
      if (!isDemoMeeting(meeting)) {
        ctx.log.debug(`${spec.id}: no market for meeting ${meeting.id}`);
        return { meeting, races: [], source: spec.id, fetchedAt };
      }
      const pack = loadDemoPack();
      return {
        meeting: demoMeetingSummary(pack, spec.id, spec.sourceRef),
        races: pack.races.map((r) => buildRace(spec, pack, r, ctx)),
        source: spec.id,
        fetchedAt,
      };
    },

    async fetchRace(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RaceRaw> {
      assertDemoSourceUp(spec.id);
      await demoDelay(ctx);
      const pack = loadDemoPack();
      const race = isDemoMeeting(meeting) ? findDemoRace(pack, raceNumber) : undefined;
      if (!race) {
        ctx.log.warn(`${spec.id}: unknown race ${meeting.id} R${raceNumber}`);
        return emptyRaceRaw(spec.id, raceNumber, nowIso(ctx));
      }
      return buildRace(spec, pack, race, ctx);
    },
  };
}

export const demoOddsAAdapter = createDemoOddsAdapter({
  id: DEMO_ODDS_A_ID,
  name: 'Alpha Bookmaker (demo)',
  bookmaker: 'AlphaBet',
  homepage: 'https://demo-odds-a.racelens.local/',
  sourceRef: 'alpha:meeting/88124',
  column: 'alpha',
  includeTrainer: true,
});

export const demoOddsBAdapter = createDemoOddsAdapter({
  id: DEMO_ODDS_B_ID,
  name: 'Bravo Bookmaker (demo)',
  bookmaker: 'BravoBet',
  homepage: 'https://demo-odds-b.racelens.local/',
  sourceRef: 'bravo:FLEM-2026-10-24',
  column: 'bravo',
  includeTrainer: false,
});
