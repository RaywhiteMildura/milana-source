import { describe, expect, it } from 'vitest';
import type { MeetingPack, Race, SchedulerStatus } from '@shared/types';
import { catchupDue, isSettled, newlyResulted, resultKeys, resultToast, resultWatchLine, schedulerLine } from './raceday';

const NOW = Date.parse('2026-10-24T02:00:00Z'); // 1pm AEDT on race day
const min = (n: number) => n * 60_000;

const race = (number: number, startTime: string, status: Race['status'] = 'open'): Race =>
  ({ number, name: `Race ${number}`, distance: 1200, startTime, status, sourceRefs: {}, runners: [], sources: [], verification: { score: 1, sourceCount: 1, conflicts: [], checkedFields: 0, agreedFields: 0 }, fieldSize: 10, fetchedAt: '' }) as Race;

const result = (raceNumber: number, status?: 'interim' | 'final') => ({ raceNumber, placings: [[1], [2], [3]], recordedAt: '', source: 'x', status });

describe('result bookkeeping', () => {
  it('treats manual results (no status) and final ones as settled, interim as not', () => {
    expect(isSettled(undefined)).toBe(false);
    expect(isSettled(result(1, 'interim'))).toBe(false);
    expect(isSettled(result(1, 'final'))).toBe(true);
    expect(isSettled(result(1))).toBe(true);
  });

  it('spots new results and interim results that were confirmed', () => {
    const before = resultKeys({ results: { 1: result(1), 2: result(2, 'interim') } } as unknown as MeetingPack);
    const after = resultKeys({ results: { 1: result(1), 2: result(2, 'final'), 4: result(4, 'interim'), 3: result(3) } } as unknown as MeetingPack);
    expect(newlyResulted(before, after)).toEqual([2, 3, 4]);
    expect(newlyResulted(after, after)).toEqual([]);
  });

  it('words the toast for one or several races', () => {
    expect(resultToast([3])).toBe('R3 result in');
    expect(resultToast([3, 4])).toBe('R3 and R4 results in');
    expect(resultToast([2, 3, 4])).toBe('R2, R3 and R4 results in');
  });
});

describe('catchupDue', () => {
  const pack = (over: Partial<Pick<MeetingPack, 'results' | 'resultWatch'>> = {}) => ({
    races: [race(1, new Date(NOW - min(40)).toISOString()), race(2, new Date(NOW - min(5)).toISOString()), race(3, new Date(NOW + min(30)).toISOString())],
    results: {},
    resultWatch: undefined,
    ...over,
  });

  it('is due when a race jumped more than 3 minutes ago and nobody has checked', () => {
    expect(catchupDue(pack(), NOW)).toBe(true);
  });
  it('is not due when every jumped race is settled', () => {
    expect(catchupDue(pack({ results: { 1: result(1), 2: result(2, 'final') } }), NOW)).toBe(false);
  });
  it('is still due for an interim result', () => {
    expect(catchupDue(pack({ results: { 1: result(1), 2: result(2, 'interim') } }), NOW)).toBe(true);
  });
  it('waits 3 minutes after the jump', () => {
    const p = pack({ results: { 1: result(1) } });
    expect(catchupDue(p, NOW)).toBe(true); // R2 jumped 5 min ago
    expect(catchupDue(p, NOW - min(3))).toBe(false); // R2 jumped only 2 min ago
  });
  it('defers to the server when it checked within the last 2 minutes', () => {
    const recent = { lastCheckedAt: new Date(NOW - min(1)).toISOString(), attempts: 2 };
    const stale = { lastCheckedAt: new Date(NOW - min(4)).toISOString(), attempts: 2 };
    expect(catchupDue(pack({ resultWatch: { 1: recent, 2: recent } }), NOW)).toBe(false);
    expect(catchupDue(pack({ resultWatch: { 1: recent, 2: stale } }), NOW)).toBe(true);
  });
  it('ignores abandoned races and races with no start time', () => {
    const p = { races: [race(1, new Date(NOW - min(40)).toISOString(), 'abandoned'), { ...race(2, ''), startTime: undefined }], results: {}, resultWatch: undefined };
    expect(catchupDue(p, NOW)).toBe(false);
  });
});

