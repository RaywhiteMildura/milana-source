import { useEffect, useMemo, useRef, useState } from 'react';
import type { MeetingSummary } from '@shared/types';
import { parseTrackRating, trackRatingLabel } from '@shared/util';
import { api, errorMessage, useRequest, type PackListItem, isQueued } from '../lib/api';
import { addDays, defaultHomeDate, fmtLongDate, fmtRelative, fmtShortDate, fmtTime, isYmd, meetingZone, nextSaturday, pct100, plural, relativeDayLabel, sourceName, todayYmd, verificationTone } from '../lib/format';
import { navigate, routes } from '../lib/router';
import { savedKeys } from '../lib/saved';
import { useConfirm } from '../components/Confirm';
import { SourceHealth } from '../components/SourceHealth';
import { useToast } from '../components/Toast';
import { Chip, Dot, EmptyState, ErrorState, Ring, SavedCopyBanner, SkeletonCard } from '../components/ui';

function trackLabel(m: MeetingSummary): string {
  const rating = m.trackRating ?? parseTrackRating(m.trackCondition);
  if (rating != null) return trackRatingLabel(rating);
  return m.trackCondition ?? 'Unknown';
}

function MeetingCard({
  meeting: m,
  pack,
  busy,
  names,
  onResearch,
}: {
  meeting: MeetingSummary;
  pack?: PackListItem;
  busy: boolean;
  names?: Record<string, string>;
  onResearch: (m: MeetingSummary, force: boolean) => void;
}) {
  return (
    <article className="card meeting-card" data-testid="meeting-card" data-meeting-id={m.id}>
      <header className="meeting-card__head">
        <div>
          <h3 className="meeting-card__venue">{m.venue}</h3>
          <div className="chips">
            {m.state && <Chip tone="neutral">{m.state}</Chip>}
            {m.raceType !== 'thoroughbred' && <Chip tone="blue">{m.raceType}</Chip>}
            {pack && (
              <Chip tone="green" testId="researched-badge">
                ✓ Researched
              </Chip>
            )}
          </div>
        </div>
        {m.raceCount != null && (
          <div className="meeting-card__count">
            <strong>{m.raceCount}</strong>
            <span className="small muted">races</span>
          </div>
        )}
      </header>
      <dl className="meeting-card__facts">
        <div>
          <dt>Track</dt>
          <dd>{trackLabel(m)}</dd>
        </div>
        <div>
          <dt>Rail</dt>
          <dd>{m.rail ?? '–'}</dd>
        </div>
        <div>
          <dt>First race</dt>
          <dd>{fmtTime(m.firstRaceTime, meetingZone(m))}</dd>
        </div>
        {m.weather && (
          <div>
            <dt>Weather</dt>
            <dd>{m.weather}</dd>
          </div>
        )}
      </dl>
      <div className="meeting-card__sources">
        <span className="small muted">Found by</span>
        <div className="chips">
          {m.sources.length ? (
            m.sources.map((s) => (
              <Chip key={s} tone="neutral" className="chip--xs" testId="meeting-source">
                {sourceName(s, names)}
              </Chip>
            ))
          ) : (
            <span className="small muted">–</span>
          )}
        </div>
      </div>
      <div className="meeting-card__actions">
        {pack ? (
          <>
            <a href={routes.pack(pack.id)} className="btn btn-primary btn-lg" data-testid="open-btn">
              Open research
            </a>
            <button type="button" className="btn btn-ghost" onClick={() => onResearch(m, true)} disabled={busy} data-testid="rerun-btn">
              {busy ? 'Starting…' : 'Re-run'}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary btn-lg" onClick={() => onResearch(m, false)} disabled={busy} data-testid="research-btn">
            {busy ? 'Starting…' : 'Research this meeting'}
          </button>
        )}
      </div>
    </article>
  );
}

function PackRow({ pack: p, onDelete }: { pack: PackListItem; onDelete: (p: PackListItem) => void }) {
  return (
    <li className="card pack-item" data-testid="pack-item">
      <Ring value={p.verificationScore} size={52} stroke={6} />
      <div className="pack-item__main">
        <h3>
          {p.meeting.venue} <span className="muted">· {relativeDayLabel(p.meeting.date)}</span>
        </h3>
        <p className="small muted">
          {fmtLongDate(p.meeting.date)}
          {p.meeting.state ? ` · ${p.meeting.state}` : ''}
        </p>
        <p className="small">
          <Dot tone={verificationTone(p.verificationScore)} /> {pct100(p.verificationScore)}% verified · {p.predictedRaces}/{p.raceCount} races predicted
          {p.resultedRaces > 0 && ` · ${plural(p.resultedRaces, 'result')} in`} · updated {fmtRelative(p.updatedAt)}
        </p>
      </div>
      <div className="pack-item__actions">
        <a href={routes.pack(p.id)} className="btn btn-primary" data-testid="pack-open">
          Open
        </a>
        <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => onDelete(p)} data-testid="pack-delete">
          Delete
        </button>
      </div>
    </li>
  );
}

