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

const FIELD = ['Alpine Echo', 'Brave Lass', 'Copper Coast', 'Dusty Road', 'Ember Glow', 'Flying Kite', 'Golden Mile', 'Harbour Lights'];
const field = (over: (r: RunnerRaw, i: number) => Partial<RunnerRaw> = () => ({})): RunnerRaw[] =>
  FIELD.map((name, i) => {
    const r: RunnerRaw = { number: i + 1, name, barrier: i + 1 };
    return { ...r, ...over(r, i) };
  });
const ra = (runners: RunnerRaw[]) => ({ source: 'racingaustralia', weight: 1, race: race('racingaustralia', runners) });
const rc = (runners: RunnerRaw[]) => ({ source: 'racingcom', weight: 1, race: race('racingcom', runners) });
const bookie = (source: 'tab' | 'sportsbet' | 'entain', runners: RunnerRaw[]) => ({ source, weight: 0.65, race: race(source, runners) });

describe('form lines across sources that spell tracks differently', () => {
  it('keeps one line per race date, newest first, with the official spelling and gaps filled', () => {
    const r = reconcileRace([
      bookie('sportsbet', [
        {
          number: 1,
          name: 'X',
          form: [
            { date: '2026-08-30', venue: 'Randwick', distance: 1300, position: 5, starters: 14, raceClass: 'BM78' },
            { date: '2026-09-20', venue: 'Moonee Valley', distance: 1200, position: 1, starters: 9, raceClass: 'BM70' },
            { date: '2026-10-10', venue: 'Sandown', distance: 1400, position: 2, starters: 10, raceClass: 'BM84' },
          ],
        },
      ]),
      rc([
        {
          number: 1,
          name: 'X',
          form: [
            { date: '2026-10-10', venue: 'Sandown Lakeside', distance: 1400, position: 2, starters: 10, margin: 0.5, startingPrice: 6, inRunning: '4-3' },
            { date: '2026-09-20', venue: 'The Valley', distance: 1200, position: 1, starters: 9, margin: 0, startingPrice: 3.2 },
            { date: '2026-08-30', venue: 'Royal Randwick', distance: 1300, position: 5, starters: 14, margin: 4.1 },
          ],
        },
      ]),
      ra([
        {
          number: 1,
          name: 'X',
          form: [
            { date: '2026-10-10', venue: 'SAND', distance: 1400, position: 2, starters: 10 },
            { date: '2026-09-20', venue: 'Moonee Valley', distance: 1200, position: 1, starters: 9 },
            { date: '2026-08-30', venue: 'Randwick', distance: 0, position: 5, starters: 0 },
          ],
        },
      ]),
    ]);
    const form = r.runners[0].form;
    expect(form).toHaveLength(3);
    expect(form.map((f) => f.date)).toEqual(['2026-10-10', '2026-09-20', '2026-08-30']);
    expect(form.map((f) => f.venue)).toEqual(['SAND', 'Moonee Valley', 'Randwick']); // heaviest source's spelling
    expect(form.every((f) => f.source === 'racingaustralia')).toBe(true);
    expect(form[0]).toMatchObject({ margin: 0.5, startingPrice: 6, inRunning: '4-3', raceClass: 'BM84' }); // filled from lighter sources
    expect(form[2]).toMatchObject({ distance: 1300, starters: 14 }); // 0 = unknown, so filled too
  });

  it('keeps one line for a date even when distances disagree, and does not mix in the far-out line', () => {
    const r = reconcileRace([
      ra([{ number: 1, name: 'X', form: [{ date: '2026-10-10', venue: 'Flemington', distance: 1200, position: 3, starters: 12 }] }]),
      bookie('sportsbet', [{ number: 1, name: 'X', form: [{ date: '2026-10-10', venue: 'Flemington', distance: 1600, position: 3, starters: 12, margin: 2 }] }]),
    ]);
    expect(r.runners[0].form).toHaveLength(1);
    expect(r.runners[0].form[0].distance).toBe(1200);
    expect(r.runners[0].form[0].margin).toBeUndefined();
  });

  it('still separates undated lines by venue and distance', () => {
    const r = reconcileRace([
      ra([{ number: 1, name: 'X', form: [{ date: '', venue: 'Flemington', distance: 1200, position: 3, starters: 12 }, { date: '', venue: 'Caulfield', distance: 1400, position: 1, starters: 9 }] }]),
    ]);
    expect(r.runners[0].form).toHaveLength(2);
  });
});

