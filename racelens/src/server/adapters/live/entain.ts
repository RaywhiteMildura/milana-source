import type { MeetingRaw, MeetingSummary, OddsQuote, RaceRaw, RaceResult, RaceStatus, RunnerRaw, SpeedMapPosition } from '../../../shared/types.js';
import { normaliseName } from '../../../shared/util.js';
import type { FetchContext, SourceAdapter } from '../types.js';
import { HttpError, sleep } from '../../core/http.js';
import { arr, bool, num, obj, parseCondition, parseStats, pick, splitCountry, str, titleCase, toNum, type Dict } from './parse.js';
import { groupFrom } from './tab.js';

/**
 * Entain Australia (Ladbrokes.com.au / Neds.com.au) via the official, documented
 * Affiliate API. Ladbrokes and Neds share one back-end and one set of UUIDs, so
 * this is ONE source for verification purposes — never count them twice.
 *
 * Gives: meetings for a date, race card (barrier, jockey, trainer, weight,
 * scratchings), fixed odds with timestamped fluctuations, aggregate form
 * (last 20 starts, breeding, speed map label, form indicators, jockey-on-horse
 * record), Racing & Sports race comment + ordered tips, rail/track/weather, and
 * placings + tote dividends once resulted. No per-start form lines for AU.
 *
 * Identification headers are requested by the docs (omitting them is the path
 * to a 429). Two hosts serve the same API; we fall over on transport errors.
 */
const HOSTS = ['https://api.ladbrokes.com.au/affiliates/v1/racing', 'https://api-affiliates.ladbrokes.com.au/affiliates/v1/racing'] as const;

/** After the primary host fails at the transport level, prefer the fallback for this long. */
const FALLBACK_STICKY_MS = 5 * 60_000;

