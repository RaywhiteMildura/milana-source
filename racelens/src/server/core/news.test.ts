import { describe, expect, it } from 'vitest';
import type { NewsItem } from '@shared/types';
import { matchNews, newsFactorForRunner, normaliseText, recencyWeight, scoreSentiment } from './news.js';

const RACE = {
  runners: [
    { name: 'Pride Of Jenni', jockey: 'Declan Bates', trainer: 'Ciaron Maher' },
    { name: "Sharp 'N' Smart (NZ)", jockey: 'James McDonald', trainer: 'Graeme Rogerson' },
    { name: 'Mr Brightside', jockey: 'Craig Williams', trainer: 'Ben Hayes' },
    { name: 'Via Sistina (IRE)', jockey: 'Ms Jamie Kah (a2)', trainer: 'Chris Waller' },
  ],
};
const TERMS = ['Flemington', 'Cox Plate', 'Moonee Valley'];

let seq = 0;
function item(title: string, extra: Partial<NewsItem> = {}): NewsItem {
  seq++;
  return {
    id: extra.id ?? `n${seq}`,
    source: 'test',
    title,
    url: `https://example.test/${seq}`,
    mentions: [],
    sentiment: 0,
    relevance: 0,
    ...extra,
  };
}

describe('normaliseText', () => {
  it('lower-cases, drops apostrophes and collapses punctuation', () => {
    expect(normaliseText("Sharp 'N' Smart (NZ) — worked brilliantly!")).toBe('sharp n smart nz worked brilliantly');
    expect(normaliseText('')).toBe('');
  });
});

describe('scoreSentiment', () => {
  it('is positive for good news and negative for bad news', () => {
    expect(scoreSentiment('Worked brilliantly on Tuesday and trialled well').score).toBeGreaterThan(0);
    expect(scoreSentiment('Scratched after being found lame by the vet').score).toBeLessThan(0);
    expect(scoreSentiment('The race is at 3pm').score).toBe(0);
  });

  it('weights and clamps: a scratching outweighs a single mild positive', () => {
    const { score, hits } = scoreSentiment('Impressive gallop but late scratching this morning');
    expect(score).toBeLessThan(0);
    expect(hits.map((h) => h.phrase).sort()).toEqual(['impressive', 'late scratching']);
    expect(scoreSentiment('scratched withdrawn lame injured setback').score).toBe(-1);
    expect(scoreSentiment('worked brilliantly, stable confident, primed, dominant').score).toBe(1);
  });

  it('lets longer phrases claim their words first', () => {
    const { hits } = scoreSentiment('The stable confident of a big run');
    expect(hits).toHaveLength(1);
    expect(hits[0].phrase).toBe('stable confident');
    expect(hits[0].weight).toBe(1.5);
    const vet = scoreSentiment('Passed a vet check this morning');
    expect(vet.hits.map((h) => h.phrase)).toEqual(['passed a vet check']);
    expect(vet.score).toBeGreaterThan(0);
  });

  it('flips negated phrases: "no concerns" and "not a concern" read as positive', () => {
    const none = scoreSentiment('Trainer says there are no concerns');
    expect(none.score).toBeGreaterThan(0);
    expect(none.hits[0]).toMatchObject({ phrase: 'concerns', negated: true, weight: 0.5 });
    expect(scoreSentiment('The barrier is not a concern for the stable').score).toBeGreaterThan(0);
    expect(scoreSentiment("Isn't under a cloud").score).toBeGreaterThan(0);
    expect(scoreSentiment('Connections concerned, this is a concern').score).toBeLessThan(0);
  });

  it('negated positives read mildly negative', () => {
    const s = scoreSentiment('Stable not confident after a wide draw');
    expect(s.score).toBeLessThan(0);
    expect(s.hits.find((h) => h.phrase === 'confident')).toMatchObject({ negated: true, weight: -0.5 });
  });

  it('only looks back three words for a negation', () => {
    expect(scoreSentiment('No, the horse that worked this morning is scratched').score).toBeLessThan(0);
  });
});