describe('scratchings against an official source still showing the horse', () => {
  const vote = (scratched: boolean) => [{ number: 1, name: 'Late Out', scratched }];
  it('scratches when three bookmakers report it, even though Racing Australia still shows it running', () => {
    const r = reconcileRace([ra(vote(false)), bookie('tab', vote(true)), bookie('sportsbet', vote(true)), bookie('entain', vote(true))]);
    const a = r.runners[0];
    expect(a.scratched).toBe(true);
    expect(a.fields.scratched.value).toBe(true);
    expect(a.verification.conflicts.some((c) => c.startsWith('Scratching') && c.includes('racingaustralia says running'))).toBe(true);
    expect(r.fieldSize).toBe(0);
  });

  it('scratches on two bookmakers against an official running', () => {
    expect(reconcileRace([ra(vote(false)), bookie('tab', vote(true)), bookie('entain', vote(true))]).runners[0].scratched).toBe(true);
  });

  it('keeps the horse running when only one bookmaker reports it scratched, but lists the conflict', () => {
    const a = reconcileRace([ra(vote(false)), bookie('tab', vote(true)), bookie('sportsbet', vote(false))]).runners[0];
    expect(a.scratched).toBe(false);
    expect(a.verification.conflicts.some((c) => c.startsWith('Scratching') && c.includes('tab says scratched'))).toBe(true);
  });

  it('scratches when one official source reports it, whatever the other official source says', () => {
    const a = reconcileRace([ra(vote(false)), rc(vote(true))]).runners[0];
    expect(a.scratched).toBe(true);
    expect(a.fields.scratched).toMatchObject({ value: true, agree: ['racingcom'], disagree: [{ source: 'racingaustralia', value: false }] });
    expect(a.verification.conflicts.some((c) => c.startsWith('Scratching'))).toBe(true);
  });
});

