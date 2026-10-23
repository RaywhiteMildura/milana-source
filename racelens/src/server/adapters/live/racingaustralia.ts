import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { CareerStats, FormLine, MeetingRaw, MeetingSummary, RaceRaw, RaceResult, RunnerRaw, SplitStats } from '../../../shared/types.js';
import { daysBetween, normaliseName, slugify } from '../../../shared/util.js';
import type { FetchContext, SourceAdapter } from '../types.js';
import { sleep } from '../../core/http.js';
import { parseCondition, parseMargin, parseStats, splitCountry, toNum } from './parse.js';
import { groupFrom } from './tab.js';
import { VENUES, findVenue, stateTimezone } from './venues.js';

/**
 * Racing Australia "Free Fields" — the official national nominations → weights →
 * acceptances → form → results pipeline, served as ASP.NET HTML and mirrored
 * byte-identical on the Racing NSW hosts. The only evidenced source of pedigree
 * and of run-by-run form with 600 m splits.
 *
 * URL grammar (see research/racingcom.md §3):
 *   {host}FreeFields/Calendar.aspx?Date=YYYYMonDD      (+ Calendar.aspx?State=XX fallback)
 *   {host}FreeFields/Form.aspx?Key={Key}               full form guide (~870 KB)
 *   {host}FreeFields/Acceptances.aspx?Key={Key}        styled acceptances (fallback when Form is unpublished)
 *   {host}ozracing/Acceptances.aspx?key={Key}          bare acceptances (last resort)
 *   {host}FreeFields/Results.aspx?Key={Key}            whole meeting, one page
 *   Key = `${YYYY}${Mon}${DD},${STATE},${Venue}` e.g. `2026Oct24,VIC,Flemington` (venue as RA spells it,
 *   sponsor prefixes included; URL-encoded with encodeURIComponent so `,` → %2C and space → %20).
 *
 * Not bot-walled in normal use, but a verification interstitial can appear under
 * load — browser-like headers, one request at a time with a polite delay, and
 * per-meeting page caching keep us well under the radar.
 */
export const RA_HOSTS = [
  'https://www.racingaustralia.horse/FreeFields/',
  'https://racing.racingnsw.com.au/FreeFields/',
  'https://mdata.racingnsw.com.au/FreeFields/',
];

const HEADERS: Record<string, string> = {
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-AU,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'];
/** Higher = later in the meeting's publication pipeline. */
const STAGE_RANK: Record<string, number> = { nominations: 1, weights: 2, acceptances: 3, scratchings: 3, stagemeeting: 3, raceprogram: 4, form: 4, allform: 4, results: 5 };
const SPONSOR_PREFIX = /^(?:sportsbet|ladbrokes|bet365|tab|tabtouch|neds|pointsbet|betfair|unibet|beteasy|aquis|magic millions|southside|racing\.com|sky racing)[\s-]+/i;

/** Racing Australia track abbreviations used in run lines ("CAUL 10Oct26"). Unknown codes are kept as printed. */
const TRACK_CODES: Record<string, string> = {
  FLEM: 'Flemington', CAUL: 'Caulfield', MV: 'Moonee Valley', 'M V': 'Moonee Valley', SANH: 'Sandown Hillside', SANL: 'Sandown Lakeside',
  RAND: 'Randwick', KENS: 'Kensington', RHIL: 'Rosehill', WFM: 'Warwick Farm', 'W FM': 'Warwick Farm', CANT: 'Canterbury', KGR: 'Kembla Grange', KEMB: 'Kembla Grange',
  NCLE: 'Newcastle', GOSF: 'Gosford', HAWK: 'Hawkesbury', WYNG: 'Wyong', SCNE: 'Scone', CANB: 'Canberra',
  EFM: 'Eagle Farm', 'E FM': 'Eagle Farm', DOOM: 'Doomben', GCST: 'Gold Coast', SCST: 'Sunshine Coast', IPSW: 'Ipswich', TWBA: 'Toowoomba',
  MORP: 'Morphettville', MRPK: 'Morphettville Parks', MBR: 'Murray Bridge', 'M BR': 'Murray Bridge', GAWL: 'Gawler',
  ASCT: 'Ascot', BLMT: 'Belmont', PINJ: 'Pinjarra', BUNB: 'Bunbury', HOBT: 'Hobart', LAUN: 'Launceston', DEVS: 'Devonport', DARW: 'Darwin',
  BRAT: 'Ballarat', BDGO: 'Bendigo', GEEL: 'Geelong', CRAN: 'Cranbourne', PAKE: 'Pakenham', MORN: 'Mornington', SALE: 'Sale', KILM: 'Kilmore',
  SEYM: 'Seymour', WANG: 'Wangaratta', WERR: 'Werribee', KYNE: 'Kyneton', ECHA: 'Echuca', SWH: 'Swan Hill', WBOL: 'Warrnambool', HTON: 'Hamilton', YVLE: 'Yarra Valley',
};

type Sel = ReturnType<CheerioAPI>;

export type UnavailableReason = 'bot-wall' | 'not-available' | 'empty' | 'transport';

/** Thrown when a page could not be obtained from any host. `reason` is the most specific cause seen. */
export class PageUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: UnavailableReason,
    readonly path: string,
  ) {
    super(message);
    this.name = 'PageUnavailableError';
  }
}

export interface RacingAustraliaOptions {
  /** Politeness delay between page fetches (ms). */
  delayMs?: number;
  /** FreeFields base URLs, tried in order. */
  hosts?: string[];
  /** How long a fetched Form/Acceptances page is reused (ms). */
  pageCacheMs?: number;
  /** How long a fetched Results page is reused (ms); results change race by race. */
  resultsCacheMs?: number;
}

// ---------------------------------------------------------------------------
// Key / date / time helpers
// ---------------------------------------------------------------------------

export interface ParsedKey {
  /** YYYY-MM-DD */
  date: string;
  state: string;
  /** Venue exactly as Racing Australia spells it (sponsor prefixes included). */
  venue: string;
  /** "Trial" / "Picnic" suffix when present. */
  variant?: string;
  /** Canonical decoded key `YYYYMonDD,STATE,Venue[,Variant]`. */
  key: string;
}

/** `2026-10-24` + `VIC` + `Flemington` → `2026Oct24,VIC,Flemington`. */
export function buildKey(date: string, state: string, venue: string): string {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const mon = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || !mon) throw new Error(`Racing Australia: cannot build a key from date "${date}"`);
  return `${m[1]}${mon}${m[3]},${state.trim().toUpperCase()},${venue.trim()}`;
}