describe('matchNews', () => {
  it('matches full horse names despite case, punctuation, possessives and country suffixes', () => {
    const items = [
      item("Pride Of Jenni's trainer confident ahead of the Cox Plate"),
      item('SHARP N SMART worked brilliantly at Flemington'),
      item("Sharp 'N' Smart (NZ) scratched after vet check"),
      item('Mr Brightside: no concerns says Hayes'),
      item('Via Sistina strolls around Moonee Valley'),
    ];
    const out = matchNews(items, RACE, TERMS);
    const byTitle = (t: string) => out.find((i) => i.title === t)!;

    expect(byTitle("Pride Of Jenni's trainer confident ahead of the Cox Plate").mentions).toEqual(['Pride Of Jenni']);
    expect(byTitle('SHARP N SMART worked brilliantly at Flemington').mentions).toEqual(["Sharp 'N' Smart (NZ)"]);
    expect(byTitle("Sharp 'N' Smart (NZ) scratched after vet check").mentions).toEqual(["Sharp 'N' Smart (NZ)"]);
    expect(byTitle('Mr Brightside: no concerns says Hayes').mentions).toEqual(['Mr Brightside']); // surname alone is not enough
    expect(byTitle('Via Sistina strolls around Moonee Valley').mentions).toEqual(['Via Sistina (IRE)']);
  });

  it('requires the full horse name as a phrase', () => {
    const out = matchNews([item('Pride parade through the city'), item('Smart money for the Cox Plate'), item('Jenni Of Pride wins')], RACE, TERMS);
    expect(out.map((i) => i.mentions)).toEqual([[]]); // only the Cox Plate item survives, with no horse mention
    expect(out[0].title).toBe('Smart money for the Cox Plate');
  });

  it('matches jockeys and trainers by full name or initial + surname', () => {
    const out = matchNews(
      [
        item('J. McDonald to ride in the Cox Plate'),
        item('James McDonald books five rides'),
        item('Ciaron Maher stable in great order'),
        item('Jamie Kah back from suspension'),
        item('McDonald wins again'), // surname only: no match
        item('Waller happy'), // surname only: no match
      ],
      RACE,
      TERMS,
    );
    const titles = out.map((i) => i.title);
    expect(titles).toContain('J. McDonald to ride in the Cox Plate');
    expect(titles).toContain('James McDonald books five rides');
    expect(titles).toContain('Ciaron Maher stable in great order');
    expect(titles).toContain('Jamie Kah back from suspension');
    expect(titles).not.toContain('McDonald wins again');
    expect(titles).not.toContain('Waller happy');
    expect(out.find((i) => i.title.startsWith('J. McDonald'))!.mentions).toEqual(['James McDonald']);
    expect(out.find((i) => i.title.startsWith('Jamie Kah'))!.mentions).toEqual(['Ms Jamie Kah (a2)']);
  });

  it('sets sentiment sign and relevance tiers', () => {
    const out = matchNews(
      [
        item("Pride Of Jenni's trainer confident ahead of the Cox Plate"), // horse + term
        item("Sharp 'N' Smart (NZ) scratched after vet check"), // horse only, negative
        item('J. McDonald to ride in the Cox Plate'), // person + term
        item('Ciaron Maher stable in great order'), // person only
        item('Moonee Valley track rated Good 4'), // term only
        item('Weather forecast for Sydney'), // nothing
      ],
      RACE,
      TERMS,
    );
    const rel = Object.fromEntries(out.map((i) => [i.title, i.relevance]));
    expect(rel["Pride Of Jenni's trainer confident ahead of the Cox Plate"]).toBe(0.95);
    expect(rel["Sharp 'N' Smart (NZ) scratched after vet check"]).toBe(0.85);
    expect(rel['J. McDonald to ride in the Cox Plate']).toBe(0.65);
    expect(rel['Ciaron Maher stable in great order']).toBe(0.55);
    expect(rel['Moonee Valley track rated Good 4']).toBe(0.4);
    expect(rel['Weather forecast for Sydney']).toBeUndefined();

    const sent = Object.fromEntries(out.map((i) => [i.title, i.sentiment]));
    expect(sent["Pride Of Jenni's trainer confident ahead of the Cox Plate"]).toBeGreaterThan(0);
    expect(sent["Sharp 'N' Smart (NZ) scratched after vet check"]).toBeLessThan(0);
    expect(sent['Ciaron Maher stable in great order']).toBeGreaterThan(0);
    expect(sent['Moonee Valley track rated Good 4']).toBe(0);
  });

  it('uses the snippet as well as the title', () => {
    const out = matchNews([item('Stable update', { snippet: 'Mr Brightside worked brilliantly this morning.' })], RACE, TERMS);
    expect(out).toHaveLength(1);
    expect(out[0].mentions).toEqual(['Mr Brightside']);
    expect(out[0].sentiment).toBeGreaterThan(0);
  });

  it('orders by relevance then recency, and de-duplicates by normalised title', () => {
    const out = matchNews(
      [
        item('Moonee Valley track rated Good 4', { id: 'mv', publishedAt: '2026-10-22T01:00:00Z' }),
        item("Pride Of Jenni's trainer confident ahead of the Cox Plate", { id: 'older', publishedAt: '2026-10-21T01:00:00Z' }),
        item('Mr Brightside flying', { id: 'flying', publishedAt: '2026-10-22T02:00:00Z' }),
        item("pride of jenni's trainer confident ahead of the cox plate!", { id: 'newer', publishedAt: '2026-10-22T03:00:00Z' }),
        item('Mr Brightside primed', { id: 'primed', publishedAt: '2026-10-22T09:00:00Z' }),
        item('Mr Brightside in great order', { id: 'undated' }), // no date: sorts after dated items of equal relevance
      ],
      RACE,
      TERMS,
    );
    expect(out.map((i) => i.id)).toEqual(['newer', 'primed', 'flying', 'undated', 'mv']);
    expect(out.filter((i) => i.title.toLowerCase().startsWith('pride of jenni'))).toHaveLength(1);
    for (let i = 1; i < out.length; i++) expect(out[i - 1].relevance).toBeGreaterThanOrEqual(out[i].relevance);
  });

  it('does not mutate the input items and accepts a full Race-shaped runners array', () => {
    const src = item('Mr Brightside flying');
    const out = matchNews([src], { runners: [{ name: 'Mr Brightside' }] }, []);
    expect(src.mentions).toEqual([]);
    expect(src.relevance).toBe(0);
    expect(out[0].mentions).toEqual(['Mr Brightside']);
    expect(matchNews([], RACE, TERMS)).toEqual([]);
  });
});