describe('a source answering with a different race', () => {
  const OTHER = ['Ironbark', 'Jasper Bay', 'Kingfisher', 'Lunar Tide', 'Mystic Rain', 'Northern Sky', 'Opal Dream', 'Pacific Gale'];
  it('ignores a bookmaker whose field does not match, instead of merging a second field', () => {
    const r = reconcileRace([ra(field()), rc(field()), bookie('sportsbet', OTHER.map((name, i) => ({ number: i + 1, name, barrier: i + 1 })))]);
    expect(r.runners).toHaveLength(8);
    expect(r.runners.map((x) => x.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r.runners.map((x) => x.name)).toEqual(FIELD);
    expect(r.sources).toEqual(['racingaustralia', 'racingcom']);
    expect(r.verification.conflicts).toContain('sportsbet listed a different field – ignored');
    expect(r.fieldSize).toBe(8);
  });

  it('still merges a source that has one extra runner (a late addition)', () => {
    const tab = [...field().slice(0, 7), { number: 9, name: 'Quiet Achiever', barrier: 9 }];
    const r = reconcileRace([ra(field()), rc(field()), bookie('tab', tab)]);
    expect(r.runners).toHaveLength(9);
    expect(r.sources).toContain('tab');
    expect(r.runners.find((x) => x.name === 'Quiet Achiever')!.number).toBe(9);
    expect(r.verification.conflicts.some((c) => c.includes('different field'))).toBe(false);
  });

  it('leaves out a runner only one source lists when its saddlecloth belongs to another horse', () => {
    const three = [{ number: 1, name: 'Alpine Echo' }, { number: 2, name: 'Brave Lass' }, { number: 3, name: 'Copper Coast' }];
    const r = reconcileRace([ra(three), rc(three), bookie('tab', [three[0], { number: 2, name: 'Stray Cat' }, three[2]])]);
    expect(r.runners.map((x) => x.name)).toEqual(['Alpine Echo', 'Brave Lass', 'Copper Coast']);
    expect(r.runners.every((x) => x.number > 0)).toBe(true);
    expect(r.verification.conflicts.some((c) => c.includes('Stray Cat') && c.includes('left out'))).toBe(true);
  });
});

describe('barriers renumbered after a scratching', () => {
  // #3 (barrier 3) is scratched: TAB and Racing Australia keep the original draw, Entain moves everyone outside it in one.
  const original = () => field((r) => (r.number === 3 ? { scratched: true } : {}));
  const renumbered = () => field((r) => (r.number === 3 ? { scratched: true, barrier: undefined } : r.barrier! > 3 ? { barrier: r.barrier! - 1 } : {}));

  it('raises no barrier conflicts and shows the original draw', () => {
    const r = reconcileRace([ra(original()), bookie('tab', original()), bookie('entain', renumbered())]);
    expect(r.runners.flatMap((x) => x.verification.conflicts).filter((c) => c.startsWith('Barrier'))).toEqual([]);
    expect(r.runners.map((x) => x.barrier)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r.runners.find((x) => x.number === 8)!.fields.barrier.agree).toEqual(['racingaustralia', 'tab', 'entain']);
  });

  it("prefers the original draw over racing.com's live barrier when Racing Australia is missing", () => {
    const r = reconcileRace([rc(renumbered()), bookie('tab', original())]);
    expect(r.runners.find((x) => x.number === 8)!.barrier).toBe(8);
    expect(r.runners.flatMap((x) => x.verification.conflicts).filter((c) => c.startsWith('Barrier'))).toEqual([]);
  });

  it('still flags a barrier that differs by more than the scratchings inside it', () => {
    const wrong = renumbered().map((r) => (r.number === 8 ? { ...r, barrier: 5 } : r));
    const r = reconcileRace([ra(original()), bookie('tab', original()), bookie('entain', wrong)]);
    expect(r.runners.find((x) => x.number === 8)!.verification.conflicts.some((c) => c.startsWith('Barrier'))).toBe(true);
    // A scratching drawn outside a runner gives no slack: #2 drawn 2 must match exactly.
    const r2 = reconcileRace([ra(original()), bookie('entain', renumbered().map((x) => (x.number === 2 ? { ...x, barrier: 1 } : x)))]);
    expect(r2.runners.find((x) => x.number === 2)!.verification.conflicts.some((c) => c.startsWith('Barrier'))).toBe(true);
  });
});

describe('field size with emergencies', () => {
  const withEmergency = (scratch?: number) => field((r) => ({ ...(r.number === 8 ? { emergency: true } : {}), ...(r.number === scratch ? { scratched: true } : {}) }));
  it('does not count a waiting emergency as a starter', () => {
    expect(reconcileRace([ra(withEmergency())]).fieldSize).toBe(7);
  });
  it('counts the emergency once a scratching gives it a start', () => {
    const r = reconcileRace([ra(withEmergency(2))]);
    expect(r.fieldSize).toBe(7);
    expect(r.runners.filter((x) => !x.scratched)).toHaveLength(7);
  });
  it('uses the same rule on a pre-race refresh', () => {
    const previous = reconcileRace([ra(withEmergency())]);
    expect(mergeRaceRefresh(previous, reconcileRace([ra(withEmergency())])).fieldSize).toBe(7);
    expect(mergeRaceRefresh(previous, reconcileRace([ra(withEmergency(2))])).fieldSize).toBe(7);
  });
});
