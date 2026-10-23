import { useEffect, useRef, useState } from 'react';
import { ApiError, api, errorMessage, type UpdateStatus } from '../lib/api';
import { deviceZone, fmtDateTime } from '../lib/format';
import { useConfirm } from './Confirm';
import { useToast } from './Toast';
import { Chip, Spinner } from './ui';

/** How often the card asks how an update is going. */
const POLL_MS = 5000;
/** Stop asking when an update has not finished after this long (it normally takes 3–5 minutes). */
const GIVE_UP_MS = 20 * 60_000;

const CONFIRM_MESSAGE =
  'The Mac mini downloads and builds the latest version (about 3–5 minutes). RaceLens keeps working meanwhile and restarts for a few seconds at the end. If the new version does not start, it goes back to this one by itself.';

const shortCommit = (c?: string) => (c ? c.slice(0, 7) : undefined);
const when = (iso?: string) => (iso ? fmtDateTime(iso, deviceZone()) : undefined);
const underWay = (s: UpdateStatus | null) => s?.state === 'requested' || s?.state === 'running';

/**
 * Settings → "RaceLens version": the version the server runs and, where the
 * Mac-side updater is installed (GET /api/update says `supported`), a button
 * that updates it from the phone, then its progress every 5 s until it is done
 * or failed, and a Reload into the new version. Not shown at all when the
 * server has no /api/update (an older version) or cannot be reached.
 */
export function UpdateCard() {
  const confirm = useConfirm();
  const toast = useToast();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [missing, setMissing] = useState(false);
  const [starting, setStarting] = useState(false);
  /** Following an update started here (or found under way): ask until it finishes. */
  const [following, setFollowing] = useState(false);
  /** How the update followed here ended. */
  const [outcome, setOutcome] = useState<'done' | 'failed' | 'gave-up' | null>(null);
  const followedSince = useRef(0);
  /** The update has been seen under way: a 'done' or 'failed' left from an earlier one does not count before that. */
  const seenUnderWay = useRef(false);

  const follow = () => {
    followedSince.current = Date.now();
    setOutcome(null);
    setFollowing(true);
  };

  useEffect(() => {
    let cancelled = false;
    api
      .getUpdate()
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        if (underWay(s)) {
          seenUnderWay.current = true;
          follow();
        }
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!following) return;
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const s = await api.getUpdate();
        if (cancelled) return;
        setStatus(s);
        if (underWay(s)) seenUnderWay.current = true;
        const startedHere = !!s.last?.startedAt && Date.parse(s.last.startedAt) >= followedSince.current - 2 * 60_000;
        if ((s.state === 'done' || s.state === 'failed') && (seenUnderWay.current || startedHere)) {
          setFollowing(false);
          setOutcome(s.state);
          return;
        }
      } catch {
        if (cancelled) return;
        /* RaceLens restarts for a few seconds at the end: keep asking */
      }
      if (Date.now() - followedSince.current > GIVE_UP_MS) {
        setFollowing(false);
        setOutcome('gave-up');
        return;
      }
      timer = window.setTimeout(tick, POLL_MS);
    };
    timer = window.setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [following]);

  const start = async () => {
    const ok = await confirm({ title: 'Update RaceLens?', message: CONFIRM_MESSAGE, confirmLabel: 'Update' });
    if (!ok) return;
    setStarting(true);
    try {
      const r = await api.startUpdate();
      toast.info(r.message || 'Update started.');
      seenUnderWay.current = false;
      setStatus((s) => (s ? { ...s, state: 'requested' } : s));
      follow();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Already running (started from another phone, or the Mac): follow that one.
        toast.info(e.message);
        seenUnderWay.current = true;
        follow();
      } else if (e instanceof ApiError && e.status === 501) {
        toast.error(e.message);
        setStatus((s) => (s ? { ...s, supported: false } : s));
      } else {
        toast.error(errorMessage(e));
      }
    } finally {
      setStarting(false);
    }
  };

  if (missing || !status) return null;
  const v = status.version;
  const last = status.last;
  const busy = following || underWay(status);

  return (
    <section className="card update-card" data-testid="update-card">
      <div className="update-card__head">
        <h2>RaceLens version</h2>
        {busy && (
          <Chip tone="blue" testId="update-chip">
            Updating
          </Chip>
        )}
        {!busy && outcome === 'done' && <Chip tone="green">Updated</Chip>}
        {!busy && outcome === 'failed' && <Chip tone="red">Update failed</Chip>}
      </div>
      <p className="update-card__version" data-testid="update-version">
        {shortCommit(v?.commit) ? <span className="mono">{shortCommit(v?.commit)}</span> : 'Version not known'}
        {v?.installedAt && <span className="muted"> · installed {when(v.installedAt)}</span>}
      </p>

      {status.supported && (
        <>
          {busy ? (
            <p className="update-card__progress" role="status" data-testid="update-progress">
              <Spinner size={16} />
              <span>
                {status.state === 'running'
                  ? 'Updating: the Mac mini is downloading and building the new version (about 3–5 minutes). RaceLens keeps working meanwhile and restarts for a few seconds at the end.'
                  : 'Update requested – waiting for the Mac mini to start it…'}
              </span>
            </p>
          ) : outcome === 'done' ? (
            <div className="update-card__done" data-testid="update-done">
              <p className="text-green">✓ Updated{shortCommit(last?.to ?? v?.commit) ? ` to ${shortCommit(last?.to ?? v?.commit)}` : ''}. Reload to use the new version.</p>
              <button type="button" className="btn btn-primary" onClick={() => window.location.reload()} data-testid="update-reload">
                Reload
              </button>
            </div>
          ) : (
            <>
              {outcome === 'failed' && (
                <p className="text-error small" role="alert" data-testid="update-failed">
                  The update did not finish{last?.message ? `: ${last.message}` : ''}. RaceLens is still running the version above.
                </p>
              )}
              {outcome === 'gave-up' && (
                <p className="text-amber small" data-testid="update-gave-up">
                  No word from the Mac mini for 20 minutes. RaceLens keeps working on the version above; check the Mac when you can.
                </p>
              )}
              {!outcome && last?.finishedAt && (
                <p className="small muted" data-testid="update-last">
                  Last update {when(last.finishedAt)}: {last.ok === false ? `did not finish${last.message ? ` (${last.message})` : ''}` : 'done'}.
                </p>
              )}
              <button type="button" className="btn btn-secondary" onClick={start} disabled={starting} data-testid="update-btn">
                {starting ? 'Starting…' : 'Update RaceLens'}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