/** Decode a (possibly URL-encoded) Key into its parts; undefined when it is not a meeting key. */
export function parseKey(raw: string): ParsedKey | undefined {
  let key = raw.replace(/\+/g, ' ');
  try {
    key = decodeURIComponent(key);
  } catch {
    /* keep as-is */
  }
  const parts = key.split(',').map((s) => s.trim());
  if (parts.length < 3) return undefined;
  const dm = parts[0].match(/^(\d{4})([A-Za-z]{3})(\d{1,2})$/);
  if (!dm) return undefined;
  const mo = MONTHS.findIndex((x) => x.toLowerCase() === dm[2].toLowerCase());
  if (mo < 0 || !parts[1] || !parts[2]) return undefined;
  const date = `${dm[1]}-${String(mo + 1).padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
  return { date, state: parts[1].toUpperCase(), venue: parts[2], variant: parts[3] || undefined, key: parts.filter(Boolean).join(',') };
}

/** The key for a meeting: its recorded sourceRef when the calendar supplied one, else built from date/state/venue. */
export function meetingKey(meeting: MeetingSummary): string {
  const ref = meeting.sourceRefs?.racingaustralia;
  if (ref) return ref;
  const state = meeting.state || findVenue(meeting.venue)?.state;
  if (!state) throw new Error(`Racing Australia: cannot determine the state for ${meeting.venue}`);
  return buildKey(meeting.date, state, meeting.venue);
}

/** Strip sponsor prefixes and map RA's venue spelling onto RaceLens' canonical venue names ("The Valley" → "Moonee Valley"). */
export function canonicalVenue(raVenue: string): string {
  const stripped = raVenue.replace(SPONSOR_PREFIX, '').replace(/\s+/g, ' ').trim() || raVenue.trim();
  const n = normaliseName(stripped);
  const hit = VENUES.find((v) => normaliseName(v.name) === n) || VENUES.find((v) => v.aliases?.some((a) => normaliseName(a) === n));
  return hit ? hit.name : stripped;
}

/** UTC offset ("+11:00") in force for a state on a race day (DST-aware via Intl). */
export function stateUtcOffset(state: string | undefined, date: string): string {
  const tz = stateTimezone(state);
  // Probe at 02:00Z = late morning everywhere in Australia, safely past the 2–3 am DST changeovers.
  const probe = new Date(`${date}T02:00:00Z`);
  let label = '';
  try {
    label = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value || '';
  } catch {
    label = '';
  }
  const m = label.match(/([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!m) return '+10:00';
  return `${m[1]}${m[2].padStart(2, '0')}:${m[3] || '00'}`;
}

/** Combine the meeting date with a printed local time ("12:40PM", "3:45 pm", "13:30") into an ISO instant. */
export function localTimeToIso(date: string, time: string, state?: string): string | undefined {
  const m = time.trim().match(/^(\d{1,2})[:.](\d{2})\s*([AaPp][Mm])?$/);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]?.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  if (h > 23 || min > 59) return undefined;
  const d = new Date(`${date}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00${stateUtcOffset(state, date)}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** "Saturday, 18 October 2025" / "Tuesday 21st July, 2026" → YYYY-MM-DD. */
export function parseLongDate(s: string): string | undefined {
  const m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/);
  if (!m) return undefined;
  const mo = MONTHS.findIndex((x) => x.toLowerCase() === m[2].slice(0, 3).toLowerCase());
  if (mo < 0) return undefined;
  return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** "10Oct26" → 2026-10-10. */
function shortDate(day: string, mon: string, year: string): string | undefined {
  const mo = MONTHS.findIndex((x) => x.toLowerCase() === mon.toLowerCase());
  if (mo < 0) return undefined;
  const y = year.length === 2 ? `20${year}` : year;
  return `${y}-${String(mo + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Page classification / identity
// ---------------------------------------------------------------------------

/** Detect bodies that are not the requested meeting page. */
export function classifyPage(html: string): Exclude<UnavailableReason, 'transport'> | undefined {
  const t = html.trim();
  if (/not currently available/i.test(t)) return 'not-available';
  if (t.length < 400) return 'empty';
  if (/race-venue-date|race-title|race-strip-fields|Key=|(?:Acceptances|Nominations|Weights|Results|Form) on /i.test(t)) return undefined;
  if (/just a moment|checking your browser|enable javascript and cookies|access denied|captcha|request unsuccessful|incapsula|cf-browser-verification|verify you are human|pardon our interruption|attention required/i.test(t.slice(0, 8000))) return 'bot-wall';
  return undefined;
}

/** Collapse whitespace but keep the newlines we injected for <br>. */
function txt(s: string): string {
  return s
    .replace(/ /g, ' ')
    .replace(/[ \t\r\f]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Title-case an ALL CAPS horse name ("REDOUTE'S CHOICE" → "Redoute's Choice", "D'ARGENTO" → "D'Argento"). */
function horseCase(s?: string): string | undefined {
  if (!s) return undefined;
  const v = oneLine(s);
  if (!v) return undefined;
  if (v !== v.toUpperCase()) return v;
  return v
    .toLowerCase()
    .replace(/(^|[\s\-(])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase())
    .replace(/\b([a-zA-Z])'([a-z])/g, (_, a: string, b: string) => a.toUpperCase() + "'" + b.toUpperCase());
}

/** Load with <br> turned into newlines so multi-line cells keep their structure. */
function load(html: string | CheerioAPI): CheerioAPI {
  if (typeof html !== 'string') return html;
  return cheerio.load(html.replace(/<br\s*\/?>/gi, '\n'));
}

interface PageHeader {
  title: string;
  date?: string;
}

function pageHeader($: CheerioAPI): PageHeader | undefined {
  const h2 = $('div.top h2').first();
  if (h2.length) {
    const dateText = oneLine(h2.find('.race-venue-date').text());
    const title = oneLine(h2.clone().children().remove().end().text());
    return { title, date: parseLongDate(dateText) || parseLongDate(oneLine(h2.text())) };
  }
  const alt = oneLine($('h2').first().text() || $('title').first().text());
  if (!alt) return undefined;
  return { title: alt, date: parseLongDate(alt) };
}

function venueMatches(headerTitle: string, wanted: string[]): boolean {
  const header = normaliseName(headerTitle.replace(SPONSOR_PREFIX, ''));
  if (!header) return false;
  for (const w of wanted) {
    if (!w) continue;
    const cands = new Set([normaliseName(w), normaliseName(w.replace(SPONSOR_PREFIX, '')), normaliseName(canonicalVenue(w))]);
    for (const c of cands) {
      if (c && (header.includes(c) || c.includes(header.split(' ')[0]) && header.split(' ')[0].length > 3)) return true;
    }
  }
  return false;
}

/** Throw unless the page header names the venue and the date we asked for. */
export function assertMeetingPage($: CheerioAPI, meeting: Pick<MeetingSummary, 'venue' | 'date'>, key: string, url: string): void {
  const header = pageHeader($);
  if (!header || !header.title) throw new PageUnavailableError(`Racing Australia: unexpected page (no meeting header) at ${url}`, 'empty', url);
  const parsed = parseKey(key);
  if (!venueMatches(header.title, [meeting.venue, parsed?.venue || ''])) {
    throw new Error(`Racing Australia returned "${header.title}" when ${meeting.venue} (${key}) was requested`);
  }
  if (header.date && header.date !== meeting.date) {
    throw new Error(`Racing Australia returned ${header.date} ("${header.title}") when ${meeting.date} was requested`);
  }
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface CalendarEntry extends ParsedKey {
  /** Page the calendar linked for this meeting (Nominations | Weights | Acceptances | Form | Results …). */
  stage: string;
}

/** Every `<a href="/FreeFields/<Page>.aspx?Key=…">` on a calendar page, deduped by key, keeping the most advanced stage. */
export function parseCalendar(html: string | CheerioAPI): CalendarEntry[] {
  const $ = load(html);
  const out = new Map<string, CalendarEntry>();
  $('a[href*="Key="]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const m = href.match(/([A-Za-z_]+)\.aspx\?(?:[^#"']*?&)?Key=([^"'&#]+)/i);
    if (!m) return;
    const parsed = parseKey(m[2]);
    if (!parsed) return;
    const stage = m[1];
    const prev = out.get(parsed.key);
    if (!prev || (STAGE_RANK[stage.toLowerCase()] || 0) > (STAGE_RANK[prev.stage.toLowerCase()] || 0)) out.set(parsed.key, { ...parsed, stage });
  });
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Race blocks (shared by Form / Acceptances / Results pages)
// ---------------------------------------------------------------------------

interface RaceHead {
  number: number;
  time?: string;
  name: string;
  distance: number;
  /** The conditions / prize cell, newline separated. */
  info: string;
}

interface RaceBlock {
  head: RaceHead;
  strips: Sel[];
  forms: Sel[];
}

function parseRaceTitle($: CheerioAPI, table: Sel): RaceHead | undefined {
  const th = table.find('th').first().clone();
  th.find('.localtimedisplayed').remove();
  const head = oneLine(th.text());
  let m = head.match(/Race\s+(\d+)\s*-\s*(\d{1,2}[:.]\d{2}\s*(?:[AaPp][Mm])?)\s+(.*?)\s*\((\d+)\s*M(?:ETRES?)?\)/i);
  let number: number;
  let time: string | undefined;
  let name: string;
  let distance: number;
  if (m) {
    number = Number(m[1]);
    time = m[2].replace(/\s+/g, '');
    name = m[3].trim();
    distance = Number(m[4]);
  } else {
    const n = head.match(/Race\s+(\d+)/i);
    if (!n) return undefined;
    number = Number(n[1]);
    time = head.match(/(\d{1,2}[:.]\d{2}\s*[AaPp][Mm])/)?.[1]?.replace(/\s+/g, '');
    distance = toNum(head.match(/\((\d+)\s*M/i)?.[1]) || 0;
    name =
      head
        .replace(/Race\s+\d+\s*-?\s*/i, '')
        .replace(/\d{1,2}[:.]\d{2}\s*[AaPp][Mm]/, '')
        .replace(/\(\d+\s*M(?:ETRES?)?\)/i, '')
        .trim() || `Race ${number}`;
  }
  let infoCell = table.find('tr.race-info td').first();
  if (!infoCell.length) infoCell = table.find('tr').eq(1).find('td').first();
  return { number, time, name, distance, info: txt(infoCell.text()) };
}

/** Walk the page in document order pairing each race title with its strip table(s) and horse form tables. */
function collectBlocks($: CheerioAPI): RaceBlock[] {
  const blocks: RaceBlock[] = [];
  let cur: RaceBlock | undefined;
  $('table.race-title, table.race-strip-fields, table.horse-form-table').each((_, el) => {
    const t = $(el);
    if (t.hasClass('race-title')) {
      const head = parseRaceTitle($, t);
      cur = head ? { head, strips: [], forms: [] } : undefined;
      if (cur) blocks.push(cur);
      return;
    }
    if (!cur) return;
    if (t.hasClass('race-strip-fields')) cur.strips.push(t);
    else if (t.hasClass('horse-form-table')) cur.forms.push(t);
  });
  return blocks;
}

interface RaceInfo {
  prize?: number;
  raceClass?: string;
  ageRestriction?: string;
  sexRestriction?: string;
  condition: { text?: string; rating?: number };
  time?: string;
  last600?: string;
}

function parseRaceInfo(info: string): RaceInfo {
  const prizeM = info.match(/Of\s+\$\s?([\d,]+)/i);
  const condM = info.match(/Track Condition:\s*([A-Za-z]+\s*\(?\d*\)?)/i);
  const time = info.match(/(?<![\w])Time:\s*(\d+:\d{2}\.\d{1,2})/i)?.[1];
  const last600 = info.match(/Last\s*600\s*m?:\s*(\d+:\d{2}\.\d{1,2})/i)?.[1];
  const lines = info
    .split('\n')
    .map(oneLine)
    .filter(Boolean)
    .map((l) => l.replace(/^Of\s+\$[\d,]+\.?\s*(?:1st\s+\$[\d,]+.*)?$/i, '').trim())
    .filter(Boolean);
  const condLines = lines.filter(
    (l) =>
      !/^(?:Of\s+\$|Track Name:|Track Condition:|Field Limit|Prize ?money contribution|This race carries|Times displayed|TAB MEETING|Rail)/i.test(l) &&
      !/^(?:GROUP\s*[123]|LISTED)$/i.test(l),
  );
  const raceClass =
    condLines[0]
      ?.replace(/\bBENCHMARK\s*(\d+)/i, 'BM$1')
      .replace(/,?\s*Apprentices (?:can|cannot) claim\.?/i, '')
      .replace(/\s*\.\s*$/, '')
      .trim() || undefined;
  const ageM = info.match(/\b(Two|Three|Four|Five|Six)-Years?-Olds?(\s+and\s+(?:Upwards|Over|Older))?/i) || info.match(/\b([2-6])YO(\+)?\b/);
  const ageWords: Record<string, string> = { two: '2', three: '3', four: '4', five: '5', six: '6' };
  const ageRestriction = ageM ? `${ageWords[ageM[1].toLowerCase()] || ageM[1]}YO${ageM[2] ? '+' : ''}` : undefined;
  const sexM = info.match(/\b(Fillies\s+and\s+Mares|Fillies|Mares|Colts,?\s+Horses\s+and\s+Geldings|Colts\s+and\s+Geldings|Colts|Geldings)\b/i);
  return {
    prize: prizeM ? toNum(prizeM[1]) : undefined,
    raceClass,
    ageRestriction,
    sexRestriction: sexM ? sexM[1] : undefined,
    condition: condM ? parseCondition(condM[1]) : {},
    time,
    last600,
  };
}

// ---------------------------------------------------------------------------
// Strip table (No | Horse | Trainer | Jockey | Barrier | Weight …) rows
// ---------------------------------------------------------------------------

export interface StripRow {
  number?: number;
  emergency?: boolean;
  name?: string;
  country?: string;
  scratched: boolean;
  trainer?: string;
  jockey?: string;
  claim?: number;
  barrier?: number;
  weight?: number;
  penalty?: number;
  hcp?: number;
  last10?: string;
  finish?: number;
  margin?: number;
  sp?: number;
  silk?: string;
}

function parseJockey(raw?: string): { jockey?: string; claim?: number; weight?: number } {
  if (!raw) return {};
  let s = oneLine(raw);
  const claimM = s.match(/\(\s*a\s*(\d+(?:\.\d+)?)\s*\)/i);
  const claim = claimM ? Number(claimM[1]) : undefined;
  const weightM = s.match(/(\d+(?:\.\d+)?)\s*kg/i);
  const weight = weightM ? Number(weightM[1]) : undefined;
  s = s
    .replace(/\(\s*a\s*\d+(?:\.\d+)?\s*\)/gi, '')
    .replace(/\d+(?:\.\d+)?\s*kg/gi, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { jockey: s || undefined, claim, weight };
}

function parseStripTable($: CheerioAPI, table: Sel): StripRow[] {
  const rows = table.find('tr');
  let headerRow = rows.filter((_, tr) => $(tr).find('th').length > 0).first();
  if (!headerRow.length) headerRow = rows.first();
  const headers = headerRow
    .find('th,td')
    .map((_, c) => oneLine($(c).text()).toLowerCase())
    .get();
  const col = (re: RegExp) => headers.findIndex((h) => re.test(h));
  const idx = {
    no: col(/^no\.?$/),
    finish: col(/^finish/),
    horse: col(/^horse/),
    trainer: col(/^trainer/),
    jockey: col(/^jockey/),
    barrier: col(/^bar/),
    weight: col(/^(?:weight|wgt)$/),
    penalty: col(/^pen/),
    hcp: col(/hcp|rating|^rtg$/),
    last10: col(/last\s*10/),
    margin: col(/^margin/),
    sp: col(/starting price|^sp$/),
  };
  const headerEl = headerRow.get(0);
  const out: StripRow[] = [];
  rows.each((_, tr) => {
    if (tr === headerEl) return;
    try {
      const row = $(tr);
      const tds = row.find('td');
      if (!tds.length) return;
      const cell = (cls: string, i: number): Sel | undefined => {
        const byClass = row.find(`td.${cls}`).first();
        if (byClass.length) return byClass;
        return i >= 0 && i < tds.length ? $(tds[i]) : undefined;
      };
      const cellText = (cls: string, i: number) => {
        const c = cell(cls, i);
        return c ? oneLine(c.text()) : '';
      };
      const horseCell = cell('horse', idx.horse);
      if (!horseCell) return;
      const anchorName = oneLine(horseCell.find('a').first().text());
      const rawName = anchorName || oneLine(horseCell.text()).replace(/\bscratched\b.*$/i, '').trim();
      if (!rawName) return;
      const rowClass = row.attr('class') || '';
      const scratched = /\bscratched\b/i.test(rowClass) || horseCell.find('s, strike, del').length > 0 || /\bscratched\b/i.test(horseCell.text());
      const noText = cellText('no', idx.no);
      const noM = noText.match(/^(\d+)\s*(e|em|emg|emergency)?\b/i);
      const { name, country } = splitCountry(rawName);
      const jk = parseJockey(cellText('jockey', idx.jockey));
      const finishCell = row.find('span.Finish').first();
      const finishText = finishCell.length ? oneLine(finishCell.text()) : idx.finish >= 0 ? cellText('finish', idx.finish) : '';
      const finish = toNum(finishText);
      const marginText = idx.margin >= 0 ? cellText('margin', idx.margin) : '';
      const spText = idx.sp >= 0 ? cellText('sp', idx.sp) : '';
      const hcpText = cellText('hcp', idx.hcp);
      const last10 = idx.last10 >= 0 || row.find('td.last').length ? cellText('last', idx.last10) : '';
      const silk = row.find('img[src*="JockeySilks"]').first().attr('src');
      out.push({
        number: noM ? Number(noM[1]) : toNum(noText),
        emergency: !!(noM && noM[2]) || /\bemergency\b/i.test(row.text()) || undefined,
        name: horseCase(name),
        country,
        scratched,
        trainer: cellText('trainer', idx.trainer) || undefined,
        jockey: jk.jockey,
        claim: jk.claim,
        barrier: toNum(cellText('barrier', idx.barrier)),
        weight: toNum(cellText('weight', idx.weight)),
        penalty: toNum(cellText('penalty', idx.penalty)),
        hcp: toNum(hcpText),
        last10: last10 && /^[0-9a-z\-]+$/i.test(last10) ? last10 : undefined,
        finish: finish && finish > 0 ? Math.trunc(finish) : undefined,
        margin: marginText ? parseMargin(marginText) : undefined,
        sp: spText ? toNum(spText.replace(/^\$/, '')) : undefined,
        silk,
      });
    } catch {
      /* skip malformed row */
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Horse form table (one per runner on Form.aspx)
// ---------------------------------------------------------------------------

interface FormBlock {
  number?: number;
  emergency?: boolean;
  name?: string;
  country?: string;
  scratched?: boolean;
  age?: number;
  sex?: string;
  colour?: string;
  sire?: string;
  dam?: string;
  damSire?: string;
  gear?: string[];
  trainer?: string;
  jockey?: string;
  claim?: number;
  weight?: number;
  barrier?: number;
  career?: CareerStats;
  splits?: SplitStats;
  form: FormLine[];
  silk?: string;
}

const REC = '(\\d+)\\s*:\\s*(\\d+)\\s*-\\s*(\\d+)\\s*-\\s*(\\d+)';

function record(text: string, label: string): CareerStats | undefined {
  const m = text.match(new RegExp(`(?<![\\w/])${label}\\s*:\\s*${REC}`, 'i'));
  return m ? parseStats(`${m[1]}: ${m[2]}-${m[3]}-${m[4]}`) : undefined;
}

const SEX_WORDS: Record<string, string> = { colt: 'Colt', filly: 'Filly', gelding: 'Gelding', mare: 'Mare', horse: 'Horse', stallion: 'Stallion', entire: 'Entire', rig: 'Rig' };

function parseHorseFormTable($: CheerioAPI, table: Sel, source: string): FormBlock {
  const block: FormBlock = { form: [] };
  const info = table.find('.horse-info').first();
  const numText = oneLine(info.find('.horse-number').first().text());
  const numM = numText.match(/^(\d+)\s*(e|em|emergency)?\b/i);
  if (numM) {
    block.number = Number(numM[1]);
    if (numM[2]) block.emergency = true;
  }
  const nameSpan = info.find('.horse-name').first();
  const rawName = oneLine(nameSpan.find('a').first().text()) || oneLine(nameSpan.text()).replace(/\bscratched\b.*$/i, '').trim();
  if (rawName) {
    const { name, country } = splitCountry(rawName);
    block.name = horseCase(name);
    block.country = country;
  }
  if (nameSpan.find('s, strike, del').length || /\bscratched\b/i.test(nameSpan.text())) block.scratched = true;
  block.silk = table.find('img[src*="JockeySilks"]').first().attr('src');

  const plain = info.find('.plain').first();
  const plainText = txt(plain.text());
  const desc = plainText.match(/(\d+)\s*(?:year|yo)s?\s*old\s+([a-z][a-z\s\/-]*?)\s+(colt|filly|gelding|mare|horse|stallion|entire|rig)\b/i);
  if (desc) {
    block.age = Number(desc[1]);
    block.colour = oneLine(desc[2]).toLowerCase() || undefined;
    block.sex = SEX_WORDS[desc[3].toLowerCase()] || desc[3];
  }
  const pedigree = plain
    .find('a')
    .filter((_, a) => /HorseFullForm/i.test($(a).attr('href') || ''))
    .map((_, a) => oneLine($(a).text()))
    .get()
    .filter(Boolean);
  if (pedigree.length >= 2) {
    block.sire = horseCase(splitCountry(pedigree[0]).name);
    block.dam = horseCase(splitCountry(pedigree[1]).name);
    if (pedigree[2]) block.damSire = horseCase(splitCountry(pedigree[2]).name);
  } else {
    const firstLine = plainText.split('\n')[0] || '';
    const pm = firstLine.match(/\((?:male|female)\)\s*(.+?)\s+x\s+(.+?)\s*\((.+?)\)\s*$/i);
    if (pm) {
      block.sire = horseCase(splitCountry(pm[1]).name);
      block.dam = horseCase(splitCountry(pm[2]).name);
      block.damSire = horseCase(splitCountry(pm[3]).name);
    }
  }
  const gearM = plainText.match(/Gear Changes:\s*([^\n]+)/i);
  if (gearM) {
    const gear = gearM[1]
      .split(/[;,]/)
      .map((g) => g.trim())
      .filter((g) => g && !/^(nil|none|no change|-)$/i.test(g));
    if (gear.length) block.gear = gear;
  }

  // Trainer / Jockey / Barrier / records live as <b>Label:</b> value runs in the table text.
  const text = txt(table.clone().find('table.horse-last-start').remove().end().text());
  const trainerM = text.match(/Trainer:\s*([^\n]+?)\s*(?:\([^)\n]*\))?\s*(?=Jockey:|Barrier:|Record:|\n|$)/i);
  if (trainerM && trainerM[1].trim()) block.trainer = trainerM[1].trim();
  const jockeyM = text.match(/Jockey:\s*([^\n]+?)\s*(?=Barrier:|Record:|Trainer:|\n|$)/i);
  if (jockeyM) {
    const jk = parseJockey(jockeyM[1]);
    block.jockey = jk.jockey;
    block.claim = jk.claim;
    block.weight = jk.weight;
  }
  const barrierM = text.match(/Barrier:\s*(\d+)/i);
  if (barrierM) block.barrier = Number(barrierM[1]);
  block.career = record(text, 'Record');
  if (block.career) {
    const pm = text.match(/Prize ?money:\s*\$?\s*([\d,]+)/i);
    if (pm) block.career.prizeMoney = toNum(pm[1]);
  }
  const splits: SplitStats = {
    firstUp: record(text, '1st Up'),
    secondUp: record(text, '2nd Up'),
    track: record(text, 'Track'),
    distance: record(text, 'Dist(?:ance)?'),
    trackDistance: record(text, 'Track/Dist(?:ance)?'),
    firm: record(text, 'Firm'),
    good: record(text, 'Good'),
    soft: record(text, 'Soft'),
    heavy: record(text, 'Heavy'),
    synthetic: record(text, 'Synth(?:etic)?'),
    jockey: record(text, 'Jockey'),
  };
  if (Object.values(splits).some(Boolean)) block.splits = splits;

  table.find('table.horse-last-start tr').each((_, tr) => {
    try {
      const line = parseRunLine($, $(tr), source);
      if (line) block.form.push(line);
    } catch {
      /* skip malformed run line */
    }
  });
  return block;
}

/**
 * One run line, e.g.
 *   td.Pos    "2 of 10"                     ("T 1 of 6" = barrier trial, "J" = jump-out — skipped)
 *   td.remain "CAUL 10Oct26 1000m Good4 2YO SW $150,000 ($90,000) Jamie Kah 57kg (cd 55kg) Barrier 2
 *              1st True Line 57kg, 2nd Rail Runner 57kg 0:57.45 (600m 33.80), 0.75L, 3rd@800m, 1st@400m, $2.40/$2.30/$2.20/$2.10"
 */
function parseRunLine($: CheerioAPI, tr: Sel, source: string): FormLine | undefined {
  const posText = oneLine(tr.find('td.Pos').first().text());
  const remain = tr.find('td.remain').first();
  if (!posText || !remain.length) return undefined;
  if (/^[TJ]\b/.test(posText) || /\b(trial|jump ?out)\b/i.test(posText)) return undefined;
  const pm = posText.match(/(\d+)\s*(?:of|\/)\s*(\d+)/);
  if (!pm) return undefined;
  const position = Number(pm[1]);
  const starters = Number(pm[2]);
  if (!position) return undefined;

  const lines = txt(remain.text())
    .split('\n')
    .map(oneLine)
    .filter(Boolean);
  const l1 = lines[0] || '';
  const l2 = lines.slice(1).join(' ');
  const meetText = oneLine(remain.find('a[href*="Meeting.aspx"]').first().text()) || (l1.match(/^(.+?\s+\d{1,2}[A-Za-z]{3}\d{2,4})\b/)?.[1] ?? '');
  const mm = meetText.match(/^(.+?)\s+(\d{1,2})([A-Za-z]{3})(\d{2,4})$/);
  if (!mm) return undefined;
  const date = shortDate(mm[2], mm[3], mm[4]);
  if (!date) return undefined;
  const code = mm[1].trim();
  const venue = TRACK_CODES[code.toUpperCase()] || code;
  const after = l1.includes(meetText) ? l1.slice(l1.indexOf(meetText) + meetText.length).trim() : l1;

  let distance = 0;
  let condition: { text?: string; rating?: number } = {};
  let raceClass: string | undefined;
  let prize: number | undefined;
  let tail = after;
  const m1 = after.match(/^(\d+)\s*m\s+(\S+)\s+(.*?)\s+\$([\d,]+)(?:\s*\(\$([\d,]+)\))?\s*(.*)$/);
  if (m1) {
    distance = Number(m1[1]);
    condition = parseCondition(m1[2]);
    raceClass = m1[3].trim() || undefined;
    prize = toNum(m1[4]);
    tail = m1[6];
  } else {
    distance = toNum(after.match(/(\d{3,4})\s*m\b/)?.[1]) || 0;
    const cm = after.match(/\b(Firm|Good|Soft|Heavy|Synth(?:etic)?|Fast|Dead|Slow)\s*\d*\b/i);
    if (cm) condition = parseCondition(cm[0]);
    prize = toNum(after.match(/\$([\d,]+)/)?.[1]);
  }
  const jockey = oneLine(remain.find('a[href*="JockeyLastRuns"]').first().text()) || tail.match(/^(.*?)\s+\d+(?:\.\d+)?\s*kg/)?.[1]?.trim() || undefined;
  const weight = toNum(tail.match(/(\d+(?:\.\d+)?)\s*kg/)?.[1]);
  const barrier = toNum(tail.match(/Barrier\s*(\d+)/i)?.[1]);

  const winner = l2.match(/\b1st\s+(.+?)\s+\d+(?:\.\d+)?\s*kg/)?.[1];
  const second = l2.match(/\b2nd\s+(.+?)\s+\d+(?:\.\d+)?\s*kg/)?.[1];
  const time = l2.match(/\b(\d{1,2}:\d{2}\.\d{1,2})\b/)?.[1];
  const sectional600 = l2.match(/600\s*m\s*(\d+(?:\.\d+)?)/i)?.[1];
  const marginM = l2.match(/(?:^|[\s,])(\d+(?:\.\d+)?)\s*L\b/);
  const inRun = [...l2.matchAll(/(\d+)(?:st|nd|rd|th)?\s*@\s*\d+\s*m/gi)].map((m) => m[1]);
  const prices = [...l2.matchAll(/\$(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1])).filter((n) => n > 1);
  return {
    date,
    venue,
    distance,
    trackCondition: condition.text,
    trackRating: condition.rating,
    position,
    starters,
    margin: position === 1 ? 0 : marginM ? Number(marginM[1]) : undefined,
    weight,
    barrier,
    jockey,
    raceClass,
    prize,
    startingPrice: prices.length ? prices[prices.length - 1] : undefined,
    time,
    sectional600,
    winner: winner ? oneLine(winner) : undefined,
    second: second ? oneLine(second) : undefined,
    inRunning: inRun.length ? inRun.join('-') : undefined,
    source,
  };
}

// ---------------------------------------------------------------------------
// Runner assembly
// ---------------------------------------------------------------------------

function runnerFromStrip(r: StripRow): RunnerRaw {
  return {
    number: r.number,
    name: r.name || '',
    country: r.country,
    barrier: r.barrier,
    jockey: r.jockey,
    claim: r.claim,
    trainer: r.trainer,
    weight: r.weight,
    scratched: r.scratched,
    emergency: r.emergency || undefined,
    last5: r.last10 ? r.last10.slice(-5) : undefined,
    ratings: r.hcp != null ? { 'racingaustralia.hcpRating': r.hcp } : undefined,
    finishingPosition: r.finish,
    margin: r.finish ? (r.finish === 1 ? 0 : r.margin) : undefined,
    silk: r.silk,
  };
}

function applyFormBlock(target: RunnerRaw, b: FormBlock, date: string): void {
  if (b.scratched) target.scratched = true;
  if (b.emergency) target.emergency = true;
  if (!target.number && b.number != null) target.number = b.number;
  if (!target.country && b.country) target.country = b.country;
  if (!target.jockey && b.jockey) target.jockey = b.jockey;
  if (target.claim == null && b.claim != null) target.claim = b.claim;
  if (!target.trainer && b.trainer) target.trainer = b.trainer;
  if (target.weight == null && b.weight != null) target.weight = b.weight;
  if (target.barrier == null && b.barrier != null) target.barrier = b.barrier;
  if (!target.silk && b.silk) target.silk = b.silk;
  if (b.age != null) target.age = b.age;
  if (b.sex) target.sex = b.sex;
  if (b.colour) target.colour = b.colour;
  if (b.sire) target.sire = b.sire;
  if (b.dam) target.dam = b.dam;
  if (b.damSire) target.damSire = b.damSire;
  if (b.gear) target.gearChanges = b.gear;
  if (b.career) target.career = b.career;
  if (b.splits) target.splits = b.splits;
  if (b.form.length) {
    target.form = b.form;
    const last = b.form[0]?.date;
    if (last && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const days = daysBetween(last, date);
      if (Number.isFinite(days) && days >= 0) target.daysSinceLastRun = days;
    }
  }
}

function mergeRunners(rows: StripRow[], blocks: FormBlock[], date: string): RunnerRaw[] {
  const runners: RunnerRaw[] = rows.filter((r) => r.name).map(runnerFromStrip);
  for (const b of blocks) {
    if (!b.name && b.number == null) continue;
    let target = runners.find((r) => (b.number != null && r.number === b.number) || (!!b.name && normaliseName(r.name) === normaliseName(b.name)));
    if (!target) {
      target = { name: b.name || `Runner ${b.number}`, number: b.number, scratched: !!b.scratched };
      runners.push(target);
    }
    applyFormBlock(target, b, date);
  }
  runners.sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
  return runners;
}

interface MeetingHeader {
  condition: { text?: string; rating?: number };
  rail?: string;
  weather?: string;
}

function parseMeetingHeader($: CheerioAPI): MeetingHeader {
  const text = txt($('div.race-venue-bottom').first().text());
  const grab = (label: RegExp) => text.match(label)?.[1]?.trim() || undefined;
  const cond = grab(/Track Condition:\s*([^\n]+)/i);
  return {
    condition: cond ? parseCondition(cond) : {},
    rail: grab(/Rail(?: Position)?:\s*([^\n]+)/i),
    weather: grab(/Weather:\s*([^\n]+)/i),
  };
}

/** Parse a Form.aspx (or styled Acceptances.aspx) page into a MeetingRaw. Exported for tests. */
export function parseFormPage(html: string | CheerioAPI, meeting: MeetingSummary, key: string, fetchedAt: string, source = 'racingaustralia'): MeetingRaw {
  const $ = load(html);
  const parsedKey = parseKey(key);
  const state = meeting.state || parsedKey?.state || findVenue(meeting.venue)?.state;
  const header = parseMeetingHeader($);
  const races: RaceRaw[] = [];
  for (const b of collectBlocks($)) {
    try {
      const rows = b.strips.flatMap((t) => parseStripTable($, t));
      const blocks = b.forms.map((t) => parseHorseFormTable($, t, source));
      const runners = mergeRunners(rows, blocks, meeting.date);
      const info = parseRaceInfo(b.head.info);
      races.push({
        number: b.head.number,
        name: horseCase(b.head.name) || `Race ${b.head.number}`,
        distance: b.head.distance,
        startTime: b.head.time ? localTimeToIso(meeting.date, b.head.time, state) : undefined,
        raceClass: info.raceClass,
        group: groupFrom(b.head.info, b.head.name),
        prize: info.prize,
        ageRestriction: info.ageRestriction,
        sexRestriction: info.sexRestriction,
        trackCondition: info.condition.text ?? header.condition.text,
        trackRating: info.condition.rating ?? header.condition.rating,
        status: 'open',
        sourceRefs: { racingaustralia: `${key}#Race${b.head.number}` },
        runners,
        source,
        fetchedAt,
      });
    } catch {
      /* skip a malformed race block */
    }
  }
  races.sort((a, b) => a.number - b.number);
  const firstRaceTime = races
    .map((r) => r.startTime)
    .filter((t): t is string => !!t)
    .sort()[0];
  return {
    meeting: {
      ...meeting,
      state,
      country: meeting.country || 'AUS',
      trackCondition: header.condition.text ?? races.find((r) => r.trackCondition)?.trackCondition ?? meeting.trackCondition,
      trackRating: header.condition.rating ?? races.find((r) => r.trackRating)?.trackRating ?? meeting.trackRating,
      rail: header.rail ?? meeting.rail,
      weather: header.weather ?? meeting.weather,
      raceCount: races.length || meeting.raceCount,
      firstRaceTime: firstRaceTime ?? meeting.firstRaceTime,
      sourceRefs: { ...meeting.sourceRefs, racingaustralia: key },
      sources: [source],
    },
    races,
    source,
    fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// Results.aspx
// ---------------------------------------------------------------------------

export interface ParsedResultRace {
  number: number;
  name: string;
  distance: number;
  time?: string;
  last600?: string;
  condition: { text?: string; rating?: number };
  rows: StripRow[];
  /** Undefined until a winner is printed. */
  placings?: number[][];
  margins?: number[];
}

/** Parse a Results.aspx page (whole meeting) into per-race results. Exported for tests. */
export function parseResultsPage(html: string | CheerioAPI): Map<number, ParsedResultRace> {
  const $ = load(html);
  const out = new Map<number, ParsedResultRace>();
  for (const b of collectBlocks($)) {
    try {
      const rows = b.strips.flatMap((t) => parseStripTable($, t));
      const info = parseRaceInfo(b.head.info);
      const race: ParsedResultRace = { number: b.head.number, name: horseCase(b.head.name) || `Race ${b.head.number}`, distance: b.head.distance, time: info.time, last600: info.last600, condition: info.condition, rows };
      const placed = rows.filter((r) => r.finish && r.number != null).sort((a, b) => a.finish! - b.finish!);
      if (placed.length && placed[0].finish === 1) {
        const byPlace = new Map<number, { nums: number[]; margin?: number }>();
        for (const r of placed) {
          const e = byPlace.get(r.finish!) || { nums: [] };
          e.nums.push(r.number!);
          if (e.margin == null) e.margin = r.finish === 1 ? 0 : r.margin;
          byPlace.set(r.finish!, e);
        }
        const places = [...byPlace.keys()].sort((a, b) => a - b);
        race.placings = places.map((p) => byPlace.get(p)!.nums.sort((a, b) => a - b));
        const margins = places.map((p) => byPlace.get(p)!.margin);
        if (margins.every((m): m is number => m != null)) race.margins = margins;
      }
      out.set(race.number, race);
    } catch {
      /* skip malformed race */
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// /ozracing/Acceptances.aspx (bare fixed-width tables, last-resort fallback)
// ---------------------------------------------------------------------------

/** Parse the bare acceptances page. Race times are printed 12-hour without AM/PM and resolved in sequence. */
export function parseOzAcceptances(html: string | CheerioAPI, meeting: MeetingSummary, key: string, fetchedAt: string, source = 'racingaustralia'): MeetingRaw {
  const $ = load(html);
  const parsedKey = parseKey(key);
  const state = meeting.state || parsedKey?.state || findVenue(meeting.venue)?.state;
  const headText = $('body')
    .contents()
    .filter((_, n) => n.nodeType === 3)
    .map((_, n) => $(n).text())
    .get()
    .join('\n');
  const rail = txt(headText).match(/Rail:\s*([^\n]+)/i)?.[1]?.trim();

  interface OzRace {
    number: number;
    h: number;
    m: number;
    name: string;
    distance: number;
    info: string;
    rows: StripRow[];
  }
  const races: OzRace[] = [];
  $('table').each((_, el) => {
    try {
      const t = $(el);
      const cells = t.find('tr').first().find('td');
      const c0 = oneLine($(cells.get(0)).text());
      const hm = c0.match(/^(\d+)\s*-\s*(\d{1,2})[.:](\d{2})$/);
      if (hm && cells.length >= 2) {
        let info = '';
        let n = el.next;
        while (n) {
          if (n.nodeType === 3) info += $(n).text();
          else if (n.nodeType === 1 && $(n).is('table')) break;
          n = n.next;
        }
        races.push({
          number: Number(hm[1]),
          h: Number(hm[2]),
          m: Number(hm[3]),
          name: horseCase($(cells.get(1)).text()) || `Race ${hm[1]}`,
          distance: toNum($(cells.get(2)).text()) || 0,
          info: txt(info),
          rows: [],
        });
        return;
      }
      if (races.length && /^no\.?$/i.test(c0)) races[races.length - 1].rows.push(...parseStripTable($, t));
    } catch {
      /* skip malformed table */
    }
  });

  // Resolve AM/PM: first race is AM only when its hour is 7–11; afterwards flip to PM when the clock would go backwards.
  let prev = -1;
  const out: RaceRaw[] = races.map((r) => {
    let minutes = (r.h % 12) * 60 + r.m;
    if (prev < 0) {
      if (!(r.h >= 7 && r.h <= 11)) minutes += 12 * 60;
    } else if (minutes < prev) {
      minutes += 12 * 60;
    }
    if (minutes >= 24 * 60) minutes -= 12 * 60;
    prev = minutes;
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mi = String(minutes % 60).padStart(2, '0');
    const info = parseRaceInfo(r.info);
    return {
      number: r.number,
      name: r.name,
      distance: r.distance,
      startTime: localTimeToIso(meeting.date, `${hh}:${mi}`, state),
      raceClass: info.raceClass,
      group: groupFrom(r.info, r.name),
      prize: info.prize,
      ageRestriction: info.ageRestriction,
      sexRestriction: info.sexRestriction,
      status: 'open',
      sourceRefs: { racingaustralia: `${key}#Race${r.number}` },
      runners: mergeRunners(r.rows, [], meeting.date),
      source,
      fetchedAt,
    };
  });
  out.sort((a, b) => a.number - b.number);
  const firstRaceTime = out
    .map((r) => r.startTime)
    .filter((t): t is string => !!t)
    .sort()[0];
  return {
    meeting: {
      ...meeting,
      state,
      country: meeting.country || 'AUS',
      rail: rail ?? meeting.rail,
      raceCount: out.length || meeting.raceCount,
      firstRaceTime: firstRaceTime ?? meeting.firstRaceTime,
      sourceRefs: { ...meeting.sourceRefs, racingaustralia: key },
      sources: [source],
    },
    races: out,
    source,
    fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

interface CachedPage {
  at: number;
  $: CheerioAPI;
}

export class RacingAustraliaAdapter implements SourceAdapter {
  id = 'racingaustralia';
  name = 'Racing Australia (official fields)';
  kind = 'official' as const;
  capabilities = ['meetings' as const, 'racecard' as const, 'form' as const, 'results' as const, 'conditions' as const];
  homepage = RA_HOSTS[0];

  private readonly delayMs: number;
  private readonly hosts: string[];
  private readonly pageCacheMs: number;
  private readonly resultsCacheMs: number;
  private readonly pages = new Map<string, CachedPage>();
  private lastFetchAt = 0;

  constructor(opts: RacingAustraliaOptions | number = {}) {
    const o = typeof opts === 'number' ? { delayMs: opts } : opts;
    this.delayMs = o.delayMs ?? 1500;
    this.hosts = (o.hosts && o.hosts.length ? o.hosts : RA_HOSTS).map((h) => (h.endsWith('/') ? h : `${h}/`));
    this.pageCacheMs = o.pageCacheMs ?? 5 * 60_000;
    this.resultsCacheMs = o.resultsCacheMs ?? 60_000;
  }

  // -- public API -------------------------------------------------------------

  async listMeetings(date: string, ctx: FetchContext): Promise<MeetingSummary[]> {
    const ymd = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const mon = ymd ? MONTHS[Number(ymd[2]) - 1] : undefined;
    if (!ymd || !mon) return [];
    const found = new Map<string, CalendarEntry>();
    const collect = ($: CheerioAPI) => {
      for (const e of parseCalendar($)) if (e.date === date) found.set(e.key, e);
    };
    let failures = 0;
    try {
      collect((await this.getPage(`Calendar.aspx?Date=${ymd[1]}${mon}${ymd[3]}`, ctx)).$);
    } catch (err) {
      failures++;
      ctx.log.warn(`Racing Australia: date calendar failed: ${err instanceof Error ? err.message : err}`);
    }
    if (!found.size) {
      // The by-date calendar is the lightly evidenced form; the per-state calendars are the well-trodden one.
      let stateFailures = 0;
      for (const st of STATES) {
        try {
          collect((await this.getPage(`Calendar.aspx?State=${st}`, ctx)).$);
        } catch (err) {
          stateFailures++;
          ctx.log.warn(`Racing Australia: ${st} calendar failed: ${err instanceof Error ? err.message : err}`);
        }
      }
      if (!found.size && failures && stateFailures === STATES.length) throw new Error('Racing Australia: calendar unavailable on all hosts');
    }
    return [...found.values()].filter((e) => !/^trials?$/i.test(e.variant || '')).map((e) => this.summary(e, date));
  }

  async fetchMeeting(meeting: MeetingSummary, ctx: FetchContext): Promise<MeetingRaw> {
    const key = await this.resolveKey(meeting, ctx);
    const fetchedAt = ctx.now().toISOString();
    const parsed = parseKey(key);
    const base: MeetingSummary = { ...meeting, state: meeting.state || parsed?.state || findVenue(meeting.venue)?.state, sourceRefs: { ...meeting.sourceRefs, racingaustralia: key } };
    const enc = encodeURIComponent(key);
    let raw: MeetingRaw | undefined;

    const attempt = async (kind: string, path: string, parse: ($: CheerioAPI) => MeetingRaw, last: boolean) => {
      try {
        raw = parse(await this.cachedPage(kind, key, path, base, ctx, this.pageCacheMs));
      } catch (err) {
        if (last || !(err instanceof PageUnavailableError) || err.reason !== 'not-available') throw err;
        ctx.log.info(`Racing Australia: ${path.split('?')[0]} not yet published for ${key}; trying the next stage page`);
      }
    };
    await attempt('form', `Form.aspx?Key=${enc}`, ($) => parseFormPage($, base, key, fetchedAt, this.id), false);
    if (!raw) await attempt('acceptances', `Acceptances.aspx?Key=${enc}`, ($) => parseFormPage($, base, key, fetchedAt, this.id), false);
    if (!raw) await attempt('oz', `../ozracing/Acceptances.aspx?key=${enc}`, ($) => parseOzAcceptances($, base, key, fetchedAt, this.id), true);
    if (!raw) throw new PageUnavailableError(`Racing Australia: no fields published yet for ${key}`, 'not-available', key);
    this.applyCachedResults(raw, key, ctx);
    return raw;
  }

  async fetchRace(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RaceRaw> {
    const raw = await this.fetchMeeting(meeting, ctx);
    const race = raw.races.find((r) => r.number === raceNumber);
    if (!race) throw new Error(`Racing Australia: race ${raceNumber} not found for ${meeting.venue} ${meeting.date}`);
    return race;
  }

  async fetchForm(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RunnerRaw[]> {
    const race = await this.fetchRace(meeting, raceNumber, ctx);
    return race.runners;
  }

  async fetchResults(meeting: MeetingSummary, raceNumber: number, ctx: FetchContext): Promise<RaceResult | null> {
    const key = await this.resolveKey(meeting, ctx);
    let $: CheerioAPI;
    try {
      $ = await this.cachedPage('results', key, `Results.aspx?Key=${encodeURIComponent(key)}`, { ...meeting, sourceRefs: { ...meeting.sourceRefs, racingaustralia: key } }, ctx, this.resultsCacheMs);
    } catch (err) {
      if (err instanceof PageUnavailableError && err.reason === 'not-available') return null;
      throw err;
    }
    const race = parseResultsPage($).get(raceNumber);
    if (!race?.placings?.length) return null;
    return { raceNumber, placings: race.placings, margins: race.margins, time: race.time, recordedAt: ctx.now().toISOString(), source: this.id };
  }

  // -- internals ---------------------------------------------------------------

  private summary(e: CalendarEntry, date: string): MeetingSummary {
    const venue = canonicalVenue(e.venue);
    const slug = slugify(venue);
    const refs: Record<string, string> = { racingaustralia: e.key, 'racingaustralia.stage': e.stage };
    if (e.variant) refs['racingaustralia.variant'] = e.variant;
    return { id: `${date}:${slug}`, date, venue, venueSlug: slug, state: e.state, country: 'AUS', raceType: 'thoroughbred', sourceRefs: refs, sources: [this.id] };
  }

  /** Use the recorded key; otherwise look the venue up on the day's calendar (RA's spelling matters); otherwise build it. */
  private async resolveKey(meeting: MeetingSummary, ctx: FetchContext): Promise<string> {
    const ref = meeting.sourceRefs?.racingaustralia;
    if (ref) return ref;
    try {
      const list = await this.listMeetings(meeting.date, ctx);
      const want = normaliseName(meeting.venue);
      const hit = list.find((m) => normaliseName(m.venue) === want || m.venueSlug === meeting.venueSlug) || list.find((m) => normaliseName(parseKey(m.sourceRefs.racingaustralia)?.venue || '') === want);
      if (hit) return hit.sourceRefs.racingaustralia;
    } catch (err) {
      ctx.log.warn(`Racing Australia: calendar lookup failed, building the key from the venue name: ${err instanceof Error ? err.message : err}`);
    }
    return meetingKey(meeting);
  }

  private async polite(): Promise<void> {
    if (this.delayMs > 0 && this.lastFetchAt) {
      const wait = this.lastFetchAt + this.delayMs - Date.now();
      if (wait > 0) await sleep(wait);
    }
    this.lastFetchAt = Date.now();
  }

  /** GET a FreeFields-relative path from the first host that answers with a real page. */
  private async getPage(path: string, ctx: FetchContext): Promise<{ $: CheerioAPI; url: string; html: string }> {
    const errors: string[] = [];
    const reasons: UnavailableReason[] = [];
    for (const host of this.hosts) {
      const url = new URL(path, host).toString();
      await this.polite();
      let html: string;
      try {
        html = await ctx.http.getText(url, { headers: HEADERS, retries: 0, signal: ctx.signal } as Parameters<typeof ctx.http.getText>[1]);
      } catch (err) {
        reasons.push('transport');
        errors.push(`${new URL(url).hostname}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      const reason = classifyPage(html);
      if (reason) {
        reasons.push(reason);
        errors.push(`${new URL(url).hostname}: ${reason === 'not-available' ? 'not currently available' : reason === 'empty' ? 'empty page' : 'bot wall'}`);
        ctx.log.warn(`Racing Australia: ${reason} from ${url}`);
        continue;
      }
      return { $: load(html), url, html };
    }
    const reason: UnavailableReason = reasons.includes('not-available') ? 'not-available' : reasons.includes('bot-wall') ? 'bot-wall' : reasons.includes('empty') ? 'empty' : 'transport';
    throw new PageUnavailableError(`Racing Australia: ${path.split('?')[0]} unavailable on all hosts (${errors.join('; ')})`, reason, path);
  }

  private async cachedPage(kind: string, key: string, path: string, meeting: MeetingSummary, ctx: FetchContext, ttl: number): Promise<CheerioAPI> {
    const ck = `${kind}:${key}`;
    const now = ctx.now().getTime();
    const hit = this.pages.get(ck);
    if (hit && now - hit.at < ttl) return hit.$;
    const { $, url } = await this.getPage(path, ctx);
    assertMeetingPage($, meeting, key, url);
    this.pages.set(ck, { at: now, $ });
    return $;
  }

  /** When this instance already holds a fresh Results page for the meeting, mark resulted races final (no extra request). */
  private applyCachedResults(raw: MeetingRaw, key: string, ctx: FetchContext): void {
    const hit = this.pages.get(`results:${key}`);
    if (!hit || ctx.now().getTime() - hit.at >= this.resultsCacheMs) return;
    try {
      const results = parseResultsPage(hit.$);
      for (const race of raw.races) {
        const r = results.get(race.number);
        if (!r?.placings?.length) continue;
        race.status = 'final';
        race.results = r.placings;
        for (const row of r.rows) {
          if (!row.finish || row.number == null) continue;
          const runner = race.runners.find((x) => x.number === row.number);
          if (runner) {
            runner.finishingPosition = row.finish;
            runner.margin = row.finish === 1 ? 0 : row.margin;
          }
        }
      }
    } catch {
      /* results overlay is best effort */
    }
  }
}
