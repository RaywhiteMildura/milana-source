import type { FormLine, MeetingRaw, MeetingSummary, OddsQuote, RaceRaw, RaceResult, RaceStatus, RunnerRaw, SpeedMapPosition } from '../../../shared/types.js';
import { normaliseName } from '../../../shared/util.js';
import type { FetchContext, SourceAdapter } from '../types.js';
import { arr, bool, num, obj, parseCondition, parseMargin, parseStats, pick, splitCountry, str, titleCase, toISODateOnly, toNum, type Dict } from './parse.js';
import { findVenue } from './venues.js';
import { sleep } from '../../core/http.js';

const AU_STATES = new Set(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']);
const WEATHER_CODES: Record<string, string> = { FINE: 'Fine', OCAST: 'Overcast', SHWRY: 'Showery', RAIN: 'Rain', STORM: 'Storm', CLOUDY: 'Cloudy', WINDY: 'Windy' };

/** TAB abbreviates conditions ("HVY8", "AWT"): expand before parsing so every source votes with the same words. */
function tabCondition(text?: string): string | undefined {
  if (!text) return undefined;
  return text.replace(/^HVY/i, 'Heavy').replace(/^AWT$/i, 'Synthetic').replace(/^SYNTH(ETIC)?$/i, 'Synthetic').replace(/^DEAD/i, 'Soft');
}

/**
 * TAB (Tabcorp) "tab-info-service" – the richest free Australian racing feed:
 * meetings, race cards with fixed + tote odds, flucs, ratings, speed bands,
 * deep form (previous starts, breeding, stats) and results.
 *
 * Base: https://api.beta.tab.com.au/v1/tab-info-service/racing
 * Field names are tolerant of the spellings seen in the wild (see parse.ts).
 */
const BASE = 'https://api.beta.tab.com.au/v1/tab-info-service/racing';

/** Browser-style XHR headers: the TAB host sits behind Akamai and rejects bare clients. Never send cookies. */
const HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-AU,en;q=0.9',
  Origin: 'https://www.tab.com.au',
  Referer: 'https://www.tab.com.au/racing',
  'sec-ch-ua': '"Chromium";v="129", "Google Chrome";v="129", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'Cache-Control': 'no-cache',
};
const Q = '&returnPromo=false&returnOffers=false';

const RACE_TYPE: Record<string, MeetingSummary['raceType']> = { R: 'thoroughbred', G: 'greyhound', H: 'harness' };

export class TabAdapter implements SourceAdapter {
  id = 'tab';
  name = 'TAB';
  kind = 'odds' as const; // odds-led feed, but carries official fields and form
  capabilities = ['meetings' as const, 'racecard' as const, 'form' as const, 'odds' as const, 'results' as const, 'conditions' as const];
  homepage = 'https://www.tab.com.au';

  /** Pause between race-card calls: TAB sits behind Akamai and throttles bursts (research: ~2 req/s sustained). */
  constructor(private readonly delayMs = 450) {}

  /** The form route can answer 401 on the anonymous tier; remember that for the session instead of hammering it. */
  private formUnavailable = false;

  private jurisdiction(ctx: FetchContext): string {
    return (ctx.jurisdiction || 'VIC').toUpperCase();
  }

  async listMeetings(date: string, ctx: FetchContext): Promise<MeetingSummary[]> {
    const url = `${BASE}/dates/${date}/meetings?jurisdiction=${this.jurisdiction(ctx)}${Q}`;
    const data = obj(await ctx.http.getJson(url, { expect: 'json', headers: HEADERS }));
    return arr(data.meetings)
      .map((m) => this.meetingSummary(obj(m), date))
      .filter((m): m is MeetingSummary => !!m);
  }

