import { XMLParser } from 'fast-xml-parser';
import type { NewsItem } from '../../../shared/types.js';

/** Minimal RSS 2.0 / Atom item extraction shared by the news adapters. */
export interface RssItem {
  title: string;
  link: string;
  pubDate?: string;
  description?: string;
  source?: string;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', cdataPropName: '__cdata', trimValues: true });

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.__cdata === 'string') return o.__cdata;
    if (typeof o['#text'] === 'string') return o['#text'] as string;
    if (typeof o['@_href'] === 'string') return o['@_href'] as string;
  }
  return '';
}

export function parseRss(xml: string): RssItem[] {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }
  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  const feed = doc.feed as Record<string, unknown> | undefined;
  let items: unknown[] = [];
  if (channel) items = toArray(channel.item);
  else if (feed) items = toArray(feed.entry);
  return items
    .map((raw): RssItem | undefined => {
      const it = raw as Record<string, unknown>;
      const title = stripHtml(text(it.title));
      const link = text(it.link) || text((it as { guid?: unknown }).guid);
      if (!title || !link) return undefined;
      const source = text(it.source) || text(it['News:Source']) || text(it['news:Source']) || text((it as { author?: unknown }).author);
      return {
        title,
        link,
        pubDate: text(it.pubDate) || text(it.published) || text(it.updated) || undefined,
        description: stripHtml(text(it.description) || text(it.summary) || text(it.content)).slice(0, 400) || undefined,
        source: source || undefined,
      };
    })
    .filter((x): x is RssItem => !!x);
}

function toArray(v: unknown): unknown[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toNewsItem(source: string, it: RssItem, defaultOutlet?: string, opts: { titleSuffixIsOutlet?: boolean } = {}): NewsItem {
  let title = it.title;
  let outlet = it.source || defaultOutlet;
  let link = it.link;
  // Bing wraps links in a click tracker: unwrap to the publisher URL so the same story de-duplicates across channels.
  try {
    const u = new URL(link);
    if (/(^|\.)bing\.com$/i.test(u.hostname) && u.searchParams.get('url')) link = u.searchParams.get('url')!;
  } catch {
    /* keep as is */
  }
  // Google News titles end with " - Outlet"
  const m = opts.titleSuffixIsOutlet !== false ? title.match(/^(.*)\s[-–]\s([^-–]{2,60})$/) : null;
  if (m) {
    const suffix = m[2].trim();
    const same = it.source && suffix.toLowerCase().replace(/[^a-z0-9]/g, '') === it.source.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!it.source || same) {
      title = m[1].trim();
      outlet = it.source || suffix;
    }
  }
  const publishedAt = it.pubDate ? safeDate(it.pubDate) : undefined;
  return {
    id: `${source}:${hash(link || title)}`,
    source,
    outlet,
    title,
    url: link,
    publishedAt,
    snippet: it.description,
    mentions: [],
    sentiment: 0,
    relevance: 0,
  };
}

export function safeDate(s: string): string | undefined {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