describe('resultWatchLine', () => {
  it('describes an active watch with last and next check times', () => {
    const line = resultWatchLine({ lastCheckedAt: new Date(NOW - min(1)).toISOString(), nextCheckAt: new Date(NOW + min(1)).toISOString(), attempts: 1 }, undefined, true, NOW);
    expect(line.tone).toBe('blue');
    expect(line.text).toBe('Checking for the result automatically – last checked 1 min ago, next in 1 min');
  });
  it('shows the server note when it has one, and the one-source wording for interim results', () => {
    expect(resultWatchLine({ lastCheckedAt: '', attempts: 1, note: 'Result from one source only – waiting for confirmation' }, undefined, true, NOW).text).toMatch(/one source/);
    expect(resultWatchLine({ lastCheckedAt: new Date(NOW - min(1)).toISOString(), nextCheckAt: new Date(NOW + min(2)).toISOString(), attempts: 2, note: 'Nothing published yet' }, undefined, true, NOW).text).toBe('Nothing published yet (checked 1 min ago, next in 2 min)');
    expect(resultWatchLine({ lastCheckedAt: new Date(NOW - min(2)).toISOString(), nextCheckAt: new Date(NOW - 20_000).toISOString(), attempts: 2, note: 'Nothing published yet' }, undefined, true, NOW).text).toBe('Nothing published yet (checked 2 min ago, next any moment now)');
    expect(resultWatchLine(undefined, result(1, 'interim'), true, NOW)).toEqual({ text: 'Result from one source only – confirming', tone: 'blue' });
  });
  it('flags a watch that gave up', () => {
    const line = resultWatchLine({ lastCheckedAt: '', attempts: 9, gaveUp: true, note: 'No result published 3 hours after the jump' }, undefined, true, NOW);
    expect(line.tone).toBe('amber');
    expect(line.text).toBe('No result published 3 hours after the jump');
  });
  it('explains what will happen before the watcher starts, on or off', () => {
    expect(resultWatchLine(undefined, undefined, true, NOW).text).toMatch(/fetched automatically/);
    expect(resultWatchLine(undefined, undefined, false, NOW).text).toMatch(/off/);
  });
});

describe('schedulerLine', () => {
  const base: SchedulerStatus = { running: true, autoResults: true, autoRecheckMinutes: 20, watching: [] };
  it('names the races being watched and when the next check is', () => {
    const s: SchedulerStatus = { ...base, watching: [{ meetingId: 'm', venue: 'Flemington', raceNumber: 3, attempts: 2, nextCheckAt: new Date(NOW + min(1)).toISOString() }] };
    expect(schedulerLine(s, NOW)).toEqual({ text: 'Watching Flemington R3 – next check in 1 min', tone: 'green' });
  });
  it('groups the races of a venue and shows its earliest next check', () => {
    const w = (venue: string, raceNumber: number, mins: number) => ({ meetingId: venue, venue, raceNumber, attempts: 1, nextCheckAt: new Date(NOW + min(mins)).toISOString() });
    const s: SchedulerStatus = { ...base, watching: [w('Flemington', 4, 1), w('Flemington', 2, 5), w('Randwick', 7, 3), w('Flemington', 1, 12)] };
    expect(schedulerLine(s, NOW).text).toBe('Watching Flemington R1, R2 and R4 – next check in 1 min; Randwick R7 – next check in 3 min');
  });
  it('says when there is nothing to watch, with the last tick', () => {
    expect(schedulerLine({ ...base, lastTickAt: new Date(NOW - min(2)).toISOString() }, NOW)).toEqual({ text: 'Nothing to watch right now. Last look 2 min ago.', tone: 'green' });
    expect(schedulerLine(base, NOW).text).toBe('Nothing to watch right now.');
  });
  it('warns when the scheduler is off or everything is disabled', () => {
    expect(schedulerLine({ ...base, running: false }, NOW).tone).toBe('amber');
    expect(schedulerLine({ ...base, autoResults: false, autoRecheckMinutes: 0 }, NOW).tone).toBe('amber');
    expect(schedulerLine(undefined, NOW).tone).toBe('neutral');
  });
});
