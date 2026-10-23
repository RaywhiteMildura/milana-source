import { describe, expect, it } from 'vitest';
import type { MeetingSummary } from '../../shared/types.js';
import { buildNewsQueries, mergeMeetingSummaries } from './research.js';

const meeting: MeetingSummary = { id: '2026-10-24:flemington', date: '2026-10-24', venue: 'Flemington', venueSlug: 'flemington', raceType: 'thoroughbred', sourceRefs: {}, sources: [] };

describe('buildNewsQueries', () => {
  it('groups runners into OR queries and adds feature races', () => {
    const races = [
      { name: 'R1 Maiden Plate', group: undefined, runners: Array.from({ length: 8 }, (_, i) => ({ name: `Horse ${i + 1}`, scratched: i === 7 })) },
      { name: 'Ladbrokes Cox Plate', group: 'G1', runners: [{ name: 'Aeliana', scratched: false }, { name: 'Horse 1', scratched: false }] },
    ];
    const qs = buildNewsQueries(meeting, races as never, 6);
    expect(qs[0]).toBe('Flemington races 2026-10-24');
    expect(qs).toContain('Ladbrokes Cox Plate');
    expect(qs).not.toContain('R1 Maiden Plate');
    const groups = qs.filter((q) => q.includes(' OR '));
    expect(groups).toHaveLength(2); // 8 unique names (7 + Aeliana) → 6 + 2
    expect(groups[0].split(' OR ')).toHaveLength(6);
    expect(qs.join(' ')).not.toContain('Horse 8'); // scratched runner excluded
    expect(qs.join(' ').match(/"Horse 1"/g)).toHaveLength(1); // deduped across races
  });
});

describe('mergeMeetingSummaries', () => {
  it('merges the same venue from several sources and keeps the richest fields', () => {
    const merged = mergeMeetingSummaries([
      { source: 'tab', meetings: [{ ...meeting, trackCondition: 'Good 4', trackRating: 4, sourceRefs: { tab: 'R/FLM' } }] },
      { source: 'sportsbet', meetings: [{ ...meeting, id: 'x', venue: 'Flemington', venueSlug: 'flemington', rail: '+3m', sourceRefs: { sportsbet: '356|1|' } }] },
      { source: 'tab', meetings: [{ ...meeting, id: 'y', venue: 'Flemington', raceType: 'greyhound', sourceRefs: {} }] },
    ]);
    expect(merged).toHaveLength(2);
    const flem = merged.find((m) => m.raceType === 'thoroughbred')!;
    expect(flem.sources).toEqual(['tab', 'sportsbet']);
    expect(flem.sourceRefs).toEqual({ tab: 'R/FLM', sportsbet: '356|1|' });
    expect(flem.trackRating).toBe(4);
    expect(flem.rail).toBe('+3m');
    expect(flem.id).toBe('2026-10-24:flemington');
  });
});
