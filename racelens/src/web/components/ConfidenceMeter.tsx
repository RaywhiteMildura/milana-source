import type { ConfidenceRating } from '@shared/types';
import { confidenceTone, pct100 } from '../lib/format';

const COMPONENT_NOTES: Array<{ key: keyof ConfidenceRating['components']; label: string; note: string }> = [
  { key: 'dataCompleteness', label: 'Data found', note: 'How much form, odds and stats we found for the whole field.' },
  { key: 'sourceAgreement', label: 'Sources agree', note: 'How well the different sources agree on the facts (barriers, jockeys, weights).' },
  { key: 'separation', label: 'Clear standouts', note: 'How clearly the top picks stand out from the rest of the field.' },
  { key: 'marketAlignment', label: 'Market match', note: 'How closely our view lines up with the betting market.' },
  { key: 'fieldSize', label: 'Field size', note: 'Smaller fields are easier to predict than big ones.' },
  { key: 'freshness', label: 'Freshness', note: 'How recently the data was fetched. Run a pre-race check to refresh.' },
];

function toneWord(label: ConfidenceRating['label']): string {
  switch (label) {
    case 'High':
      return 'We are confident in this read.';
    case 'Good':
      return 'A solid read with good data behind it.';
    case 'Fair':
      return 'Reasonable, but treat it with some caution.';
    default:
      return 'Thin or conflicting data – be careful here.';
  }
}

export function ConfidenceMeter({ rating }: { rating: ConfidenceRating }) {
  const value = Math.max(0, Math.min(100, Math.round(rating.overall)));
  const tone = confidenceTone(rating.label);

  // Semi-circle gauge geometry
  const size = 180;
  const stroke = 16;
  const cx = size / 2;
  const cy = size / 2 + 10;
  const r = size / 2 - stroke;
  const angle = Math.PI * (1 - value / 100); // π (left) .. 0 (right)
  const ex = cx + r * Math.cos(angle);
  const ey = cy - r * Math.sin(angle);
  const bgPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const fgPath = value <= 0 ? '' : `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  const ticks = [25, 50, 75].map((t) => {
    const a = Math.PI * (1 - t / 100);
    return { x1: cx + (r - stroke / 2 - 2) * Math.cos(a), y1: cy - (r - stroke / 2 - 2) * Math.sin(a), x2: cx + (r + stroke / 2 + 2) * Math.cos(a), y2: cy - (r + stroke / 2 + 2) * Math.sin(a) };
  });

  return (
    <section className="card confidence" data-testid="confidence-meter" data-label={rating.label}>
      <div className="confidence__dial">
        <svg viewBox={`0 0 ${size} ${size / 2 + 42}`} width="100%" role="img" aria-label={`Confidence ${value} out of 100, ${rating.label}`}>
          <path d={bgPath} className="gauge__bg" strokeWidth={stroke} fill="none" strokeLinecap="round" />
          {fgPath && <path d={fgPath} className={`gauge__fg gauge__fg--${tone}`} strokeWidth={stroke} fill="none" strokeLinecap="round" />}
          {ticks.map((t, i) => (
            <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className="gauge__tick" />
          ))}
          <text x={cx} y={cy - 18} textAnchor="middle" className="gauge__value">
            {value}
          </text>
          <text x={cx} y={cy + 6} textAnchor="middle" className={`gauge__label gauge__label--${tone}`}>
            {rating.label}
          </text>
          <text x={cx - r} y={cy + 22} textAnchor="middle" className="gauge__end">
            0
          </text>
          <text x={cx + r} y={cy + 22} textAnchor="middle" className="gauge__end">
            100
          </text>
        </svg>
        <p className="confidence__blurb">
          <strong>Confidence: {rating.label}.</strong> {toneWord(rating.label)}
        </p>
      </div>
      <div className="confidence__components">
        <table className="table table--tight">
          <thead>
            <tr>
              <th>What we checked</th>
              <th className="num">Score</th>
            </tr>
          </thead>
          <tbody>
            {COMPONENT_NOTES.map((c) => {
              const v = pct100(rating.components?.[c.key]);
              return (
                <tr key={c.key}>
                  <td>
                    <div className="confidence__comp-label">{c.label}</div>
                    <div className="small muted">{c.note}</div>
                  </td>
                  <td className="num">
                    <div className="mini-bar" aria-hidden>
                      <div className={`mini-bar__fill mini-bar__fill--${v >= 70 ? 'green' : v >= 40 ? 'amber' : 'red'}`} style={{ width: `${v}%` }} />
                    </div>
                    <span className="mini-bar__value">{v}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {(rating.notes ?? []).length > 0 && (
          <ul className="notes">
            {rating.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
