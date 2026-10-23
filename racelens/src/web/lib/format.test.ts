import { describe, expect, it } from 'vitest';
import { placingPositions } from './format';

describe('placingPositions', () => {
  const labels = (p: number[][]) => placingPositions(p).map((x) => x.label);

  it('labels a plain result 1st, 2nd, 3rd, 4th', () => {
    expect(labels([[4], [2], [7], [9]])).toEqual(['1st', '2nd', '3rd', '4th']);
  });

  it('counts every horse of a dead heat: the horse after a dead heat for 2nd ran 4th, not 3rd', () => {
    expect(labels([[4], [2, 7], [9]])).toEqual(['1st', '=2nd', '4th']);
    expect(placingPositions([[4], [2, 7], [9]]).map((x) => x.position)).toEqual([1, 2, 4]);
  });

  it('handles a dead heat for the win and a three-way dead heat', () => {
    expect(labels([[4, 2], [9], [1]])).toEqual(['=1st', '3rd', '4th']);
    expect(labels([[4], [3, 5, 8], [6]])).toEqual(['1st', '=2nd', '5th']);
  });

  it('copes with no placings', () => {
    expect(placingPositions(undefined)).toEqual([]);
  });
});
