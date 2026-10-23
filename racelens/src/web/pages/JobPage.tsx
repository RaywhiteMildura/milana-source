import { useEffect, useState } from 'react';
import { api, errorMessage, useJobPoll } from '../lib/api';
import { navigate, routes } from '../lib/router';
import { JobProgressPanel } from '../components/JobProgressPanel';
import { useToast } from '../components/Toast';
import { ErrorState } from '../components/ui';

/** Split a meeting id `${date}:${venueSlug}` back into its parts. */
function splitMeetingId(meetingId: string): { date: string; venueSlug: string } | null {
  const idx = meetingId.indexOf(':');
  if (idx <= 0) return null;
  return { date: meetingId.slice(0, idx), venueSlug: meetingId.slice(idx + 1) };
}

export function JobPage({ id, query }: { id: string; query: URLSearchParams }) {
  const toast = useToast();
  const { job, error } = useJobPoll(id);
  const target = job?.meetingId ?? query.get('to') ?? undefined;
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (job?.status !== 'done') return;
    const t = window.setTimeout(() => navigate(target ? routes.pack(target) : routes.home(), true), 900);
    return () => window.clearTimeout(t);
  }, [job?.status, target]);

  const retry = async () => {
    const parts = target ? splitMeetingId(target) : null;
    if (!parts || job?.type !== 'research') {
      navigate(target ? routes.pack(target) : routes.home(), true);
      return;
    }
    setRetrying(true);
    try {
      const r = await api.research({ date: parts.date, venueSlug: parts.venueSlug, force: true });
      navigate(routes.job(r.jobId, r.meetingId), true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRetrying(false);
    }
  };

  const gone = !job && !!error && /not found/i.test(error);

  return (
    <div className="page page--job">
      <a href={routes.home()} className="back">
        ← Back to race days
      </a>
      {gone ? (
        <ErrorState title="We lost track of that job" message="The server may have restarted. Head back and start the research again – it only takes a moment." onRetry={() => navigate(routes.home(), true)} />
      ) : (
        <>
          <JobProgressPanel job={job} error={error} onRetry={retrying ? undefined : retry} />
          {job?.status === 'done' && (
            <p className="center muted" data-testid="job-done">
              All done – opening the research…
            </p>
          )}
          {job?.status === 'error' && target && (
            <p className="center small muted">
              {job.type === 'research' ? 'Retry runs the research again from scratch.' : ''}{' '}
              <a href={routes.pack(target)}>Open what we have</a>
            </p>
          )}
          {(job?.status === 'queued' || job?.status === 'running' || !job) && !error && (
            <p className="center small muted">This usually takes under a minute. You can leave this page – the job keeps running.</p>
          )}
        </>
      )}
    </div>
  );
}
