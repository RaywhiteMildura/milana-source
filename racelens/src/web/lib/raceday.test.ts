import { describe, expect, it } from 'vitest';
import type { MeetingPack, Prediction, Race, RaceResult, Runner, SchedulerStatus } from '@shared/types';
import { CATCHUP_GRACE_MS, catchupDue, isManualResult, isSettled, newlyResulted, newsToast, packNews, resultKeys, resultToast, resultWatchLine, schedulerLine, watchLineVisible } from './raceday';

const NOW = Date.parse('2026-10-24T02:00:00Z'); // 1pm AEDT on race day
const min = (n: number) => n * 60_000;

const race = (number: number, startTime: string, status: Race['status'] = 'open'): Race =>
  ({ number, name: `Race ${number}`, distance: 1200, startTime, status, sourceRefs: {}, runners: [], sources: [], verification: { score: 1, sourceCount: 1, conflicts: [], checkedFields: 0, agreedFields: 0 }, fieldSize: 10, fetchedAt: '' }) as Race;

const result = (raceNumber: number, status?: 'interim' | 'final', over: Partial<RaceResult> = {}): RaceResult => ({ raceNumber, placings: [[1], [2], [3]], recordedAt: '', source: 'x', status, ...over }) as RaceResult;
const iso = (ms: number) => new Date(ms).toISOString();

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
  it('leaves the server to its own schedule while its booked checks are on time', () => {
    // 40 min after the jump the server looks every 5 min: 4 min since the last look is normal, not "behind".
    const booked = { lastCheckedAt: iso(NOW - min(4)), nextCheckAt: iso(NOW + min(1)), attempts: 16, note: 'Nothing published yet' };
    const justDue = { lastCheckedAt: iso(NOW - min(5)), nextCheckAt: iso(NOW - 30_000), attempts: 16 };
    expect(catchupDue(pack({ resultWatch: { 1: booked, 2: booked } }), NOW)).toBe(false);
    expect(catchupDue(pack({ resultWatch: { 1: justDue, 2: booked } }), NOW)).toBe(false); // the next tick will take it
  });
  it('catches up when the server is well behind a booked check (it was asleep or off)', () => {
    const booked = { lastCheckedAt: iso(NOW - min(1)), nextCheckAt: iso(NOW + min(1)), attempts: 2 };
    const overdue = { lastCheckedAt: iso(NOW - min(10)), nextCheckAt: iso(NOW - CATCHUP_GRACE_MS - 1000), attempts: 3 };
    expect(catchupDue(pack({ resultWatch: { 1: booked, 2: overdue } }), NOW)).toBe(true);
  });
  it('leaves a race the server gave up on (or stopped booking) alone, also when an old pack is opened weeks later', () => {
    const gaveUp = { lastCheckedAt: iso(NOW - min(60)), attempts: 30, gaveUp: true, note: 'No result published after 4 hours' };
    const stopped = { lastCheckedAt: iso(NOW - min(3)), attempts: 1 }; // no nextCheckAt: nothing booked
    expect(catchupDue(pack({ resultWatch: { 1: gaveUp, 2: stopped } }), NOW)).toBe(false);
    expect(catchupDue(pack({ resultWatch: { 1: gaveUp, 2: gaveUp, 3: gaveUp } }), NOW + 21 * 24 * min(60))).toBe(false);
    // ...whereas a race the server never looked at is still worth one catch-up.
    expect(catchupDue(pack({ resultWatch: { 1: gaveUp } }), NOW)).toBe(true);
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
  it('never promises a booked check once automatic results are off', () => {
    const booked = { lastCheckedAt: iso(NOW - min(40)), nextCheckAt: iso(NOW - min(35)), attempts: 3, note: 'Nothing published yet' };
    const line = resultWatchLine(booked, undefined, false, NOW);
    expect(line.text).not.toMatch(/next|any moment/);
    expect(line.text).toBe('Automatic results are off – fetch the result or enter it manually. Last checked 40 min ago.');
    expect(line.tone).toBe('neutral');
    expect(resultWatchLine(booked, result(1, 'interim'), false, NOW).text).toMatch(/^Interim result only/);
  });
  it('says "any moment now" rather than "next just now" in the last 30 seconds', () => {
    const w = { lastCheckedAt: iso(NOW - min(2)), nextCheckAt: iso(NOW + 25_000), attempts: 2, note: 'Nothing published yet' };
    expect(resultWatchLine(w, undefined, true, NOW).text).toBe('Nothing published yet (checked 2 min ago, next any moment now)');
  });
});

