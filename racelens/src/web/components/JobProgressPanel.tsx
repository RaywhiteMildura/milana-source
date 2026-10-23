import { useEffect, useRef } from 'react';
import type { JobProgress, JobStepStatus } from '@shared/types';
import { useJobPoll } from '../lib/api';

function StepIcon({ status }: { status: JobStepStatus }) {
  switch (status) {
    case 'running':
      return <span className="spinner spinner--sm" aria-label="Running" />;
    case 'done':
      return <span aria-label="Done">✓</span>;
    case 'warn':
      return <span aria-label="Warning">⚠</span>;
    case 'error':
      return <span aria-label="Error">✕</span>;
    case 'skipped':
      return <span aria-label="Skipped">–</span>;
    default:
      return <span aria-label="Pending">○</span>;
  }
}

export function jobTitle(job: JobProgress | null | undefined): string {
  if (!job) return 'Getting started…';
  switch (job.type) {
    case 'research':
      return job.status === 'done' ? 'Research complete' : 'Researching the meeting';
    case 'recheck':
      return job.status === 'done' ? 'Pre-race check complete' : job.raceNumber ? `Pre-race check – Race ${job.raceNumber}` : 'Pre-race check – all races';
    case 'results':
      return job.status === 'done' ? 'Results fetched' : 'Fetching results';
    case 'probe':
      return job.status === 'done' ? 'Source check complete' : 'Checking sources';
    default:
      return 'Working…';
  }
}

export function JobProgressPanel({
  job,
  error,
  title,
  compact = false,
  onRetry,
  onDismiss,
}: {
  job: JobProgress | null;
  error?: string | null;
  title?: string;
  compact?: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const status = job?.status ?? 'loading';
  const pct = job ? Math.max(0, Math.min(100, job.percent)) : 3;
  const isError = status === 'error';
  return (
    <section className={`job card job--${status} ${compact ? 'job--compact' : ''}`} data-testid="job-progress" data-status={status} aria-live="polite">
      <header className="job__head">
        <h3>{title ?? jobTitle(job)}</h3>
        <span className="job__pct">{job ? `${pct}%` : '…'}</span>
      </header>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className={`progress__fill ${isError ? 'progress__fill--error' : status === 'done' ? 'progress__fill--done' : ''}`} style={{ width: `${pct}%` }} />
      </div>
      <p className={`job__message ${isError ? 'text-error' : ''}`}>
        {isError ? job?.error || job?.message || 'Something went wrong.' : job?.message || 'Starting up…'}
      </p>
      {error && !isError && <p className="small text-warn">Connection hiccup: {error}. Still trying…</p>}
      {job && job.steps.length > 0 && (
        <ol className="steps">
          {job.steps.map((s) => (
            <li key={s.key} className={`step step--${s.status}`}>
              <span className="step__icon">
                <StepIcon status={s.status} />
              </span>
              <div className="step__body">
                <div className="step__label">{s.label}</div>
                {s.detail && <div className="step__detail">{s.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {isError && (onRetry || onDismiss) && (
        <div className="job__actions">
          {onRetry && (
            <button type="button" className="btn btn-primary" onClick={onRetry} data-testid="job-retry">
              Retry
            </button>
          )}
          {onDismiss && (
            <button type="button" className="btn btn-secondary" onClick={onDismiss} data-testid="job-dismiss">
              Dismiss
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Self-contained polling panel used inline (pre-race check, results fetch,
 * source probe). Calls `onFinished` once, then `onClear` after a short pause so
 * the person sees the "complete" state before it disappears.
 */
export function InlineJob({
  jobId,
  title,
  onFinished,
  onClear,
  clearAfterMs = 1800,
}: {
  jobId: string;
  title?: string;
  onFinished: (job: JobProgress) => void;
  onClear: () => void;
  clearAfterMs?: number;
}) {
  const { job, error } = useJobPoll(jobId);
  const handled = useRef(false);
  const finishedRef = useRef(onFinished);
  const clearRef = useRef(onClear);
  finishedRef.current = onFinished;
  clearRef.current = onClear;

  useEffect(() => {
    if (!job || handled.current) return;
    if (job.status === 'done' || job.status === 'error') {
      handled.current = true;
      finishedRef.current(job);
      const t = window.setTimeout(() => clearRef.current(), job.status === 'done' ? clearAfterMs : 12_000);
      return () => window.clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

  return <JobProgressPanel job={job} error={error} title={title} compact onDismiss={job?.status === 'error' ? () => clearRef.current() : undefined} />;
}
