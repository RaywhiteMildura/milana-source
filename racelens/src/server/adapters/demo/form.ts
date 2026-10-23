/**
 * demo-form — a "form guide" view of the demo meeting.
 *
 * Full form lines, splits, career, breeding, comments, ratings, speed map and
 * tote-style odds. Deliberately slightly stale versus demo-official: one older
 * jockey booking, one weight 0.5kg out, two name spellings ("Nellies Lantern",
 * "Tauranga Mist (NZ)") and one scratching not yet applied. See the `variants`
 * block of fixtures/demo/flemington-2026-10-24.json.
 */
import type { FormLine, MeetingRaw, MeetingSummary, OddsQuote, RaceRaw, RunnerRaw } from '../../../shared/types.js';
import type { FetchContext, SourceAdapter } from '../types.js';
import {
  applyDemoVariants,
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
  type DemoFormLine,
  type DemoPack,
  type DemoRace,
  type DemoRunner,
} from './pack.js';

export const DEMO_FORM_ID = 'demo-form';
const SOURCE_REF = 'flemington-20261024';
const TOTE_NAME = 'Demo Tote';

function toFormLine(l: DemoFormLine): FormLine {
  const out: FormLine = {
    date: l.date,
    venue: l.venue,
    distance: l.distance,
    trackCondition: l.trackCondition,
    trackRating: l.trackRating,
    position: l.position,
    starters: l.starters,
    margin: l.margin,
    barrier: l.barrier,
    jockey: l.jockey,
    raceClass: l.raceClass,
    prize: l.prize,
    time: l.time,
    sectional600: l.sectional600,
    inRunning: l.inRunning,
    comment: l.comment,
    source: DEMO_FORM_ID,
  };
  if (l.weight !== undefined) out.weight = l.weight;
  if (l.startingPrice !== undefined) out.startingPrice = l.startingPrice;
  if (l.winner) out.winner = l.winner;
  if (l.second) out.second = l.second;
  return out;
}

function toteQuote(r: DemoRunner, fetchedAt: string): OddsQuote | undefined {
  const q = r.odds?.tote;
  if (!q) return undefined;
  return {
    source: DEMO_FORM_ID,
    bookmaker: TOTE_NAME,
    type: 'tote',
    win: q.win,
    place: q.place,
    opening: q.opening,
    flucs: q.flucs.map((f) => ({ price: f.price, at: f.at })),
    fetchedAt,
  };
}

export function formRunner(r: DemoRunner, fetchedAt: string): RunnerRaw {
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
    last5: r.last5,
    splits: structuredClone(r.splits ?? {}),
    form: (r.form ?? []).map(toFormLine),
    daysSinceLastRun: r.daysSinceLastRun,
    comment: r.comment,
    ratings: { ...(r.ratings ?? {}) },
    speedMapPosition: r.speedMapPosition,
  };
  if (r.claim !== undefined) out.claim = r.claim;
  if (r.emergency) out.emergency = true;
  if (r.career) out.career = { ...r.career };
  if (r.gearChanges?.length) out.gearChanges = [...r.gearChanges];
  const tote = toteQuote(r, fetchedAt);
  if (tote) out.odds = [tote];
  return out;
}

function buildRunners(pack: DemoPack, race: DemoRace, fetchedAt: string): RunnerRaw[] {
  const runners = race.runners.map((r) => formRunner(r, fetchedAt));
  return applyDemoVariants(race.number, runners, demoVariantsFor(pack, DEMO_FORM_ID));
}

function buildRace(pack: DemoPack, race: DemoRace, ctx: FetchContext): RaceRaw {
  const fetchedAt = nowIso(ctx);
  return {
    ...demoRaceSummary(race, DEMO_FORM_ID, `${SOURCE_REF}-r${race.number}`, 'open'),
    runners: buildRunners(pack, race, fetchedAt),
    source: DEMO_FORM_ID,
    fetchedAt,
  };
}

export const demoFormAdapter: SourceAdapter = {
  id: DEMO_FORM_ID,
  name: 'Demo Form Guide',
  kind: 'form',
  capabilities: ['meetings', 'racecard', 'form', 'odds'],
  homepage: 'https://demo-form.racelens.local/',

  async listMeetings(date: string, ctx: FetchContext): Promise<MeetingSummary[]> {
    await demoDelay(ctx);
    if (!isDemoDate(date)) return [];
    return [demoMeetingSummary(loadDemoPack(), DEMO_FORM_ID, SOURCE_REF)];
  },

  async fetchMeeting(meeting: MeetingSummary, ctx: FetchContext): Promise<MeetingRaw> {
    await demoDelay(ctx);
    const fetchedAt = nowIso(ctx);
    if (!isDemoMeeting(meeting)) {
      ctx.log.debug(`${DEMO_FORM_ID}: no data for meeting ${meeting.id}`);
      return { meeting, races: [], source: DEMO_FORM_ID, fetchedAt };
    }
    const pack = loadDemoPack();
    return {
      meeting: demoMeetingSummary(pack, DEMO_FORM_ID, SOURCE_REF),
      races: pack.races.map((r) => buildRace(pack, r, ctx)),
      source: DEMO_FORM_ID,
      fetchedAt,
    };
  },

  async fetchRace(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RaceRaw> {
    await demoDelay(ctx);
    const pack = loadDemoPack();
    const race = isDemoMeeting(meeting) ? findDemoRace(pack, raceNumber) : undefined;
    if (!race) {
      ctx.log.warn(`${DEMO_FORM_ID}: unknown race ${meeting.id} R${raceNumber}`);
      return emptyRaceRaw(DEMO_FORM_ID, raceNumber, nowIso(ctx));
    }
    return buildRace(pack, race, ctx);
  },

  async fetchForm(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RunnerRaw[]> {
    await demoDelay(ctx);
    const pack = loadDemoPack();
    const race = isDemoMeeting(meeting) ? findDemoRace(pack, raceNumber) : undefined;
    if (!race) return [];
    return buildRunners(pack, race, nowIso(ctx));
  },
};
