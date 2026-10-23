import type { FormLine, MeetingRaw, MeetingSummary, OddsQuote, RaceRaw, RaceResult, RaceStatus, RunnerRaw } from '../../../shared/types.js';
import { normaliseName } from '../../../shared/util.js';
import type { FetchContext, SourceAdapter } from '../types.js';
import { sleep } from '../../core/http.js';
import { arr, bool, num, obj, parseCondition, parseMargin, parseStats, pick, splitCountry, str, toNum, type Dict } from './parse.js';
import { groupFrom } from './tab.js';
import { parseRaceTime } from './timezone.js';
import { findVenue } from './venues.js';

/**
 * Racing.com (Racing Victoria) public GraphQL API – the official Victorian
 * source: meetings, fields, form, odds from several providers, results,
 * sectionals and stewards' comments. AppSync behind CloudFront with the site's
 * public API key (override with RACING_COM_API_KEY if it rotates).
 */
const ENDPOINT = 'https://graphql.rmdprod.racing.com/';
const DEFAULT_KEY = 'da2-6nsi4ztsynar3l3frgxf77q5fe';

const MEETING_FIELDS = 'id date meetingName venueName state country isTab isTrial isJumpOut isPicnic railPosition trackCondition trackRating weather racesCount status meetUrl';
const MEETING_FIELDS_MIN = 'id date meetingName venueName state isTab isTrial isJumpOut trackCondition trackRating railPosition weather racesCount';
const RACE_FIELDS = 'id raceNumber name distance class group raceStatus hasResults resultsString trackCondition trackRating time totalPrizeMoney runnersCount tempo';
const RACE_FIELDS_MIN = 'id raceNumber name distance class raceStatus hasResults resultsString trackCondition trackRating time';
const ENTRY_FRAGMENT_FULL = `fragment E on RaceEntryItem { id raceEntryNumber barrierNumber liveBarrierNumber weight weightCarried scratched isLateScratching emergency finish position margin beatenMargin horseName horseCode horseCountry jockeyName trainerName gearChanges gearHasChanges jockeyChanged commentShort commentStewards handicapRating lastRaceDate startingPrice bettingFluctuationsPriceOpen speedValue positionAtSettled positionAt800 positionAt400 trackStats distanceStats trackDistanceStats atThisBarrierNumberStats atThisClassStats horse { id name age sex careerStats lastTen goodStats softStats heavyStats firstUpStats secondUpStats rating horseForm { date venue distance position starters margin raceClass startingPrice weightCarried trackCondition positionAt800 positionAt400 barrier jockeyName winningTime isTrial isJumpOut } } jockey { fullName winPercent recentWinPercent apprentice weightClaim } trainer { fullName winPercent recentWinPercent } odds { providerCode oddsWin oddsPlace } }`;
const ENTRY_FRAGMENT_MIN = `fragment E on RaceEntryItem { id raceEntryNumber barrierNumber liveBarrierNumber weight weightCarried scratched isLateScratching emergency finish position margin horseName horseCountry jockeyName trainerName commentShort startingPrice horse { name age sex careerStats lastTen goodStats softStats heavyStats firstUpStats secondUpStats horseForm { date venue distance position starters margin raceClass startingPrice weightCarried trackCondition barrier jockeyName isTrial isJumpOut } } odds { providerCode oddsWin oddsPlace } }`;

const TOTE_CODES = new Set(['V', 'N', 'Q', 'S', 'W']);
const PROVIDER_NAMES: Record<string, string> = { V: 'VIC Tote', N: 'NSW Tote', Q: 'QLD Tote', SB: 'Sportsbet', LB: 'Ladbrokes', ND: 'Neds', BB: 'BetEasy', TB: 'TAB Fixed', BF: 'Betfair', UB: 'Unibet', PB: 'PointsBet', BM: 'Bet365' };

interface GqlResponse {
  data?: Record<string, unknown> | null;
  errors?: Array<{ message?: string }>;
}

