import type { FormLine, MeetingRaw, MeetingSummary, OddsQuote, RaceRaw, RaceResult, RaceStatus, RunnerRaw, SpeedMapPosition } from '../../../shared/types.js';
import { normaliseName } from '../../../shared/util.js';
import type { FetchContext, SourceAdapter } from '../types.js';
import { sleep } from '../../core/http.js';
import { arr, bool, num, obj, parseCondition, parseMargin, parseStats, pick, splitCountry, str, titleCase, toISODateOnly, toNum, type Dict } from './parse.js';
import { groupFrom } from './tab.js';
import { findVenue } from './venues.js';

/**
 * Sportsbet racing gateway. Anonymous JSON used by sportsbet.com.au's own web
 * app. Unusually rich: every runner carries a full form guide (career and
 * split records, last starts, breeding, Racing & Sports comment, speed map),
 * fixed odds with fluctuations, scratchings, going and results.
 *
 * AU-geo-fenced; a non-JSON body means blocked. Never poll one racecard fast.
 */
const BASE = 'https://www.sportsbet.com.au/apigw/sportsbook-racing/Sportsbook/Racing';

const HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-AU,en;q=0.9',
  Origin: 'https://www.sportsbet.com.au',
  Referer: 'https://www.sportsbet.com.au/horse-racing',
};

const RACE_TYPE: Record<string, MeetingSummary['raceType']> = { horse: 'thoroughbred', horses: 'thoroughbred', greyhound: 'greyhound', harness: 'harness' };

interface Refs {
  competitionId: string;
  classId: string;
  events: Map<number, string>;
}

export class SportsbetAdapter implements SourceAdapter {
  id = 'sportsbet';
  name = 'Sportsbet';
  kind = 'odds' as const;
  capabilities = ['meetings' as const, 'racecard' as const, 'form' as const, 'odds' as const, 'results' as const, 'conditions' as const];
  homepage = 'https://www.sportsbet.com.au/horse-racing';

  constructor(private readonly delayMs = 350) {}

  async listMeetings(date: string, ctx: FetchContext): Promise<MeetingSummary[]> {
    const data = obj(await ctx.http.getJson(`${BASE}/AllRacing/${date}`, { expect: 'json', headers: HEADERS }));
    const out: MeetingSummary[] = [];
    for (const d of arr(data.dates).map(obj)) {
      for (const section of arr(d.sections).map(obj)) {
        const raceType = RACE_TYPE[(str(section, 'raceType') || '').toLowerCase()] || 'thoroughbred';
        for (const m of arr(section.meetings).map(obj)) {
          const summary = this.meetingSummary(m, raceType, date);
          if (summary) out.push(summary);
        }
      }
    }
    return out;
  }

  private meetingSummary(m: Dict, raceType: MeetingSummary['raceType'], date: string): MeetingSummary | undefined {
    const rawName = str(m, 'name');
    if (!rawName) return undefined;
    const region = str(m, 'regionName', 'region') || '';
    const country = /australia/i.test(region) ? 'AUS' : /new zealand/i.test(region) ? 'NZ' : undefined;
    // International meetings (Newcastle UK, Sandown UK...) share names with Australian tracks: never let them in.
    if (!country || bool(m, 'isInternational') === true) return undefined;
    // Sportsbet names tracks by configuration ("Caulfield Heath", "Sandown Hillside"): use the canonical venue so sources merge.
    const known = country === 'AUS' ? findVenue(rawName) : undefined;
    const name = known?.name || rawName;
    const events = arr(m.events).map(obj);
    const starts = events.map((e) => num(e, 'startTime')).filter((n): n is number => !!n);
    const first = starts.length ? epochToIso(Math.min(...starts)) : undefined;
    const slug = normaliseName(name).replace(/\s+/g, '-');
    const eventRefs = events
      .map((e) => `${num(e, 'raceNumber')}:${str(e, 'id')}`)
      .filter((s) => !s.startsWith('undefined'))
      .join(',');
    const track = events.map((e) => str(e, 'track', 'trackStatus')).find(Boolean);
    const cond = parseCondition(track);
    return {
      id: `${date}:${slug}`,
      date,
      venue: name,
      venueSlug: slug,
      country,
      raceType,
      raceCount: events.length || undefined,
      trackCondition: cond.text,
      trackRating: cond.rating,
      firstRaceTime: first,
      state: known?.state,
      sourceRefs: { sportsbet: `${str(m, 'id') || ''}|${str(m, 'classId') || '1'}|${eventRefs}`, 'sportsbet.venue': rawName },
      sources: [this.id],
    };
  }

