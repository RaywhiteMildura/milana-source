import { Fragment, useState } from 'react';
import type { CareerStats, NewsItem, Race, Runner, SplitStats } from '@shared/types';
import { trackRatingLabel } from '@shared/util';
import { careerRecord, fmtDateTime, fmtMargin, fmtOdds, fmtRelative, fmtShortDate, fmtWeight, sentimentTone, sentimentWord, sourceName, speedMapLabel, ymdOfIso } from '../lib/format';
import { Chip, Dot, Saddle, VerificationDot } from './ui';

function Mover({ runner }: { runner: Runner }) {
  const m = runner.market;
  if (!m || !m.mover) return <span className="muted">–</span>;
  const pct = m.movePct != null ? `${Math.abs(Math.round(m.movePct))}%` : '';
  if (m.mover === 'firming') {
    return (
      <span className="mover mover--firming" title="Price is shortening – money is coming for this runner">
        ▼ Firming {pct}
      </span>
    );
  }
  if (m.mover === 'drifting') {
    return (
      <span className="mover mover--drifting" title="Price is lengthening – the market is cooling on this runner">
        ▲ Drifting {pct}
      </span>
    );
  }
  return (
    <span className="mover mover--steady" title="Price steady">
      – Steady
    </span>
  );
}

const SPLIT_LABELS: Array<{ key: keyof SplitStats; label: string }> = [
  { key: 'track', label: 'This track' },
  { key: 'distance', label: 'This distance' },
  { key: 'trackDistance', label: 'Track & distance' },
  { key: 'firm', label: 'Firm' },
  { key: 'good', label: 'Good' },
  { key: 'soft', label: 'Soft' },
  { key: 'heavy', label: 'Heavy' },
  { key: 'synthetic', label: 'Synthetic' },
  { key: 'firstUp', label: 'First up' },
  { key: 'secondUp', label: 'Second up' },
  { key: 'jockey', label: "Today's jockey" },
  { key: 'direction', label: 'This way of going' },
];

function SplitsTable({ splits }: { splits?: SplitStats }) {
  const rows = SPLIT_LABELS.map((s) => ({ ...s, stats: splits?.[s.key] as CareerStats | undefined })).filter((r) => r.stats);
  if (!rows.length) return <p className="muted small">No career splits available.</p>;
  return (
    <div className="splits">
      {rows.map((r) => (
        <div key={r.key} className="splits__item">
          <span className="splits__label">{r.label}</span>
          <span className="splits__value">{careerRecord(r.stats)}</span>
        </div>
      ))}
    </div>
  );
}

