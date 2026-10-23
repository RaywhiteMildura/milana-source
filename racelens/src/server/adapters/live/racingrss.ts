import type { NewsItem } from '../../../shared/types.js';
import { normaliseName } from '../../../shared/util.js';
import type { FetchContext, SourceAdapter } from '../types.js';
import { parseRss, toNewsItem } from './rss.js';

/**
 * Dedicated Australian racing news feeds (RSS). Feeds are not searchable, so
 * we pull each feed once (cached by the HTTP client) and filter locally by the
 * query terms. Independent of the Google/Bing aggregators, so a story has to
 * appear in two different channels to be "verified" by the news engine.
 */
export const RACING_FEEDS: Array<{ url: string; outlet: string }> = [
  { url: 'https://www.justhorseracing.com.au/feed/', outlet: 'Just Horse Racing' },
  { url: 'https://www.news.com.au/content-feeds/latest-news-sport/', outlet: 'news.com.au Sport' },
  { url: 'https://www.races.com.au/feed/', outlet: 'Races.com.au' },
  { url: 'https://horsebetting.com.au/category/news/au/feed/', outlet: 'HorseBetting.com.au' },
  { url: 'https://www.eliteracing.com.au/feed/', outlet: 'Elite Racing' },
];

export class RacingRssAdapter implements SourceAdapter {
  id = 'racingrss';
  name = 'Racing news feeds';
  kind = 'news' as const;
  capabilities = ['news' as const];
  homepage = 'https://www.justhorseracing.com.au';

  constructor(private readonly feeds = RACING_FEEDS) {}

  async searchNews(query: string, ctx: FetchContext): Promise<NewsItem[]> {
    // "A" OR "B" OR "C" → match any alternative; a plain query must contain every term (or the whole phrase).
    const alternatives = query
      .split(/\s+OR\s+/)
      .map((alt) => alt.replace(/\b(horse|racing|races)\b/gi, ' ').replace(/"/g, ' ').trim())
      .filter(Boolean)
      .map((alt) => ({ phrase: normaliseName(alt), terms: alt.split(/\s+/).map((t) => normaliseName(t)).filter((t) => t.length >= 3) }));
    const matches = (hay: string) => alternatives.some(({ phrase, terms }) => (phrase.length >= 3 && hay.includes(phrase)) || (terms.length > 0 && terms.every((t) => hay.includes(t))));
    const out: NewsItem[] = [];
    let okFeeds = 0;
    let lastError: unknown;
    await Promise.all(
      this.feeds.map(async (feed) => {
        try {
          const xml = await ctx.http.getText(feed.url, { timeoutMs: 10_000, headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' } });
          okFeeds++;
          for (const it of parseRss(xml)) {
            const hay = normaliseName(`${it.title} ${it.description || ''}`);
            if (matches(hay)) out.push(toNewsItem(this.id, it, feed.outlet));
          }
        } catch (err) {
          lastError = err;
          ctx.log.debug(`racingrss: ${feed.outlet} failed: ${err instanceof Error ? err.message : err}`);
        }
      }),
    );
    if (!okFeeds) throw lastError instanceof Error ? lastError : new Error('No racing RSS feed responded');
    return out;
  }
}
