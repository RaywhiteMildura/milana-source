import type { BetSuggestion, BettingPlan, Runner, Settings } from '@shared/types';
import { betTypeLabel, fmtMoney, ordinal, priorityLabel, stanceBlurb, stanceLabel, stanceTone } from '../lib/format';
import { Chip } from './ui';

export const DISCLAIMER = 'Suggestions only. Bet responsibly. Gambling Help 1800 858 858.';

const PRIORITY_ORDER: BetSuggestion['priority'][] = ['core', 'value', 'saver', 'fun'];

function runnerLabel(n: number, runners: Map<number, Runner>): string {
  const r = runners.get(n);
  return r ? `${n} ${r.name}` : `No. ${n}`;
}

/** The disclaimer-style notes ("Suggestions only…") stay small; the rest (price marks, warnings) must be easy to read. */
const isFinePrint = (note: string) => /^suggestions only/i.test(note.trim());

/** The note worth repeating at the top: one naming a price to wait for, else the first real note. */
export function keyNote(plan: BettingPlan): string | undefined {
  const notes = (plan.notes ?? []).filter((n) => !isFinePrint(n));
  return notes.find((n) => /\$\d/.test(n)) ?? notes[0];
}

/** "3 Marmalade Sky" for one runner, "3, 5, 7" for several, "3 / 5, 7 / 2, 5, 7" for legs. */
function runnersShort(s: BetSuggestion, runners: Map<number, Runner>): string {
  if (s.legs && s.legs.length) return s.legs.map((leg) => leg.join(', ')).join(' / ');
  const list = s.runners ?? [];
  return list.length === 1 ? runnerLabel(list[0], runners) : list.join(', ');
}

/**
 * The bets at a glance, at the top of the race's picks: on a phone the full
 * betting structure sits below six runner cards. The button jumps to it.
 */
export function BetSummary({ plan, runners }: { plan: BettingPlan; runners: Map<number, Runner> }) {
  const suggestions = [...(plan.suggestions ?? [])].sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority));
  const note = keyNote(plan);
  return (
    <section className="card bet-summary" data-testid="bet-summary" aria-labelledby="bet-summary-title">
      <header className="bet-summary__head">
        <h3 id="bet-summary-title">Bets for this race</h3>
        <Chip tone={stanceTone(plan.stance)} className="stance">
          {stanceLabel(plan.stance)}
        </Chip>
      </header>
      {suggestions.length ? (
        <ul className="bet-summary__list">
          {suggestions.map((s, i) => {
            // The price to insist on ("Take $6.69 or better"), when the rationale names one.
            const mark = s.rationale?.match(/\$\d+(?:\.\d+)?\s+or better/i)?.[0];
            return (
              <li key={i} className="bet-summary__row" data-testid="bet-summary-row">
                <span className="bet-summary__type">{betTypeLabel(s.type)}</span>
                <span className="bet-summary__runners">
                  {runnersShort(s, runners)}
                  {mark && <span className="bet-summary__mark small">take {mark}</span>}
                </span>
                <strong className="bet-summary__stake">{fmtMoney(s.stakeAmount)}</strong>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="bet-summary__none">No bets suggested{plan.stance === 'skip' ? ' – we would skip it.' : '.'}</p>
      )}
      {note && <p className="bet-summary__note">{note}</p>}
      <div className="bet-summary__foot">
        <span className="small muted">Suggestions only. Bet responsibly.</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => document.getElementById('betting-plan')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          data-testid="bet-summary-more"
        >
          Full betting structure ↓
        </button>
      </div>
    </section>
  );
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

export function BettingPlanView({ plan, runners, sizedWith, current }: { plan: BettingPlan; runners: Map<number, Runner>; sizedWith?: Settings; current?: Settings }) {
  const suggestions = plan.suggestions ?? [];
  const stale = !!sizedWith && !!current && (sizedWith.unitAmount !== current.unitAmount || sizedWith.riskProfile !== current.riskProfile);
  const groups = PRIORITY_ORDER.map((p) => ({ p, items: suggestions.filter((s) => s.priority === p) })).filter((g) => g.items.length);

  return (
    <section className="card betting" id="betting-plan" data-testid="betting-plan" data-stance={plan.stance}>
      <header className="betting__head">
        <div>
          <h3>Betting structure</h3>
          <p className="muted small">{stanceBlurb(plan.stance)}</p>
        </div>
        <Chip tone={stanceTone(plan.stance)} className="stance" testId="stance-badge">
          {stanceLabel(plan.stance)}
        </Chip>
      </header>

      {stale && (
        <p className="banner banner--warn small" data-testid="stakes-stale">
          Stakes were sized to a {fmtMoney(sizedWith!.unitAmount)} unit ({sizedWith!.riskProfile}). Your unit is now {fmtMoney(current!.unitAmount)} ({current!.riskProfile}) – press Pre-race check to re-size.
        </p>
      )}
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
        <ul className="notes betting__notes">
          {plan.notes.map((n, i) => (
            <li key={i} className={isFinePrint(n) ? 'betting__fine' : undefined}>
              {n}
            </li>
          ))}
        </ul>
      )}
      <p className="disclaimer" data-testid="disclaimer">
        {DISCLAIMER}
      </p>
    </section>
  );
}
