import type { PackEvent } from '@shared/types';
import { fmtDateTime } from '../lib/format';

function icon(type: PackEvent['type']): string {
  switch (type) {
    case 'research':
      return '🔎';
    case 'recheck':
      return '🔄';
    case 'results':
      return '🏁';
    default:
      return '📝';
  }
}

export function ChangesList({ changes, title = 'What changed' }: { changes: string[]; title?: string }) {
  if (!changes.length) return null;
  return (
    <section className="card changes" data-testid="changes">
      <h3>{title}</h3>
      <ol className="timeline">
        {changes.map((c, i) => (
          <li key={i} className="timeline__item">
            <span className="timeline__dot" />
            <span>{c}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function HistoryPanel({ history, defaultOpen = false }: { history: PackEvent[]; defaultOpen?: boolean }) {
  const events = [...history].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return (
    <details className="card history" data-testid="history-panel" open={defaultOpen}>
      <summary data-testid="history-toggle">
        History <span className="muted">({events.length} {events.length === 1 ? 'event' : 'events'})</span>
      </summary>
      {events.length === 0 ? (
        <p className="muted small">Nothing has happened yet.</p>
      ) : (
        <ol className="timeline">
          {events.map((e, i) => (
            <li key={`${e.at}-${i}`} className="timeline__item" data-testid="history-event" data-type={e.type}>
              <span className="timeline__dot" aria-hidden>
                {icon(e.type)}
              </span>
              <div className="timeline__body">
                <div>
                  <strong>{e.summary}</strong>
                  {e.raceNumber != null && <span className="chip chip--neutral chip--xs">R{e.raceNumber}</span>}
                </div>
                <div className="small muted">{fmtDateTime(e.at)}</div>
                {e.changes && e.changes.length > 0 && (
                  <ul className="small plain">
                    {e.changes.map((c, j) => (
                      <li key={j}>• {c}</li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
