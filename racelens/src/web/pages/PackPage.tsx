import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { JobProgress, MeetingPack, NewsItem, Race } from '@shared/types';
import { normaliseName, normalisePerson, parseTrackRating, trackRatingLabel } from '@shared/util';
import { api, errorMessage, isUnreachable, useJobPoll, useRequest, isQueued } from '../lib/api';
import { countdown, deviceZone, fmtDistance, fmtLongDate, fmtMoney, fmtOdds, fmtPct, fmtRelative, fmtSeenAt, fmtTime, meetingZone, plural, raceStatusLabel, verificationWord, zoneAbbrev } from '../lib/format';
import { useMediaQuery } from '../lib/hooks';
import { CATCHUP_STALE_MS, catchupDue, newsToast, packNews, resultWatchLine, watchLineVisible } from '../lib/raceday';
import { navigate, routes } from '../lib/router';
import { savedKeys } from '../lib/saved';
import { useServerNow, useSession } from '../lib/session';
import { BetSummary, BettingPlanView } from '../components/BettingPlanView';
import { ConfidenceMeter } from '../components/ConfidenceMeter';
import { DayPatterns } from '../components/DayPatterns';
import { FieldTable, NewsItems } from '../components/FieldTable';
import { ChangesList, HistoryPanel } from '../components/HistoryPanel';
import { InlineJob } from '../components/JobProgressPanel';
import { RankedRunnerCard } from '../components/RankedRunnerCard';
import { ResultView } from '../components/ResultView';
import { useToast } from '../components/Toast';
import { VerificationView } from '../components/VerificationView';
import { Chip, EmptyState, ErrorState, Ring, Saddle, SavedCopyBanner, Skeleton, SkeletonCard } from '../components/ui';

type Section = 'prediction' | 'field' | 'verification' | 'news' | 'result';
type RaceState = 'open' | 'predicted' | 'resulted' | 'abandoned';

const SECTIONS: Array<{ key: Section; label: string; testId: string }> = [
  { key: 'prediction', label: 'Prediction & bets', testId: 'prediction-tab' },
  { key: 'field', label: 'Full field', testId: 'field-tab' },
  { key: 'verification', label: 'Verification', testId: 'verification-tab' },
  { key: 'news', label: 'News & rumours', testId: 'news-tab' },
  { key: 'result', label: 'Result', testId: 'result-tab' },
];

function raceState(pack: MeetingPack, race: Race): RaceState {
  if (race.status === 'abandoned') return 'abandoned';
  if (pack.results?.[race.number]) return 'resulted';
  if (pack.predictions?.[race.number]) return 'predicted';
  return 'open';
}

function stateWord(s: RaceState): string {
  switch (s) {
    case 'resulted':
      return 'Result in';
    case 'predicted':
      return 'Predicted';
    case 'abandoned':
      return 'Abandoned';
    default:
      return 'Not predicted yet';
  }
}

interface ActiveJob {
  id: string;
  title: string;
  raceNumber?: number;
}