  private meetingSummary(m: Dict, date: string): MeetingSummary | undefined {
    const name = titleCase(str(m, 'meetingName', 'name'));
    if (!name) return undefined;
    const location = (str(m, 'location', 'state') || '').toUpperCase();
    // Overseas meetings (ASCOT UK, NEWCASTLE UK, HAMILTON NZ...) must never merge with the Australian venue of the same name.
    if (location && !AU_STATES.has(location)) return undefined;
    const typeCode = (str(m, 'raceType', 'meetingType') || 'R').toUpperCase().charAt(0);
    const raceType = RACE_TYPE[typeCode] || 'thoroughbred';
    const venue = findVenue(name);
    const cond = parseCondition(tabCondition(str(m, 'trackCondition')));
    const races = arr(m.races).map(obj);
    const first = races.map((r) => str(r, 'raceStartTime', 'startTime')).filter(Boolean).sort()[0];
    const mnemonic = str(m, 'venueMnemonic', 'mnemonic') || name.slice(0, 3).toUpperCase();
    const slug = normaliseName(name).replace(/\s+/g, '-');
    return {
      id: `${date}:${slug}`,
      date,
      venue: venue?.name && raceType === 'thoroughbred' ? venue.name : name,
      venueSlug: slug,
      state: location || venue?.state,
      country: 'AUS',
      raceType,
      raceCount: races.length || num(m, 'numberOfRaces'),
      trackCondition: cond.text,
      trackRating: cond.rating,
      weather: WEATHER_CODES[(str(m, 'weatherCondition', 'weather') || '').toUpperCase()] || titleCase(str(m, 'weatherCondition', 'weather')),
      rail: str(m, 'railPosition', 'rail'),
      firstRaceTime: first,
      sourceRefs: { tab: `${typeCode}/${mnemonic}` },
      sources: [this.id],
    };
  }

  private ref(meeting: MeetingSummary): { type: string; mnemonic: string } | undefined {
    const ref = meeting.sourceRefs?.tab;
    if (ref && ref.includes('/')) {
      const [type, mnemonic] = ref.split('/');
      return { type, mnemonic };
    }
    const v = findVenue(meeting.venue);
    if (v?.tab) return { type: 'R', mnemonic: v.tab };
    return undefined;
  }

  async fetchMeeting(meeting: MeetingSummary, ctx: FetchContext): Promise<MeetingRaw> {
    const j = this.jurisdiction(ctx);
    const ref = this.ref(meeting) || (await this.discoverRef(meeting, ctx));
    if (!ref) throw new Error(`TAB: cannot work out the venue code for ${meeting.venue}`);
    // Meeting list gives the race skeleton (numbers, names, times); each race is fetched for runners.
    const list = obj(await ctx.http.getJson(`${BASE}/dates/${meeting.date}/meetings?jurisdiction=${j}${Q}`, { expect: 'json', headers: HEADERS }));
    const m = arr(list.meetings)
      .map(obj)
      .find((x) => (str(x, 'venueMnemonic') || '').toUpperCase() === ref.mnemonic.toUpperCase() && (str(x, 'raceType') || 'R').toUpperCase().startsWith(ref.type.toUpperCase()));
    const skeleton = arr(m?.races).map(obj);
    const numbers = skeleton.length ? skeleton.map((r) => num(r, 'raceNumber')).filter((n): n is number => !!n) : Array.from({ length: meeting.raceCount || 10 }, (_, i) => i + 1);
    const races: RaceRaw[] = [];
    const header = m ? this.meetingSummary(m, meeting.date) : undefined;
    const fetchedAt = ctx.now().toISOString();
    for (const n of numbers) {
      try {
        const raw = obj(await ctx.http.getJson(`${BASE}/dates/${meeting.date}/meetings/${ref.type}/${ref.mnemonic}/races/${n}?jurisdiction=${j}${Q}`, { expect: 'json', headers: HEADERS }));
        this.assertIdentity(raw, ref.mnemonic, n);
        races.push(this.race(raw, n, fetchedAt, skeleton.find((s) => num(s, 'raceNumber') === n)));
      } catch (err) {
        ctx.log.warn(`TAB: race ${n} failed: ${err instanceof Error ? err.message : err}`);
        if (!skeleton.length && races.length === 0 && n >= 3) break; // unknown race count and nothing is coming back
      }
      if (this.delayMs && n !== numbers[numbers.length - 1]) await sleep(this.delayMs);
    }
    return { meeting: { ...meeting, ...(header || {}), id: meeting.id, venueSlug: meeting.venueSlug, sources: [this.id] }, races, source: this.id, fetchedAt };
  }

  private async discoverRef(meeting: MeetingSummary, ctx: FetchContext): Promise<{ type: string; mnemonic: string } | undefined> {
    const list = await this.listMeetings(meeting.date, ctx);
    const hit = list.find((m) => m.venueSlug === meeting.venueSlug || normaliseName(m.venue) === normaliseName(meeting.venue));
    const ref = hit?.sourceRefs.tab;
    if (!ref) return undefined;
    const [type, mnemonic] = ref.split('/');
    return { type, mnemonic };
  }

