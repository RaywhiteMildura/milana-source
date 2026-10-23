import type { NewsItem } from '../../../shared/types.js';
import type { FetchContext, SourceAdapter } from '../types.js';
import { parseRss, toNewsItem } from './rss.js';

/** Google News RSS search – the broadest free aggregator of racing news and stable talk. */
export class GoogleNewsAdapter implements SourceAdapter {
  id = 'googlenews';
  name = 'Google News';
  kind = 'news' as const;
  capabilities = ['news' as const];
  homepage = 'https://news.google.com';

  async searchNews(query: string, ctx: FetchContext): Promise<NewsItem[]> {
    const q = /racing|horse|jockey|trainer|stakes|cup|plate/i.test(query) ? query : `${query} racing`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:14d')}&hl=en-AU&gl=AU&ceid=AU:en`;
    const xml = await ctx.http.getText(url, { timeoutMs: 10_000, headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' } });
    return parseRss(xml)
      .slice(0, 25)
      .map((it) => toNewsItem(this.id, it));
  }
}
