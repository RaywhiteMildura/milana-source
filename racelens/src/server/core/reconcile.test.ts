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

describe('race name clean-up', () => {
  it('strips a leading race-number prefix from source race names', () => {
    const r = reconcileRace([
      { source: 'official', weight: 1, race: race('official', [{ number: 1, name: 'A' }], { name: 'R9 Demo Plate' }) },
      { source: 'odds', weight: 0.65, race: race('odds', [{ number: 1, name: 'A' }], { name: 'Race 9 - Demo Plate' }) },
    ]);
    expect(r.name).toBe('Demo Plate');
    expect(r.verification.conflicts).toHaveLength(0);
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
      { source: 'form', weight: 0.85, race: race('form', [{ number: 1, name: 'A', odds: [{ source: 'form', bookmaker: 'Z', type: 'fixed', win: 2.6, fetchedAt: 't2' }] }], { fetchedAt: '2026-10-24T05:00:00.000Z', trackRating: undefined, startTime: undefined }) },
    ]);
    const merged: Race = mergeRaceRefresh({ ...previous, trackRating: 4, startTime: '2026-10-24T01:00:00.000Z' }, fresh);
    const a = merged.runners.find((r) => r.name === 'A')!;
    expect(a.form).toHaveLength(1);
    expect(a.odds[0].win).toBe(2.6);
    const b = merged.runners.find((r) => r.name === 'B')!;
    expect(b.scratched).toBe(true); // the source that listed B answered and dropped it
    expect(merged.fieldSize).toBe(1);
    expect(merged.fetchedAt).toBe('2026-10-24T05:00:00.000Z');
    expect(merged.trackRating).toBe(4); // researched facts survive a refresh that lacks them
    expect(merged.startTime).toBe('2026-10-24T01:00:00.000Z');
  });

  it('does not scratch a runner just because a different source did not list it, and does not un-scratch on one source', () => {
    const previous = reconcileRace([
      { source: 'official', weight: 1, race: race('official', [{ number: 1, name: 'A' }, { number: 2, name: 'B', scratched: true }, { number: 3, name: 'C' }]) },
    ]);
    const fresh = reconcileRace([{ source: 'odds', weight: 0.65, race: race('odds', [{ number: 1, name: 'A' }, { number: 2, name: 'B', scratched: false }]) }]);
    const merged = mergeRaceRefresh(previous, fresh);
    const c = merged.runners.find((r) => r.name === 'C')!;
    expect(c.scratched).toBe(false); // 'official' did not respond, so C is simply unchanged
    expect(c.verification.conflicts.join(' ')).toMatch(/Not covered/);
    const b = merged.runners.find((r) => r.name === 'B')!;
    expect(b.scratched).toBe(true); // one bookmaker showing it running does not reinstate it
    expect(b.verification.conflicts.join(' ')).toMatch(/Still treated as scratched/);
    // Two fresh sources agreeing do reinstate it
    const fresh2 = reconcileRace([
      { source: 'odds', weight: 0.65, race: race('odds', [{ number: 2, name: 'B', scratched: false }]) },
      { source: 'form', weight: 0.85, race: race('form', [{ number: 2, name: 'B', scratched: false }]) },
    ]);
    expect(mergeRaceRefresh(previous, fresh2).runners.find((r) => r.name === 'B')!.scratched).toBe(false);
  });
});

describe('source priority and sticky scratchings', () => {
  it('breaks equal-weight ties by a fixed source order, not arrival order', () => {
    const a = { source: 'sportsbet', weight: 0.65, race: race('sportsbet', [{ number: 1, name: 'A', barrier: 5 }]) };
    const b = { source: 'tab', weight: 0.65, race: race('tab', [{ number: 1, name: 'A', barrier: 6 }]) };
    expect(reconcileRace([a, b]).runners[0].barrier).toBe(6);
    expect(reconcileRace([b, a]).runners[0].barrier).toBe(6);
  });
  it('keeps a horse scratched when an equal-weight source still shows it running, but lets a heavier source overrule', () => {
    const scratchedByTab = { source: 'tab', weight: 0.65, race: race('tab', [{ number: 1, name: 'A', scratched: true }]) };
    const runningBySb = { source: 'sportsbet', weight: 0.65, race: race('sportsbet', [{ number: 1, name: 'A', scratched: false }]) };
    expect(reconcileRace([runningBySb, scratchedByTab]).runners[0].scratched).toBe(true);
    const runningOfficial = { source: 'official', weight: 1, race: race('official', [{ number: 1, name: 'A', scratched: false }]) };
    expect(reconcileRace([scratchedByTab, runningOfficial]).runners[0].scratched).toBe(false);
  });
  it('keeps similarly named horses with different numbers apart, and matches trainer partnerships', () => {
    const r = reconcileRace([
      { source: 'tab', weight: 0.65, race: race('tab', [{ number: 1, name: 'Mr Brightside', trainer: 'C Maher' }]) },
      { source: 'sportsbet', weight: 0.65, race: race('sportsbet', [{ number: 2, name: 'Mrs Brightside', trainer: 'C. Maher & D. Eustace' }, { number: 1, name: 'Mr Brightside', trainer: 'C. Maher & D. Eustace' }]) },
    ]);
    expect(r.runners).toHaveLength(2);
    const mr = r.runners.find((x) => x.number === 1)!;
    expect(mr.fields.trainer.disagree).toHaveLength(0);
    expect(mr.trainer).toBe('C. Maher & D. Eustace');
  });
});
