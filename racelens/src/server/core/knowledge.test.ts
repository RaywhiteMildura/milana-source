import { describe, expect, it } from 'vitest';
import { TRAINER_TIERS, trainerTier, type Tier } from './knowledge.js';

describe('trainerTier', () => {
  it('gives every listed trainer and partnership its own tier (A where a name is listed twice)', () => {
    for (const tier of ['A', 'B'] as Tier[]) {
      for (const name of TRAINER_TIERS[tier]) expect([name, trainerTier(name)]).toEqual([name, TRAINER_TIERS.A.includes(name) ? 'A' : tier]);
    }
  });

  it('never matches on a surname alone: unlisted trainers get no tier', () => {
    expect(trainerTier('Paul Walker')).toBeUndefined(); // not Mark Walker
    expect(trainerTier('Sarah Baker')).toBeUndefined(); // not Bjorn Baker
    expect(trainerTier('Danny Walker & Arron Tata')).toBeUndefined();
    expect(trainerTier('Peter Cheers')).toBeUndefined();
    expect(trainerTier('Freedman')).toBeUndefined();
    expect(trainerTier('')).toBeUndefined();
    expect(trainerTier(undefined)).toBeUndefined();
  });

  it('matches first initial + surname the way the feeds write a single trainer', () => {
    for (const name of ['C Waller', 'C J Waller', 'C. Waller']) expect(trainerTier(name)).toBe(trainerTier('Chris Waller'));
    expect(trainerTier('C Waller')).toBe('A');
    expect(trainerTier('M Freedman')).toBe('B');
  });

  it('resolves partnerships member by member against the listed partnerships', () => {
    expect(trainerTier('Anthony & Sam Freedman')).toBe('A');
    for (const name of ['A & S Freedman', 'A. & S. Freedman', 'S & A Freedman']) expect(trainerTier(name)).toBe(trainerTier('Anthony & Sam Freedman')); // not Mitchell Freedman's B
    expect(trainerTier('G Waterhouse & A Bott')).toBe('A');
    expect(trainerTier('G. Waterhouse & A. Bott')).toBe('A');
    expect(trainerTier('Michael, John & Wayne Hawkes')).toBe('A');
    expect(trainerTier('M. Price & M. Kent Jnr')).toBe('A');
    expect(trainerTier('P & P Snowden')).toBe('A');
    expect(trainerTier('L & T Corstens & W Larkin')).toBe('B'); // contains Leon & Troy Corstens
    // A partnership that is not listed takes its best-known member.
    expect(trainerTier('Ciaron Maher & David Eustace')).toBe('A');
    expect(trainerTier('C. Maher & D. Eustace')).toBe('A');
    expect(trainerTier('C Maher & D Eustace')).toBe('A');
  });
});