function headers(): Record<string, string> {
  return {
    From: process.env.RACELENS_CONTACT_EMAIL || 'racelens-user@localhost',
    'X-Partner': 'RaceLens personal research',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

const RACE_TYPE: Record<string, MeetingSummary['raceType']> = { T: 'thoroughbred', H: 'harness', G: 'greyhound' };

const STATUS: Record<string, RaceStatus> = { open: 'open', closed: 'closed', live: 'closed', interim: 'interim', final: 'final', abandoned: 'abandoned' };

const SEX: Record<string, string> = { G: 'Gelding', M: 'Mare', H: 'Horse', C: 'Colt', F: 'Filly', R: 'Rig' };

/** Market rows that are not horses (seen in Live Racing / derivative markets). */
const PSEUDO_RUNNER = /^(odds|evens|favourite|the field|field|any other runners?|all other runners?)\b/i;

/** "Sportsbet-Ballarat" style sponsor prefixes on venue names. */
const SPONSOR_PREFIX = /^(sportsbet|ladbrokes|neds|tab|bet365|betr|pointsbet)-\s*/i;

interface Refs {
  meetingId: string;
  events: Map<number, string>;
}

export class EntainAdapter implements SourceAdapter {
  id = 'entain';
  name = 'Ladbrokes / Neds (Entain)';
  kind = 'odds' as const;
  capabilities = ['meetings' as const, 'racecard' as const, 'odds' as const, 'results' as const, 'conditions' as const];
  homepage = 'https://www.ladbrokes.com.au/racing';

  private preferFallbackUntil = 0;

  constructor(private readonly delayMs = 300) {}

  // ---------------------------------------------------------------------------
  // Transport

  /**
   * GET one affiliate route and unwrap the `{header, params, data}` envelope.
   * Falls over to the second host on a transport failure (network, timeout,
   * 5xx, 429, non-JSON body) but not on a 4xx, which means the same thing on
   * both hosts. An envelope `header.error` is a data error, never a fallback.
   */
  private async api(path: string, ctx: FetchContext): Promise<Dict> {
    const hosts = Date.now() < this.preferFallbackUntil ? [HOSTS[1], HOSTS[0]] : [HOSTS[0], HOSTS[1]];
    let envelope: unknown;
    let served = false;
    let lastErr: unknown;
    for (let i = 0; i < hosts.length && !served; i++) {
      try {
        envelope = await ctx.http.getJson(`${hosts[i]}${path}`, { expect: 'json', headers: headers() });
        served = true;
      } catch (err) {
        lastErr = err;
        if (!isTransportError(err)) throw err;
        if (hosts[i] === HOSTS[0]) this.preferFallbackUntil = Date.now() + FALLBACK_STICKY_MS;
        if (i + 1 < hosts.length) ctx.log.warn(`Entain: ${new URL(hosts[i]).hostname} failed (${errMsg(err)}); trying ${new URL(hosts[i + 1]).hostname}`);
      }
    }
    if (!served) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    const env = obj(envelope);
    const error = str(obj(env.header), 'error');
    if (error) throw new Error(`Entain: ${error}`);
    return obj(env.data);
  }

  // ---------------------------------------------------------------------------
  // Meetings

  async listMeetings(date: string, ctx: FetchContext): Promise<MeetingSummary[]> {
    const data = await this.api(`/meetings?enc=json&date_from=${encodeURIComponent(date)}&date_to=${encodeURIComponent(date)}&category=T&country=AUS&limit=200`, ctx);
    const out: MeetingSummary[] = [];
    for (const m of arr(data.meetings).map(obj)) {
      const summary = this.meetingSummary(m, date);
      if (summary) out.push(summary);
    }
    return out;
  }

  private meetingSummary(m: Dict, date: string): MeetingSummary | undefined {
    const name = (str(m, 'name') || '').replace(SPONSOR_PREFIX, '').trim();
    const meetingId = str(m, 'meeting', 'id');
    if (!name || !meetingId) return undefined;
    // race_number 0 rows are specials (Jockey Challenge etc.), not races.
    const races = arr(m.races)
      .map(obj)
      .filter((r) => (num(r, 'race_number') || 0) > 0 && !!str(r, 'id'))
      .sort((a, b) => (num(a, 'race_number') || 0) - (num(b, 'race_number') || 0));
    const starts = races.map((r) => Date.parse(str(r, 'start_time') || '')).filter((t) => Number.isFinite(t));
    const slug = normaliseName(name).replace(/\s+/g, '-');
    const cond = parseCondition(races.map((r) => str(r, 'track_condition')).find(Boolean));
    const weather = titleCase(races.map((r) => str(r, 'weather')).find(Boolean));
    return {
      id: `${date}:${slug}`,
      date,
      venue: name,
      venueSlug: slug,
      state: str(m, 'state'),
      country: str(m, 'country') || 'AUS',
      raceType: RACE_TYPE[(str(m, 'category') || 'T').toUpperCase()] || 'thoroughbred',
      raceCount: races.length || undefined,
      trackCondition: cond.text,
      trackRating: cond.rating,
      weather,
      firstRaceTime: starts.length ? new Date(Math.min(...starts)).toISOString() : undefined,
      sourceRefs: { entain: `${meetingId}|${races.map((r) => `${num(r, 'race_number')}:${str(r, 'id')}`).join(',')}` },
      sources: [this.id],
    };
  }

  private parseRefs(meeting: MeetingSummary): Refs | undefined {
    const ref = meeting.sourceRefs?.entain;
    if (!ref) return undefined;
    const [meetingId, events] = ref.split('|');
    const map = new Map<number, string>();
    for (const pair of (events || '').split(',')) {
      const [n, id] = pair.split(':');
      if (n && id && Number(n) > 0) map.set(Number(n), id);
    }
    return { meetingId, events: map };
  }

  private async resolveRefs(meeting: MeetingSummary, ctx: FetchContext): Promise<Refs> {
    const existing = this.parseRefs(meeting);
    if (existing && existing.events.size) return existing;
    const list = await this.listMeetings(meeting.date, ctx);
    const hit = list.find((m) => m.raceType === meeting.raceType && (m.venueSlug === meeting.venueSlug || normaliseName(m.venue) === normaliseName(meeting.venue)));
    const refs = hit && this.parseRefs(hit);
    if (!refs || !refs.events.size) throw new Error(`Entain: no meeting matching ${meeting.venue} on ${meeting.date}`);
    return refs;
  }

  // ---------------------------------------------------------------------------
  // Races

  async fetchMeeting(meeting: MeetingSummary, ctx: FetchContext): Promise<MeetingRaw> {
    const refs = await this.resolveRefs(meeting, ctx);
    const fetchedAt = ctx.now().toISOString();
    const races: RaceRaw[] = [];
    const numbers = [...refs.events.keys()].sort((a, b) => a - b);
    const header: Partial<MeetingSummary> = {};
    for (const n of numbers) {
      try {
        const { race, weather } = await this.loadEvent(refs.events.get(n)!, n, ctx);
        races.push(race);
        if (!header.trackCondition && race.trackCondition) {
          header.trackCondition = race.trackCondition;
          header.trackRating = race.trackRating;
        }
        if (!header.rail && race.sourceRefs['entain.rail']) header.rail = race.sourceRefs['entain.rail'];
        if (!header.weather && weather) header.weather = weather;
      } catch (err) {
        ctx.log.warn(`Entain: race ${n} failed: ${errMsg(err)}`);
      }
      if (this.delayMs && n !== numbers[numbers.length - 1]) await sleep(this.delayMs);
    }
    return { meeting: { ...meeting, ...header, sources: [this.id] }, races, source: this.id, fetchedAt };
  }

  async fetchRace(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RaceRaw> {
    const refs = await this.resolveRefs(meeting, ctx);
    const id = refs.events.get(raceNumber);
    if (!id) throw new Error(`Entain: race ${raceNumber} not found for ${meeting.venue}`);
    return (await this.loadEvent(id, raceNumber, ctx)).race;
  }

  async fetchResults(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RaceResult | null> {
    const race = await this.fetchRace(meeting, raceNumber, ctx);
    if ((race.status !== 'interim' && race.status !== 'final') || !race.results?.length) return null;
    // Lengths behind the winner per placing; only when every placing has one.
    const margins = race.results.map((group) => race.runners.find((r) => r.number === group[0])?.margin);
    return {
      raceNumber,
      placings: race.results,
      margins: margins.every((m): m is number => typeof m === 'number') ? margins : undefined,
      dividends: race.dividends,
      recordedAt: ctx.now().toISOString(),
      source: this.id,
    };
  }

  private async loadEvent(eventId: string, raceNumber: number, ctx: FetchContext): Promise<{ race: RaceRaw; weather?: string }> {
    const data = await this.api(`/events/${encodeURIComponent(eventId)}?enc=json`, ctx);
    const race = obj(data.race);
    if (!Object.keys(race).length) throw new Error(`Entain: event ${eventId} payload has no race`);
    const gotId = str(race, 'event_id');
    if (gotId && gotId !== eventId) throw new Error(`Entain returned event ${gotId} when ${eventId} was requested`);
    const n = num(race, 'race_number');
    if (n != null && n !== raceNumber) throw new Error(`Entain returned race ${n} when ${raceNumber} was requested`);
    return { race: this.race(data, raceNumber, ctx.now().toISOString(), ctx.jurisdiction), weather: titleCase(str(race, 'weather')) };
  }

  // ---------------------------------------------------------------------------
  // Mapping

  private race(data: Dict, raceNumber: number, fetchedAt: string, jurisdiction?: string): RaceRaw {
    const race = obj(data.race);
    const status = STATUS[(str(race, 'status') || '').toLowerCase()] || 'unknown';
    const resulted = status === 'interim' || status === 'final';
    const { name, raceClass } = splitRaceName(str(race, 'description') || `Race ${raceNumber}`);
    const cond = parseCondition(str(race, 'track_condition'));

    const allRunners = arr(data.runners).map(obj);
    const primary = allRunners.filter((r) => bool(r, 'primary_market') === true || /^final field$/i.test(str(r, 'market_name') || ''));
    const field = primary.length ? primary : allRunners.filter((r) => bool(r, 'primary_market') !== false);

    // entrant_id → saddlecloth, across the final field AND derivative markets
    // (R&S tips may reference the Live Racing market's entrant ids).
    const entrantToNumber = new Map<string, number>();
    const numberByName = new Map<string, number>();
    for (const r of field) {
      const id = str(r, 'entrant_id');
      const n = num(r, 'runner_number');
      if (id && n && n > 0) entrantToNumber.set(id, n);
      if (n && n > 0) numberByName.set(normaliseName(splitCountry(str(r, 'name')).name), n);
    }
    for (const r of [...allRunners, ...arr(data.derivatives).map(obj)]) {
      const id = str(r, 'entrant_id');
      if (!id || entrantToNumber.has(id)) continue;
      const n = num(r, 'runner_number') || numberByName.get(normaliseName(splitCountry(str(r, 'name')).name));
      if (n && n > 0) entrantToNumber.set(id, n);
    }

    const results = arr(data.results).map(obj);
    const resultFor = (r: Dict): Dict | undefined => {
      const id = str(r, 'entrant_id');
      const n = num(r, 'runner_number');
      return results.find((res) => (id && str(res, 'entrant_id') === id) || (n && n > 0 && num(res, 'runner_number') === n));
    };
    const runners = field.map((r) => this.runner(r, resulted, resulted ? resultFor(r) : undefined, fetchedAt)).filter((r): r is RunnerRaw => !!r);

    let placings: number[][] | undefined;
    if (resulted && results.length) {
      const byPlace = new Map<number, Set<number>>();
      for (const res of results) {
        const p = num(res, 'position');
        const rn = num(res, 'runner_number') || entrantToNumber.get(str(res, 'entrant_id') || '');
        if (!p || !rn) continue;
        const set = byPlace.get(p) || new Set<number>();
        set.add(rn);
        byPlace.set(p, set);
      }
      const places = [...byPlace.keys()].sort((a, b) => a - b);
      if (places.length && places[0] === 1) placings = places.map((p) => [...byPlace.get(p)!].sort((a, b) => a - b));
    }

    const rail = str(race, 'rail_position');
    const comment = str(race, 'comment');
    const tips = arr(race.tips)
      .map((id) => entrantToNumber.get(String(id)))
      .filter((n): n is number => !!n)
      .join(',');
    const eventId = str(race, 'event_id') || '';

    return {
      number: num(race, 'race_number') || raceNumber,
      name,
      distance: toNum(pick(race, 'distance')) || 0,
      startTime: unixToIso(num(race, 'advertised_start')) || isoOrUndefined(str(race, 'advertised_start_string')),
      raceClass,
      group: groupFrom(str(race, 'group')) || groupFrom(raceClass, name),
      prize: num(obj(race.prize_monies), 'total_value') || undefined,
      trackCondition: cond.text,
      trackRating: cond.rating,
      status,
      sourceRefs: {
        entain: eventId,
        ...(rail ? { 'entain.rail': rail } : {}),
        ...(comment ? { 'entain.comment': comment.slice(0, 500) } : {}),
        ...(tips ? { 'entain.tips': tips } : {}),
      },
      runners,
      results: placings,
      dividends: resulted ? this.dividends(data, jurisdiction) : undefined,
      source: this.id,
      fetchedAt,
    };
  }

  private runner(r: Dict, resulted: boolean, result: Dict | undefined, fetchedAt: string): RunnerRaw | undefined {
    const rawName = str(r, 'name');
    if (!rawName || PSEUDO_RUNNER.test(rawName)) return undefined;
    const { name, country } = splitCountry(rawName);
    const scratched = bool(r, 'is_scratched') === true || bool(r, 'is_late_scratched') === true;

    const weight = obj(r.weight);
    const allocated = toNum(pick(weight, 'allocated')) ?? toNum(pick(weight, 'total')) ?? (typeof r.weight === 'string' || typeof r.weight === 'number' ? toNum(r.weight) : undefined);
    const apprentice = (str(r, 'apprentice_indicator') || '').toUpperCase() === 'A';
    const allowance = toNum(pick(r, 'allowance_weight'));
    const claim = apprentice && allowance && allowance > 0 ? allowance : undefined;

    // Odds: fixed_win 0 = TBA; scratched runners keep a frozen price we must not report.
    const odds = obj(r.odds);
    const win = num(odds, 'fixed_win');
    const place = num(odds, 'fixed_place');
    const flucs = arr(r.flucs)
      .map(toNum)
      .filter((n): n is number => !!n && n > 1);
    const fwt = obj(r.flucs_with_timestamp);
    const lastSix = arr(fwt.last_six).map(obj);
    const openFluc = num(obj(fwt.open), 'fluc');
    const opening = openFluc && openFluc > 1 ? openFluc : flucs[0];
    const quotes: OddsQuote[] = [];
    if (!scratched && win && win > 1) {
      quotes.push({
        source: this.id,
        bookmaker: 'Ladbrokes',
        type: 'fixed',
        win,
        place: place && place > 1 ? place : undefined,
        opening: opening && opening > 1 ? opening : undefined,
        // flucs[] is oldest-first with the current price last; last_six carries the matching timestamps.
        flucs: flucs.length
          ? flucs.map((price, i) => {
              const at = lastSix.length === flucs.length ? str(lastSix[i], 'timestamp') : undefined;
              return at ? { price, at } : { price };
            })
          : undefined,
        fetchedAt,
      });
    }

    const indicators = arr(r.form_indicators).map(obj);
    const positive = indicators.filter((i) => bool(i, 'negative') !== true).map((i) => str(i, 'name')).filter((s): s is string => !!s);
    const negative = indicators.filter((i) => bool(i, 'negative') === true).map((i) => str(i, 'name')).filter((s): s is string => !!s).map((s) => `⚠ ${s}`);
    const picks = arr(r.picks)
      .map(obj)
      .map((p) => {
        const who = str(p, 'name');
        const text = str(p, 'comment');
        if (!who && !text) return undefined;
        const rank = num(p, 'rank');
        const kind = str(p, 'selector_type') || 'expert';
        return `${kind[0].toUpperCase()}${kind.slice(1)} pick${rank ? ` #${rank}` : ''}${who ? ` (${who})` : ''}${text ? `: ${text}` : ''}`;
      })
      .filter((s): s is string => !!s);
    const formComment = str(r, 'form_comment');
    const comment = [...(formComment ? [formComment] : []), ...positive, ...negative, ...picks].join('; ') || undefined;

    const jockeyStats = parseStats(statsFromSnake(obj(obj(r.past_performances).jockey)));
    const l20 = str(r, 'last_twenty_starts');
    const sexRaw = (str(r, 'sex') || '').toUpperCase();
    const position = result ? num(result, 'position') : undefined;
    const marginLength = result ? num(result, 'margin_length') : undefined;

    return {
      number: num(r, 'runner_number') || undefined,
      name,
      country: country || str(r, 'country'),
      barrier: num(r, 'barrier') || undefined,
      jockey: str(r, 'jockey'),
      trainer: str(r, 'trainer_name', 'trainer'),
      weight: allocated,
      claim,
      scratched,
      emergency: bool(r, 'is_emergency') === true || undefined,
      age: num(r, 'age') || undefined,
      sex: SEX[sexRaw] || (sexRaw || undefined),
      colour: str(r, 'colour'),
      sire: titleCase(splitCountry(str(r, 'sire')).name) || undefined,
      dam: titleCase(splitCountry(str(r, 'dam')).name) || undefined,
      last5: l20 ? l20.replace(/\s+/g, '').slice(-5) || undefined : undefined,
      splits: jockeyStats ? { jockey: jockeyStats } : undefined,
      comment,
      speedMapPosition: speedMap(str(obj(r.speedmap), 'label')),
      odds: quotes.length ? quotes : undefined,
      finishingPosition: resulted ? position : undefined,
      // margin_length is 0 for every placing until Final; only trust a positive figure (winner = 0).
      margin: resulted && position ? (position === 1 ? 0 : marginLength && marginLength > 0 ? marginLength : undefined) : undefined,
      silk: str(r, 'silk_url_64x64', 'silk_url_128x128'),
    };
  }

  /** Tote dividends from one tote (the user's jurisdiction when it is listed). */
  private dividends(data: Dict, jurisdiction?: string): Record<string, number> | undefined {
    const divs = arr(data.dividends).map(obj);
    if (!divs.length) return undefined;
    const totes = [...new Set(divs.map((d) => (str(d, 'tote') || '').toUpperCase()))];
    const tote = totes.find((t) => t === (jurisdiction || '').toUpperCase()) ?? totes.find((t) => t && t !== 'UNKNOWN') ?? totes[0];
    const out: Record<string, number> = {};
    for (const d of divs) {
      if ((str(d, 'tote') || '').toUpperCase() !== tote) continue;
      const amount = num(d, 'dividend');
      if (!amount || amount <= 0) continue;
      const product = (str(d, 'product_name') || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const positions = arr(d.positions).map(obj);
      if (product === 'totewin' || product === 'win') out.win ??= amount;
      else if (product === 'toteplace' || product === 'place') {
        const pos = num(positions[0] || {}, 'position');
        if (pos) out[`place${pos}`] ??= amount;
      } else if (product === 'quinella') out.quinella ??= amount;
      else if (product === 'exacta') out.exacta ??= amount;
      else if (product === 'trifecta') out.trifecta ??= amount;
      else if (product === 'firstfour' || product === 'first4') out.first4 ??= amount;
    }
    return Object.keys(out).length ? out : undefined;
  }
}

// -----------------------------------------------------------------------------
// Helpers

/**
 * "Ladbrokes Cox Plate @ Flemington (Bm70) Hcp" → name "Ladbrokes Cox Plate @ Flemington",
 * raceClass "BM70 Hcp". Names without a parenthesised class are left intact.
 */
export function splitRaceName(description: string): { name: string; raceClass?: string } {
  const desc = description.replace(/\s+/g, ' ').trim();
  const m = desc.match(/^(.*?)\s*\(([^()]+)\)\s*((?:[A-Za-z0-9&'./-]+\s*){0,3})$/);
  if (!m || !m[1].trim()) return { name: desc };
  const inner = m[2].trim().replace(/^bm\s*(\d)/i, 'BM$1').replace(/^cl\s*(\d)/i, 'CL$1');
  const raceClass = [inner, m[3].trim()].filter(Boolean).join(' ');
  return { name: m[1].trim(), raceClass: raceClass || undefined };
}

/** Entain speed-map labels → RaceLens positions ("invalid settling lengths" on scratched runners → none). */
export function speedMap(label?: string): SpeedMapPosition | undefined {
  const l = (label || '').toLowerCase();
  if (!l || l.includes('invalid')) return undefined;
  if (l.includes('lead') || l.includes('front')) return 'leader';
  if (l.includes('pace') || l.includes('handy')) return 'on-pace';
  if (l.includes('midfield')) return 'midfield';
  if (l.includes('back')) return 'backmarker';
  return undefined;
}

/** {number_of_starts, number_of_wins, ...} → the shape parseStats reads. */
function statsFromSnake(o: Dict): Dict | undefined {
  if (!Object.keys(o).length) return undefined;
  const seconds = num(o, 'number_of_seconds', 'seconds');
  const thirds = num(o, 'number_of_thirds', 'thirds');
  const placings = num(o, 'number_of_placings', 'placings');
  const itemised = (seconds || 0) + (thirds || 0) > 0 || !placings;
  return {
    starts: num(o, 'number_of_starts', 'starts'),
    wins: num(o, 'number_of_wins', 'wins'),
    ...(itemised ? { seconds, thirds } : { placings }),
  };
}

function unixToIso(v?: number): string | undefined {
  if (!v || !Number.isFinite(v)) return undefined;
  return new Date(v > 1e12 ? v : v * 1000).toISOString();
}

function isoOrUndefined(s?: string): string | undefined {
  if (!s) return undefined;
  const t = Date.parse(s.replace(' +0000 UTC', 'Z').replace(' ', 'T'));
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/** True unless the failure is a definite 4xx (other than 429), which the other host would repeat. */
function isTransportError(err: unknown): boolean {
  if (err instanceof HttpError) return !(err.status >= 400 && err.status < 500 && err.status !== 429);
  return true;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
