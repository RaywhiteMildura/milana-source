import type { NewsItem } from '../../../shared/types.js';
import type { FetchContext, SourceAdapter } from '../types.js';
import { hash, safeDate, stripHtml } from './rss.js';

interface RedditListing {
  data?: { children?: Array<{ data?: { title?: string; selftext?: string; url?: string; permalink?: string; created_utc?: number; subreddit?: string; score?: number } }> };
}

/** Reddit search (r/horseracing and r/australia chatter) – the "online rumours" channel. */
export class RedditAdapter implements SourceAdapter {
  id = 'reddit';
  name = 'Reddit';
  kind = 'news' as const;
  capabilities = ['news' as const];
  homepage = 'https://www.reddit.com/r/horseracing';

  async searchNews(query: string, ctx: FetchContext): Promise<NewsItem[]> {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(`${query} (subreddit:horseracing OR subreddit:australia OR subreddit:melbourne OR subreddit:sportsbook)`)}&sort=new&limit=25&t=month`;
    const data = await ctx.http.getJson<RedditListing>(url, {
      expect: 'json',
      timeoutMs: 10_000,
      headers: { 'User-Agent': 'RaceLens/0.1 (personal racing research tool)' },
    });
    const children = data.data?.children || [];
    return children
      .map((c) => c.data)
      .filter((d): d is NonNullable<typeof d> => !!d && !!d.title)
      .map((d) => ({
        id: `${this.id}:${hash(d.permalink || d.url || d.title!)}`,
        source: this.id,
        outlet: d.subreddit ? `r/${d.subreddit}` : 'Reddit',
        title: stripHtml(d.title!),
        url: d.permalink ? `https://www.reddit.com${d.permalink}` : d.url || '',
        publishedAt: d.created_utc ? safeDate(new Date(d.created_utc * 1000).toISOString()) : undefined,
        snippet: d.selftext ? stripHtml(d.selftext).slice(0, 400) : undefined,
        mentions: [],
        sentiment: 0,
        relevance: 0.3,
      }));
  }
}
