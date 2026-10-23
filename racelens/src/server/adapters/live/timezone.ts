/** Australian state → IANA zone, and local-clock → ISO conversion. */
const ZONES: Record<string, string> = {
  VIC: 'Australia/Melbourne',
  NSW: 'Australia/Sydney',
  ACT: 'Australia/Sydney',
  TAS: 'Australia/Hobart',
  QLD: 'Australia/Brisbane',
  SA: 'Australia/Adelaide',
  NT: 'Australia/Darwin',
  WA: 'Australia/Perth',
};

export function zoneForState(state?: string): string {
  return ZONES[(state || '').toUpperCase()] || 'Australia/Melbourne';
}

/** UTC offset (minutes) of a zone at a given instant. */
export function offsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Convert a local wall-clock time ("2026-10-24T12:25" or "2026-10-24 12:25:00") in a zone to an ISO UTC string. */
export function localToIso(local: string, zone: string): string | undefined {
  const m = local.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return undefined;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  // Two passes handle DST transitions well enough for race times.
  let offset = offsetMinutes(zone, new Date(guess));
  let utc = guess - offset * 60000;
  offset = offsetMinutes(zone, new Date(utc));
  utc = guess - offset * 60000;
  return new Date(utc).toISOString();
}

/** Parse a time string that may be ISO (with zone), or local wall clock for the given state. */
export function parseRaceTime(value: string | undefined, state?: string): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(v) && !Number.isNaN(new Date(v).getTime())) return new Date(v).toISOString();
  return localToIso(v, zoneForState(state));
}

/** Format "3:45PM"/"15:45" on a date into ISO for a state. */
export function clockToIso(date: string, clock: string, state?: string): string | undefined {
  const m = clock.trim().match(/^(\d{1,2})[:.](\d{2})\s*(AM|PM|am|pm)?$/);
  if (!m) return undefined;
  let h = +m[1];
  const ampm = m[3]?.toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return localToIso(`${date}T${String(h).padStart(2, '0')}:${m[2]}`, zoneForState(state));
}
