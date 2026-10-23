/**
 * News matching and sentiment.
 *
 * `matchNews` links fetched news items to the runners of a race (horses by
 * full-name phrase, jockeys/trainers by full name or initial + surname), scores
 * a crude racing-specific sentiment and a 0..1 relevance, then returns the
 * relevant items sorted and de-duplicated. `newsFactorForRunner` folds the
 * matched items for one horse into a model factor.
 *
 * Pure functions: no I/O, no clock (`now` is a parameter).
 */
import type { NewsItem, Race } from '../../shared/types.js';
import { clamp, normaliseName, normalisePerson, round } from '../../shared/util.js';

export interface NewsRunnerLike {
  name: string;
  jockey?: string;
  trainer?: string;
}

export type NewsRaceLike = Race | { runners: NewsRunnerLike[] };

export interface NewsFactor {
  /** -1 .. 1 */
  score: number;
  evidence: string;
  /** 0..1 */
  dataQuality: number;
}

// ---------------------------------------------------------------------------
// Text normalisation
// ---------------------------------------------------------------------------

/** Lower-case, drop apostrophes, collapse everything else that is not a letter or digit to a space. */
export function normaliseText(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** "Pride Of Jenni's" -> "Pride Of Jenni" so possessives still match the full name. */
function stripPossessives(text: string): string {
  return (text || '').replace(/([a-z0-9])[’'`´]s\b/gi, '$1');
}

function tokensOf(text: string): string[] {
  const n = normaliseText(text);
  return n ? n.split(' ') : [];
}

function containsPhrase(padded: string, phrase: string): boolean {
  return phrase.length > 0 && padded.includes(` ${phrase} `);
}

/** Drop parenthesised suffixes such as apprentice claims "(a2)" before normalising a person. */
function cleanPerson(name: string): string {
  return (name || '').replace(/\([^)]*\)/g, ' ');
}

/** Drop honorifics so "Ms Jamie Kah" matches "Jamie Kah". */
function stripHonorifics(normalised: string): string {
  return normalised
    .replace(/\b(ms|mr|mrs|miss|dr)\b/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Sentiment lexicon
// ---------------------------------------------------------------------------

/** Phrases that read well for a runner, with weights. */
const POSITIVE_PHRASES: Array<[string, number]> = [
  ['worked brilliantly', 1.5],
  ['worked well', 1],
  ['working well', 1],
  ['trialled well', 1.2],
  ['trialed well', 1.2],
  ['trialled brilliantly', 1.5],
  ['won his trial', 1.2],
  ['won her trial', 1.2],
  ['trial winner', 1],
  ['stable confident', 1.5],
  ['stable is confident', 1.5],
  ['confident', 1],
  ['bullish', 1],
  ['in great order', 1.2],
  ['in good order', 1],
  ['great order', 1],
  ['in good shape', 1],
  ['in great shape', 1.2],
  ['flying', 1],
  ['strong', 0.8],
  ['firmed', 1],
  ['firming', 1],
  ['dominant', 1.2],
  ['dominated', 1.2],
  ['impressive', 1],
  ['impressed', 1],
  ['impressively', 1],
  ['well drawn', 1],
  ['good draw', 1],
  ['ideal draw', 1],
  ['perfect draw', 1],
  ['good barrier', 0.8],
  ['primed', 1.2],
  ['peaking', 1],
  ['thriving', 1],
  ['fit', 0.6],
  ['fitter', 0.8],
  ['cherry ripe', 1.2],
  ['going great', 1],
  ['going well', 0.8],
  ['pleased', 0.8],
  ['happy with', 0.8],
  ['jumping out of his skin', 1.5],
  ['jumping out of her skin', 1.5],
  ['slashing', 1],
  ['eye catching', 1],
  ['eyecatching', 1],
  ['shortened', 0.8],
  ['well backed', 1],
  ['heavily backed', 1.2],
  ['specked', 0.8],
  ['big chance', 1],
  ['good chance', 0.8],
  ['great chance', 1],
  ['bounce back', 0.6],
  ['improved', 0.6],
  ['improving', 0.6],
  ['passed a vet check', 1],
  ['passed the vet', 1],
  ['cleared by vets', 1],
  ['cleared to run', 1],
];

/** Phrases that read badly for a runner, with weights (applied negatively). */
const NEGATIVE_PHRASES: Array<[string, number]> = [
  ['late scratching', 2],
  ['scratched', 2],
  ['scratching', 1.5],
  ['injury', 1.5],
  ['injured', 1.5],
  ['injuries', 1.2],
  ['lame', 1.5],
  ['lameness', 1.5],
  ['vet', 1],
  ['vets', 1],
  ['veterinary', 1],
  ['under a cloud', 1.5],
  ['jockey replaced', 1],
  ['rider replaced', 1],
  ['late change', 1],
  ['late changes', 1],
  ['late rider change', 1],
  ['drifted', 1],
  ['drifting', 1],
  ['eased', 0.6],
  ['disappointing', 1.2],
  ['disappointed', 1],
  ['disappoint', 1],
  ['wide draw', 1],
  ['wide barrier', 1],
  ['awkward draw', 0.8],
  ['awkward barrier', 0.8],
  ['tricky draw', 0.6],
  ['doubtful', 1.2],
  ['in doubt', 1.2],
  ['doubt', 0.8],
  ['doubts', 0.8],
  ['withdrawn', 2],
  ['withdrawal', 1.5],
  ['suspended', 1.2],
  ['suspension', 1],
  ['fail', 1],
  ['failed', 1],
  ['fails', 1],
  ['failure', 1],
  ['setback', 1.5],
  ['setbacks', 1.2],
  ['blew out', 1.2],
  ['blow out', 1],
  ['blowing out', 1],
  ['concern', 1],
  ['concerns', 1],
  ['concerning', 1],
  ['worry', 0.8],
  ['worries', 0.8],
  ['worrying', 0.8],
  ['struggled', 0.8],
  ['struggling', 0.8],
  ['sore', 1],
  ['soreness', 1],
  ['bled', 1.5],
  ['bleeding', 1.2],
  ['stood down', 1.5],
  ['out of form', 1],
  ['lost form', 1],
  ['poor', 0.6],
  ['flopped', 1],
  ['flop', 1],
  ['query', 0.6],
  ['question mark', 0.8],
  ['question marks', 0.8],
];

interface LexiconEntry {
  phrase: string;
  tokens: string[];
  weight: number;
}

const LEXICON: LexiconEntry[] = [
  ...POSITIVE_PHRASES.map(([phrase, weight]) => ({ phrase, tokens: phrase.split(' '), weight })),
  ...NEGATIVE_PHRASES.map(([phrase, weight]) => ({ phrase, tokens: phrase.split(' '), weight: -weight })),
].sort((a, b) => b.tokens.length - a.tokens.length); // longest phrases claim their words first

const NEGATION_WORDS = new Set([
  'no',
  'not',
  'never',
  'without',
  'none',
  'nothing',
  'hardly',
  'isnt',
  'arent',
  'wasnt',
  'werent',
  'hasnt',
  'havent',
  'hadnt',
  'dont',
  'doesnt',
  'didnt',
  'cant',
  'wont',
  'couldnt',
  'wouldnt',
  'shouldnt',
]);
const NEGATION_WINDOW = 3;
/** Divisor turning summed phrase weights into a -1..1 sentiment. */
const SENTIMENT_SCALE = 3;

export interface SentimentHit {
  phrase: string;
  /** Signed weight after negation handling. */
  weight: number;
  negated: boolean;
}

function isNegated(tokens: string[], index: number): boolean {
  for (let k = 1; k <= NEGATION_WINDOW && index - k >= 0; k++) {
    if (NEGATION_WORDS.has(tokens[index - k])) return true;
  }
  return false;
}

/**
 * Racing-specific lexicon sentiment for a piece of text. Each phrase hit adds
 * its weight; a negation word within three words before the phrase ("no
 * concerns", "not a concern") flips the sign and halves the weight. The sum is
 * divided by 3 and clamped to -1..1.
 */
export function scoreSentiment(text: string): { score: number; hits: SentimentHit[] } {
  const tokens = tokensOf(text);
  const consumed = new Array<boolean>(tokens.length).fill(false);
  const hits: SentimentHit[] = [];
  let total = 0;

  for (const entry of LEXICON) {
    const n = entry.tokens.length;
    for (let i = 0; i + n <= tokens.length; i++) {
      let matches = true;
      for (let j = 0; j < n; j++) {
        if (consumed[i + j] || tokens[i + j] !== entry.tokens[j]) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;
      for (let j = 0; j < n; j++) consumed[i + j] = true;
      const negated = isNegated(tokens, i);
      const weight = negated ? -entry.weight * 0.5 : entry.weight;
      total += weight;
      hits.push({ phrase: entry.phrase, weight, negated });
      i += n - 1;
    }
  }

  return { score: round(clamp(total / SENTIMENT_SCALE, -1, 1), 2), hits };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

interface HorseKey {
  display: string;
  norm: string;
}

interface PersonKey {
  display: string;
  full: string;
  initial: string;
}

function horseKeys(runners: NewsRunnerLike[]): HorseKey[] {
  const seen = new Set<string>();
  const out: HorseKey[] = [];
  for (const r of runners) {
    const norm = normaliseName(r.name);
    if (norm.length < 3 || seen.has(norm)) continue;
    seen.add(norm);
    out.push({ display: r.name, norm });
  }
  return out;
}

function personKeys(runners: NewsRunnerLike[]): PersonKey[] {
  const seen = new Set<string>();
  const out: PersonKey[] = [];
  for (const r of runners) {
    for (const name of [r.jockey, r.trainer]) {
      if (!name) continue;
      const cleaned = cleanPerson(name);
      const full = stripHonorifics(normaliseName(cleaned));
      const initial = normalisePerson(cleaned);
      if (!full || seen.has(full)) continue;
      seen.add(full);
      out.push({ display: name.trim(), full, initial });
    }
  }
  return out;
}

function publishedMs(item: NewsItem): number {
  if (!item.publishedAt) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(item.publishedAt);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/**
 * Attach `mentions`, `sentiment` and `relevance` to news items for a race.
 *
 * Relevance: a horse in the race is mentioned -> 0.85..1 (more with extra runners
 * or a meeting term); only a jockey/trainer -> 0.55..0.7; only a meeting-wide
 * term -> 0.4..0.5; nothing -> 0 and dropped. Output is sorted by relevance
 * then publishedAt (newest first) and de-duplicated by normalised title.
 */
export function matchNews(items: NewsItem[], race: NewsRaceLike, meetingTerms: string[]): NewsItem[] {
  const runners: NewsRunnerLike[] = race.runners ?? [];
  const horses = horseKeys(runners);
  const people = personKeys(runners);
  const terms = Array.from(new Set((meetingTerms ?? []).map((t) => normaliseName(t)).filter((t) => t.length >= 3)));

  const scored: NewsItem[] = [];
  for (const item of items ?? []) {
    const raw = `${item.title ?? ''} ${item.snippet ?? ''}`;
    const plain = ` ${normaliseText(raw)} `;
    const noPossessive = ` ${normaliseText(stripPossessives(raw))} `;
    const has = (phrase: string): boolean => containsPhrase(plain, phrase) || containsPhrase(noPossessive, phrase);

    const horseHits = horses.filter((h) => has(h.norm));
    const personHits = people.filter((p) => has(p.full) || has(p.initial));
    const termHits = terms.filter((t) => has(t));

    let relevance = 0;
    if (horseHits.length > 0) {
      relevance = Math.min(1, 0.85 + 0.05 * (horseHits.length - 1) + (termHits.length > 0 ? 0.1 : 0));
    } else if (personHits.length > 0) {
      relevance = Math.min(0.7, 0.55 + 0.05 * (personHits.length - 1) + (termHits.length > 0 ? 0.1 : 0));
    } else if (termHits.length > 0) {
      relevance = Math.min(0.5, 0.4 + 0.05 * (termHits.length - 1));
    }
    if (relevance <= 0) continue;

    const mentions = Array.from(new Set([...horseHits.map((h) => h.display), ...personHits.map((p) => p.display)]));
    scored.push({
      ...item,
      mentions,
      sentiment: scoreSentiment(raw).score,
      relevance: round(relevance, 2),
    });
  }

  scored.sort((a, b) => b.relevance - a.relevance || publishedMs(b) - publishedMs(a));

  const seenTitles = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of scored) {
    const key = normaliseName(item.title) || item.id;
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runner factor
// ---------------------------------------------------------------------------

const RECENCY_DAYS = 7;
const RECENCY_FLOOR = 0.15;

/** 1 for fresh items, decaying linearly to 0.15 over seven days. 1 when either date is missing. */
export function recencyWeight(publishedAt: string | undefined, now: Date | undefined): number {
  if (!publishedAt || !now) return 1;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return 1;
  const ageDays = (now.getTime() - t) / 86400000;
  if (ageDays <= 0) return 1;
  return clamp(1 - ageDays / RECENCY_DAYS, RECENCY_FLOOR, 1);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Quote the strongest lexicon phrase as it appears in the item, else a trimmed title. */
function excerptFor(item: NewsItem): string {
  const raw = `${item.title ?? ''} ${item.snippet ?? ''}`.trim();
  const { hits } = scoreSentiment(raw);
  const strongest = hits.reduce<SentimentHit | undefined>(
    (best, h) => (best === undefined || Math.abs(h.weight) > Math.abs(best.weight) ? h : best),
    undefined,
  );
  if (strongest) {
    const pattern = new RegExp(strongest.phrase.split(' ').map(escapeRegExp).join('[^a-z0-9]+'), 'i');
    const m = pattern.exec(raw);
    if (m) {
      const end = m.index + m[0].length;
      return `${m[0]}${end < raw.length ? '…' : ''}`;
    }
    return `${strongest.phrase}…`;
  }
  const title = (item.title ?? '').trim();
  return title.length > 60 ? `${title.slice(0, 60).trimEnd()}…` : title;
}

/**
 * Fold the news items mentioning `runnerName` into a factor: relevance- and
 * recency-weighted mean sentiment in -1..1, a one-line evidence string and a
 * data-quality estimate (0 with no items, 0.5 with one fresh item, 1 with 4+).
 */
export function newsFactorForRunner(items: NewsItem[], runnerName: string, now?: Date): NewsFactor {
  const target = normaliseName(runnerName);
  const relevant = target
    ? (items ?? []).filter((i) => (i.mentions ?? []).some((m) => normaliseName(m) === target))
    : [];
  if (relevant.length === 0) return { score: 0, evidence: 'No news mentions', dataQuality: 0 };

  let weightSum = 0;
  let weightedSentiment = 0;
  let recencySum = 0;
  let positive = 0;
  let negative = 0;
  let best: NewsItem | undefined;
  let bestInfluence = -1;

  for (const item of relevant) {
    const sentiment = clamp(Number.isFinite(item.sentiment) ? item.sentiment : 0, -1, 1);
    const relevance = clamp(Number.isFinite(item.relevance) ? item.relevance : 0.5, 0.1, 1);
    const recency = recencyWeight(item.publishedAt, now);
    const w = relevance * recency;
    weightSum += w;
    weightedSentiment += w * sentiment;
    recencySum += recency;
    if (sentiment > 0.1) positive++;
    else if (sentiment < -0.1) negative++;
    const influence = Math.abs(sentiment) * w;
    if (influence > bestInfluence) {
      bestInfluence = influence;
      best = item;
    }
  }

  const n = relevant.length;
  const score = weightSum > 0 ? round(clamp(weightedSentiment / weightSum, -1, 1), 2) : 0;
  const meanRecency = recencySum / n;
  const dataQuality = round(Math.min(1, 0.3 + 0.2 * n) * (0.6 + 0.4 * meanRecency), 2);

  const tone =
    positive > negative ? 'mostly positive' : negative > positive ? 'mostly negative' : positive > 0 ? 'mixed' : 'neutral';
  const excerpt = best ? excerptFor(best) : '';
  const evidence = `${n} item${n === 1 ? '' : 's'}, ${tone}${excerpt ? `: '${excerpt}'` : ''}`;

  return { score, evidence, dataQuality };
}
