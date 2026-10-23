import { describe, expect, it } from 'vitest';
import { HttpClient } from '../../core/http.js';
import { silentLogger } from '../../core/logger.js';
import type { FetchContext } from '../types.js';
import { GoogleNewsAdapter } from './googlenews.js';
import { BingNewsAdapter } from './bingnews.js';
import { RedditAdapter } from './reddit.js';
import { OpenMeteoAdapter } from './openmeteo.js';
import { parseRss } from './rss.js';
import { findVenue } from './venues.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>x</title>
<item><title>Aeliana primed for Cox Plate glory - Racenet</title><link>https://www.racenet.com.au/news/aeliana</link><pubDate>Thu, 22 Oct 2026 03:00:00 GMT</pubDate><description>&lt;a href="x"&gt;Trainer says the mare has worked brilliantly.&lt;/a&gt;</description><source url="https://www.racenet.com.au">Racenet</source></item>
<item><title><![CDATA[Sir Delius under an injury cloud]]></title><link>https://example.com/sir-delius</link><pubDate>Wed, 21 Oct 2026 03:00:00 GMT</pubDate><description><![CDATA[Vet to inspect on Friday.]]></description></item>
<item><title>No link item</title></item>
</channel></rss>`;

function ctxFor(responses: Record<string, { status?: number; body: string }>): FetchContext {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    const hit = Object.entries(responses).find(([k]) => url.includes(k));
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(hit[1].body, { status: hit[1].status ?? 200, headers: { 'content-type': url.includes('json') ? 'application/json' : 'text/xml' } });
  };
  const http = new HttpClient({ fetchImpl, cacheTtlMs: 0, perHostDelayMs: 0 });
  return { http, log: silentLogger, now: () => new Date('2026-10-23T05:00:00.000Z'), jurisdiction: 'VIC' };
}

describe('parseRss', () => {
  it('parses RSS items with CDATA, html entities and missing links', () => {
    const items = parseRss(RSS);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Aeliana primed for Cox Plate glory - Racenet');
    expect(items[0].description).toContain('worked brilliantly');
    expect(items[0].source).toBe('Racenet');
    expect(items[1].title).toBe('Sir Delius under an injury cloud');
  });
  it('returns [] for garbage', () => {
    expect(parseRss('not xml at all')).toEqual([]);
    expect(parseRss('<rss><channel></channel></rss>')).toEqual([]);
  });
});

describe('news adapters', () => {
  it('Google News maps items and splits outlet from title', async () => {
    const items = await new GoogleNewsAdapter().searchNews('Aeliana', ctxFor({ 'news.google.com/rss/search': { body: RSS } }));
    expect(items).toHaveLength(2);
    expect(items[0].outlet).toBe('Racenet');
    expect(items[0].title).toBe('Aeliana primed for Cox Plate glory - Racenet'.replace(' - Racenet', ''));
    expect(items[0].publishedAt).toBe('2026-10-22T03:00:00.000Z');
    expect(items[0].url).toBe('https://www.racenet.com.au/news/aeliana');
    expect(items[0].source).toBe('googlenews');
  });
  it('Bing News maps items', async () => {
    const items = await new BingNewsAdapter().searchNews('Cox Plate', ctxFor({ 'bing.com/news/search': { body: RSS } }));
    expect(items).toHaveLength(2);
    expect(items[0].source).toBe('bingnews');
  });
  it('Reddit maps listing JSON', async () => {
    const body = JSON.stringify({ data: { children: [{ data: { title: 'Cox Plate thoughts?', selftext: 'Aeliana looks the one', permalink: '/r/horseracing/comments/abc/cox_plate', created_utc: 1761100000, subreddit: 'horseracing' } }, { data: {} }] } });
    const items = await new RedditAdapter().searchNews('Cox Plate', ctxFor({ 'reddit.com/search.json': { body } }));
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://www.reddit.com/r/horseracing/comments/abc/cox_plate');
    expect(items[0].outlet).toBe('r/horseracing');
    expect(items[0].snippet).toContain('Aeliana');
  });
  it('propagates transport failures so the orchestrator can record an outage', async () => {
    await expect(new GoogleNewsAdapter().searchNews('x', ctxFor({}))).rejects.toThrow();
  });
});

describe('Open-Meteo adapter', () => {
  it('builds a weather summary for a known venue', async () => {
    const times: string[] = [];
    const rain: number[] = [];
    const temp: number[] = [];
    for (let d = 21; d <= 26; d++) for (let h = 0; h < 24; h++) {
      times.push(`2026-10-${d}T${String(h).padStart(2, '0')}:00`);
      rain.push(d === 22 && h < 6 ? 2 : 0);
      temp.push(12 + h / 2);
    }
    const body = JSON.stringify({ hourly: { time: times, temperature_2m: temp, precipitation: rain, precipitation_probability: rain.map((r) => (r ? 80 : 10)), wind_speed_10m: temp.map(() => 15), wind_direction_10m: temp.map(() => 180) } });
    const w = await new OpenMeteoAdapter().fetchWeather('Flemington', '2026-10-24', ctxFor({ 'api.open-meteo.com': { body } }));
    expect(w).not.toBeNull();
    expect(w!.venue).toBe('Flemington');
    expect(w!.hourly.length).toBe(times.length);
    expect(w!.rainLast72hMm).toBeCloseTo(12, 0);
    expect(w!.summary.length).toBeGreaterThan(10);
  });
  it('returns null for an unknown venue', async () => {
    expect(await new OpenMeteoAdapter().fetchWeather('Nowhereville', '2026-10-24', ctxFor({}))).toBeNull();
  });
});

describe('venues', () => {
  it('finds venues by name, alias, slug and TAB code', () => {
    expect(findVenue('Flemington')!.state).toBe('VIC');
    expect(findVenue('The Valley')!.name).toBe('Moonee Valley');
    expect(findVenue('moonee-valley')!.name).toBe('Moonee Valley');
    expect(findVenue('RAN')!.name).toBe('Randwick');
    expect(findVenue('Sandown Hillside')!.name).toBe('Sandown');
    expect(findVenue('Mildura')!.tz).toBe('Australia/Melbourne');
  });
});

describe('RacingRssAdapter', () => {
  it('filters feed items by the query terms and tolerates one dead feed', async () => {
    const { RacingRssAdapter } = await import('./racingrss.js');
    const feed = `<rss version="2.0"><channel><title>JHR</title>
      <item><title>Aeliana ready to fire in the Cox Plate</title><link>https://jhr/aeliana</link><pubDate>Thu, 22 Oct 2026 03:00:00 GMT</pubDate><description>Stable confident.</description></item>
      <item><title>Greyhound news</title><link>https://jhr/dogs</link><description>Nothing to do with it.</description></item>
    </channel></rss>`;
    const adapter = new RacingRssAdapter([
      { url: 'https://feed-ok.example/feed/', outlet: 'Feed OK' },
      { url: 'https://feed-dead.example/feed/', outlet: 'Dead Feed' },
    ]);
    const items = await adapter.searchNews('"Aeliana" horse', ctxFor({ 'feed-ok.example': { body: feed } }));
    expect(items).toHaveLength(1);
    expect(items[0].outlet).toBe('Feed OK');
    expect(items[0].source).toBe('racingrss');
    const none = await adapter.searchNews('Sir Delius', ctxFor({ 'feed-ok.example': { body: feed } }));
    expect(none).toHaveLength(0);
    await expect(adapter.searchNews('Aeliana', ctxFor({}))).rejects.toThrow();
  });
});
