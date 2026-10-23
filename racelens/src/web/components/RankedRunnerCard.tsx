import { useState } from 'react';
import type { FactorScore, Runner, RunnerAssessment } from '@shared/types';
import { fmtOdds, fmtPct, fmtWeight } from '../lib/format';
import { useMediaQuery } from '../lib/hooks';
import { Bar, Chip, RankBadge, Saddle, ScoreBar } from './ui';

/** Same margin the betting plan wants before it calls a runner value: the best price at least 5% above our fair price. */
export const VALUE_EDGE_THRESHOLD = 0.05;
/** On a phone each card shows this many reasons and concerns until "+N more" is tapped (six cards of seven chips each is pages of scrolling). */
const PHONE_CHIPS = 2;

function FactorsTable({ factors }: { factors: FactorScore[] }) {
  if (!factors.length) return <p className="muted small">No factor breakdown available.</p>;
  const sorted = [...factors].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return (
    <div className="table-wrap">
      <table className="table table--tight factors">
        <thead>
          <tr>
            <th>Factor</th>
            <th>Score (−1 … +1)</th>
            <th className="num">Weight</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((f) => (
            <tr key={f.key} className={f.dataQuality < 0.3 ? 'is-faint' : ''}>
              <td data-label="Factor">
                <strong>{f.label}</strong>
                {f.dataQuality < 0.3 && <div className="small muted">Little data behind this</div>}
              </td>
              <td data-label="Score">
                <div className="factor-score">
                  <ScoreBar score={f.score} />
                  <span className={`factor-score__num ${f.score >= 0 ? 'text-green' : 'text-amber'}`}>
                    {f.score >= 0 ? '+' : ''}
                    {f.score.toFixed(2)}
                  </span>
                </div>
              </td>
              <td data-label="Weight" className="num">
                ×{f.weight.toFixed(1)}
              </td>
              <td data-label="Evidence" className="td-wide small">
                {f.evidence}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RankedRunnerCard({ assessment, runner, bookmaker }: { assessment: RunnerAssessment; runner?: Runner; bookmaker?: string }) {
  const [open, setOpen] = useState(false);
  const [allChips, setAllChips] = useState(false);
  const phone = useMediaQuery('(max-width: 480px)');
  const a = assessment;
  const limit = phone && !allChips ? PHONE_CHIPS : Infinity;
  const reasons = (a.reasons ?? []).slice(0, limit);
  const concerns = (a.concerns ?? []).slice(0, limit);
  const hidden = (a.reasons ?? []).length + (a.concerns ?? []).length - reasons.length - concerns.length;
  const hasValue = a.valueEdge != null && a.valueEdge >= VALUE_EDGE_THRESHOLD && a.bestOdds != null;
  const details = [
    runner?.barrier != null ? `Barrier ${runner.barrier}` : null,
    runner?.jockey ? `J: ${runner.jockey}` : null,
    runner?.trainer ? `T: ${runner.trainer}` : null,
    runner?.weight != null ? fmtWeight(runner.weight) : null,
  ].filter(Boolean);
  const bestBook = bookmaker ?? runner?.market?.bestWinBookmaker;

  return (
    <article className={`ranked card rank-${a.rank <= 3 ? a.rank : 'n'}`} data-testid="ranked-runner" data-rank={a.rank} data-number={a.number}>
      <div className="ranked__rank">
        <RankBadge rank={a.rank} />
      </div>
      <div className="ranked__body">
        <header className="ranked__head">
          <Saddle number={a.number} />
          <h3 className="ranked__name">{a.name}</h3>
          {hasValue && (
            <Chip tone="gold" className="value-badge" testId="value-badge" title="The best price on offer pays more than our fair price for this runner">
              VALUE: {fmtOdds(a.bestOdds)} vs fair {fmtOdds(a.fairOdds)}
            </Chip>
          )}
        </header>
        {details.length > 0 && <p className="ranked__details muted">{details.join(' · ')}</p>}

        <div className="ranked__probs">
          <Bar label="Win chance" value={a.winProb} tone="green" />
          <Bar label="Place chance" value={a.placeProb} tone="blue" />
        </div>

        <div className="ranked__odds">
          <span>
            Best odds <strong>{fmtOdds(a.bestOdds)}</strong>
            {bestBook && a.bestOdds != null && <span className="muted"> at {bestBook}</span>}
          </span>
          <span className="muted">Fair price {fmtOdds(a.fairOdds)}</span>
          {a.marketWinProb != null && <span className="muted">Market {fmtPct(a.marketWinProb)}</span>}
        </div>

        {(reasons.length > 0 || concerns.length > 0) && (
          <div className="chips">
            {reasons.map((r, i) => (
              <Chip key={`r${i}`} tone="green">
                ✓ {r}
              </Chip>
            ))}
            {concerns.map((c, i) => (
              <Chip key={`c${i}`} tone="amber">
                ⚠ {c}
              </Chip>
            ))}
            {hidden > 0 && (
              <button type="button" className="chip chip--neutral chip-more" onClick={() => setAllChips(true)} data-testid="chips-more">
                +{hidden} more
              </button>
            )}
          </div>
        )}

        <button type="button" className="btn btn-ghost btn-sm ranked__why" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="why-toggle">
          {open ? 'Hide the working' : 'Why we rate it here'} {open ? '▲' : '▼'}
        </button>
        {open && (
          <div className="ranked__why-body">
            <p className="small muted">
              Expected finish {(a.expectedFinish ?? 0).toFixed(1)} · Top-6 chance {fmtPct(a.top6Prob)} · Data completeness {fmtPct(a.dataCompleteness)} · Facts verified {fmtPct(a.verificationScore)}
            </p>
            <FactorsTable factors={a.factors ?? []} />
          </div>
        )}
      </div>
    </article>
  );
}