export class RacingComAdapter implements SourceAdapter {
  id = 'racingcom';
  name = 'Racing.com (Racing Victoria)';
  kind = 'official' as const;
  capabilities = ['meetings' as const, 'racecard' as const, 'form' as const, 'odds' as const, 'results' as const, 'conditions' as const];
  homepage = 'https://www.racing.com';

  constructor(
    private readonly delayMs = 300,
    private readonly apiKey = process.env.RACING_COM_API_KEY || DEFAULT_KEY,
  ) {}

  private async query(ctx: FetchContext, query: string): Promise<Record<string, unknown>> {
    const res = await ctx.http.request<GqlResponse>(ENDPOINT, {
      method: 'POST',
      body: JSON.stringify({ query }),
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey, Accept: 'application/json' },
      expect: 'json',
      retries: 2,
      timeoutMs: 20_000,
    });
    if (!res.ok) throw new Error(`racing.com HTTP ${res.status}`);
    const body = res.json;
    if (!body || typeof body !== 'object') throw new Error('racing.com returned a non-JSON body');
    if (body.errors?.length && !body.data) {
      const msg = body.errors.map((e) => e.message || 'error').join('; ');
      throw new GqlError(msg);
    }
    return (body.data || {}) as Record<string, unknown>;
  }

  /** Try the rich query; if the schema rejects a field, fall back to the minimal one. */
  private async queryWithFallback(ctx: FetchContext, full: string, minimal: string): Promise<Record<string, unknown>> {
    try {
      return await this.query(ctx, full);
    } catch (err) {
      if (err instanceof GqlError && /validation|undefined|cannot query|unknown field|not defined/i.test(err.message)) {
        ctx.log.warn(`racing.com: rich query rejected (${err.message.slice(0, 120)}); using minimal field set`);
        return this.query(ctx, minimal);
      }
      throw err;
    }
  }

  async listMeetings(date: string, ctx: FetchContext): Promise<MeetingSummary[]> {
    const data = await this.queryWithFallback(ctx, `{ m: GetMeetingByDate(date:"${date}") { ${MEETING_FIELDS} } }`, `{ m: GetMeetingByDate(date:"${date}") { ${MEETING_FIELDS_MIN} } }`);
    const seen = new Set<string>();
    const out: MeetingSummary[] = [];
    for (const m of arr(data.m).map(obj)) {
      const id = str(m, 'id');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (bool(m, 'isTrial') || bool(m, 'isJumpOut') || bool(m, 'isPicnic')) continue;
      const isTab = pick(m, 'isTab');
      if (isTab !== undefined && isTab !== null && Number(isTab) === 0) continue;
      const summary = this.meetingSummary(m, date);
      if (summary) out.push(summary);
    }
    return out;
  }

  private meetingSummary(m: Dict, date: string): MeetingSummary | undefined {
    const rawName = str(m, 'venueName', 'meetingName');
    if (!rawName) return undefined;
    const state = str(m, 'state');
    if (state && !/^(VIC|NSW|QLD|SA|WA|TAS|NT|ACT)$/i.test(state)) return undefined; // skip HK etc.
    const country = str(m, 'country') || 'AUS';
    // Track configurations ("Sandown Hillside", "Caulfield Heath", "The Valley") map onto the canonical venue so sources
    // merge; the feed's own name stays in sourceRefs (queries go by meet code, never by name).
    const known = /^(AUS?|AUSTRALIA)$/i.test(country) ? findVenue(rawName) : undefined;
    const name = known?.name || rawName;
    const slug = normaliseName(name).replace(/\s+/g, '-');
    const cond = parseCondition([str(m, 'trackCondition'), str(m, 'trackRating')].filter(Boolean).join(' '));
    return {
      id: `${date}:${slug}`,
      date: str(m, 'date') || date,
      venue: name,
      venueSlug: slug,
      state: state || known?.state,
      country,
      raceType: 'thoroughbred',
      raceCount: num(m, 'racesCount'),
      trackCondition: cond.text,
      trackRating: cond.rating,
      weather: str(m, 'weather'),
      rail: str(m, 'railPosition'),
      sourceRefs: { racingcom: str(m, 'id')!, 'racingcom.venue': rawName },
      sources: [this.id],
    };
  }

  private async resolveMeetCode(meeting: MeetingSummary, ctx: FetchContext): Promise<string> {
    if (meeting.sourceRefs?.racingcom) return meeting.sourceRefs.racingcom;
    const list = await this.listMeetings(meeting.date, ctx);
    const want = canonicalName(meeting.venue);
    const hit = list.find(
      (m) =>
        m.venueSlug === meeting.venueSlug ||
        normaliseName(m.venue) === normaliseName(meeting.venue) ||
        normaliseName(m.venue).includes(normaliseName(meeting.venue)) ||
        (!!want && (canonicalName(m.venue) === want || canonicalName(m.sourceRefs['racingcom.venue'] || '') === want)),
    );
    if (!hit) throw new Error(`racing.com: no meeting matching ${meeting.venue} on ${meeting.date}`);
    return hit.sourceRefs.racingcom;
  }

  async fetchMeeting(meeting: MeetingSummary, ctx: FetchContext): Promise<MeetingRaw> {
    const meetCode = await this.resolveMeetCode(meeting, ctx);
    const fetchedAt = ctx.now().toISOString();
    const list = await this.queryWithFallback(ctx, `{ r: getRacesForMeet(meetCode:"${meetCode}") { ${RACE_FIELDS} } }`, `{ r: getRacesForMeet(meetCode:"${meetCode}") { ${RACE_FIELDS_MIN} } }`);
    const skeleton = arr(list.r).map(obj);
    const numbers = skeleton.map((r) => num(r, 'raceNumber')).filter((n): n is number => !!n);
    const races: RaceRaw[] = [];
    for (const n of numbers.sort((a, b) => a - b)) {
      try {
        races.push(await this.fetchRaceByCode(meetCode, n, meeting, fetchedAt, ctx));
      } catch (err) {
        ctx.log.warn(`racing.com: race ${n} failed: ${err instanceof Error ? err.message : err}`);
        const sk = skeleton.find((r) => num(r, 'raceNumber') === n);
        if (sk) races.push(this.race(sk, n, meeting, fetchedAt)); // at least the skeleton
      }
      if (this.delayMs) await sleep(this.delayMs);
    }
    return { meeting: { ...meeting, sourceRefs: { ...meeting.sourceRefs, racingcom: meetCode }, sources: [this.id] }, races, source: this.id, fetchedAt };
  }

  async fetchRace(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RaceRaw> {
    const meetCode = await this.resolveMeetCode(meeting, ctx);
    return this.fetchRaceByCode(meetCode, raceNumber, meeting, ctx.now().toISOString(), ctx);
  }

  async fetchResults(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RaceResult | null> {
    const race = await this.fetchRace(meeting, raceNumber, ctx);
    if ((race.status !== 'final' && race.status !== 'interim') || !race.results?.length) return null;
    // An interim result is reported as interim, so the watcher keeps looking until it is declared final.
    return { raceNumber, placings: race.results, recordedAt: ctx.now().toISOString(), source: this.id, status: race.status, dividends: race.dividends };
  }

  private async fetchRaceByCode(meetCode: string, n: number, meeting: MeetingSummary, fetchedAt: string, ctx: FetchContext): Promise<RaceRaw> {
    const data = await this.queryWithFallback(
      ctx,
      `{ r: getRaceForm(meetCode:"${meetCode}", raceNumber:${n}) { ${RACE_FIELDS} raceEntries { ...E } formRaceEntries { ...E } } } ${ENTRY_FRAGMENT_FULL}`,
      `{ r: getRaceForm(meetCode:"${meetCode}", raceNumber:${n}) { ${RACE_FIELDS_MIN} raceEntries { ...E } formRaceEntries { ...E } } } ${ENTRY_FRAGMENT_MIN}`,
    );
    const r = obj(data.r);
    if (!Object.keys(r).length) throw new Error(`racing.com: empty race ${n}`);
    const got = num(r, 'raceNumber');
    if (got != null && got !== n) throw new Error(`racing.com returned race ${got} when ${n} was requested`);
    return this.race(r, n, meeting, fetchedAt);
  }

  // ---------------------------------------------------------------------------

  private race(r: Dict, raceNumber: number, meeting: MeetingSummary, fetchedAt: string): RaceRaw {
    const statusText = `${str(r, 'raceStatus') || ''} ${str(r, 'status') || ''}`.toLowerCase();
    const resultsString = str(r, 'resultsString') || '';
    const hasResults = bool(r, 'hasResults') === true || /result|final|paying/.test(statusText) || /^\d+[^0-9]+\d+/.test(resultsString);
    // Interim (protest or correction pending) wins over "has results": the placings exist but may still change.
    const status: RaceStatus = /abandon|cancel/.test(statusText) ? 'abandoned' : /interim|protest|correct/.test(statusText) ? 'interim' : hasResults ? 'final' : /running|closed/.test(statusText) ? 'interim' : 'open';
    const cond = parseCondition([str(r, 'trackCondition'), str(r, 'trackRating')].filter(Boolean).join(' '));

    // Merge entries: before race day the full field lives in formRaceEntries; raceEntries win where both exist.
    const byNumber = new Map<number, Dict>();
    for (const e of arr(r.formRaceEntries).map(obj)) {
      const n = num(e, 'raceEntryNumber');
      if (n != null) byNumber.set(n, e);
    }
    for (const e of arr(r.raceEntries).map(obj)) {
      const n = num(e, 'raceEntryNumber');
      if (n == null) continue;
      const prev = byNumber.get(n);
      const finish = num(e, 'finish');
      if (prev && finish != null && finish >= 100 && num(prev, 'finish') != null && num(prev, 'finish')! < 100) continue; // keep the real runner over a scratching duplicate
      byNumber.set(n, prev ? { ...prev, ...stripNull(e) } : e);
    }
    // Placings exist once the race is final, and also while an interim (protest-pending) result is published.
    const placed = status === 'final' || (status === 'interim' && hasResults);
    const runners = [...byNumber.values()].map((e) => this.runner(e, placed, fetchedAt)).filter((x): x is RunnerRaw => !!x && !!x.name).sort((a, b) => (a.number || 0) - (b.number || 0));

    let results: number[][] | undefined;
    if (placed) {
      const byPlace = new Map<number, number[]>();
      for (const x of runners) if (x.finishingPosition && x.finishingPosition < 100 && x.number != null) byPlace.set(x.finishingPosition, [...(byPlace.get(x.finishingPosition) || []), x.number]);
      if (byPlace.size) results = [...byPlace.keys()].sort((a, b) => a - b).map((p) => byPlace.get(p)!.sort((a, b) => a - b));
      else if (resultsString) results = resultsString.split(/[^0-9]+/).filter(Boolean).map((s) => [Number(s)]);
    }
    const winner = results?.[0]?.[0];
    const winnerSp = winner != null ? runners.find((x) => x.number === winner)?.odds?.find((o) => o.bookmaker === 'Starting price')?.win : undefined;

    const classText = str(r, 'class', 'rdcClass');
    const tempo = str(r, 'tempo');
    return {
      number: num(r, 'raceNumber') || raceNumber,
      name: str(r, 'name') || `Race ${raceNumber}`,
      distance: toNum(pick(r, 'distance')) || 0,
      startTime: parseRaceTime(str(r, 'time'), meeting.state),
      raceClass: classText,
      group: groupFrom(str(r, 'group'), classText, str(r, 'name')),
      prize: toNum(pick(r, 'totalPrizeMoney')),
      trackCondition: cond.text,
      trackRating: cond.rating,
      status,
      sourceRefs: { racingcom: str(r, 'id') || String(raceNumber), ...(tempo ? { 'racingcom.tempo': tempo } : {}) },
      runners,
      results,
      dividends: winnerSp ? { win: winnerSp } : undefined,
      source: this.id,
      fetchedAt,
    };
  }

  private runner(e: Dict, resulted: boolean, fetchedAt: string): RunnerRaw | undefined {
    const rawName = str(e, 'horseName') || str(obj(e.horse), 'name');
    if (!rawName) return undefined;
    const { name, country } = splitCountry(rawName);
    const horse = obj(e.horse);
    const jockey = obj(e.jockey);
    const trainer = obj(e.trainer);
    const finish = num(e, 'finish');
    const scratched = bool(e, 'scratched') === true || bool(e, 'isLateScratching') === true || finish === 109;
    const odds: OddsQuote[] = [];
    for (const o of arr(e.odds).map(obj)) {
      const code = (str(o, 'providerCode') || '').toUpperCase();
      const win = toNum(pick(o, 'oddsWin'));
      const place = toNum(pick(o, 'oddsPlace'));
      if (!win || win <= 1) continue;
      const tote = TOTE_CODES.has(code) || code.startsWith('BTOTE');
      odds.push({ source: this.id, bookmaker: PROVIDER_NAMES[code] || (tote ? `${code} Tote` : code || 'Bookmaker'), type: tote ? 'tote' : 'fixed', win, place: place && place > 1 ? place : undefined, opening: toNum(pick(e, 'bettingFluctuationsPriceOpen')), fetchedAt });
    }
    const sp = toNum(pick(e, 'startingPrice'));
    if (resulted && sp && sp > 1) odds.push({ source: this.id, bookmaker: 'Starting price', type: 'tote', win: sp, fetchedAt });

    let last5: string | undefined;
    const lastTen = pick(horse, 'lastTen');
    if (typeof lastTen === 'string') {
      try {
        const parsed = JSON.parse(lastTen);
        if (Array.isArray(parsed)) last5 = parsed.map((c) => (c === '-' ? 'x' : String(c))).join('').slice(-5);
      } catch {
        last5 = lastTen.replace(/[^0-9x-]/gi, '').replace(/-/g, 'x').slice(-5) || undefined;
      }
    }
    const form = arr(horse.horseForm)
      .map(obj)
      .filter((h) => !(bool(h, 'isTrial') || bool(h, 'isJumpOut')) && !/TRL|TRIAL|JUMP|JMP|^OUT/i.test(str(h, 'raceClass') || ''))
      .map((h) => this.formLine(h))
      .filter((x): x is FormLine => !!x);
    const ratings: Record<string, number> = {};
    const hr = toNum(pick(horse, 'rating'));
    if (hr) ratings['racingcom.rating'] = hr;
    const hcp = toNum(pick(e, 'handicapRating'));
    if (hcp) ratings['racingcom.handicapRating'] = hcp;
    const comments = [str(e, 'commentShort'), str(e, 'commentStewards') ? `Stewards: ${str(e, 'commentStewards')}` : undefined].filter(Boolean) as string[];
    const gear = bool(e, 'gearHasChanges') !== false && str(e, 'gearChanges') ? [str(e, 'gearChanges')!] : undefined;
    const settled = num(e, 'positionAtSettled');
    const p800 = num(e, 'positionAt800');
    const p400 = num(e, 'positionAt400');
    const inRun = [settled, p800, p400].filter((x) => x != null);
    const inRunning = resulted && inRun.length ? inRun.join('-') : undefined;
    const jw = toNum(pick(jockey, 'winPercent'));
    const jrw = toNum(pick(jockey, 'recentWinPercent'));
    const tw = toNum(pick(trainer, 'winPercent'));
    const trw = toNum(pick(trainer, 'recentWinPercent'));
    const claim = toNum(pick(jockey, 'weightClaim'));
    // RunnerRaw.weight is the allotted weight (as Racing Australia prints it); the apprentice claim is reported
    // separately and taken off downstream. `weightCarried` is already net of the claim.
    const allotted = toNum(pick(e, 'weight'));
    const carried = toNum(pick(e, 'weightCarried'));
    return {
      number: num(e, 'raceEntryNumber'),
      name,
      country: country || str(e, 'horseCountry'),
      barrier: num(e, 'liveBarrierNumber') || num(e, 'barrierNumber'),
      jockey: str(jockey, 'fullName') || str(e, 'jockeyName'),
      trainer: str(trainer, 'fullName') || str(e, 'trainerName'),
      weight: allotted ?? (carried != null ? carried + (claim && claim > 0 ? claim : 0) : undefined),
      claim: claim && claim > 0 ? claim : undefined,
      scratched,
      emergency: bool(e, 'emergency') || undefined,
      age: num(horse, 'age'),
      sex: str(horse, 'sex'),
      last5,
      career: parseStats(pick(horse, 'careerStats')),
      splits: {
        track: parseStats(pick(e, 'trackStats')),
        distance: parseStats(pick(e, 'distanceStats')),
        trackDistance: parseStats(pick(e, 'trackDistanceStats')),
        good: parseStats(pick(horse, 'goodStats')),
        soft: parseStats(pick(horse, 'softStats')),
        heavy: parseStats(pick(horse, 'heavyStats')),
        firstUp: parseStats(pick(horse, 'firstUpStats')),
        secondUp: parseStats(pick(horse, 'secondUpStats')),
      },
      form: form.length ? form : undefined,
      gearChanges: gear,
      comment: comments.length ? comments.join(' ') : undefined,
      ratings: Object.keys(ratings).length ? ratings : undefined,
      odds: odds.length ? odds : undefined,
      finishingPosition: finish != null && finish < 100 ? finish : undefined,
      margin: resulted ? parseMargin(pick(e, 'beatenMargin') ?? pick(e, 'margin')) : undefined,
      inRunning,
      jockeyStats: jw != null || jrw != null ? { winPct: jw ?? undefined, recentWinPct: jrw ?? undefined, source: this.id } : undefined,
      trainerStats: tw != null || trw != null ? { winPct: tw ?? undefined, recentWinPct: trw ?? undefined, source: this.id } : undefined,
    };
  }

  private formLine(h: Dict): FormLine | undefined {
    const date = str(h, 'date');
    const position = num(h, 'position');
    if (!date || !position || position >= 100) return undefined;
    const cond = parseCondition(str(h, 'trackCondition'));
    const p800 = num(h, 'positionAt800');
    const p400 = num(h, 'positionAt400');
    const wt = toNum(pick(h, 'winningTime'));
    const venue = str(h, 'venue');
    return {
      date: date.slice(0, 10),
      // "The Valley" / "Sandown Hillside" → the canonical venue; overseas and unknown tracks keep the feed's name.
      venue: venue ? findVenue(venue)?.name || venue : 'Unknown',
      distance: toNum(pick(h, 'distance')) || 0,
      trackCondition: cond.text,
      trackRating: cond.rating,
      position,
      starters: num(h, 'starters') || 0,
      margin: position === 1 ? 0 : parseMargin(pick(h, 'margin')),
      weight: toNum(pick(h, 'weightCarried')),
      barrier: num(h, 'barrier'),
      jockey: str(h, 'jockeyName'),
      raceClass: str(h, 'raceClass'),
      startingPrice: toNum(pick(h, 'startingPrice')),
      time: wt ? (wt > 1000 ? (wt / 100).toFixed(2) : String(wt)) : undefined,
      inRunning: p800 != null || p400 != null ? [p800, p400].filter((x) => x != null).join('-') : undefined,
      source: this.id,
    };
  }
}

class GqlError extends Error {}

/** Normalised canonical venue ("Sandown Hillside" / "Sandown" → "sandown"), for matching meetings across feeds. */
function canonicalName(venue: string): string {
  return normaliseName(findVenue(venue)?.name ?? venue);
}

function stripNull(o: Dict): Dict {
  const out: Dict = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}
