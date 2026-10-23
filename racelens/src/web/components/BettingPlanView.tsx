import type { BetSuggestion, BettingPlan, Runner } from '@shared/types';
import { betTypeLabel, fmtMoney, ordinal, priorityLabel, stanceBlurb, stanceLabel, stanceTone } from '../lib/format';
import { Chip } from './ui';

export const DISCLAIMER = 'Suggestions only. Bet responsibly. Gambling Help 1800 858 858.';

const PRIORITY_ORDER: BetSuggestion['priority'][] = ['core', 'value', 'saver', 'fun'];

function runnerLabel(n: number, runners: Map<number, Runner>): string {
  const r = runners.get(n);
  return r ? `${n} ${r.name}` : `No. ${n}`;
}

function RunnersText({ s, runners }: { s: BetSuggestion; runners: Map<number, Runner> }) {
  if (s.legs && s.legs.length) {
    return (
      <>
        {s.legs.map((leg, i) => (
          <div key={i}>
            <span className="muted small">{ordinal(i + 1)}: </span>
            {leg.map((n) => runnerLabel(n, runners)).join(', ')}
          </div>
        ))}
      </>
    );
  }
  return <>{(s.runners ?? []).map((n) => runnerLabel(n, runners)).join(', ')}</>;
}

export function BettingPlanView({ plan, runners }: { plan: BettingPlan; runners: Map<number, Runner> }) {
  const suggestions = plan.suggestions ?? [];
  const groups = PRIORITY_ORDER.map((p) => ({ p, items: suggestions.filter((s) => s.priority === p) })).filter((g) => g.items.length);

  return (
    <section className="card betting" data-testid="betting-plan" data-stance={plan.stance}>
      <header className="betting__head">
        <div>
          <h3>Betting structure</h3>
          <p className="muted small">{stanceBlurb(plan.stance)}</p>
        </div>
        <Chip tone={stanceTone(plan.stance)} className="stance" testId="stance-badge">
          {stanceLabel(plan.stance)}
        </Chip>
      </header>

      <div className="betting__totals">
        <div className="stat">
          <span className="stat__label">Unit</span>
          <span className="stat__value">{fmtMoney(plan.unitAmount)}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Units</span>
          <span className="stat__value">{plan.totalUnits}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Total outlay</span>
          <span className="stat__value">{fmtMoney(plan.totalAmount)}</span>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="muted">No bets suggested for this race{plan.stance === 'skip' ? ' – we would skip it.' : '.'}</p>
      ) : (
        groups.map((g) => (
          <div key={g.p} className="betting__group">
            <h4 className={`betting__group-title betting__group-title--${g.p}`}>{priorityLabel(g.p)}</h4>
            <ul className="bets">
              {g.items.map((s, i) => (
                <li key={i} className="bet" data-testid="bet-row">
                  <div className="bet__type">
                    <strong>{betTypeLabel(s.type)}</strong>
                    {s.combinations != null && <span className="small muted">{s.combinations} combos</span>}
                    {s.flexiPct != null && <span className="small muted">Flexi {Math.round(s.flexiPct)}%</span>}
                  </div>
                  <div className="bet__body">
                    <div className="bet__runners">
                      {/* legs or flat runner list */}
                      <RunnersText s={s} runners={runners} />
                    </div>
                    <div className="bet__why small muted">{s.rationale}</div>
                  </div>
                  <div className="bet__stake">
                    <strong>{fmtMoney(s.stakeAmount)}</strong>
                    <span className="small muted">{s.stakeUnits}u</span>
                    {s.estimatedReturn && <span className="small bet__return">Could return {s.estimatedReturn}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {plan.notes?.length > 0 && (
        <ul className="notes">
          {plan.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      <p className="disclaimer" data-testid="disclaimer">
        {DISCLAIMER}
      </p>
    </section>
  );
}
