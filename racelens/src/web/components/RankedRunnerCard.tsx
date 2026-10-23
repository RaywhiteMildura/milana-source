import { useState } from 'react';
import type { FactorScore, Runner, RunnerAssessment } from '@shared/types';
import { fmtOdds, fmtPct, fmtWeight } from '../lib/format';
import { Bar, Chip, RankBadge, Saddle, ScoreBar } from './ui';

export const VALUE_EDGE_THRESHOLD = 0.03;

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
  const a = assessment;
  const reasons = a.reasons ?? [];
  const concerns = a.concerns ?? [];
  const hasValue = a.valueEdge != null && a.valueEdge > VALUE_EDGE_THRESHOLD && a.marketWinProb != null;
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
            <Chip tone="gold" className="value-badge" testId="value-badge" title="Our win chance is well above what the market price implies">
              VALUE: {fmtPct(a.winProb)} vs market {fmtPct(a.marketWinProb)}
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