function FormLines({ runner }: { runner: Runner }) {
  const form = runner.form ?? [];
  if (!form.length) return <p className="muted small">No past starts found.</p>;
  return (
    <div className="table-wrap">
      <table className="table table--tight form-lines">
        <thead>
          <tr>
            <th>Date</th>
            <th>Venue</th>
            <th className="num">Dist</th>
            <th>Track</th>
            <th>Finish</th>
            <th>Margin</th>
            <th className="num">Wt</th>
            <th>Jockey</th>
            <th className="num">SP</th>
          </tr>
        </thead>
        <tbody>
          {form.map((f, i) => (
            <tr key={i} className={f.position === 1 ? 'is-win' : ''}>
              <td>{/^\d{4}-\d{2}-\d{2}$/.test(f.date) ? fmtShortDate(f.date) : fmtShortDate(ymdOfIso(f.date) ?? f.date)}</td>
              <td>
                {f.venue}
                {f.raceClass && <div className="small muted">{f.raceClass}</div>}
              </td>
              <td className="num">{f.distance}m</td>
              <td>{f.trackCondition ?? (f.trackRating != null ? trackRatingLabel(f.trackRating) : '–')}</td>
              <td>
                <strong>{f.position}</strong>
                <span className="muted">/{f.starters}</span>
              </td>
              <td>{fmtMargin(f.margin, f.position)}</td>
              <td className="num">{f.weight != null ? f.weight : '–'}</td>
              <td>{f.jockey ?? '–'}</td>
              <td className="num">{fmtOdds(f.startingPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {form.some((f) => f.comment) && (
        <ul className="form-comments small">
          {form
            .filter((f) => f.comment)
            .slice(0, 5)
            .map((f, i) => (
              <li key={i}>
                <span className="muted">{fmtShortDate(/^\d{4}-\d{2}-\d{2}$/.test(f.date) ? f.date : ymdOfIso(f.date) ?? f.date)} {f.venue}:</span> {f.comment}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function OddsTable({ runner }: { runner: Runner }) {
  const odds = runner.odds ?? [];
  if (!odds.length) return <p className="muted small">No odds found for this runner.</p>;
  const best = runner.market?.bestWin;
  const sorted = [...odds].sort((a, b) => (b.win ?? 0) - (a.win ?? 0));
  return (
    <table className="table table--tight odds">
      <thead>
        <tr>
          <th>Bookmaker</th>
          <th className="num">Win</th>
          <th className="num">Place</th>
          <th>Type</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((o, i) => (
          <tr key={i} className={best != null && o.win === best ? 'is-best' : ''}>
            <td>
              {o.bookmaker}
              {best != null && o.win === best && <span className="chip chip--gold chip--xs">best</span>}
            </td>
            <td className="num">{fmtOdds(o.win)}</td>
            <td className="num">{fmtOdds(o.place)}</td>
            <td className="muted small">
              {o.type}
              {o.opening != null && ` · opened ${fmtOdds(o.opening)}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function NewsItems({ items, names }: { items: NewsItem[]; names?: Record<string, string> }) {
  if (!items.length) return <p className="muted small">No news or rumours found.</p>;
  return (
    <ul className="news">
      {items.map((n) => (
        <li key={n.id} className="news__item" data-testid="news-item">
          <Dot tone={sentimentTone(n.sentiment)} title={`${sentimentWord(n.sentiment)} tone`} />
          <div className="news__body">
            <a href={n.url} target="_blank" rel="noreferrer noopener" className="news__title">
              {n.title}
            </a>
            <div className="small muted">
              {n.outlet ?? sourceName(n.source, names)}
              {n.publishedAt && ` · ${fmtRelative(n.publishedAt)}`}
              {n.mentions.length > 0 && ` · mentions ${n.mentions.slice(0, 3).join(', ')}${n.mentions.length > 3 ? '…' : ''}`}
            </div>
            {n.snippet && <p className="news__snippet small">{n.snippet}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function RunnerDetails({ runner, names }: { runner: Runner; names?: Record<string, string> }) {
  const gear = runner.gearChanges ?? [];
  const comments = runner.comments ?? [];
  const ratings = runner.ratings ?? {};
  const sources = runner.sources ?? [];
  const v = runner.verification ?? { score: 0, sourceCount: 0, conflicts: [], checkedFields: 0, agreedFields: 0 };
  const breeding = [runner.sire && `Sire: ${runner.sire}`, runner.dam && `Dam: ${runner.dam}`, runner.damSire && `Damsire: ${runner.damSire}`].filter(Boolean) as string[];
  const bio = [runner.age != null && `${runner.age}yo`, runner.sex, runner.colour, runner.country && `(${runner.country})`].filter(Boolean).join(' ');
  return (
    <div className="runner-details" data-testid="runner-details">
      <div className="runner-details__grid">
        <section>
          <h4>Past starts</h4>
          <FormLines runner={runner} />
        </section>
        <section>
          <h4>Career splits</h4>
          <SplitsTable splits={runner.splits} />
          {runner.daysSinceLastRun != null && <p className="small muted">Last ran {runner.daysSinceLastRun} days ago.</p>}
          {runner.speedMapPosition && <p className="small muted">Likely to settle: {speedMapLabel(runner.speedMapPosition)}.</p>}
        </section>
        <section>
          <h4>Breeding & profile</h4>
          {bio && <p className="small">{bio}</p>}
          {breeding.length ? (
            <ul className="plain small">
              {breeding.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No breeding details.</p>
          )}
          <h4>Gear changes</h4>
          {gear.length ? (
            <div className="chips">
              {gear.map((g, i) => (
                <Chip key={i} tone="blue">
                  {g}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="muted small">No gear changes.</p>
          )}
        </section>
        <section>
          <h4>Comments</h4>
          {comments.length ? (
            <ul className="comments">
              {comments.map((c, i) => (
                <li key={i}>
                  <span className="comments__source">{sourceName(c.source, names)}</span>
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No comments from any source.</p>
          )}
          {Object.keys(ratings).length > 0 && (
            <div className="chips">
              {Object.entries(ratings).map(([k, v]) => (
                <Chip key={k} tone="neutral">
                  {k}: {v}
                </Chip>
              ))}
            </div>
          )}
        </section>
        <section>
          <h4>Odds comparison</h4>
          <OddsTable runner={runner} />
        </section>
        <section>
          <h4>News</h4>
          <NewsItems items={runner.news ?? []} names={names} />
        </section>
      </div>
      <p className="small muted">
        Sources for this runner: {sources.map((s) => sourceName(s, names)).join(', ') || 'none'}. Verified {Math.round((v.score ?? 0) * 100)}% ·{' '}
        {v.agreedFields}/{v.checkedFields} fields agree
        {(v.conflicts ?? []).length > 0 && ` · ${v.conflicts.length} conflict${v.conflicts.length === 1 ? '' : 's'}`}.
      </p>
    </div>
  );
}

export function FieldTable({ race, names, tz }: { race: Race; names?: Record<string, string>; tz?: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const runners = [...(race.runners ?? [])].sort((a, b) => a.number - b.number);
  const active = runners.filter((r) => !r.scratched).length;

  return (
    <section className="card field" data-testid="field-table">
      <header className="field__head">
        <h3>Full field</h3>
        <span className="muted small">
          {active} runners{runners.length - active > 0 ? ` · ${runners.length - active} scratched` : ''} · updated {fmtDateTime(race.fetchedAt, tz)}
        </span>
      </header>
      <div className="table-wrap">
        <table className="table table--stack field-table">
          <thead>
            <tr>
              <th className="num">No.</th>
              <th>Horse</th>
              <th className="num">Bar</th>
              <th>Jockey</th>
              <th>Trainer</th>
              <th className="num">Wt</th>
              <th>Last 5</th>
              <th>Career</th>
              <th className="num">Best odds</th>
              <th>Market</th>
              <th>Check</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runners.map((r) => {
              const isOpen = open.has(r.id);
              return (
                <Fragment key={r.id}>
                  <tr className={`field-row ${r.scratched ? 'is-scratched' : ''} ${isOpen ? 'is-open' : ''}`} data-testid="field-row" data-number={r.number}>
                    <td data-label="No." className="num">
                      <Saddle number={r.number} scratched={r.scratched} />
                    </td>
                    <td data-label="Horse" className="td-wide">
                      <span className="field-row__name">{r.name}</span>
                      {r.scratched && (
                        <Chip tone="red" className="chip--xs">
                          SCR
                        </Chip>
                      )}
                      {r.emergency && (
                        <Chip tone="amber" className="chip--xs" title="Emergency: it only starts if a horse is scratched in time, and is not in our picks until then">
                          EM
                        </Chip>
                      )}
                    </td>
                    <td data-label="Barrier" className="num">
                      {r.barrier ?? '–'}
                    </td>
                    <td data-label="Jockey">
                      {r.jockey ?? '–'}
                      {r.claim ? <span className="muted small"> (a{r.claim})</span> : null}
                    </td>
                    <td data-label="Trainer">{r.trainer ?? '–'}</td>
                    <td data-label="Weight" className="num">
                      {fmtWeight(r.weight)}
                    </td>
                    <td data-label="Last 5" className="mono">
                      {r.last5 ?? '–'}
                    </td>
                    <td data-label="Career" className="mono">
                      {careerRecord(r.career)}
                    </td>
                    <td data-label="Best odds" className="num">
                      <strong>{fmtOdds(r.market?.bestWin)}</strong>
                      {r.market?.bestWinBookmaker && <div className="small muted">{r.market.bestWinBookmaker}</div>}
                    </td>
                    <td data-label="Market">
                      <Mover runner={r} />
                    </td>
                    <td data-label="Check">
                      <VerificationDot score={r.verification?.score} conflicts={r.verification?.conflicts} />
                      <span className="small muted"> {r.verification ? `${Math.round(r.verification.score * 100)}%` : '–'}</span>
                      {(r.verification?.conflicts ?? []).length > 0 && (
                        <details className="conflicts small" data-testid="runner-conflicts">
                          <summary>
                            {r.verification!.conflicts.length} conflict{r.verification!.conflicts.length === 1 ? '' : 's'}
                          </summary>
                          <ul>
                            {r.verification!.conflicts.map((c, i) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td data-label="" className="td-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(r.id)} aria-expanded={isOpen} data-testid="runner-toggle">
                        {isOpen ? 'Hide' : 'Details'} {isOpen ? '▲' : '▼'}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="row-details">
                      <td colSpan={12}>
                        <RunnerDetails runner={r} names={names} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
