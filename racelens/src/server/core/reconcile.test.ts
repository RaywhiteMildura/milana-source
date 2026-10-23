import { describe, expect, it } from 'vitest';
import type { MeetingRaw, MeetingSummary, Race, RaceRaw, RunnerRaw } from '../../shared/types.js';
import { clusterRunners, mergeRaceRefresh, reconcileMeeting, reconcileRace, similarity } from './reconcile.js';

const meeting: MeetingSummary = {
  id: '2026-10-24:flemington',
  date: '2026-10-24',
  venue: 'Flemington',
  venueSlug: 'flemington',
  raceType: 'thoroughbred',
  sourceRefs: {},
  sources: [],
};

function race(source: string, runners: RunnerRaw[], extra: Partial<RaceRaw> = {}): RaceRaw {
  return {
    number: 1,
    name: 'Test Stakes',
    distance: 1200,
    status: 'open',
    sourceRefs: {},
    runners,
    source,
    fetchedAt: '2026-10-24T00:00:00.000Z',
    ...extra,
  };
}

function raw(source: string, races: RaceRaw[]): MeetingRaw {
  return { meeting, races, source, fetchedAt: '2026-10-24T00:00:00.000Z' };
}

const sources = [
  { id: 'official', kind: 'official' as const },
  { id: 'form', kind: 'form' as const },
  { id: 'odds', kind: 'odds' as const },
];

describe('similarity', () => {
  it('scores identical and near-identical names high', () => {
    expect(similarity('hells bells', 'hells bells')).toBe(1);
    expect(similarity('hells bells', 'hell s bells')).toBeGreaterThan(0.8);
    expect(similarity('aeliana', 'sir delius')).toBeLessThan(0.3);
  });
});

describe('clusterRunners', () => {
  it('merges the same horse across sources despite country suffix and apostrophes', () => {
    const clusters = clusterRunners([
      { source: 'official', weight: 1, runners: [{ number: 1, name: "Hell's Bells" }, { number: 2, name: 'Aeliana' }] },
      { source: 'form', weight: 0.85, runners: [{ number: 1, name: 'Hells Bells' }, { number: 2, name: 'Aeliana (NZ)' }] },
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.members.length === 2)).toBe(true);
  });

  it('does not merge different horses with the same number', () => {
    const clusters = clusterRunners([
      { source: 'official', weight: 1, runners: [{ number: 3, name: 'Fast Lane' }] },
      { source: 'odds', weight: 0.65, runners: [{ number: 3, name: 'Slow Burner' }] },
    ]);
    expect(clusters).toHaveLength(2);
  });
});

