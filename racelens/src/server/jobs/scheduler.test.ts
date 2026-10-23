import { describe, expect, it } from 'vitest';
import type { MeetingPack, Race } from '../../shared/types.js';
import { AutoRecheckScheduler } from './scheduler.js';
import { DEFAULT_SETTINGS } from '../store/store.js';

function race(number: number, startIso: string, over: Partial<Race> = {}): Race {
  return { number, name: `R${number}`, distance: 1200, startTime: startIso, status: 'open', sourceRefs: {}, runners: [], sources: [], verification: { score: 1, sourceCount: 1, conflicts: [], checkedFields: 0, agreedFields: 0 }, fieldSize: 0, fetchedAt: startIso, ...over };
}

function pack(races: Race[], results: MeetingPack['results'] = {}): MeetingPack {
  return { id: 'p', createdAt: 't', updatedAt: 't', meeting: { id: 'p', date: '2026-10-24', venue: 'Flemington', venueSlug: 'flemington', raceType: 'thoroughbred', sourceRefs: {}, sources: [] }, races, predictions: {}, news: [], sourceStatuses: [], dayPatterns: [], results, history: [], verificationScore: 1, settings: DEFAULT_SETTINGS };
}

describe('AutoRecheckScheduler.dueRaces', () => {
  const sched = new AutoRecheckScheduler({ store: {} as never, jobs: {} as never, researchDeps: () => ({}) as never });
  const now = new Date('2026-10-24T03:00:00.000Z');

  it('picks races inside the window once, and again in the final minutes', () => {
    const p = pack([race(1, '2026-10-24T02:30:00.000Z'), race(2, '2026-10-24T03:08:00.000Z'), race(3, '2026-10-24T03:40:00.000Z'), race(4, '2026-10-24T03:05:00.000Z')], { 4: { raceNumber: 4, placings: [[1]], recordedAt: 't', source: 'x' } });
    expect(sched.dueRaces(p, now, 10)).toEqual([2]); // R1 jumped, R3 too far, R4 already resulted
    // Simulate having run it
    (sched as unknown as { lastRun: Map<string, string> }).lastRun.set('p:2', now.toISOString());
    expect(sched.dueRaces(p, new Date('2026-10-24T03:01:00.000Z'), 10)).toEqual([]);
    // Final 3 minutes: one more check
    expect(sched.dueRaces(p, new Date('2026-10-24T03:05:30.000Z'), 10)).toEqual([2]);
  });

  it('is disabled when minutes is 0 and ignores abandoned races', () => {
    const p = pack([race(1, '2026-10-24T03:05:00.000Z'), race(2, '2026-10-24T03:06:00.000Z', { status: 'abandoned' })]);
    expect(sched.dueRaces(p, now, 0)).toEqual([]);
    expect(sched.dueRaces(p, now, 10)).toEqual([1]);
  });
});
