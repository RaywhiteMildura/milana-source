import type { DayPattern } from '@shared/types';
import { Bar } from './ui';

export function DayPatterns({ patterns }: { patterns: DayPattern[] }) {
  if (!patterns.length) return null;
  return (
    <section className="patterns" data-testid="day-patterns">
      <div className="section-title">
        <h2>Day patterns</h2>
        <span className="muted small">What the results so far are telling us about the track</span>
      </div>
      <div className="patterns__grid">
        {patterns.map((p) => (
          <article key={p.key} className="card pattern">
            <h3>{p.label}</h3>
            <p>{p.detail}</p>
            <Bar label="How strong" value={p.strength} tone={p.strength >= 0.66 ? 'green' : p.strength >= 0.33 ? 'amber' : 'neutral'} compact />
            {p.basedOnRaces.length > 0 && <p className="small muted">Based on {p.basedOnRaces.map((r) => `R${r}`).join(', ')}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