describe('reconcileRace', () => {
  it('records agreement and conflicts per field, weighting official sources', () => {
    const r = reconcileRace([
      { source: 'official', weight: 1, race: race('official', [{ number: 1, name: 'Aeliana', barrier: 10, jockey: 'James McDonald', trainer: 'Ciaron Maher', weight: 57 }]) },
      { source: 'form', weight: 0.85, race: race('form', [{ number: 1, name: 'Aeliana', barrier: 10, jockey: 'J. McDonald', trainer: 'C. Maher', weight: 57 }]) },
      { source: 'odds', weight: 0.65, race: race('odds', [{ number: 1, name: 'Aeliana', barrier: 11, jockey: 'James McDonald', weight: 57.5 }]) },
    ]);
    const a = r.runners[0];
    expect(a.barrier).toBe(10);
    expect(a.fields.barrier.agree).toEqual(['official', 'form']);
    expect(a.fields.barrier.disagree).toEqual([{ source: 'odds', value: 11 }]);
    expect(a.jockey).toBe('James McDonald');
    expect(a.fields.jockey.disagree).toHaveLength(0); // initial vs full name treated as same person
    expect(a.weight).toBe(57);
    expect(a.verification.conflicts.some((c) => c.startsWith('Barrier'))).toBe(true);
    expect(a.verification.conflicts.some((c) => c.startsWith('Weight'))).toBe(true);
    expect(a.verification.sourceCount).toBe(3);
    expect(a.verification.score).toBeGreaterThan(0.6);
    expect(a.verification.score).toBeLessThan(0.95);
  });

  it('marks a runner scratched when an official source says so even if odds sources still list it', () => {
    const r = reconcileRace([
      { source: 'official', weight: 1, race: race('official', [{ number: 4, name: 'Late Out', scratched: true }]) },
      { source: 'odds', weight: 0.65, race: race('odds', [{ number: 4, name: 'Late Out', scratched: false }]) },
    ]);
    expect(r.runners[0].scratched).toBe(true);
    expect(r.fieldSize).toBe(0);
  });

  it('gives single-source runners lower verification', () => {
    const r = reconcileRace([
      { source: 'official', weight: 1, race: race('official', [{ number: 1, name: 'Solo', barrier: 1, jockey: 'A B', weight: 55 }, { number: 2, name: 'Duo', barrier: 2, jockey: 'C D', weight: 55 }]) },
      { source: 'form', weight: 0.85, race: race('form', [{ number: 2, name: 'Duo', barrier: 2, jockey: 'C D', weight: 55 }]) },
    ]);
    const solo = r.runners.find((x) => x.name === 'Solo')!;
    const duo = r.runners.find((x) => x.name === 'Duo')!;
    expect(solo.verification.score).toBeLessThan(duo.verification.score);
    expect(solo.verification.sourceCount).toBe(1);
  });

  it('merges form lines without duplicates and concatenates odds', () => {
    const line = { date: '2026-10-03', venue: 'Caulfield', distance: 1400, position: 1, starters: 12 };
    const r = reconcileRace([
      { source: 'form', weight: 0.85, race: race('form', [{ number: 1, name: 'X', form: [line, { ...line, date: '2026-09-12', position: 3 }], odds: [{ source: 'form', bookmaker: 'Tote', type: 'tote', win: 4.5, fetchedAt: 't' }] }]) },
      { source: 'odds', weight: 0.65, race: race('odds', [{ number: 1, name: 'X', form: [line], odds: [{ source: 'odds', bookmaker: 'BookieA', type: 'fixed', win: 4.2, fetchedAt: 't' }] }]) },
    ]);
    expect(r.runners[0].form).toHaveLength(2);
    expect(r.runners[0].form[0].date).toBe('2026-10-03');
    expect(r.runners[0].odds).toHaveLength(2);
  });

  it('promotes race status to the most advanced and carries results', () => {
    const r = reconcileRace([
      { source: 'official', weight: 1, race: race('official', [{ number: 1, name: 'A' }, { number: 2, name: 'B' }], { status: 'final', results: [[2], [1]] }) },
      { source: 'odds', weight: 0.65, race: race('odds', [{ number: 1, name: 'A' }, { number: 2, name: 'B' }], { status: 'open' }) },
    ]);
    expect(r.status).toBe('final');
    expect(r.results).toEqual([[2], [1]]);
  });
});

describe('reconcileMeeting', () => {
  it('aligns races by number across sources and computes meeting verification', () => {
    const m = reconcileMeeting(
      [
        raw('official', [race('official', [{ number: 1, name: 'A', barrier: 1 }]), { ...race('official', [{ number: 1, name: 'B', barrier: 2 }]), number: 2 }]),
        raw('form', [race('form', [{ number: 1, name: 'A', barrier: 1 }])]),
      ],
      { sources },
    );
    expect(m.races.map((r) => r.number)).toEqual([1, 2]);
    expect(m.races[0].sources).toEqual(['official', 'form']);
    expect(m.races[1].sources).toEqual(['official']);
    expect(m.verification.score).toBeGreaterThan(0);
    expect(m.sources).toEqual(['official', 'form']);
  });
});

describe('mergeRaceRefresh', () => {
  it('keeps deep form from the original research while taking fresh odds and scratchings', () => {
    const previous = reconcileRace([
      { source: 'form', weight: 0.85, race: race('form', [{ number: 1, name: 'A', form: [{ date: '2026-10-01', venue: 'X', distance: 1200, position: 1, starters: 8 }], odds: [{ source: 'form', bookmaker: 'T', type: 'tote', win: 3, fetchedAt: 't' }] }, { number: 2, name: 'B' }]) },
    ]);
    const fresh = reconcileRace([
      { source: 'odds', weight: 0.65, race: race('odds', [{ number: 1, name: 'A', odds: [{ source: 'odds', bookmaker: 'Z', type: 'fixed', win: 2.6, fetchedAt: 't2' }] }], { fetchedAt: '2026-10-24T05:00:00.000Z' }) },
    ]);
    const merged: Race = mergeRaceRefresh(previous, fresh);
    const a = merged.runners.find((r) => r.name === 'A')!;
    expect(a.form).toHaveLength(1);
    expect(a.odds[0].win).toBe(2.6);
    const b = merged.runners.find((r) => r.name === 'B')!;
    expect(b.scratched).toBe(true);
    expect(merged.fieldSize).toBe(1);
    expect(merged.fetchedAt).toBe('2026-10-24T05:00:00.000Z');
  });
});
