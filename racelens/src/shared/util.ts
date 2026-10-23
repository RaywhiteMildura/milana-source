/** Normalise a horse / person name for cross-source matching. */
export function normaliseName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/\((?:[a-z]{2,3})\)\s*$/i, '') // trailing country code e.g. (NZ)
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Normalise a person name: handles "J. McDonald" vs "James McDonald" by surname + first initial. */
export function normalisePerson(name: string): string {
  const n = normaliseName(name).replace(/\b(ms|mr|mrs|dr)\b/g, '').trim();
  if (!n) return '';
  const parts = n.split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0];
  // Drop apprentice claim suffixes like "(a3)" already stripped by normaliseName; keep first initial + surname
  const first = parts[0][0];
  const surname = parts[parts.length - 1];
  return `${first} ${surname}`;
}

export function slugify(s: string): string {
  return normaliseName(s).replace(/\s+/g, '-');
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function round(v: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/** Parse Australian track condition strings into 1..10 rating. */
export function parseTrackRating(text?: string): number | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  const m = t.match(/(\d{1,2})/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 10) return n;
  }
  if (t.includes('firm')) return 2;
  if (t.includes('good')) return 4;
  if (t.includes('soft')) return 6;
  if (t.includes('heavy')) return 9;
  if (t.includes('synth')) return 4;
  return undefined;
}

export function trackRatingLabel(rating?: number): string {
  if (rating == null) return 'Unknown';
  if (rating <= 2) return `Firm ${rating}`;
  if (rating <= 4) return `Good ${rating}`;
  if (rating <= 7) return `Soft ${rating}`;
  return `Heavy ${rating}`;
}

/** Parse "1x234" style last-starts strings into positions (x = spell, 0 = 10+). */
export function parseLastStarts(s?: string): Array<number | 'x'> {
  if (!s) return [];
  return s
    .replace(/\s+/g, '')
    .split('')
    .map((c) => (c.toLowerCase() === 'x' || c === '-' ? 'x' : c === '0' ? 10 : Number(c)))
    .filter((c) => c === 'x' || (typeof c === 'number' && !Number.isNaN(c))) as Array<number | 'x'>;
}

export function toISODate(d: Date, tz = 'Australia/Melbourne'): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(d);
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.round((db - da) / 86400000);
}

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
