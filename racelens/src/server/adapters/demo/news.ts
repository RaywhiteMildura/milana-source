/**
 * demo-news — a fictional racing news / rumour feed.
 *
 * `searchNews(query)` returns bundled items whose title or snippet contain every
 * meaningful token of the query (case-insensitive, whole-word, apostrophes and
 * country suffixes ignored). Each hit is tagged with the demo horses, jockeys
 * and trainers it mentions and a crude sentiment score.
 */
import type { NewsItem } from '../../../shared/types.js';
import { normaliseName, clamp } from '../../../shared/util.js';
import type { FetchContext, SourceAdapter } from '../types.js';
import { demoDelay, loadDemoNews, loadDemoPack, type DemoNewsRaw, type DemoPack } from './pack.js';

export const DEMO_NEWS_ID = 'demo-news';

const NEGATIVE = [
  'injury', 'cloud', 'scratched', 'scratching', 'withdrawn', 'replaced', 'suspension', 'vet', 'vetted', 'temperature',
  'concern', 'concerns', 'doubt', 'lame', 'bled', 'bleeding', 'disappointing', 'lost his way', 'lost her way', 'poor',
  'abandoned', 'glitch', 'error', 'scratchy', 'rubbish', 'not himself', 'not herself', 'query',
];
const POSITIVE = [
  'brilliant', 'brilliantly', 'confident', 'impressive', 'eye-catching', 'firms', 'firmed', 'thrived', 'career-best',
  'ready', 'ideal', 'bullish', 'hard to run down', 'one to beat', 'fastest', 'come on', 'never looked better',
  'nothing wrong', 'handy weight', 'pick of the',
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordMatch(text: string, token: string): boolean {
  return new RegExp(`(^|\\s)${escapeRe(token)}s?(?=\\s|$)`).test(text);
}

/** Query tokens worth matching: normalised, initials (single letters) dropped. */
export function newsQueryTokens(query: string): string[] {
  return normaliseName(query)
    .split(' ')
    .filter((t) => t.length >= 2);
}

function lexiconSentiment(text: string): number {
  const t = text.toLowerCase();
  let score = 0;
  for (const w of NEGATIVE) if (t.includes(w)) score -= 1;
  for (const w of POSITIVE) if (t.includes(w)) score += 1;
  return clamp(score * 0.3, -1, 1);
}

interface Entity {
  name: string;
  full: string;
  surname?: string;
}

let entityCache: Entity[] | undefined;

/** Horses, jockeys and trainers from the demo pack, for mention tagging. */
function entities(pack: DemoPack): Entity[] {
  if (entityCache) return entityCache;
  const seen = new Set<string>();
  const out: Entity[] = [];
  const add = (name: string, person: boolean) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    const full = normaliseName(name);
    if (!full) return;
    const e: Entity = { name, full };
    if (person) {
      const parts = full.split(' ');
      const surname = parts[parts.length - 1];
      if (surname.length >= 5) e.surname = surname;
    }
    out.push(e);
  };
  for (const race of pack.races) {
    for (const r of race.runners) {
      add(r.name, false);
      add(r.jockey, true);
      add(r.trainer, true);
    }
  }
  entityCache = out;
  return out;
}

function mentionsIn(text: string, pack: DemoPack): string[] {
  const found: string[] = [];
  for (const e of entities(pack)) {
    if (wordMatch(text, e.full) || (e.surname && wordMatch(text, e.surname))) found.push(e.name);
  }
  return found;
}

export function toNewsItem(raw: DemoNewsRaw, index: number, pack: DemoPack, tokens: string[]): NewsItem {
  const text = normaliseName(`${raw.title} ${raw.snippet ?? ''}`);
  const mentions = mentionsIn(text, pack);
  const sentiment = typeof raw.sentiment === 'number' ? clamp(raw.sentiment, -1, 1) : lexiconSentiment(`${raw.title} ${raw.snippet ?? ''}`);
  const matched = tokens.filter((t) => wordMatch(text, t)).length;
  let relevance = tokens.length ? 0.4 + 0.3 * (matched / tokens.length) : 0.4;
  if (mentions.length) relevance += 0.2;
  if (/\bflemington\b|\bdemo plate\b/.test(text)) relevance += 0.1;
  if (raw.tags?.includes('irrelevant')) relevance -= 0.3;
  return {
    id: raw.id ?? `${DEMO_NEWS_ID}:${index + 1}`,
    source: DEMO_NEWS_ID,
    outlet: raw.outlet,
    title: raw.title,
    url: raw.url,
    publishedAt: raw.publishedAt,
    snippet: raw.snippet,
    mentions,
    sentiment,
    relevance: clamp(Math.round(relevance * 100) / 100, 0, 1),
  };
}

export const demoNewsAdapter: SourceAdapter = {
  id: DEMO_NEWS_ID,
  name: 'Demo Racing News',
  kind: 'news',
  capabilities: ['news'],
  homepage: 'https://demo-news.racelens.local/',

  async searchNews(query: string, ctx: FetchContext): Promise<NewsItem[]> {
    await demoDelay(ctx);
    // "A" OR "B" OR "C" → any alternative may match; a plain query needs every token.
    const alternatives = query.split(/\s+OR\s+/).map((alt) => newsQueryTokens(alt)).filter((t) => t.length);
    if (!alternatives.length) return [];
    const pack = loadDemoPack();
    const items = loadDemoNews().items ?? [];
    const hits: NewsItem[] = [];
    items.forEach((raw, i) => {
      if (!raw?.title) return;
      const text = normaliseName(`${raw.title} ${raw.snippet ?? ''}`);
      const tokens = alternatives.find((alt) => alt.every((t) => wordMatch(text, t)));
      if (!tokens) return;
      hits.push(toNewsItem(raw, i, pack, tokens));
    });
    hits.sort((a, b) => b.relevance - a.relevance || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    return hits;
  },
};