describe('watchLineVisible', () => {
  const jumped = race(3, iso(NOW - min(20)));
  const booked = { lastCheckedAt: iso(NOW - min(1)), nextCheckAt: iso(NOW + min(1)), attempts: 4, note: 'Nothing published yet' };
  it('shows for a jumped race without a settled result, not before the jump or for an abandoned race', () => {
    expect(watchLineVisible(jumped, undefined, undefined, true, NOW)).toBe(true);
    expect(watchLineVisible(jumped, result(3, 'interim'), booked, true, NOW)).toBe(true);
    expect(watchLineVisible(race(3, iso(NOW + min(5))), undefined, undefined, true, NOW)).toBe(false);
    expect(watchLineVisible(race(3, iso(NOW - min(20)), 'abandoned'), undefined, undefined, true, NOW)).toBe(false);
  });
  it('keeps showing a one-source result while the server is booked to confirm it', () => {
    expect(watchLineVisible(jumped, result(3, 'final'), { ...booked, note: 'Result from one source only – extra check 1 of 3' }, true, NOW)).toBe(true);
    expect(watchLineVisible(jumped, result(3, 'final'), { ...booked, nextCheckAt: undefined }, true, NOW)).toBe(false);
  });
  it('hides a stale booking under a result typed in by hand, and once automatic results are off', () => {
    const manual = result(3, 'final', { source: 'manual', confirmedBy: ['manual'] });
    expect(isManualResult(manual)).toBe(true);
    expect(watchLineVisible(jumped, manual, booked, true, NOW)).toBe(false);
    expect(watchLineVisible(jumped, result(3, 'final'), booked, false, NOW)).toBe(false);
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
  it('does not claim to be watching for results once automatic results are off', () => {
    const s: SchedulerStatus = { ...base, autoResults: false, lastTickAt: iso(NOW - min(1)), watching: [{ meetingId: 'm', venue: 'Flemington', raceNumber: 3, attempts: 2, nextCheckAt: iso(NOW - min(10)) }] };
    expect(schedulerLine(s, NOW)).toEqual({ text: 'Automatic results are off – pre-race checks still run by themselves. Last look 1 min ago.', tone: 'neutral' });
  });
  it('warns when the scheduler is off or everything is disabled', () => {
    expect(schedulerLine({ ...base, running: false }, NOW).tone).toBe('amber');
    expect(schedulerLine({ ...base, autoResults: false, autoRecheckMinutes: 0 }, NOW).tone).toBe('amber');
    expect(schedulerLine(undefined, NOW).tone).toBe('neutral');
  });
});

describe('packNews / newsToast', () => {
  const runner = (number: number, over: Partial<Runner> = {}) => ({ id: `r${number}`, number, name: `Horse ${number}`, scratched: false, jockey: `Jockey ${number}`, ...over }) as Runner;
  const prediction = (raceNumber: number, top: number[], generatedAt = 'g1', label = 'Moderate') =>
    ({ raceNumber, generatedAt, top: top.map((n, i) => ({ number: n, runnerId: `r${n}`, rank: i + 1 })), ranked: [], confidence: { overall: 55, label } }) as unknown as Prediction;
  const snapshot = () =>
    ({
      races: [1, 2, 3, 4, 5].map((n) => ({ ...race(n, iso(NOW + min(30 * (n - 2)))), runners: [runner(1), runner(2), runner(3)] })),
      results: { 1: result(1, 'final') } as Record<number, RaceResult>,
      predictions: { 2: prediction(2, [1, 2, 3]), 3: prediction(3, [3, 1, 2]), 4: prediction(4, [2, 3, 1]), 5: prediction(5, [1, 3, 2]) } as Record<number, Prediction>,
      resultWatch: { 2: { lastCheckedAt: iso(NOW - min(2)), nextCheckAt: iso(NOW), attempts: 3, note: 'Nothing published yet' } },
      updatedAt: iso(NOW - min(2)),
    }) as unknown as MeetingPack;

  it('stays quiet for a routine automatic check: only the watch, updatedAt and prediction timestamps changed', () => {
    const before = snapshot();
    const after = snapshot();
    after.updatedAt = iso(NOW);
    after.resultWatch = { 2: { lastCheckedAt: iso(NOW), nextCheckAt: iso(NOW + min(2)), attempts: 4, note: 'Nothing published yet' } };
    after.predictions[3] = { ...after.predictions[3], generatedAt: 'g2' }; // re-generated, same picks
    expect(packNews(before, after)).toEqual({ resulted: [], corrected: [], abandoned: [], fieldChanged: [], rerated: [] });
    expect(newsToast(packNews(before, after))).toBeNull();
  });
  it('says nothing on the first load', () => {
    expect(newsToast(packNews(null, snapshot()))).toBeNull();
  });
  it('names a new result (the re-rating that follows is implied)', () => {
    const before = snapshot();
    const after = snapshot();
    after.results[2] = result(2, 'final');
    after.predictions[3] = prediction(3, [1, 3, 2], 'g2');
    expect(newsToast(packNews(before, after))).toEqual({ kind: 'success', text: 'R2 result in' });
  });
  it('flags a corrected result', () => {
    const before = snapshot();
    const after = snapshot();
    after.results[1] = result(1, 'final', { placings: [[2], [1], [3]] });
    expect(packNews(before, after).corrected).toEqual([1]);
    expect(newsToast(packNews(before, after))).toEqual({ kind: 'warn', text: 'R1 result corrected' });
  });
  it('reports a scratching or a rider change in a race still to run', () => {
    const before = snapshot();
    const scratched = snapshot();
    scratched.races[3].runners[1] = runner(2, { scratched: true });
    expect(newsToast(packNews(before, scratched))).toEqual({ kind: 'info', text: 'Updated: scratching or rider change in R4' });
    const rider = snapshot();
    rider.races[4].runners[0] = runner(1, { jockey: 'Someone Else' });
    expect(packNews(before, rider).fieldChanged).toEqual([5]);
    const sameRider = snapshot();
    sameRider.races[4].runners[0] = runner(1, { jockey: 'JOCKEY 1' });
    expect(packNews(before, sameRider).fieldChanged).toEqual([]);
    // A runner dropped from the field altogether (no scratched flag) is a field change too.
    const removed = snapshot();
    removed.races[3].runners = removed.races[3].runners.slice(1);
    expect(packNews(before, removed).fieldChanged).toEqual([4]);
  });
  it('shows unreachable results sources in amber, not as routine waiting', () => {
    const watch = { lastCheckedAt: new Date(NOW - min(1)).toISOString(), nextCheckAt: new Date(NOW + min(1)).toISOString(), attempts: 2, note: 'No results source answered (TAB: HTTP 403)' };
    expect(resultWatchLine(watch, undefined, true, NOW).tone).toBe('amber');
    expect(resultWatchLine({ ...watch, note: 'Nothing published yet' }, undefined, true, NOW).tone).toBe('blue');
  });
  it('reports new picks and abandonments', () => {
    const before = snapshot();
    const after = snapshot();
    after.predictions[4] = prediction(4, [3, 2, 1], 'g2');
    expect(newsToast(packNews(before, after))).toEqual({ kind: 'info', text: 'Updated: new picks for R4' });
    const all = snapshot();
    for (const n of [2, 3, 4, 5]) all.predictions[n] = prediction(n, [3, 2, 1], 'g2', 'Low');
    expect(newsToast(packNews(before, all))?.text).toBe('Updated: new picks for the remaining races');
    const abandoned = snapshot();
    abandoned.races[4] = { ...abandoned.races[4], status: 'abandoned' };
    expect(newsToast(packNews(before, abandoned))).toEqual({ kind: 'warn', text: 'R5 abandoned' });
  });
});
