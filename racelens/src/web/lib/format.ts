/** Display helpers. All times are shown in Australia/Melbourne local time. */
import type { BetSuggestion, BettingPlan, CareerStats, ConfidenceLabel, SourceId } from '@shared/types';
import { toISODate } from '@shared/util';

export const TZ = 'Australia/Melbourne';

// ---------------------------------------------------------------------------
// Dates (YYYY-MM-DD calendar arithmetic, independent of browser timezone)
// ---------------------------------------------------------------------------

export function todayYmd(): string {
  return toISODate(new Date(), TZ);
}

export function isYmd(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function ymdToUtc(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function addDays(ymd: string, n: number): string {
  const dt = ymdToUtc(ymd);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** 0 = Sunday .. 6 = Saturday */
export function weekdayOf(ymd: string): number {
  return ymdToUtc(ymd).getUTCDay();
}

/** The coming Saturday (today if today is Saturday). */
export function nextSaturday(from: string = todayYmd()): string {
  const diff = (6 - weekdayOf(from) + 7) % 7;
  return addDays(from, diff);
}

/** "Saturday 24 October 2026" */
export function fmtLongDate(ymd?: string): string {
  if (!isYmd(ymd)) return ymd || '–';
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(ymdToUtc(ymd));
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${p('weekday')} ${p('day')} ${p('month')} ${p('year')}`.trim();
}

/** "Sat 24 Oct" */
export function fmtShortDate(ymd?: string): string {
  if (!isYmd(ymd)) return ymd || '–';
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(
    ymdToUtc(ymd),
  );
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${p('weekday')} ${p('day')} ${p('month')}`.trim();
}

/** Friendly label for a date relative to today in Melbourne: "Today", "Tomorrow", else short date. */
export function relativeDayLabel(ymd: string): string {
  const today = todayYmd();
  if (ymd === today) return 'Today';
  if (ymd === addDays(today, 1)) return 'Tomorrow';
  if (ymd === addDays(today, -1)) return 'Yesterday';
  return fmtShortDate(ymd);
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

function parseIso(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** IANA zone for an Australian state code. */
export function zoneForState(state?: string | null): string | undefined {
  switch ((state || '').toUpperCase()) {
    case 'VIC':
      return 'Australia/Melbourne';
    case 'NSW':
    case 'ACT':
      return 'Australia/Sydney';
    case 'TAS':
      return 'Australia/Hobart';
    case 'QLD':
      return 'Australia/Brisbane';
    case 'SA':
      return 'Australia/Adelaide';
    case 'WA':
      return 'Australia/Perth';
    case 'NT':
      return 'Australia/Darwin';
    default:
      return undefined;
  }
}

/** The zone race times should be shown in: the track's own local time. */
export function meetingZone(m?: { timezone?: string; state?: string } | null): string {
  return m?.timezone || zoneForState(m?.state) || TZ;
}

export function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || TZ;
  } catch {
    return TZ;
  }
}

/** "AEDT", "AEST", "AWST"… for a zone at an instant. */
export function zoneAbbrev(tz: string, at: number = Date.now()): string {
  try {
    const part = new Intl.DateTimeFormat('en-AU', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(at)).find((p) => p.type === 'timeZoneName');
    return part?.value || tz;
  } catch {
    return tz;
  }
}

/** Today until 7pm Melbourne time, then tomorrow (the next race day people plan for). */
export function defaultHomeDate(now: Date = new Date()): string {
  const today = toISODate(now, TZ);
  const hour = Number(new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(now));
  return hour >= 19 ? addDays(today, 1) : today;
}

/** "12:25pm" in the given zone (default Melbourne) */
export function fmtTime(iso?: string | null, tz: string = TZ): string {
  const t = parseIso(iso);
  if (t == null) return '–';
  return new Intl.DateTimeFormat('en-AU', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(t))
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** "Sat 24 Oct, 12:25pm" */
export function fmtDateTime(iso?: string | null, tz: string = TZ): string {
  const t = parseIso(iso);
  if (t == null) return '–';
  const day = new Intl.DateTimeFormat('en-AU', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(t));
  return `${day}, ${fmtTime(iso, tz)}`;
}

/** Local race-day date (YYYY-MM-DD, Melbourne) of an ISO timestamp. */
export function ymdOfIso(iso?: string | null): string | null {
  const t = parseIso(iso);
  return t == null ? null : toISODate(new Date(t), TZ);
}

/** "just now", "3 min ago", "2 hours ago", "in 15 min" */
export function fmtRelative(iso?: string | null, now: number = Date.now()): string {
  const t = parseIso(iso);
  if (t == null) return '–';
  const diff = now - t;
  const future = diff < 0;
  const mins = Math.round(Math.abs(diff) / 60000);
  if (mins < 1) return 'just now';
  let s: string;
  if (mins < 60) s = `${mins} min`;
  else if (mins < 60 * 24) {
    const h = Math.floor(mins / 60);
    s = `${h} hour${h === 1 ? '' : 's'}`;
  } else {
    const d = Math.floor(mins / 1440);
    s = `${d} day${d === 1 ? '' : 's'}`;
  }
  return future ? `in ${s}` : `${s} ago`;
}

export type CountdownTone = 'soon' | 'later' | 'past' | 'unknown';

/** "Jumps in 42 min" / "Jumped 5 min ago" */
export function countdown(iso?: string | null, now: number = Date.now()): { text: string; tone: CountdownTone } {
  const t = parseIso(iso);
  if (t == null) return { text: 'Start time not known yet', tone: 'unknown' };
  const diffMin = Math.round((t - now) / 60000);
  if (Math.abs(diffMin) < 1) return { text: 'Jumping now', tone: 'soon' };
  if (diffMin < 0) {
    const m = -diffMin;
    if (m < 60) return { text: `Jumped ${m} min ago`, tone: 'past' };
    if (m < 1440) return { text: `Jumped ${Math.floor(m / 60)} h ${m % 60} min ago`, tone: 'past' };
    return { text: `Ran ${fmtRelative(iso, now)}`, tone: 'past' };
  }
  if (diffMin < 60) return { text: `Jumps in ${diffMin} min`, tone: diffMin <= 10 ? 'soon' : 'later' };
  if (diffMin < 1440) return { text: `Jumps in ${Math.floor(diffMin / 60)} h ${diffMin % 60} min`, tone: 'later' };
  const d = Math.floor(diffMin / 1440);
  const h = Math.floor((diffMin % 1440) / 60);
  return { text: `Jumps in ${d} day${d === 1 ? '' : 's'} ${h} h`, tone: 'later' };
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export function fmtOdds(n?: number | null): string {
  if (n == null || !(n > 0) || !Number.isFinite(n)) return '–';
  return `$${n.toFixed(2)}`;
}

/** 0..1 -> "23%" */
export function fmtPct(p?: number | null): string {
  if (p == null || Number.isNaN(p)) return '–';
  return `${Math.round(p * 100)}%`;
}

/** Accepts either 0..1 or 0..100 and returns 0..100. */
export function pct100(v?: number | null): number {
  if (v == null || Number.isNaN(v)) return 0;
  const n = v <= 1 ? v * 100 : v;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function fmtMoney(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return '–';
  const dp = Number.isInteger(n) ? 0 : 2;
  const abs = Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return `${n < 0 ? '-' : ''}$${abs}`;
}

export function fmtWeight(w?: number | null): string {
  if (w == null || Number.isNaN(w)) return '–';
  return `${w}kg`;
}

export function fmtDistance(m?: number | null): string {
  if (m == null || Number.isNaN(m)) return '–';
  return `${m}m`;
}

export function fmtMargin(m?: number | null, position?: number): string {
  if (position === 1) return 'won';
  if (m == null || Number.isNaN(m)) return '–';
  if (m === 0) return 'dead heat';
  return `${m}L`;
}

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "12: 4-2-1" */
export function careerRecord(c?: CareerStats | null): string {
  if (!c) return '–';
  return `${c.starts}: ${c.wins}-${c.seconds}-${c.thirds}`;
}

export function winRate(c?: CareerStats | null): string {
  if (!c || !c.starts) return '–';
  return fmtPct(c.wins / c.starts);
}

export function placeRate(c?: CareerStats | null): string {
  if (!c || !c.starts) return '–';
  return fmtPct((c.wins + c.seconds + c.thirds) / c.starts);
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'neutral' | 'gold';

/** Verification 0..1 -> traffic-light tone */
export function verificationTone(score?: number | null): Tone {
  if (score == null) return 'neutral';
  if (score >= 0.8) return 'green';
  if (score >= 0.5) return 'amber';
  return 'red';
}

export function verificationWord(score?: number | null): string {
  if (score == null) return 'Unchecked';
  if (score >= 0.9) return 'Fully verified';
  if (score >= 0.8) return 'Well verified';
  if (score >= 0.5) return 'Partly verified';
  return 'Low confidence';
}

export function confidenceTone(label: ConfidenceLabel): Tone {
  switch (label) {
    case 'High':
      return 'green';
    case 'Good':
      return 'green';
    case 'Fair':
      return 'amber';
    default:
      return 'red';
  }
}

export function sentimentTone(s?: number | null): Tone {
  if (s == null) return 'neutral';
  if (s > 0.2) return 'green';
  if (s < -0.2) return 'red';
  return 'neutral';
}

export function sentimentWord(s?: number | null): string {
  if (s == null) return 'Neutral';
  if (s > 0.2) return 'Positive';
  if (s < -0.2) return 'Negative';
  return 'Neutral';
}

export function betTypeLabel(t: BetSuggestion['type']): string {
  switch (t) {
    case 'win':
      return 'Win';
    case 'place':
      return 'Place';
    case 'each-way':
      return 'Each way';
    case 'quinella':
      return 'Quinella';
    case 'exacta':
      return 'Exacta';
    case 'trifecta':
      return 'Trifecta';
    case 'first4':
      return 'First 4';
    case 'saver':
      return 'Saver';
    default:
      return String(t);
  }
}

export function stanceLabel(s: BettingPlan['stance']): string {
  switch (s) {
    case 'bet':
      return 'Bet';
    case 'small':
      return 'Small';
    case 'watch':
      return 'Watch';
    case 'skip':
      return 'Skip';
    default:
      return String(s);
  }
}

export function stanceTone(s: BettingPlan['stance']): Tone {
  switch (s) {
    case 'bet':
      return 'green';
    case 'small':
      return 'blue';
    case 'watch':
      return 'amber';
    default:
      return 'neutral';
  }
}

export function stanceBlurb(s: BettingPlan['stance']): string {
  switch (s) {
    case 'bet':
      return 'Strong enough to back with your normal unit.';
    case 'small':
      return 'Worth a small play only – keep stakes light.';
    case 'watch':
      return 'Watch the market; the numbers are not convincing yet.';
    default:
      return 'We suggest sitting this one out.';
  }
}

export function priorityLabel(p: BetSuggestion['priority']): string {
  switch (p) {
    case 'core':
      return 'Core bets';
    case 'value':
      return 'Value bets';
    case 'saver':
      return 'Savers';
    default:
      return 'Fun / small';
  }
}

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Friendly name for a source id, using names from /api/sources when known. */
export function sourceName(id: SourceId, names?: Record<string, string>): string {
  if (names && names[id]) return names[id];
  return id
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map(capitalise)
    .join(' ');
}

export function speedMapLabel(p?: string): string {
  switch (p) {
    case 'leader':
      return 'Leader';
    case 'on-pace':
      return 'On pace';
    case 'midfield':
      return 'Midfield';
    case 'backmarker':
      return 'Backmarker';
    default:
      return '–';
  }
}

export function raceStatusLabel(status: string): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'closed':
      return 'Closed';
    case 'interim':
      return 'Interim result';
    case 'final':
      return 'Final';
    case 'abandoned':
      return 'Abandoned';
    default:
      return 'Status unknown';
  }
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function joinNice(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
