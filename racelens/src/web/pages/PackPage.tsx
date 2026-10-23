import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { JobProgress, MeetingPack, NewsItem, Race } from '@shared/types';
import { normaliseName, normalisePerson, parseTrackRating, trackRatingLabel } from '@shared/util';
import { api, errorMessage, useRequest } from '../lib/api';
import { countdown, fmtDistance, fmtLongDate, fmtMoney, fmtOdds, fmtPct, fmtRelative, fmtTime, plural, raceStatusLabel, verificationWord } from '../lib/format';
import { useNow } from '../lib/hooks';
import { navigate, routes } from '../lib/router';
import { BettingPlanView } from '../components/BettingPlanView';
import { ConfidenceMeter } from '../components/ConfidenceMeter';
import { DayPatterns } from '../components/DayPatterns';
import { FieldTable, NewsItems } from '../components/FieldTable';
import { ChangesList, HistoryPanel } from '../components/HistoryPanel';
import { InlineJob } from '../components/JobProgressPanel';
import { RankedRunnerCard } from '../components/RankedRunnerCard';
import { ResultView } from '../components/ResultView';
import { useToast } from '../components/Toast';
import { VerificationView } from '../components/VerificationView';
import { Chip, EmptyState, ErrorState, Ring, Saddle, Skeleton, SkeletonCard } from '../components/ui';

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
  const now = useNow(30_000);
  const pack = useRequest(() => api.getPack(id), [id]);
  const sources = useRequest(() => api.getSources().then((r) => Object.fromEntries(r.sources.map((s) => [s.id, s.name])) as Record<string, string>), []);
  const names = sources.data ?? undefined;
  const [section, setSection] = useState<Section>('prediction');
  const [packJob, setPackJob] = useState<ActiveJob | null>(null);
  const [raceJob, setRaceJob] = useState<ActiveJob | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  const data = pack.data;
  const races = useMemo(() => (data ? [...(data.races ?? [])].sort((a, b) => a.number - b.number) : []), [data]);

  const selectedNumber = useMemo(() => {
    if (!data || !races.length) return null;
    const fromParam = raceParam ? Number(raceParam) : NaN;
    if (Number.isInteger(fromParam) && races.some((r) => r.number === fromParam)) return fromParam;
    const results = data.results ?? {};
    const upcoming = races.find((r) => !results[r.number] && r.status !== 'abandoned' && (!r.startTime || new Date(r.startTime).getTime() > Date.now()));
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
    if (job.status === 'done') {
      toast.success(job.type === 'results' ? 'Results updated' : 'Pre-race check complete – page refreshed');
    } else {
      toast.error(job.error || 'The check failed. Try again in a moment.');
    }
  };

  const saveManual = async (placings: number[][]): Promise<boolean> => {
    if (!data || !race) return false;
    try {
      const updated = await api.manualResult(data.id, race.number, placings);
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

  if (pack.error || !data) {
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
            </div>
            {w && (w.rainLast72hMm != null || w.rainRaceDayMm != null || w.maxTempC != null || w.windKmhMax != null) && (
              <p className="small muted pack-head__weather">
                {w.rainLast72hMm != null && `Rain last 72h: ${w.rainLast72hMm}mm`}
                {w.rainRaceDayMm != null && ` · Race day rain: ${w.rainRaceDayMm}mm`}
                {w.maxTempC != null && ` · Max ${Math.round(w.maxTempC)}°C`}
                {w.windKmhMax != null && ` · Wind to ${Math.round(w.windKmhMax)} km/h`}
                {w.conditionDrift != null && w.conditionDrift !== 0 && ` · Track may go ${w.conditionDrift > 0 ? 'softer' : 'firmer'}`}
              </p>
            )}
          </div>
          <Ring
            value={data.verificationScore}
            size={92}
            stroke={9}
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
          <nav className="race-tabs" role="tablist" aria-label="Races" data-testid="race-tabs">
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
                    {fmtDistance(r.distance)} · {fmtTime(r.startTime)}
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
              <div className={`countdown countdown--${cd.tone}`} data-testid="countdown">
                <strong>{cd.text}</strong>
                <span className="muted">{fmtTime(race.startTime)}</span>
              </div>
            </div>
            <div className="race-top__side">
              <Ring value={race.verification?.score ?? 0} size={56} stroke={6} caption={<span className="small muted">{plural(race.verification?.sourceCount ?? 0, 'source')}</span>} testId="race-verification" />
              <button type="button" className="btn btn-primary" onClick={() => startJob('recheck', race.number)} disabled={!!raceJob || starting === `recheck:${race.number}`} data-testid="recheck-btn">
                {starting === `recheck:${race.number}` ? 'Starting…' : 'Pre-race check this race'}
              </button>
            </div>
            {raceJob && (
              <div className="race-top__job">
                <InlineJob jobId={raceJob.id} title={raceJob.title} onFinished={onJobFinished} onClear={() => setRaceJob(null)} />
              </div>
            )}
            {prediction?.summary && <p className="race-top__summary">{prediction.summary}</p>}
          </section>

          {/* ------------------------------------------------ section tabs */}
          <nav className="section-tabs" role="tablist" aria-label="Race details" data-testid="section-tabs">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                type="button"
                role="tab"
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
            <div className="section" data-testid="prediction-panel">
              {!prediction ? (
                <EmptyState icon="🔮" title="No prediction yet for this race" action={<button type="button" className="btn btn-primary" onClick={() => startJob('recheck', race.number)}>Run a pre-race check</button>}>
                  {race.status === 'abandoned' ? 'This race was abandoned.' : 'Run a pre-race check and we will rate the field.'}
                </EmptyState>
              ) : (
                <>
                  <div className="section-title">
                    <h2>Our finishing order</h2>
                    <span className="small muted">
                      Generated {fmtRelative(prediction.generatedAt, now)} · {prediction.modelVersion}
                    </span>
                  </div>
                  <div className="ranked-list" data-testid="ranked-list">
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
                    <BettingPlanView plan={prediction.betting} runners={runnerByNo} />
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
            <div className="section" data-testid="field-panel">
              <FieldTable race={race} names={names} />
            </div>
          )}

          {section === 'verification' && (
            <div className="section">
              <VerificationView race={race} names={names} />
            </div>
          )}

          {section === 'news' && (
            <div className="section news-groups" data-testid="news-panel">
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
            <div className="section">
              <ResultView race={race} result={result} prediction={prediction} onManual={saveManual} onFetch={() => startJob('results', race.number)} busy={!!raceJob || starting === `results:${race.number}`} names={names} />
            </div>
          )}
        </div>
      )}

      <HistoryPanel history={data.history ?? []} />
    </div>
  );
}