  private parseRefs(meeting: MeetingSummary): Refs | undefined {
    const ref = meeting.sourceRefs?.sportsbet;
    if (!ref) return undefined;
    const [competitionId, classId, events] = ref.split('|');
    const map = new Map<number, string>();
    for (const pair of (events || '').split(',')) {
      const [n, id] = pair.split(':');
      if (n && id) map.set(Number(n), id);
    }
    return { competitionId, classId: classId || '1', events: map };
  }

  private async resolveRefs(meeting: MeetingSummary, ctx: FetchContext): Promise<Refs> {
    const existing = this.parseRefs(meeting);
    if (existing && existing.events.size) return existing;
    const list = await this.listMeetings(meeting.date, ctx);
    const hit = list.find((m) => m.raceType === meeting.raceType && (m.venueSlug === meeting.venueSlug || normaliseName(m.venue) === normaliseName(meeting.venue)));
    const refs = hit && this.parseRefs(hit);
    if (!refs || !refs.events.size) throw new Error(`Sportsbet: no meeting matching ${meeting.venue} on ${meeting.date}`);
    return refs;
  }

  async fetchMeeting(meeting: MeetingSummary, ctx: FetchContext): Promise<MeetingRaw> {
    const refs = await this.resolveRefs(meeting, ctx);
    const fetchedAt = ctx.now().toISOString();
    const races: RaceRaw[] = [];
    const numbers = [...refs.events.keys()].sort((a, b) => a - b);
    let header: Partial<MeetingSummary> = {};
    for (const n of numbers) {
      try {
        const race = await this.fetchRaceById(refs.events.get(n)!, refs.classId, n, meeting, ctx);
        races.push(race);
        if (!header.trackCondition && race.trackCondition) header = { trackCondition: race.trackCondition, trackRating: race.trackRating };
      } catch (err) {
        ctx.log.warn(`Sportsbet: race ${n} failed: ${err instanceof Error ? err.message : err}`);
      }
      if (this.delayMs) await sleep(this.delayMs);
    }
    return { meeting: { ...meeting, ...header, sources: [this.id] }, races, source: this.id, fetchedAt };
  }