  async fetchRace(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RaceRaw> {
    const ref = this.ref(meeting) || (await this.discoverRef(meeting, ctx));
    if (!ref) throw new Error(`TAB: cannot work out the venue code for ${meeting.venue}`);
    const raw = obj(await ctx.http.getJson(`${BASE}/dates/${meeting.date}/meetings/${ref.type}/${ref.mnemonic}/races/${raceNumber}?jurisdiction=${this.jurisdiction(ctx)}${Q}`, { expect: 'json', headers: HEADERS }));
    this.assertIdentity(raw, ref.mnemonic, raceNumber);
    return this.race(raw, raceNumber, ctx.now().toISOString());
  }

  async fetchForm(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RunnerRaw[]> {
    if (this.formUnavailable) return [];
    const ref = this.ref(meeting) || (await this.discoverRef(meeting, ctx));
    if (!ref) return [];
    if (this.delayMs) await sleep(this.delayMs);
    const res = await ctx.http.get(`${BASE}/dates/${meeting.date}/meetings/${ref.type}/${ref.mnemonic}/races/${raceNumber}/form?jurisdiction=${this.jurisdiction(ctx)}`, { expect: 'json', headers: HEADERS });
    if (res.status === 401 || res.status === 403) {
      this.formUnavailable = true;
      ctx.log.warn(`TAB: form endpoint answered ${res.status} – skipping TAB form for the rest of this session (other sources supply form)`);
      return [];
    }
    if (!res.ok || res.json === undefined) throw new Error(`TAB form HTTP ${res.status}`);
    const raw = obj(res.json);
    const list = arr(pick(raw, 'form', 'formData', 'runners', 'formRunners'));
    return list.map((f) => this.formRunner(obj(f))).filter((r): r is RunnerRaw => !!r && !!r.name);
  }

  async fetchResults(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RaceResult | null> {
    const race = await this.fetchRace(meeting, raceNumber, ctx);
    if (!race.results || !race.results.length) return null;
    if (!['final', 'interim'].includes(race.status)) return null;
    const dividends: Record<string, number> = { ...(race.dividends || {}) };
    for (const r of race.runners) {
      if (r.finishingPosition === 1) {
        const tote = r.odds?.find((o) => o.type === 'tote');
        if (tote?.win && !dividends.win) dividends.win = tote.win;
        if (tote?.place && !dividends.place1) dividends.place1 = tote.place;
      }
    }
    return { raceNumber, placings: race.results, recordedAt: ctx.now().toISOString(), source: this.id, status: race.status === 'final' ? 'final' : 'interim', dividends: Object.keys(dividends).length ? dividends : undefined };
  }

  // ---------------------------------------------------------------------------

  /** A 200 can describe a different meeting (seen in the wild): make sure we got what we asked for. */
  private assertIdentity(raw: Dict, mnemonic: string, raceNumber: number): void {
    const m = obj(raw.meeting);
    const got = str(m, 'venueMnemonic');
    if (got && got.toUpperCase() !== mnemonic.toUpperCase()) throw new Error(`TAB returned ${got} when ${mnemonic} was requested`);
    const n = num(raw, 'raceNumber');
    if (n != null && n !== raceNumber) throw new Error(`TAB returned race ${n} when ${raceNumber} was requested`);
  }

  private race(raw: Dict, raceNumber: number, fetchedAt: string, skeleton?: Dict): RaceRaw {
    const status = this.status(str(raw, 'raceStatus') || str(skeleton || {}, 'raceStatus'));
    const cond = parseCondition(tabCondition(str(raw, 'trackCondition') || str(obj(raw.meeting), 'trackCondition')));
    const scratchedNumbers = new Set([...arr(raw.scratchings), ...arr(skeleton?.scratchings)].map((x) => num(obj(x), 'runnerNumber')).filter((n): n is number => n != null));
    const winPredictions = new Map<number, number>();
    for (const p of arr(raw.predictions).map(obj)) {
      if ((str(p, 'betType') || '').toLowerCase() !== 'win') continue;
      for (const r of arr(p.runners).map(obj)) {
        const n = num(r, 'runnerNumber');
        const prob = num(r, 'probability');
        if (n != null && prob != null && prob > 0) winPredictions.set(n, prob);
      }
    }
    const results = arr(pick(raw, 'results') ?? pick(skeleton || {}, 'results'))
      .map((slot) => arr(slot).map(toNum).filter((n): n is number => !!n))
      .filter((slot) => slot.length);
    const runners = arr(raw.runners).map((r) => this.runner(obj(r), fetchedAt)).filter((r): r is RunnerRaw => !!r && !!r.name);
    for (const r of runners) {
      if (r.number != null && scratchedNumbers.has(r.number)) r.scratched = true;
      const prob = r.number != null ? winPredictions.get(r.number) : undefined;
      if (prob != null) r.ratings = { ...(r.ratings || {}), 'tab.winProbability': Math.round(prob * 1000) / 10 };
    }
    // Finishing positions from results when the runner object lacks them
    if (results.length) {
      results.forEach((slot, i) => slot.forEach((n) => {
        const r = runners.find((x) => x.number === n);
        if (r && r.finishingPosition == null) r.finishingPosition = i + 1;
      }));
    }
    const classText = str(raw, 'raceClassConditions', 'raceClass', 'class');
    const dividends: Record<string, number> = {};
    for (const d of arr(raw.dividends).map(obj)) {
      const product = (str(d, 'wageringProduct') || '').toLowerCase();
      const pools = arr(d.poolDividends).map(obj);
      if (!pools.length) continue;
      if (product === 'win') dividends.win = num(pools[0], 'amount') ?? dividends.win;
      else if (product === 'place') {
        const first = pools.find((p) => arr(p.selections).map(toNum).includes(results[0]?.[0]));
        const amt = num(first || pools[0], 'amount');
        if (amt) dividends.place1 = amt;
      } else if (['quinella', 'exacta', 'trifecta', 'firstfour', 'first4'].includes(product)) {
        const amt = num(pools[0], 'amount');
        if (amt) dividends[product === 'firstfour' ? 'first4' : product] = amt;
      }
    }
    return {
      number: num(raw, 'raceNumber') || raceNumber,
      name: titleCase(str(raw, 'raceName') || str(skeleton || {}, 'raceName')) || `Race ${raceNumber}`,
      distance: num(raw, 'raceDistance', 'distance') || num(skeleton || {}, 'raceDistance') || 0,
      startTime: str(raw, 'raceStartTime', 'startTime') || str(skeleton || {}, 'raceStartTime'),
      raceClass: classText,
      group: groupFrom(classText, str(raw, 'raceName')),
      prize: num(raw, 'prizeMoney', 'totalPrizeMoney', 'prizemoney'),
      trackCondition: cond.text,
      trackRating: cond.rating,
      status,
      sourceRefs: { tab: String(raceNumber) },
      runners,
      results: results.length ? results : undefined,
      dividends: Object.keys(dividends).length ? dividends : undefined,
      source: this.id,
      fetchedAt,
    };
  }

  private status(s?: string): RaceStatus {
    const t = (s || '').toLowerCase();
    if (!t) return 'unknown';
    if (t.includes('abandon')) return 'abandoned';
    if (t.includes('paying') || t.includes('final') || t.includes('result')) return 'final';
    if (t.includes('interim')) return 'interim';
    if (t.includes('closed') || t.includes('suspend')) return 'closed';
    if (t.includes('normal') || t.includes('open') || t.includes('selling')) return 'open';
    return 'unknown';
  }

  private runner(r: Dict, fetchedAt: string): RunnerRaw | undefined {
    const rawName = str(r, 'runnerName', 'name');
    if (!rawName) return undefined;
    const { name, country } = splitCountry(titleCase(rawName));
    const fixed = obj(r.fixedOdds);
    const tote = obj(r.parimutuel);
    const fixedStatus = (str(fixed, 'bettingStatus') || '').toLowerCase();
    const toteStatus = (str(tote, 'bettingStatus') || '').toLowerCase();
    const scratched = fixedStatus.includes('scratch') || toteStatus.includes('scratch') || bool(r, 'scratched', 'isScratched') === true;
    const odds: OddsQuote[] = [];
    const fw = num(fixed, 'returnWin');
    const fp = num(fixed, 'returnPlace');
    if (fw && fw > 1) {
      // TAB lists flucs newest-first; OddsQuote.flucs is oldest-first.
      const flucs = arr(fixed.flucs)
        .map(obj)
        .map((f) => ({ price: num(f, 'returnWin', 'price') || 0, at: str(f, 'returnWinTime', 'time') }))
        .filter((f) => f.price > 1)
        .reverse();
      odds.push({ source: this.id, bookmaker: 'TAB Fixed', type: 'fixed', win: fw, place: fp && fp > 1 ? fp : undefined, opening: num(fixed, 'returnWinOpen', 'returnWinOpenDaily', 'openingPrice') || flucs[0]?.price, flucs: flucs.length ? flucs : undefined, fetchedAt });
    }
    const tw = num(tote, 'returnWin');
    const tp = num(tote, 'returnPlace');
    if (tw && tw > 1) odds.push({ source: this.id, bookmaker: 'TAB Tote', type: 'tote', win: tw, place: tp && tp > 1 ? tp : undefined, fetchedAt });

    const ratings: Record<string, number> = {};
    for (const k of ['techFormRating', 'dfsFormRating', 'earlySpeedRating', 'totalRatingPoints']) {
      const v = num(r, k);
      if (v != null && v > 0) ratings[`tab.${k}`] = v;
    }
    const band = (str(r, 'earlySpeedRatingBand') || '').toUpperCase();
    const speed: SpeedMapPosition | undefined = band.includes('LEAD') ? 'leader' : band.includes('ON') || band.includes('PACE') ? 'on-pace' : band.includes('MID') ? 'midfield' : band.includes('BACK') || band.includes('REAR') ? 'backmarker' : undefined;
    const jockey = titleCase(str(r, 'riderDriverFullName', 'riderDriverName', 'jockey', 'rider'));
    const trainer = titleCase(str(r, 'trainerFullName', 'trainerName', 'trainer'));
    return {
      number: num(r, 'runnerNumber', 'number'),
      name,
      country,
      barrier: num(r, 'barrierNumber', 'barrier'),
      jockey: jockey && !/^(unknown|tba|scratched|-)$/i.test(jockey) ? jockey : undefined,
      trainer,
      weight: num(r, 'handicapWeight', 'weight'),
      claim: num(r, 'claimAmount', 'apprenticeClaim'),
      emergency: bool(r, 'emergencyIndicator', 'isEmergency', 'emergency'),
      last5: str(r, 'last5Starts', 'lastFiveStarts'),
      ratings: Object.keys(ratings).length ? ratings : undefined,
      speedMapPosition: speed,
      scratched,
      odds: odds.length ? odds : undefined,
      finishingPosition: num(r, 'finishingPosition'),
      silk: str(r, 'silkURL', 'silkColours', 'silkUrl'),
      comment: str(r, 'tcdwIndicators')?.trim() ? `TAB indicators ${str(r, 'tcdwIndicators')!.trim()} (T track, C course & distance, D distance, W wet winner; lower case = placed)` : undefined,
    };
  }

  private formRunner(f: Dict): RunnerRaw | undefined {
    const rawName = str(f, 'runnerName', 'name', 'horseName');
    if (!rawName) return undefined;
    const { name, country } = splitCountry(titleCase(rawName));
    const stats = obj(pick(f, 'runnerStats', 'statistics', 'stats'));
    const grab = (...keys: string[]) => parseStats(pick(f, ...keys) ?? pick(stats, ...keys));
    const previous = arr(pick(f, 'previousStarts', 'pastPerformances', 'lastStarts', 'formHistory', 'runs')).map((p) => this.formLine(obj(p))).filter((x): x is FormLine => !!x);
    const comments: string[] = [];
    for (const k of ['formComment', 'runnerComments', 'comment', 'formComments']) {
      const v = pick(f, k);
      if (typeof v === 'string') comments.push(v);
      else if (Array.isArray(v)) for (const x of v) {
        if (typeof x === 'string') comments.push(x);
        else {
          const c = str(obj(x), 'comment', 'text');
          if (c) comments.push(c);
        }
      }
    }
    const gear = arr(pick(f, 'gearChanges', 'gear')).map((g) => (typeof g === 'string' ? g : str(obj(g), 'description', 'gearChange', 'name'))).filter((g): g is string => !!g);
    const blinkers = str(f, 'blinkers');
    if (blinkers && /first|on|off/i.test(blinkers)) gear.push(`Blinkers ${blinkers.toLowerCase()}`);
    const lastRun = str(f, 'lastRunDate', 'lastStartDate');
    return {
      number: num(f, 'runnerNumber', 'number'),
      name,
      country: country || str(f, 'country'),
      barrier: num(f, 'barrierNumber'),
      jockey: titleCase(str(f, 'riderDriverFullName', 'riderDriverName')),
      trainer: titleCase(str(f, 'trainerFullName', 'trainerName')),
      weight: num(f, 'handicapWeight'),
      age: num(f, 'age'),
      sex: str(f, 'sex'),
      colour: str(f, 'colour', 'color'),
      sire: titleCase(str(f, 'sire')),
      dam: titleCase(str(f, 'dam')),
      damSire: titleCase(str(f, 'sireOfDam', 'damSire', 'damsire')),
      last5: str(f, 'last5Starts') || (str(f, 'last20Starts') || '').slice(-5) || undefined,
      career: grab('careerStats', 'career', 'overall', 'overallStats'),
      splits: {
        track: grab('trackStats', 'track'),
        distance: grab('distanceStats', 'distance'),
        trackDistance: grab('trackDistanceStats', 'trackDistance'),
        firm: grab('firmStats', 'firm'),
        good: grab('goodStats', 'good'),
        soft: grab('softStats', 'soft'),
        heavy: grab('heavyStats', 'heavy'),
        synthetic: grab('syntheticStats', 'synthetic'),
        firstUp: grab('firstUpStats', 'firstUp'),
        secondUp: grab('secondUpStats', 'secondUp'),
        jockey: grab('jockeyStats', 'riderStats', 'jockey'),
      },
      form: previous.length ? previous : undefined,
      daysSinceLastRun: num(f, 'daysSinceLastRun', 'daysSinceLastStart') ?? (lastRun ? undefined : undefined),
      gearChanges: gear.length ? gear : undefined,
      comment: comments.length ? comments.join(' ') : undefined,
    };
  }

  private formLine(p: Dict): FormLine | undefined {
    const date = toISODateOnly(pick(p, 'startDate', 'date', 'raceDate', 'meetingDate'));
    const venue = titleCase(str(p, 'venueName', 'venue', 'trackName', 'track', 'location')) || 'Unknown';
    const distance = num(p, 'distance', 'raceDistance') || 0;
    const position = num(p, 'finishingPosition', 'position', 'placing', 'finish');
    if (!date || !position) return undefined;
    const cond = parseCondition(str(p, 'trackCondition', 'condition'));
    const place = arr(pick(p, 'placeGetters', 'placings')).map(obj);
    const winner = titleCase(str(p, 'winner', 'winnerName')) || titleCase(str(place.find((x) => num(x, 'finishingPosition', 'position') === 1) || {}, 'name', 'runnerName'));
    const second = titleCase(str(p, 'second', 'secondName')) || titleCase(str(place.find((x) => num(x, 'finishingPosition', 'position') === 2) || {}, 'name', 'runnerName'));
    const settle = pick(p, 'inRun', 'settlingPosition', 'positionInRun', 'inRunning');
    return {
      date,
      venue,
      distance,
      trackCondition: cond.text,
      trackRating: cond.rating,
      position,
      starters: num(p, 'numberOfStarters', 'starters', 'fieldSize') || 0,
      margin: position === 1 ? 0 : parseMargin(pick(p, 'margin', 'beatenMargin')),
      weight: num(p, 'handicapWeight', 'weight', 'handicap'),
      barrier: num(p, 'barrierNumber', 'barrier'),
      jockey: titleCase(str(p, 'riderDriverFullName', 'riderDriverName', 'rider', 'jockey')),
      raceClass: str(p, 'raceClass', 'class', 'raceClassConditions'),
      prize: num(p, 'prizeMoney', 'prizemoney'),
      startingPrice: num(p, 'startingPrice', 'sp', 'startingOdds'),
      time: str(p, 'time', 'raceTime', 'winningTime'),
      sectional600: str(p, 'sectional600', 'last600', 'sectionalTime'),
      winner: winner && winner.toLowerCase() !== 'unknown' ? winner : undefined,
      second,
      inRunning: typeof settle === 'string' ? settle : Array.isArray(settle) ? settle.join('-') : settle != null ? String(settle) : undefined,
      comment: str(p, 'stewardsComment', 'comment', 'stewardsReport', 'runComment'),
      source: this.id,
    };
  }
}

export function groupFrom(...texts: Array<string | undefined>): string | undefined {
  const t = texts.filter(Boolean).join(' ');
  if (/\b(G1|GROUP 1|GR1)\b/i.test(t)) return 'G1';
  if (/\b(G2|GROUP 2|GR2)\b/i.test(t)) return 'G2';
  if (/\b(G3|GROUP 3|GR3)\b/i.test(t)) return 'G3';
  if (/\b(LISTED|LR)\b/i.test(t)) return 'Listed';
  return undefined;
}