describe('recencyWeight', () => {
  const now = new Date('2026-10-23T00:00:00Z');
  it('decays linearly over seven days to a floor', () => {
    expect(recencyWeight('2026-10-23T00:00:00Z', now)).toBe(1);
    expect(recencyWeight('2026-10-24T00:00:00Z', now)).toBe(1); // future-dated
    expect(recencyWeight('2026-10-19T12:00:00Z', now)).toBe(0.5);
    expect(recencyWeight('2026-10-01T00:00:00Z', now)).toBe(0.15);
    expect(recencyWeight(undefined, now)).toBe(1);
    expect(recencyWeight('2026-10-01T00:00:00Z', undefined)).toBe(1);
    expect(recencyWeight('garbage', now)).toBe(1);
  });
});

describe('newsFactorForRunner', () => {
  const now = new Date('2026-10-23T00:00:00Z');

  it('is empty with no mentions', () => {
    expect(newsFactorForRunner([], 'Mr Brightside')).toEqual({ score: 0, evidence: 'No news mentions', dataQuality: 0 });
    const other = matchNews([item('Mr Brightside flying')], RACE, TERMS);
    expect(newsFactorForRunner(other, 'Pride Of Jenni').dataQuality).toBe(0);
  });

  it('summarises positive coverage with an excerpt of the strongest phrase', () => {
    const items = matchNews(
      [
        item('Mr Brightside worked brilliantly at Flemington on Tuesday', { publishedAt: '2026-10-22T20:00:00Z' }),
        item('Mr Brightside primed for the Cox Plate', { publishedAt: '2026-10-22T10:00:00Z' }),
        item('Hayes says Mr Brightside is in great order', { publishedAt: '2026-10-21T10:00:00Z' }),
      ],
      RACE,
      TERMS,
    );
    const f = newsFactorForRunner(items, 'Mr Brightside', now);
    expect(f.score).toBeGreaterThan(0.3);
    expect(f.score).toBeLessThanOrEqual(1);
    expect(f.evidence).toBe("3 items, mostly positive: 'worked brilliantly…'");
    expect(f.dataQuality).toBeGreaterThan(0.8);
    expect(f.dataQuality).toBeLessThanOrEqual(1);
  });

  it('matches the runner name tolerantly and weights conflicting items by relevance', () => {
    const items = matchNews(
      [item('SHARP N SMART worked brilliantly at Flemington'), item("Sharp 'N' Smart (NZ) scratched after vet check")],
      RACE,
      TERMS,
    );
    const f = newsFactorForRunner(items, 'sharp n smart');
    expect(f.score).toBeLessThan(0); // the scratching (-1) outweighs the gallop (+0.5) even at lower relevance
    expect(f.evidence).toContain('2 items, mixed');
    expect(f.evidence).toContain("'scratched…'");
    expect(f.dataQuality).toBe(0.7);
  });

  it('lets recency decide when `now` is supplied', () => {
    const items = matchNews(
      [
        item('Mr Brightside flying', { publishedAt: '2026-10-22T23:00:00Z' }),
        item('Mr Brightside disappointing', { publishedAt: '2026-10-16T23:00:00Z' }),
      ],
      RACE,
      TERMS,
    );
    const timeless = newsFactorForRunner(items, 'Mr Brightside');
    const dated = newsFactorForRunner(items, 'Mr Brightside', now);
    expect(timeless.score).toBeLessThanOrEqual(0); // equal weights: 'disappointing' (1.2) edges 'flying' (1.0)
    expect(dated.score).toBeGreaterThan(0); // the week-old negative item is down-weighted to the floor
    expect(dated.dataQuality).toBeLessThan(timeless.dataQuality);
  });

  it('scales dataQuality with item count', () => {
    const mk = (n: number) => matchNews(Array.from({ length: n }, (_, i) => item(`Mr Brightside update ${i}`)), RACE, TERMS);
    expect(newsFactorForRunner(mk(1), 'Mr Brightside').dataQuality).toBe(0.5);
    expect(newsFactorForRunner(mk(3), 'Mr Brightside').dataQuality).toBe(0.9);
    expect(newsFactorForRunner(mk(5), 'Mr Brightside').dataQuality).toBe(1);
    const neutral = newsFactorForRunner(mk(2), 'Mr Brightside');
    expect(neutral.score).toBe(0);
    expect(neutral.evidence).toMatch(/^2 items, neutral: 'Mr Brightside update/);
  });

  it('reports mostly negative coverage', () => {
    const items = matchNews([item('Mr Brightside scratched'), item('Mr Brightside under a cloud'), item('Mr Brightside fit')], RACE, TERMS);
    const f = newsFactorForRunner(items, 'Mr Brightside');
    expect(f.score).toBeLessThan(0);
    expect(f.evidence).toContain('3 items, mostly negative');
  });
});