  async fetchRace(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RaceRaw> {
    const refs = await this.resolveRefs(meeting, ctx);
    const id = refs.events.get(raceNumber);
    if (!id) throw new Error(`Sportsbet: race ${raceNumber} not found for ${meeting.venue}`);
    return this.fetchRaceById(id, refs.classId, raceNumber, meeting, ctx);
  }

  async fetchResults(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RaceResult | null> {
    const race = await this.fetchRace(meeting, raceNumber, ctx);
    if (race.status !== 'final' || !race.results?.length) return null;
    return { raceNumber, placings: race.results, recordedAt: ctx.now().toISOString(), source: this.id, status: 'final', dividends: race.dividends };
  }

  private async fetchRaceById(eventId: string, classId: string, raceNumber: number, meeting: MeetingSummary, ctx: FetchContext): Promise<RaceRaw> {
    const data = obj(await ctx.http.getJson(`${BASE}/Events/${eventId}/RacecardWithContext?classId=${encodeURIComponent(classId)}`, { expect: 'json', headers: HEADERS }));
    const ev = obj(data.racecardEvent).id !== undefined ? obj(data.racecardEvent) : data;
    const n = num(ev, 'raceNumber');
    if (n != null && n !== raceNumber) throw new Error(`Sportsbet returned race ${n} when ${raceNumber} was requested`);
    const comp = str(ev, 'competitionName');
    const expected = [meeting.venue, meeting.sourceRefs?.['sportsbet.venue'], findVenue(meeting.venue)?.name].filter((x): x is string => !!x).map(normaliseName);
    if (comp && !expected.includes(normaliseName(comp)) && findVenue(comp)?.name !== findVenue(meeting.venue)?.name) {
      throw new Error(`Sportsbet returned ${comp} when ${meeting.venue} was requested`);
    }
    return this.race(ev, raceNumber, ctx.now().toISOString());
  }

  // ---------------------------------------------------------------------------

  private race(ev: Dict, raceNumber: number, fetchedAt: string): RaceRaw {
    const statusCode = (str(ev, 'statusCode') || '').toUpperCase();
    const betting = (str(ev, 'bettingStatus') || '').toUpperCase();
    const status: RaceStatus = betting === 'RESULTED' || statusCode === 'R' ? 'final' : statusCode === 'B' ? 'interim' : betting === 'OFF' ? 'closed' : statusCode === 'A' || betting === 'PRICED' ? 'open' : 'unknown';
    const rawName = str(ev, 'name') || `Race ${raceNumber}`;
    const name = rawName.replace(/^R\d+\s+/i, '').trim();
    const classMatch = name.match(/\(([^()]*)\)\s*$/);
    const raceClass = classMatch ? classMatch[1].replace(/\bbm/i, 'BM').trim() : undefined;
    const cond = parseCondition(str(ev, 'trackStatus'));
    const market = arr(ev.markets).map(obj).find((m) => /win or place/i.test(str(m, 'name') || '')) || arr(ev.markets).map(obj).find((m) => arr(m.selections).some((s) => num(obj(s), 'runnerNumber') != null));
    const selections = arr(market?.selections).map(obj);
    const resulted = status === 'final';
    const runners = selections.map((s) => this.runner(s, resulted, fetchedAt)).filter((r): r is RunnerRaw => !!r && !!r.name);

    // Full finishing order from selections[].place; fall back to results[] (top 4).
    let results: number[][] | undefined;
    if (resulted) {
      // results[] carries the placegetters (top 4, unsorted); selections[].place carries the full order.
      const byPlace = new Map<number, Set<number>>();
      const add = (p?: number, rn?: number) => {
        if (!p || rn == null) return;
        const set = byPlace.get(p) || new Set<number>();
        set.add(rn);
        byPlace.set(p, set);
      };
      for (const res of arr(ev.results).map(obj)) add(num(res, 'place'), num(res, 'runnerNumber'));
      for (const r of runners) add(r.finishingPosition, r.number);
      const places = [...byPlace.keys()].sort((a, b) => a - b);
      if (places.length && places[0] === 1) results = places.map((p) => [...byPlace.get(p)!].sort((a, b) => a - b));
    }

    let dividends: Record<string, number> | undefined;
    if (resulted) {
      dividends = {};
      // winPrice/placePrice are Sportsbet's own fixed prices; the tote dividends live in dividend[] strings like "NSW/PL:4.4/1.7".
      const TOTES = ['VIC', 'NSW', 'QLD', 'UNI', 'MID', 'STAB'];
      for (const res of arr(ev.results).map(obj)) {
        if (num(res, 'place') !== 1) continue;
        const strings = arr(res.dividend).map(String);
        const tote = TOTES.map((t) => strings.find((s) => s.toUpperCase().startsWith(`${t}/PL:`))).find(Boolean);
        const m = tote?.match(/PL:([\d.]+)\/([\d.]+)/i);
        if (m) {
          dividends.win = Number(m[1]);
          dividends.place1 = Number(m[2]);
        }
        const sp = strings.find((s) => /^SP:/i.test(s))?.match(/SP:([\d.]+)/i);
        if (sp) dividends.startingPrice = Number(sp[1]);
      }
      for (const ex of arr(ev.exoticResults).map(obj)) {
        const key = (str(ex, 'name') || '').toLowerCase().replace(/\s+/g, '');
        const d = toNum(pick(ex, 'dividend'));
        if (key && d) dividends[key === 'first4' || key === 'firstfour' ? 'first4' : key] = d;
      }
      if (!Object.keys(dividends).length) dividends = undefined;
    }
    const tempo = str(ev, 'tempo');
    const overview = str(ev, 'overview');
    return {
      number: num(ev, 'raceNumber') || raceNumber,
      name: name.replace(/\s*\([^()]*\)\s*$/, '') || name,
      distance: toNum(pick(ev, 'distance')) || 0,
      startTime: epochToIso(num(ev, 'startTime')),
      raceClass,
      group: groupFrom(raceClass, name),
      trackCondition: cond.text,
      trackRating: cond.rating,
      status,
      sourceRefs: { sportsbet: String(str(ev, 'id') || ''), ...(tempo ? { 'sportsbet.tempo': tempo } : {}), ...(overview ? { 'sportsbet.overview': overview.slice(0, 500) } : {}) },
      runners,
      results,
      dividends,
      source: this.id,
      fetchedAt,
    };
  }

  private runner(s: Dict, resulted: boolean, fetchedAt: string): RunnerRaw | undefined {
    const rawName = str(s, 'name');
    if (!rawName) return undefined;
    const { name, country } = splitCountry(rawName);
    const stats = obj(s.statistics);
    const prices = arr(s.prices).map(obj);
    const live = prices.find((p) => (str(p, 'priceCode') || '').toUpperCase() === 'L');
    const mdp = prices.find((p) => ['MDP', 'MID'].includes((str(p, 'priceCode') || '').toUpperCase()));
    const win = num(live || {}, 'winPrice');
    const place = num(live || {}, 'placePrice');
    const result = (str(s, 'result') || '').toUpperCase();
    const selStatus = (str(s, 'statusCode') || '').toUpperCase();
    const scratched = bool(s, 'isOut') === true || result === 'V' || (!resulted && selStatus === 'S' && !win);
    const flucs = arr(s.recentOddsFluctuations).map(toNum).filter((n): n is number => !!n && n > 1);
    const opening = num(stats, 'openPrice') ?? num(mdp || {}, 'winPrice');
    const odds: OddsQuote[] = [];
    if (win && win > 1 && !scratched) {
      odds.push({
        source: this.id,
        bookmaker: 'Sportsbet',
        type: 'fixed',
        win,
        place: place && place > 1 ? place : undefined,
        opening: opening && opening > 1 ? opening : undefined,
        // recentOddsFluctuations are newest-first; store oldest-first then current.
        flucs: flucs.length ? [...flucs].reverse().concat([win]).map((price) => ({ price })) : undefined,
        fetchedAt,
      });
    }
    const ratings: Record<string, number> = {};
    for (const [k, key] of [['dryRating', 'sportsbet.dryRating'], ['wetRating', 'sportsbet.wetRating']] as const) {
      const v = num(stats, k);
      if (v != null && v > 0) ratings[key] = v;
    }
    const settle = (str(stats, 'expectedSettlingPosition') || '').toLowerCase();
    const speedScore = num(stats, 'speed');
    const speedMapPosition: SpeedMapPosition | undefined = settle.includes('leader')
      ? 'leader'
      : settle === 'off pace'
        ? 'on-pace'
        : settle.includes('midfield')
          ? 'midfield'
          : settle.includes('back')
            ? 'backmarker'
            : speedScore != null
              ? speedScore >= 80
                ? 'leader'
                : speedScore >= 60
                  ? 'on-pace'
                  : speedScore >= 40
                    ? 'midfield'
                    : 'backmarker'
              : undefined;
    const claimText = str(s, 'weightClaim');
    const claim = claimText ? toNum(claimText.replace(/^a/i, '')) : undefined;
    const weightGram = num(s, 'weightGram');
    const career = parseStats(pick(stats, 'total'));
    if (career) career.prizeMoney = num(stats, 'prizeMoney') ?? career.prizeMoney;
    const sire = splitCountry(str(stats, 'sire')).name || undefined;
    const dam = splitCountry(str(stats, 'dam')).name || undefined;
    const formFig = str(stats, 'formFig', 'lastSix') || str(s, 'shortForm');
    const form = arr(stats.recentStartsThoroughbreds)
      .map((p) => this.formLine(obj(p)))
      .filter((f): f is FormLine => !!f);
    const gear: string[] = [];
    if (bool(stats, 'blinkers') === true) gear.push('Blinkers');
    const sexMap: Record<string, string> = { g: 'Gelding', m: 'Mare', h: 'Horse', f: 'Filly', c: 'Colt', r: 'Rig' };
    const sexRaw = (str(stats, 'sex') || '').toLowerCase();
    return {
      number: num(s, 'runnerNumber'),
      name,
      country: country || str(s, 'runnerCountry'),
      barrier: num(s, 'drawNumber', 'barrier'),
      jockey: str(s, 'jockey'),
      trainer: str(s, 'trainer'),
      weight: weightGram ? Math.round(weightGram / 100) / 10 : num(s, 'weight'),
      claim: claim || undefined,
      scratched,
      emergency: num(s, 'emergencyRunnerNumber') != null || undefined,
      age: num(stats, 'age'),
      sex: sexMap[sexRaw] || (sexRaw ? sexRaw.toUpperCase() : undefined),
      colour: str(stats, 'colour'),
      sire,
      dam,
      last5: formFig ? formFig.slice(-5) : undefined,
      career,
      splits: {
        track: parseStats(pick(stats, 'track')),
        distance: parseStats(pick(stats, 'distance')),
        trackDistance: parseStats(pick(stats, 'distanceTrack')),
        firm: parseStats(pick(stats, 'firm')),
        good: parseStats(pick(stats, 'good')),
        soft: parseStats(pick(stats, 'soft')),
        heavy: parseStats(pick(stats, 'heavy')),
        synthetic: parseStats(pick(stats, 'synthetic')),
        firstUp: parseStats(pick(stats, 'firstUp')),
        secondUp: parseStats(pick(stats, 'secondUp')),
        jockey: parseStats(pick(stats, 'horseJockey')),
      },
      form: form.length ? form : undefined,
      gearChanges: gear.length ? gear : undefined,
      comment: str(stats, 'overview'),
      ratings: Object.keys(ratings).length ? ratings : undefined,
      speedMapPosition,
      odds: odds.length ? odds : undefined,
      finishingPosition: resulted ? num(s, 'place') : undefined,
      margin: resulted ? parseMargin(pick(s, 'margin')) : undefined,
      silk: str(s, 'mobileSilkImage'),
    };
  }

  private formLine(p: Dict): FormLine | undefined {
    const date = toISODateOnly(pick(p, 'date'));
    const position = num(p, 'place');
    if (!date || !position) return undefined;
    const cls = str(p, 'class') || '';
    if (/trial|\bbt\b|jump ?out/i.test(cls)) return undefined; // barrier trials are not race form
    const trackStatus = str(p, 'trackStatus');
    const ratingValue = num(p, 'trackStatusValue');
    const cond = parseCondition(trackStatus ? `${trackStatus}${ratingValue != null ? ` ${ratingValue}` : ''}` : undefined);
    const first = str(p, 'first');
    const second = str(p, 'second');
    return {
      date,
      venue: str(p, 'trackName') || 'Unknown',
      distance: toNum(pick(p, 'distance')) || 0,
      trackCondition: cond.text,
      trackRating: cond.rating ?? ratingValue ?? undefined,
      position,
      starters: num(p, 'totalRunners') || 0,
      margin: position === 1 ? 0 : parseMargin(pick(p, 'margin')),
      weight: toNum(pick(p, 'weight')),
      barrier: num(p, 'barrier'),
      jockey: str(p, 'jockey'),
      raceClass: cls || undefined,
      startingPrice: toNum(pick(p, 'startingPrice')),
      time: str(p, 'time'),
      winner: first ? first.replace(/\s*\([^)]*\)\s*$/, '') : undefined,
      second: second ? second.replace(/\s*\([^)]*\)\s*$/, '') : undefined,
      source: this.id,
    };
  }
}

export function epochToIso(v?: number): string | undefined {
  if (!v || !Number.isFinite(v)) return undefined;
  const ms = v > 1e12 ? v : v * 1000;
  return new Date(ms).toISOString();
}
