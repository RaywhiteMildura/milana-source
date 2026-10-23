/** Small presentational building blocks shared across pages. */
import type { CSSProperties, ReactNode } from 'react';
import { pct100, verificationTone, type Tone } from '../lib/format';

export function Spinner({ size = 18, label }: { size?: number; label?: string }) {
  return (
    <span className="spinner-wrap">
      <span className="spinner" style={{ width: size, height: size }} aria-hidden />
      {label && <span className="muted small">{label}</span>}
    </span>
  );
}

export function Skeleton({ h = 16, w = '100%', style, className = '' }: { h?: number | string; w?: number | string; style?: CSSProperties; className?: string }) {
  return <span className={`skeleton ${className}`} style={{ height: h, width: w, ...style }} aria-hidden />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card skeleton-card" aria-busy="true" aria-label="Loading">
      <Skeleton h={22} w="55%" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} h={14} w={`${90 - i * 12}%`} />
      ))}
    </div>
  );
}

export function Chip({ tone = 'neutral', children, title, className = '', testId }: { tone?: Tone; children: ReactNode; title?: string; className?: string; testId?: string }) {
  return (
    <span className={`chip chip--${tone} ${className}`} title={title} data-testid={testId}>
      {children}
    </span>
  );
}

export function Dot({ tone, title, size = 10, testId }: { tone: Tone; title?: string; size?: number; testId?: string }) {
  return <span className={`dot dot--${tone}`} style={{ width: size, height: size }} title={title} aria-label={title} data-testid={testId} />;
}

export function VerificationDot({ score, conflicts, size = 12 }: { score?: number; conflicts?: string[]; size?: number }) {
  const tone = verificationTone(score);
  const pct = score == null ? '–' : `${pct100(score)}%`;
  const title = [`Verification ${pct}`, ...(conflicts && conflicts.length ? ['Conflicts:', ...conflicts.map((c) => `• ${c}`)] : ['No conflicts between sources'])].join('\n');
  return (
    <span className="verify-dot" title={title} tabIndex={0} aria-label={title}>
      <Dot tone={tone} size={size} />
    </span>
  );
}

/** Horizontal percentage bar. `value` is 0..1 */
export function Bar({ value, label, tone = 'green', showValue = true, compact = false }: { value: number; label?: string; tone?: Tone; showValue?: boolean; compact?: boolean }) {
  const pct = Math.max(0, Math.min(100, Math.round((value || 0) * 100)));
  return (
    <div className={`bar ${compact ? 'bar--compact' : ''}`} role="img" aria-label={`${label ?? ''} ${pct}%`.trim()}>
      {(label || showValue) && (
        <div className="bar__head">
          {label && <span className="bar__label">{label}</span>}
          {showValue && <span className="bar__value">{pct}%</span>}
        </div>
      )}
      <div className="bar__track">
        <div className={`bar__fill bar__fill--${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Centred bar for -1..1 factor scores */
export function ScoreBar({ score }: { score: number }) {
  const s = Math.max(-1, Math.min(1, score || 0));
  const half = Math.abs(s) * 50;
  const style: CSSProperties = s >= 0 ? { left: '50%', width: `${half}%` } : { right: '50%', width: `${half}%` };
  return (
    <div className="scorebar" role="img" aria-label={`Score ${s.toFixed(2)}`}>
      <div className="scorebar__mid" />
      <div className={`scorebar__fill ${s >= 0 ? 'scorebar__fill--pos' : 'scorebar__fill--neg'}`} style={style} />
    </div>
  );
}

/** Circular percentage ring. `value` is 0..1 */
export function Ring({ value, size = 72, stroke = 8, caption, testId }: { value: number; size?: number; stroke?: number; caption?: ReactNode; testId?: string }) {
  const pct = pct100(value);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = verificationTone(value);
  return (
    <div className="ring-wrap" data-testid={testId}>
      <div className={`ring ring--${tone}`} style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden>
          <circle className="ring__bg" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
          <circle
            className="ring__fg"
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${(c * pct) / 100} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <span className="ring__text" style={{ fontSize: Math.max(12, size * 0.26) }}>
          {pct}%
        </span>
      </div>
      {caption && <div className="ring__caption">{caption}</div>}
    </div>
  );
}

export function EmptyState({ icon = '◌', title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty card" data-testid="empty-state">
      <div className="empty__icon" aria-hidden>
        {icon}
      </div>
      <h3>{title}</h3>
      {children && <div className="muted">{children}</div>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }: { title?: string; message?: string | null; onRetry?: () => void }) {
  return (
    <div className="empty card empty--error" role="alert" data-testid="error-state">
      <div className="empty__icon" aria-hidden>
        ⚠
      </div>
      <h3>{title}</h3>
      {message && <p className="muted">{message}</p>}
      {onRetry && (
        <div className="empty__action">
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

export function KV({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`kv ${className}`}>
      <span className="kv__label">{label}</span>
      <span className="kv__value">{children}</span>
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="section-title">
      <h2>{children}</h2>
      {aside && <div className="section-title__aside">{aside}</div>}
    </div>
  );
}

export function RankBadge({ rank }: { rank: number }) {
  const cls = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : 'plain';
  const word = rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : `${rank}th`;
  return (
    <span className={`rank-badge rank-badge--${cls}`} aria-label={`Ranked ${word}`}>
      <span className="rank-badge__num">{rank}</span>
      <span className="rank-badge__suffix">{word.replace(String(rank), '')}</span>
    </span>
  );
}

export function Saddle({ number, scratched = false }: { number: number; scratched?: boolean }) {
  return <span className={`saddle ${scratched ? 'saddle--scr' : ''}`}>{number}</span>;
}