export function PackPage({ id, raceParam }: { id: string; raceParam?: string }) {
  const toast = useToast();
  const session = useSession();
  const now = useServerNow(30_000);
  const { clockOffset } = session;
  const clockOffsetRef = useRef(clockOffset);
  clockOffsetRef.current = clockOffset;
  // Kept on the phone: a stalled connection at the track shows the saved copy (with a banner) and keeps retrying.
  const pack = useRequest(() => api.getPack(id), [id], savedKeys.pack(id));
  const sources = useRequest(() => api.getSources().then((r) => Object.fromEntries(r.sources.map((s) => [s.id, s.name])) as Record<string, string>), []);
  const liveSettings = useRequest(() => api.getSettings(), []);
  const onSavedCopy = pack.savedAt != null;
  const onSavedCopyRef = useRef(onSavedCopy);
  onSavedCopyRef.current = onSavedCopy;
  // Back from the saved copy: fetch what failed meanwhile (the catch-up waits for the settings).
  const lastSavedAt = useRef<string | null>(null);
  useEffect(() => {
    const was = lastSavedAt.current;
    lastSavedAt.current = pack.savedAt;
    if (!was || pack.savedAt) return;
    if (liveSettings.error) void liveSettings.reload(true);
    if (sources.error) void sources.reload(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack.savedAt]);
  const names = sources.data ?? undefined;
  const [section, setSection] = useState<Section>('prediction');
  /** The race `section` was chosen for: another race opens on its picks (see below). */
  const [sectionRace, setSectionRace] = useState<number | null>(null);
  const phone = useMediaQuery('(max-width: 480px)');
  const [packJob, setPackJob] = useState<ActiveJob | null>(null);
  const [raceJob, setRaceJob] = useState<ActiveJob | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  const data = pack.data;
  const tz = meetingZone(data?.meeting);
  const races = useMemo(() => (data ? [...(data.races ?? [])].sort((a, b) => a.number - b.number) : []), [data]);

  // Shown as on until the settings arrive (the usual case), but nothing is fetched on that assumption.
  const autoResultsOn = liveSettings.data ? liveSettings.data.autoResults !== false : true;
  const autoResultsKnownOn = !!liveSettings.data && liveSettings.data.autoResults !== false;
  const autoChip = !!session.health?.scheduler?.running && autoResultsOn;

  // Always the latest pack for callbacks that run from timers and DOM events.
  const dataRef = useRef<MeetingPack | null>(null);
  dataRef.current = data;

  /** Refresh with a newer copy of the pack, toasting only what the owner cares about (never routine book-keeping). */
  const applyFresh = (fresh: MeetingPack) => {
    const news = newsToast(packNews(dataRef.current, fresh));
    pack.setData(fresh);
    if (news) toast.push(news.text, news.kind);
  };

  // ---------------------------------------------------------------- catch-up
  // Opening the page (or coming back to it) after a race has run while the
  // server was asleep or off: if the server never looked for that result, or is
  // well behind its own booked check, ask it to catch up once, quietly. The
  // server only checks what its schedule says is due, as an automatic check, and
  // answers without a job when nothing is; the toast only appears if something
  // new arrived.
  const [catchupJobId, setCatchupJobId] = useState<string | null>(null);
  const catchupPoll = useJobPoll(catchupJobId, 2000);
  const catchup = useRef<{ lastFiredAt: number }>({ lastFiredAt: 0 });
  const jobRunning = !!packJob || !!raceJob || !!catchupJobId;
  const jobRunningRef = useRef(jobRunning);
  jobRunningRef.current = jobRunning;
  const autoOnRef = useRef(autoResultsKnownOn);
  autoOnRef.current = autoResultsKnownOn;

  const maybeCatchUp = useCallback(async () => {
    const d = dataRef.current;
    if (!d || jobRunningRef.current || !autoOnRef.current || onSavedCopyRef.current) return;
    if (document.visibilityState === 'hidden') return;
    const t = Date.now() + clockOffsetRef.current;
    if (t - catchup.current.lastFiredAt < CATCHUP_STALE_MS) return;
    if (!catchupDue(d, t)) return;
    catchup.current.lastFiredAt = t;
    try {
      const busy = (await api.getJobs()).some((j) => j.meetingId === d.id && (j.status === 'queued' || j.status === 'running'));
      if (busy) return;
      const { jobId } = await api.catchUpResults(d.id);
      if (jobId) setCatchupJobId(jobId); // null: the server had nothing due
    } catch {
      /* quiet by design – the 30 s poll and the manual buttons still work */
    }
  }, []);

  // On load, once the auto-results setting and the server's clock are known, again whenever the person moves to another race (throttled inside), and once a saved copy gives way to live data.
  useEffect(() => {
    if (!data) return;
    void maybeCatchUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!data, raceParam, autoResultsKnownOn, clockOffset, onSavedCopy]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void maybeCatchUp();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [maybeCatchUp]);

  // Finished – or lost (the server restarted and forgot the job): refresh and let the live poll and later catch-ups run again.
  useEffect(() => {
    if (!catchupJobId || !(catchupPoll.finished || catchupPoll.gone)) return;
    let cancelled = false;
    (async () => {
      try {
        const fresh = await api.getPack(id);
        if (cancelled) return;
        applyFresh(fresh);
      } catch {
        /* keep what we have */
      } finally {
        if (!cancelled) setCatchupJobId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catchupJobId, catchupPoll.finished, catchupPoll.gone]);

  // ------------------------------------------------------------- live poll
  // The server re-checks races and collects results on its own: notice that
  // every 30 s and refresh silently, with a toast only for real news (a result,
  // a correction, a scratching or rider change, new picks) – an automatic
  // results check that found nothing also saves the pack, and that is not news.
  const seenRef = useRef<{ updatedAt?: string; resulted: number }>({ updatedAt: undefined, resulted: 0 });
  useEffect(() => {
    seenRef.current = { updatedAt: data?.updatedAt, resulted: Object.keys(data?.results ?? {}).length };
  }, [data?.updatedAt, data?.results]);
  const poll = useRef({ busy: false, at: 0, misses: 0, lastContact: null as string | null });
  const livePoll = useRef(async () => undefined as void);
  livePoll.current = async () => {
    const st = poll.current;
    // A saved copy on screen: useRequest is already retrying.
    if (!dataRef.current || st.busy || jobRunningRef.current || onSavedCopyRef.current) return;
    st.busy = true;
    st.at = Date.now();
    try {
      const mine = (await api.getPacks()).find((p) => p.id === id);
      st.misses = 0;
      st.lastContact = new Date().toISOString();
      if (!mine) return;
      const seen = seenRef.current;
      const grew = mine.resultedRaces > seen.resulted;
      if (!grew && !(seen.updatedAt && mine.updatedAt > seen.updatedAt)) return;
      applyFresh(await api.getPack(id));
    } catch (e) {
      // One missed check is harmless; two in a row means the phone has lost the Mac: say so (the saved-copy
      // banner, from the last time it answered) and let useRequest retry until it answers again.
      if (isUnreachable(e) && ++st.misses >= 2) {
        st.misses = 0;
        const since = [st.lastContact, pack.receivedAt].filter((t): t is string => !!t).sort().pop();
        pack.markUnreachable(since);
      }
    } finally {
      st.busy = false;
    }
  };
  useEffect(() => {
    if (!data) return;
    poll.current.at = Date.now();
    const timer = window.setInterval(() => void livePoll.current(), 30_000);
    // Back from the lock screen (timers were frozen there): check for news now rather than at the next tick.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - poll.current.at > 5_000) void livePoll.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!data]);

  const selectedNumber = useMemo(() => {
    if (!data || !races.length) return null;
    const fromParam = raceParam ? Number(raceParam) : NaN;
    if (Number.isInteger(fromParam) && races.some((r) => r.number === fromParam)) return fromParam;
    const results = data.results ?? {};
    const serverNow = Date.now() + clockOffsetRef.current;
    const upcoming = races.find((r) => !results[r.number] && r.status !== 'abandoned' && (!r.startTime || new Date(r.startTime).getTime() > serverNow));
    return (upcoming ?? races.find((r) => !results[r.number]) ?? races[0]).number;
  }, [data, races, raceParam]);

  // Pin the auto-picked race into the URL so the selection never silently
  // jumps (e.g. after a result is saved for the race being viewed).
  useEffect(() => {
    if (data && selectedNumber != null && raceParam !== String(selectedNumber)) navigate(routes.pack(id, selectedNumber), true);
  }, [data, selectedNumber, raceParam, id]);

  const race = races.find((r) => r.number === selectedNumber);
  const prediction = race && data ? data.predictions?.[race.number] : undefined;
  const result = race && data ? data.results?.[race.number] : undefined;
  const watch = race && data ? data.resultWatch?.[race.number] : undefined;

  // Another race keeps the open tab (comparing fields across races), except Result: that stays only if the race
  // has a result too, else it opens on the picks – never on an empty result form. The "Next" bar always opens the picks.
  if (selectedNumber !== sectionRace) {
    setSectionRace(selectedNumber);
    if (sectionRace != null && section === 'result' && !result) setSection('prediction');
  }

  // Keep the selected race in view in the sideways strip (on R8 it would sit off-screen behind R1–R3).
  // Sideways only: setting scrollLeft never scrolls the page.
  const raceTabsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const strip = raceTabsRef.current;
    const tab = strip?.querySelector<HTMLElement>('.race-tab.is-selected');
    if (!strip || !tab) return;
    const s = strip.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    strip.scrollLeft += t.left - s.left - (s.width - t.width) / 2;
  }, [selectedNumber, races.length]);

  // The race to head to once this one is done: the next un-resulted race after it, else any un-resulted race.
  const nextRace = useMemo(() => {
    if (!data || !race) return undefined;
    const open = (r: Race) => !data.results?.[r.number] && r.status !== 'abandoned';
    return races.find((r) => r.number > race.number && open(r)) ?? races.find((r) => r.number !== race.number && open(r));
  }, [data, race, races]);

  const runnerById = useMemo(() => new Map((race?.runners ?? []).map((r) => [r.id, r])), [race]);
  const runnerByNo = useMemo(() => new Map((race?.runners ?? []).map((r) => [r.number, r])), [race]);

  const raceNews = useMemo(() => {
    const empty = { race: [] as NewsItem[], meeting: [] as NewsItem[] };
    if (!data || !race) return empty;
    const keys = new Set<string>();
    (race.runners ?? []).forEach((r) => {
      keys.add(normaliseName(r.name));
      if (r.jockey) {
        keys.add(normaliseName(r.jockey));
        keys.add(normalisePerson(r.jockey));
      }
      if (r.trainer) {
        keys.add(normaliseName(r.trainer));
        keys.add(normalisePerson(r.trainer));
      }
    });
    const anyRunner = new Set<string>();
    (data.races ?? []).forEach((rc) => (rc.runners ?? []).forEach((r) => anyRunner.add(normaliseName(r.name))));
    const seen = new Set<string>();
    const out = { race: [] as NewsItem[], meeting: [] as NewsItem[] };
    const consider = (n: NewsItem) => {
      if (seen.has(n.id)) return;
      seen.add(n.id);
      const ms = (n.mentions ?? []).flatMap((m) => [normaliseName(m), normalisePerson(m)]);
      if (ms.some((m) => keys.has(m))) out.race.push(n);
      else if (!ms.some((m) => anyRunner.has(m))) out.meeting.push(n);
    };
    (race.runners ?? []).forEach((r) => (r.news ?? []).forEach(consider));
    (data.news ?? []).forEach(consider);
    const byTime = (a: NewsItem, b: NewsItem) => new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime();
    out.race.sort(byTime);
    out.meeting.sort(byTime);
    return out;
  }, [data, race]);

  const selectRace = (n: number) => navigate(routes.pack(id, n));

  const startJob = async (kind: 'recheck' | 'results', raceNumber?: number) => {
    if (!data) return;
    const key = `${kind}:${raceNumber ?? 'all'}`;
    setStarting(key);
    try {
      const { jobId } = kind === 'recheck' ? await api.recheck(data.id, raceNumber) : await api.fetchResults(data.id, raceNumber);
      const title =
        kind === 'recheck'
          ? raceNumber != null
            ? `Pre-race check – Race ${raceNumber}`
            : 'Pre-race check – all remaining races'
          : raceNumber != null
            ? `Fetching result – Race ${raceNumber}`
            : 'Fetching results';
      if (raceNumber != null) setRaceJob({ id: jobId, title, raceNumber });
      else setPackJob({ id: jobId, title });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setStarting(null);
    }
  };

  const onJobFinished = (job: JobProgress) => {
    void pack.reload(true);
    const where = job.raceNumber != null ? `Race ${job.raceNumber}: ` : '';
    if (job.status === 'done') {
      toast.success(job.type === 'results' ? `${where}results updated` : `${where}pre-race check complete – page refreshed`);
    } else {
      toast.error(job.error || 'The check failed. Try again in a moment.');
    }
  };

  const saveManual = async (placings: number[][]): Promise<boolean> => {
    if (!data || !race) return false;
    try {
      const updated = await api.manualResult(data.id, race.number, placings);
      if (isQueued(updated)) {
        // Accepted, but another job for this meeting is still running: show it, and refresh when the result lands.
        toast.info(updated.message);
        setRaceJob({ id: updated.jobId, title: `Saving your Race ${race.number} result`, raceNumber: race.number });
        return true;
      }
      pack.setData(updated);
      toast.success(`Result saved for Race ${race.number}`);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    }
  };

  // ------------------------------------------------------------------ states
  if (pack.loading && !data) {
    return (
      <div className="page page--pack" aria-busy="true">
        <div className="card pack-head">
          <Skeleton h={14} w={120} />
          <Skeleton h={34} w="50%" />
          <Skeleton h={16} w="35%" />
          <div className="chips">
            <Skeleton h={26} w={110} />
            <Skeleton h={26} w={90} />
            <Skeleton h={26} w={160} />
          </div>
        </div>
        <div className="race-tabs" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} h={56} w={120} className="race-tab-skeleton" />
          ))}
        </div>
        <SkeletonCard lines={3} />
        <SkeletonCard lines={5} />
      </div>
    );
  }

  // A full-page error only when there is nothing to show; a failed refresh keeps the page (notice below).
  if (!data) {
    const notFound = pack.error && /not found/i.test(pack.error);
    return (
      <div className="page page--pack">
        <a href={routes.home()} className="back">
          ← Back to race days
        </a>
        <ErrorState
          title={notFound ? "We couldn't find that research" : 'Could not load this meeting'}
          message={notFound ? 'It may have been deleted or not researched yet. Head back and research the meeting again.' : pack.error ?? 'Unknown error'}
          onRetry={notFound ? () => navigate(routes.home(), true) : () => pack.reload()}
        />
      </div>
    );
  }

  const m = data.meeting;
  const trackRating = m.trackRating ?? parseTrackRating(m.trackCondition) ?? race?.trackRating ?? parseTrackRating(race?.trackCondition);
  const trackText = trackRating != null ? trackRatingLabel(trackRating) : m.trackCondition ?? race?.trackCondition ?? 'Unknown';
  const raceSources = new Set((data.races ?? []).flatMap((r) => r.sources ?? []));
  const sourceCount = raceSources.size || (data.sourceStatuses ?? []).filter((s) => s.ok).length;
  const cd = race ? countdown(race.startTime, now) : null;
  const w = data.weather;

  const sectionCount: Partial<Record<Section, ReactNode>> = {
    field: race ? (race.runners ?? []).length : undefined,
    news: raceNews.race.length + raceNews.meeting.length || undefined,
    result: result ? '✓' : undefined,
    verification: race && (race.runners ?? []).some((r) => (r.verification?.conflicts ?? []).length) ? '⚠' : undefined,
  };

  return (
    <div className="page page--pack" data-testid="pack-page">
      {pack.savedAt && <SavedCopyBanner savedAt={pack.savedAt} />}
      {pack.error && (
        <p className="banner banner--warn" role="status" data-testid="refresh-failed">
          <strong>Couldn't refresh – showing what you had{pack.receivedAt ? ` from ${fmtSeenAt(pack.receivedAt)}` : ''}.</strong>
          <span className="banner__detail small">{pack.error}</span>
        </p>
      )}
      {/* ------------------------------------------------------------ header */}
      <section className="card pack-head" data-testid="pack-header">
        <div className="pack-head__row">
          <div className="pack-head__title">
            <a href={routes.home(m.date)} className="back">
              ← Race days
            </a>
            <h1>{m.venue}</h1>
            <p className="pack-head__date">
              {fmtLongDate(m.date)}
              {m.state ? ` · ${m.state}` : ''}
            </p>
            <div className="chips">
              <Chip tone="neutral" title="Track condition">
                Track: <strong>{trackText}</strong>
              </Chip>
              {m.rail && (
                <Chip tone="neutral" title="Rail position">
                  Rail: {m.rail}
                </Chip>
              )}
              {w?.summary && (
                <Chip tone="blue" title="Weather">
                  ☁ {w.summary}
                </Chip>
              )}
              {tz !== deviceZone() && (
                <Chip tone="neutral" title="Race times are shown in the track's local time" testId="zone-chip">
                  Times {zoneAbbrev(tz)}
                </Chip>
              )}
              {autoChip && (
                <Chip tone="green" title="Results and pre-race checks run automatically while the server is on" testId="auto-chip">
                  ⟳ Auto
                </Chip>
              )}
            </div>
            {w && (w.rainLast72hMm != null || w.rainRaceDayMm != null || w.maxTempC != null || w.windKmhMax != null) && (
              <p className="small muted pack-head__weather">
                {w.rainLast72hMm != null && `Rain last 72h: ${w.rainLast72hMm}mm`}
                {w.rainRaceDayMm != null && ` · Rain still to come on race day: ${w.rainRaceDayMm}mm`}
                {w.maxTempC != null && ` · Max ${Math.round(w.maxTempC)}°C`}
                {w.windKmhMax != null && ` · Wind to ${Math.round(w.windKmhMax)} km/h`}
                {w.conditionDrift != null && w.conditionDrift !== 0 && ` · Track may go ${w.conditionDrift > 0 ? 'softer' : 'firmer'}`}
              </p>
            )}
          </div>
          <Ring
            value={data.verificationScore}
            size={phone ? 56 : 92}
            stroke={phone ? 6 : 9}
            testId="pack-verification"
            caption={
              <>
                <strong>{verificationWord(data.verificationScore)}</strong>
                <br />
                <span className="muted">Verified across {plural(sourceCount, 'source')}</span>
              </>
            }
          />
        </div>
        <div className="pack-head__actions">
          <button type="button" className="btn btn-primary" onClick={() => startJob('recheck')} disabled={!!packJob || starting === 'recheck:all'} data-testid="recheck-all-btn">
            {starting === 'recheck:all' ? 'Starting…' : 'Pre-race check all'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => startJob('results')} disabled={!!packJob || starting === 'results:all'} data-testid="fetch-results-btn">
            {starting === 'results:all' ? 'Starting…' : 'Fetch results'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => pack.reload(true)} title="Reload this page's data" data-testid="refresh-btn">
            Refresh
          </button>
          <span className="small muted pack-head__updated" data-testid="pack-updated">
            Last updated {fmtRelative(data.updatedAt, now)}
          </span>
        </div>
        {packJob && <InlineJob jobId={packJob.id} title={packJob.title} onFinished={onJobFinished} onClear={() => setPackJob(null)} />}
      </section>

      <DayPatterns patterns={data.dayPatterns ?? []} />

      {/* --------------------------------------------------------- race tabs */}
      {races.length === 0 ? (
        <EmptyState icon="🐎" title="No races found for this meeting">
          The sources didn't return a race card. Try re-running the research from the home page.
        </EmptyState>
      ) : (
        <>
          <nav className="race-tabs" role="tablist" aria-label="Races" data-testid="race-tabs" ref={raceTabsRef}>
            {races.map((r) => {
              const st = raceState(data, r);
              const sel = r.number === selectedNumber;
              return (
                <button
                  key={r.number}
                  type="button"
                  role="tab"
                  aria-selected={sel}
                  className={`race-tab race-tab--${st} ${sel ? 'is-selected' : ''}`}
                  onClick={() => selectRace(r.number)}
                  title={`${r.name} – ${stateWord(st)}`}
                  data-testid="race-tab"
                  data-race={r.number}
                  data-state={st}
                >
                  <span className="race-tab__num">R{r.number}</span>
                  <span className="race-tab__meta">
                    {fmtDistance(r.distance)} · {fmtTime(r.startTime, tz)}
                  </span>
                  <span className={`pip pip--${st}`} aria-label={stateWord(st)} />
                </button>
              );
            })}
          </nav>
          <p className="race-tabs-legend small muted">
            <span className="pip pip--open" /> not predicted <span className="pip pip--predicted" /> predicted <span className="pip pip--resulted" /> result in
          </p>
        </>
      )}

      {race && cd && (
        <div className="race-detail" data-testid="race-detail" data-race={race.number}>
          {/* ---------------------------------------------------- race top */}
          <section className="card race-top">
            <div className="race-top__main">
              <div className="race-top__title">
                <h2>
                  <span className="race-top__num">R{race.number}</span> {race.name}
                </h2>
                <div className="race-top__meta">
                  <span>{fmtDistance(race.distance)}</span>
                  {race.raceClass && <span>{race.raceClass}</span>}
                  {race.group && <Chip tone="gold">{race.group}</Chip>}
                  {race.prize != null && <span>{fmtMoney(race.prize)}</span>}
                  <span>{plural(race.fieldSize, 'runner')}</span>
                  {race.ageRestriction && <span>{race.ageRestriction}</span>}
                  {race.sexRestriction && <span>{race.sexRestriction}</span>}
                  {race.status !== 'open' && race.status !== 'unknown' && <Chip tone={race.status === 'abandoned' ? 'red' : 'neutral'}>{raceStatusLabel(race.status)}</Chip>}
                </div>
              </div>
              <div className={`countdown countdown--${result ? 'done' : cd.tone}`} data-testid="countdown">
                <strong>{result ? (result.status === 'interim' ? 'Interim result in' : 'Result in') : cd.text}</strong>
                <span className="muted">{fmtTime(race.startTime, tz)}</span>
              </div>
            </div>
            <div className="race-top__side">
              <Ring value={race.verification?.score ?? 0} size={56} stroke={6} caption={<span className="small muted">{plural(race.verification?.sourceCount ?? 0, 'source')}</span>} testId="race-verification" />
              {!result && (
                <button type="button" className="btn btn-primary" onClick={() => startJob('recheck', race.number)} disabled={raceJob?.raceNumber === race.number || starting === `recheck:${race.number}`} data-testid="recheck-btn">
                  {starting === `recheck:${race.number}` ? 'Starting…' : raceJob?.raceNumber === race.number ? 'Checking…' : 'Pre-race check this race'}
                </button>
              )}
              {raceJob && raceJob.raceNumber !== race.number && <span className="small muted">Checking Race {raceJob.raceNumber}…</span>}
            </div>
            {raceJob && raceJob.raceNumber === race.number && (
              <div className="race-top__job">
                <InlineJob jobId={raceJob.id} title={raceJob.title} onFinished={onJobFinished} onClear={() => setRaceJob(null)} />
              </div>
            )}
            {prediction?.summary && <p className="race-top__summary">{prediction.summary}</p>}
            {watchLineVisible(race, result, watch, autoResultsOn, now) && (() => {
              const line = resultWatchLine(watch, result, autoResultsOn, now);
              // Not a live region: its relative times tick every 30 s and would be re-announced; results are announced by the toast.
              return (
                <p className={`result-watch result-watch--${line.tone}`} data-testid="result-watch">
                  <span className="result-watch__icon" aria-hidden>
                    {line.tone === 'amber' ? '⚠' : '⟳'}
                  </span>
                  {line.text}
                </p>
              );
            })()}
          </section>

          {result &&
            (nextRace ? (
              <a href={routes.pack(id, nextRace.number)} className="next-race" onClick={() => setSection('prediction')} data-testid="next-race-bar" data-race={nextRace.number}>
                <span className="next-race__label">Next:</span>
                <strong>
                  R{nextRace.number}
                  {(() => {
                    const c = countdown(nextRace.startTime, now);
                    return c.tone === 'unknown' ? '' : ` ${c.text.charAt(0).toLowerCase()}${c.text.slice(1)}`;
                  })()}
                </strong>
                <span className="next-race__meta small">
                  {nextRace.name} · {fmtDistance(nextRace.distance)} · {fmtTime(nextRace.startTime, tz)}
                </span>
                <span className="next-race__arrow" aria-hidden>
                  →
                </span>
              </a>
            ) : (
              <p className="next-race next-race--done" data-testid="next-race-bar">
                <span className="next-race__label">That's the card:</span> <strong>every race has a result.</strong>
              </p>
            ))}

          {/* ------------------------------------------------ section tabs */}
          <nav className="section-tabs" role="tablist" aria-label="Race details" data-testid="section-tabs">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                type="button"
                role="tab"
                id={`section-tab-${s.key}`}
                aria-controls={`section-panel-${s.key}`}
                aria-selected={section === s.key}
                className={`section-tab ${section === s.key ? 'is-active' : ''}`}
                onClick={() => setSection(s.key)}
                data-testid={s.testId}
              >
                {s.label}
                {sectionCount[s.key] != null && <span className="section-tab__count">{sectionCount[s.key]}</span>}
              </button>
            ))}
          </nav>

          {/* -------------------------------------------------- prediction */}
          {section === 'prediction' && (
            <div className="section" data-testid="prediction-panel" id="section-panel-prediction" role="tabpanel">
              {!prediction ? (
                <EmptyState icon="🔮" title="No prediction yet for this race" action={<button type="button" className="btn btn-primary" onClick={() => startJob('recheck', race.number)}>Run a pre-race check</button>}>
                  {race.status === 'abandoned' ? 'This race was abandoned.' : 'Run a pre-race check and we will rate the field.'}
                </EmptyState>
              ) : (
                <>
                  {prediction.betting && <BetSummary plan={prediction.betting} runners={runnerByNo} />}
                  <div className="section-title">
                    <h2>Our finishing order</h2>
                    <span className="small muted">
                      Generated {fmtRelative(prediction.generatedAt, now)} · {prediction.modelVersion}
                    </span>
                    {prediction.postJump && (
                      <Chip tone="amber" title="First rated after this race had started: shown for reference, not scored" testId="post-jump-chip">
                        Rated after the jump
                      </Chip>
                    )}
                  </div>
                  <div className="ranked-list" data-testid="ranked-list" key={race.number}>
                    {(prediction.top ?? prediction.ranked ?? []).slice(0, 6).map((a) => (
                      <RankedRunnerCard key={a.runnerId || a.number} assessment={a} runner={runnerById.get(a.runnerId) ?? runnerByNo.get(a.number)} />
                    ))}
                  </div>
                  {(prediction.ranked ?? []).length > (prediction.top ?? []).length && (
                    <details className="card others">
                      <summary>The rest of the field ({prediction.ranked.length - (prediction.top ?? []).length} more)</summary>
                      <div className="table-wrap">
                        <table className="table table--tight">
                          <thead>
                            <tr>
                              <th className="num">Rank</th>
                              <th>Horse</th>
                              <th className="num">Win</th>
                              <th className="num">Place</th>
                              <th className="num">Best odds</th>
                            </tr>
                          </thead>
                          <tbody>
                            {prediction.ranked
                              .filter((a) => !(prediction.top ?? []).some((t) => t.runnerId === a.runnerId))
                              .map((a) => (
                                <tr key={a.runnerId || a.number}>
                                  <td className="num">{a.rank}</td>
                                  <td>
                                    <Saddle number={a.number} /> {a.name}
                                  </td>
                                  <td className="num">{fmtPct(a.winProb)}</td>
                                  <td className="num">{fmtPct(a.placeProb)}</td>
                                  <td className="num">{fmtOdds(a.bestOdds)}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
                  <div className="two-col">
                    <ConfidenceMeter rating={prediction.confidence} />
                    <BettingPlanView plan={prediction.betting} runners={runnerByNo} sizedWith={data.settings} current={liveSettings.data ?? undefined} />
                  </div>
                  {(prediction.dayPatternsApplied ?? []).length > 0 && (
                    <p className="small muted">Day patterns applied to this race: {prediction.dayPatternsApplied.map((p) => p.label).join(', ')}.</p>
                  )}
                  {prediction.changes && prediction.changes.length > 0 && <ChangesList changes={prediction.changes} title="What changed since the last check" />}
                </>
              )}
            </div>
          )}

          {section === 'field' && (
            <div className="section" data-testid="field-panel" id="section-panel-field" role="tabpanel">
              <FieldTable key={race.number} race={race} names={names} tz={tz} />
            </div>
          )}

          {section === 'verification' && (
            <div className="section" id="section-panel-verification" role="tabpanel">
              <VerificationView key={race.number} race={race} names={names} />
            </div>
          )}

          {section === 'news' && (
            <div className="section news-groups" data-testid="news-panel" id="section-panel-news" role="tabpanel">
              <div className="card">
                <h3>About this race</h3>
                <NewsItems items={raceNews.race} names={names} />
              </div>
              <div className="card">
                <h3>Around the meeting</h3>
                <NewsItems items={raceNews.meeting} names={names} />
              </div>
            </div>
          )}

          {section === 'result' && (
            <div className="section" id="section-panel-result" role="tabpanel">
              <ResultView key={race.number} race={race} result={result} prediction={prediction} onManual={saveManual} onFetch={() => startJob('results', race.number)} busy={raceJob?.raceNumber === race.number || starting === `results:${race.number}`} names={names} tz={tz} />
            </div>
          )}
        </div>
      )}

      <HistoryPanel history={data.history ?? []} />
    </div>
  );
}
