import { describe, expect, it } from 'vitest';
import type { BettingPlan } from '@shared/types';
import { keyNote } from './BettingPlanView';

const plan = (notes: string[]): BettingPlan => ({ stance: 'watch', unitAmount: 10, totalUnits: 0, totalAmount: 0, suggestions: [], notes });

describe('keyNote (the note repeated in "Bets for this race")', () => {
  it('prefers the note that names a price to wait for', () => {
    expect(
      keyNote(
        plan([
          'No bet at the current prices: nothing on offer pays more than our ratings say it is worth.',
          'Sugarloaf Sprite is the most likely winner, but $3.70 is under our fair price of $4.71 – no value. Only worth a win bet at $4.71 or better.',
          'Suggestions only. Stick to your unit size and never chase losses. Gambling Help 1800 858 858.',
        ]),
      ),
    ).toMatch(/Only worth a win bet at \$4\.71/);
  });

  it('otherwise gives the first note, never the fine print', () => {
    expect(keyNote(plan(['Open race. Treat any bet here as a small speculative play or pass.', 'Suggestions only. Bet responsibly.']))).toMatch(/^Open race/);
    expect(keyNote(plan(['Suggestions only. Gambling Help 1800 858 858.']))).toBeUndefined();
  });
});