export function HomePage({ query }: { query: URLSearchParams }) {
  const toast = useToast();
  const confirm = useConfirm();
  const today = todayYmd();
  const tomorrow = addDays(today, 1);
  const saturday = nextSaturday(today);
  const queryDate = query.get('date');
  const date = isYmd(queryDate) ? queryDate : defaultHomeDate();
  const [inputValue, setInputValue] = useState(date);
  useEffect(() => setInputValue(date), [date]);
  // Typing a date: only navigate once the value is complete and plausible, and not on every keystroke.
  useEffect(() => {
    if (!isYmd(inputValue) || inputValue === date) return;
    const year = Number(inputValue.slice(0, 4));
    if (year < 2000 || year > 2100) return;
    const t = window.setTimeout(() => navigate(routes.home(inputValue), true), 400);
    return () => window.clearTimeout(t);
  }, [inputValue, date]);

  const meetings = useRequest(() => api.getMeetings(date), [date]);
  // Kept on the phone, so a stalled connection at the track still lists the research (with a "saved copy" banner).
  const packs = useRequest(() => api.getPacks(), [], savedKeys.packList);
  const sources = useRequest(() => api.getSources().then((r) => r.sources), []);
  // Back from the saved copy: fetch what failed meanwhile.
  const lastSavedAt = useRef<string | null>(null);
  useEffect(() => {
    const was = lastSavedAt.current;
    lastSavedAt.current = packs.savedAt;
    if (!was || packs.savedAt) return;
    if (meetings.error) void meetings.reload();
    if (sources.error) void sources.reload(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packs.savedAt]);
  // Discovery records source statuses server-side: show them once the meetings have loaded.
  useEffect(() => {
    if (meetings.data) void sources.reload(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings.data]);
  const names = useMemo(() => (sources.data ? Object.fromEntries(sources.data.map((s) => [s.id, s.name])) : undefined), [sources.data]);
  const [busy, setBusy] = useState<string | null>(null);

  const setDate = (d: string) => {
    if (isYmd(d)) navigate(routes.home(d));
  };

  const packFor = (m: MeetingSummary) => packs.data?.find((p) => p.id === m.id || (p.meeting.date === m.date && p.meeting.venueSlug === m.venueSlug));

  const research = async (m: MeetingSummary, force: boolean) => {
    if (force) {
      const ok = await confirm({
        title: `Re-run research for ${m.venue}?`,
        message: 'This fetches everything again and replaces the saved research for this meeting.',
        confirmLabel: 'Re-run',
      });
      if (!ok) return;
    }
    setBusy(m.id);
    try {
      const { jobId, meetingId } = await api.research({ date: m.date, venueSlug: m.venueSlug, force });
      navigate(routes.job(jobId, meetingId));
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  };

  const remove = async (p: PackListItem) => {
    const ok = await confirm({
      title: `Delete research for ${p.meeting.venue}?`,
      message: `${fmtLongDate(p.meeting.date)}. The saved predictions, results and history for this meeting will be gone for good.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      const out = await api.deletePack(p.id);
      if (isQueued(out)) {
        // Accepted but queued behind a running check: follow the job, then refresh the list.
        toast.info(out.message);
        for (let i = 0; i < 150; i++) {
          await new Promise((r) => window.setTimeout(r, 2000));
          const job = await api.getJob(out.jobId).catch(() => null);
          if (!job || job.status === 'done' || job.status === 'error') break;
        }
        const left = await api.getPacks().catch(() => null);
        await packs.reload(true);
        if (left && !left.some((x) => x.id === p.id)) toast.success('Research deleted');
        return;
      }
      toast.success('Research deleted');
      await packs.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const failedSources = meetings.data?.sourceStatuses.filter((s) => !s.ok) ?? [];
  const chips: Array<{ label: string; value: string }> = [
    { label: 'Today', value: today },
    { label: 'Tomorrow', value: tomorrow },
    { label: 'Saturday', value: saturday },
  ];

  return (
    <div className="page page--home">
      <section className="hero">
        <h1 className="hero__title">Pick a race day</h1>
        <p className="hero__tagline">Choose a date, then research a meeting. We pull every source we can find and show you one clear view.</p>
        <div className="date-picker" data-testid="date-picker">
          <label className="date-picker__field">
            <span className="small muted">Race day</span>
            <input
              type="date"
              className="input input--date"
              value={inputValue}
              min="2000-01-01"
              max="2100-12-31"
              onChange={(e) => setInputValue(e.target.value)}
              data-testid="date-input"
              aria-label="Race day date"
            />
          </label>
          <div className="date-chips" role="group" aria-label="Quick dates">
            {chips.map((c) => (
              <button
                key={c.label}
                type="button"
                className={`date-chip ${date === c.value ? 'is-active' : ''}`}
                onClick={() => setDate(c.value)}
                aria-pressed={date === c.value}
                data-testid={`date-chip-${c.label.toLowerCase()}`}
              >
                {c.label}
                <span className="date-chip__sub">{fmtShortDate(c.value)}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {packs.savedAt && <SavedCopyBanner savedAt={packs.savedAt} />}

      <div className="home-grid">
        <div className="home-main">
          {(packs.data ?? []).some((p) => p.meeting.date === date) && (
            <section className="saved saved--today" data-testid="today-research">
              <div className="section-title">
                <h2>{date === today ? "Today's research" : date === tomorrow ? "Tomorrow's research" : `Research for ${fmtLongDate(date)}`}</h2>
                <span className="small muted">Ready to open</span>
              </div>
              <ul className="packs-list">
                {(packs.data ?? [])
                  .filter((p) => p.meeting.date === date)
                  .map((p) => (
                    <PackRow key={p.id} pack={p} onDelete={remove} />
                  ))}
              </ul>
            </section>
          )}
          <section className="meetings" data-testid="meetings">
            <div className="section-title">
              <h2>
                Meetings on {fmtLongDate(date)}
                {date === today ? ' (today)' : date === tomorrow ? ' (tomorrow)' : ''}
              </h2>
              {meetings.data && !meetings.loading && (
                <span className="small muted">
                  {plural(meetings.data.meetings.length, 'meeting')}
                  {meetings.data.fromCache ? ' · from cache' : ''}
                </span>
              )}
            </div>

            {meetings.loading ? (
              <div className="meetings-grid" aria-busy="true">
                <SkeletonCard lines={4} />
                <SkeletonCard lines={4} />
                <SkeletonCard lines={4} />
              </div>
            ) : meetings.error ? (
              <ErrorState title="Couldn't load meetings" message={`${meetings.error.replace(/[.!]?\s*$/, '')}. Check your internet connection and try again.`} onRetry={() => meetings.reload()} />
            ) : !meetings.data || meetings.data.meetings.length === 0 ? (
              <EmptyState icon="📅" title="No meetings found for this date" action={<button type="button" className="btn btn-secondary" onClick={() => meetings.reload()}>Try again</button>}>
                No meetings found for this date from any source. Check your internet or try another date.
                {failedSources.length > 0 && (
                  <p className="small">
                    {plural(failedSources.length, 'source')} didn't respond: {failedSources.map((s) => s.name).join(', ')}.
                  </p>
                )}
              </EmptyState>
            ) : (
              <>
                {failedSources.length > 0 && (
                  <p className="banner banner--warn small" data-testid="source-warning">
                    ⚠ {plural(failedSources.length, 'source')} didn't respond ({failedSources.map((s) => s.name).join(', ')}). Meetings below come from the rest.
                  </p>
                )}
                <div className="meetings-grid">
                  {meetings.data.meetings.map((m) => (
                    <MeetingCard key={m.id} meeting={m} pack={packFor(m)} busy={busy === m.id} names={names} onResearch={research} />
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="saved" data-testid="saved-research">
            <div className="section-title">
              <h2>{(packs.data ?? []).some((p) => p.meeting.date === date) ? 'Other saved research' : 'Saved research'}</h2>
              {packs.data && <span className="small muted">{plural(packs.data.filter((p) => p.meeting.date !== date).length, 'meeting')}</span>}
            </div>
            {packs.loading && !packs.data ? (
              <SkeletonCard lines={2} />
            ) : packs.error && !packs.data ? (
              <ErrorState title="Couldn't load saved research" message={packs.error} onRetry={() => packs.reload()} />
            ) : !packs.data || packs.data.length === 0 ? (
              <EmptyState icon="🗂" title="Nothing saved yet">
                Research a meeting above and it will be saved here so you can come back to it on race day.
              </EmptyState>
            ) : packs.data.every((p) => p.meeting.date === date) ? (
              <p className="small muted">Nothing saved for other dates.</p>
            ) : (
              <ul className="packs-list">
                {packs.data
                  .filter((p) => p.meeting.date !== date)
                  .sort((a, b) => (a.meeting.date < b.meeting.date ? 1 : a.meeting.date > b.meeting.date ? -1 : a.updatedAt < b.updatedAt ? 1 : -1))
                  .map((p) => (
                    <PackRow key={p.id} pack={p} onDelete={remove} />
                  ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="home-side">
          <SourceHealth sources={sources.data} loading={sources.loading} onRefresh={() => sources.reload(true)} />
          <section className="card tips">
            <h3>How it works</h3>
            <ol className="tips__list">
              <li>
                <strong>Research</strong> a meeting the night before. We fetch the card, form, odds, weather and news from every source.
              </li>
              <li>
                <strong>Verify</strong> – we cross-check barriers, jockeys and weights between sources and flag anything that doesn't match.
              </li>
              <li>
                <strong>Pre-race check</strong> before each race for scratchings, market moves and track changes.
              </li>
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
