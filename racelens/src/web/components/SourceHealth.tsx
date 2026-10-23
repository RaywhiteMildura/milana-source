import { useState } from 'react';
import { api, errorMessage, type SourceInfo } from '../lib/api';
import { fmtRelative, type Tone } from '../lib/format';
import { InlineJob } from './JobProgressPanel';
import { Dot, Skeleton } from './ui';
import { useToast } from './Toast';

export function sourceTone(s: SourceInfo): { tone: Tone; word: string } {
  if (!s.enabled) return { tone: 'neutral', word: 'Turned off in settings' };
  const st = s.lastStatus;
  if (!st) return { tone: 'neutral', word: 'Not checked yet' };
  if (!st.ok) return { tone: 'red', word: `Failed: ${st.error ?? 'no response'}` };
  if (st.itemCount === 0 || st.ms > 8000) return { tone: 'amber', word: st.itemCount === 0 ? 'Working but returned nothing' : `Working but slow (${Math.round(st.ms / 1000)}s)` };
  return { tone: 'green', word: `Working (${st.ms}ms${st.itemCount != null ? `, ${st.itemCount} items` : ''})` };
}

export function SourceHealth({ sources, loading, onRefresh }: { sources: SourceInfo[] | null; loading: boolean; onRefresh: () => void }) {
  const toast = useToast();
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const probe = async () => {
    setStarting(true);
    try {
      const { jobId: id } = await api.probeSources();
      setJobId(id);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  const enabled = sources?.filter((s) => s.enabled) ?? [];
  const checked = enabled.filter((s) => s.lastStatus);
  const healthy = checked.filter((s) => s.lastStatus?.ok).length;
  const lastChecked = sources?.map((s) => s.lastStatus?.fetchedAt).filter(Boolean).sort().pop();
  const headline =
    loading && !sources
      ? 'Checking…'
      : !sources
        ? 'Could not load sources'
        : checked.length === 0
          ? 'Not checked yet – tap Check sources'
          : `${healthy} of ${checked.length} checked ${checked.length === 1 ? 'is' : 'are'} working${lastChecked ? ` · checked ${fmtRelative(lastChecked)}` : ''}`;

  return (
    <section className="card sources" data-testid="source-health">
      <header className="sources__head">
        <div>
          <h3>Data sources</h3>
          <p className="small muted" data-testid="source-headline">
            {headline}
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={probe} disabled={starting || !!jobId} data-testid="probe-btn">
          {starting || jobId ? 'Checking…' : 'Check sources'}
        </button>
      </header>
      {jobId && (
        <InlineJob
          jobId={jobId}
          title="Checking sources"
          onFinished={(job) => {
            onRefresh();
            if (job.status === 'done') toast.success('Source check finished');
            else toast.error(job.error || 'Source check failed');
          }}
          onClear={() => setJobId(null)}
        />
      )}
      <ul className="sources__list">
        {loading && !sources
          ? Array.from({ length: 5 }).map((_, i) => (
              <li key={i}>
                <Skeleton h={14} w={110} />
              </li>
            ))
          : (sources ?? []).map((s) => {
              const { tone, word } = sourceTone(s);
              return (
                <li key={s.id} className={`sources__item ${s.enabled ? '' : 'is-disabled'}`} title={`${s.name} – ${word}`} data-testid="source-item" data-tone={tone}>
                  <Dot tone={tone} />
                  <span className="sources__name">{s.name}</span>
                  <span className="small muted sources__kind">{s.kind}</span>
                </li>
              );
            })}
      </ul>
    </section>
  );
}
