import type { CareerStats } from '../../../shared/types.js';
import { parseTrackRating } from '../../../shared/util.js';

/**
 * Tolerant parsing helpers shared by the live adapters. Real feeds change
 * spellings and drop fields; adapters must never crash on that.
 */

export type Dict = Record<string, unknown>;

export function obj(v: unknown): Dict {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : {};
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** First defined value among the given keys. */
export function pick(o: Dict, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

export function str(o: Dict, ...keys: string[]): string | undefined {
  const v = pick(o, ...keys);
  if (v === undefined) return undefined;
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

export function num(o: Dict, ...keys: string[]): number | undefined {
  const v = pick(o, ...keys);
  return toNum(v);
}

export function toNum(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const m = v.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (m) {
      const n = Number(m[0]);
      return Number.isFinite(n) ? n : undefined;
    }
  }
  return undefined;
}

export function bool(o: Dict, ...keys: string[]): boolean | undefined {
  const v = pick(o, ...keys);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (/^(true|yes|y|1)$/i.test(v)) return true;
    if (/^(false|no|n|0)$/i.test(v)) return false;
  }
  if (typeof v === 'number') return v !== 0;
  return undefined;
}

/** Title-case an ALL CAPS name ("AELIANA" → "Aeliana", "J MCDONALD" → "J Mcdonald"). */
export function titleCase(s?: string): string | undefined {
  if (!s) return undefined;
  if (s !== s.toUpperCase()) return s.trim();
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'(])([a-z])/g, (_, p, c) => p + c.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, c) => 'Mc' + c.toUpperCase())
    .replace(/\bO'([a-z])/g, (_, c) => "O'" + c.toUpperCase())
    .replace(/\((Nz|Gb|Ire|Usa|Fr|Jpn|Ger|Aus|Sa|Arg|Bra|Chi|Nzl)\)/g, (m) => m.toUpperCase())
    .trim();
}

/** Strip a trailing country code "(NZ)" from a horse name, returning both. */
export function splitCountry(name?: string): { name: string; country?: string } {
  if (!name) return { name: '' };
  const m = name.match(/^(.*?)\s*\(([A-Za-z]{2,3})\)\s*$/);
  if (m) return { name: m[1].trim(), country: m[2].toUpperCase() };
  return { name: name.trim() };
}

/**
 * Parse a career/split record from many shapes:
 *  - { starts, wins, seconds, thirds } / { numberOfStarts, numberOfWins, ... } / { firsts, placings }
 *  - "12: 4-2-1" / "12-4-2-1" / "4-2-1 (12)"
 */
export function parseStats(v: unknown): CareerStats | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') {
    // "12: 4-2-1", "12:4,2,1", "12 (4-2-1)"
    let m = v.match(/^\s*(\d+)\s*[:(]\s*(\d+)\s*[-,]\s*(\d+)\s*[-,]\s*(\d+)/);
    if (m) return { starts: +m[1], wins: +m[2], seconds: +m[3], thirds: +m[4] };
    // "12-4-2-1" (starts first) – reject nonsense where placings exceed starts
    m = v.match(/^\s*(\d+)\s*-\s*(\d+)\s*-\s*(\d+)\s*-\s*(\d+)\s*$/);
    if (m && +m[2] + +m[3] + +m[4] <= +m[1]) return { starts: +m[1], wins: +m[2], seconds: +m[3], thirds: +m[4] };
    // "4-2-1 (12)"
    m = v.match(/^\s*(\d+)\s*-\s*(\d+)\s*-\s*(\d+)\s*\(\s*(\d+)\s*\)/);
    if (m) return { starts: +m[4], wins: +m[1], seconds: +m[2], thirds: +m[3] };
    return undefined;
  }
  const o = obj(v);
  const starts = num(o, 'starts', 'numberOfStarts', 'runs', 'noOfStarts', 'total', 'startsCount');
  const wins = num(o, 'wins', 'numberOfWins', 'firsts', 'win', 'first');
  const seconds = num(o, 'seconds', 'numberOfSeconds', 'second', 'placesSecond');
  const thirds = num(o, 'thirds', 'numberOfThirds', 'third', 'placesThird');
  const placings = num(o, 'placings', 'numberOfPlacings', 'places');
  if (starts == null && wins == null) return undefined;
  const w = wins ?? 0;
  let s2 = seconds ?? 0;
  let t3 = thirds ?? 0;
  if (seconds == null && thirds == null && placings != null) {
    // "Placings" in Australian form = seconds + thirds. Split evenly when not itemised.
    const p = Math.max(0, placings);
    s2 = Math.ceil(p / 2);
    t3 = Math.floor(p / 2);
  }
  return { starts: starts ?? w + s2 + t3, wins: w, seconds: s2, thirds: t3, prizeMoney: num(o, 'prizeMoney', 'prizemoney', 'earnings') };
}

/** Convert "GOOD4" / "Good (4)" / "Soft 5" into { text, rating }. */
export function parseCondition(v?: string): { text?: string; rating?: number } {
  if (!v) return {};
  const rating = parseTrackRating(v);
  const text = v.replace(/([A-Za-z])(\d)/, '$1 $2').replace(/\s+/g, ' ').trim();
  return { text: titleCase(text) || text, rating };
}

/** Parse a date in the common forms sources use into YYYY-MM-DD. */
export function toISODateOnly(v?: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'number') return new Date(v).toISOString().slice(0, 10);
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/); // dd/mm/yyyy (Australian)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2})$/);
  if (m) return `20${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2,4})/); // 03 Oct 2026 / 03-Oct-26
  if (m) {
    const mo = months.indexOf(m[2].toLowerCase().slice(0, 3));
    if (mo >= 0) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${y}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

/** Parse "1.5L", "0.2", "SHD", "NK", "HD", "LG NK" margins into lengths. */
export function parseMargin(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toUpperCase();
  if (!s) return undefined;
  if (/^(DH|DEAD ?HEAT)/.test(s)) return 0;
  if (/^NS|NOSE/.test(s)) return 0.05;
  if (/^SHD|SH HD|SHORT HEAD/.test(s)) return 0.1;
  if (/^HD|HEAD/.test(s)) return 0.2;
  if (/^LG NK|LONG NECK/.test(s)) return 0.4;
  if (/^NK|NECK/.test(s)) return 0.3;
  if (/^SH NK|SHORT NECK/.test(s)) return 0.25;
  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : undefined;
}

export function parseInt10(v: unknown): number | undefined {
  const n = toNum(v);
  return n == null ? undefined : Math.trunc(n);
}
