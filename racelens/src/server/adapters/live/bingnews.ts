import type { NewsItem } from '../../../shared/types.js';
import type { FetchContext, SourceAdapter } from '../types.js';
import { parseRss, toNewsItem } from './rss.js';

/** Bing News RSS – second, independent news aggregator so news is also cross-checked. */
export class BingNewsAdapter implements SourceAdapter {
  id = 'bingnews';
  name = 'Bing News';
  kind = 'news' as const;
  capabilities = ['news' as const];
  homepage = 'https://www.bing.com/news';

  async searchNews(query: string, ctx: FetchContext): Promise<NewsItem[]> {
    const q = /racing|horse|jockey|trainer|stakes|cup|plate/i.test(query) ? query : `${query} horse racing`;
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setmkt=en-AU&cc=AU`;
    const xml = await ctx.http.getText(url, { timeoutMs: 10_000, headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' } });
    return parseRss(xml)
      .slice(0, 25)
      .map((it) => toNewsItem(this.id, it, it.source, { titleSuffixIsOutlet: false }));
  }
}
