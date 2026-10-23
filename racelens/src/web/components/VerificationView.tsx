import type { FieldAgreement, Race, Runner } from '@shared/types';
import { fmtWeight, plural, sourceName, verificationTone, verificationWord } from '../lib/format';
import { Chip, Ring, Saddle, VerificationDot } from './ui';

type FieldKey = keyof Runner['fields'];

const FIELD_ORDER: Array<{ key: FieldKey; label: string }> = [
  { key: 'number', label: 'Saddlecloth' },
  { key: 'barrier', label: 'Barrier' },
  { key: 'jockey', label: 'Jockey' },
  { key: 'trainer', label: 'Trainer' },
  { key: 'weight', label: 'Weight' },
  { key: 'scratched', label: 'Scratched' },
];

function fmtValue(key: FieldKey, v: unknown): string {
  if (v == null || v === '') return '–';
  if (key === 'scratched') return v ? 'Yes' : 'No';
  if (key === 'weight' && typeof v === 'number') return fmtWeight(v);
  return String(v);
}

function RunnerFields({ runner, names }: { runner: Runner; names?: Record<string, string> }) {
  const v = runner.verification ?? { score: 0, sourceCount: 0, conflicts: [], checkedFields: 0, agreedFields: 0 };
  const conflicts = v.conflicts ?? [];
  return (
    <div className={`card verify-runner ${conflicts.length ? 'has-conflicts' : ''}`} data-testid="verification-runner">
      <header className="verify-runner__head">
        <Saddle number={runner.number} scratched={runner.scratched} />
        <h4 className={runner.scratched ? 'is-struck' : ''}>{runner.name}</h4>
        <VerificationDot score={v.score} conflicts={conflicts} />
        <span className="small muted">
          {Math.round((v.score ?? 0) * 100)}% · {plural(v.sourceCount ?? 0, 'source')}
        </span>
      </header>
      <div className="table-wrap">
        <table className="table table--stack table--tight verify-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Value we used</th>
              <th>Sources that agree</th>
              <th>Sources that disagree</th>
              <th className="num">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {FIELD_ORDER.map(({ key, label }) => {
              const f = runner.fields?.[key] as FieldAgreement<unknown> | undefined;
              if (!f) return null;
              const agree = f.agree ?? [];
              const disagree = f.disagree ?? [];
              const conflict = disagree.length > 0;
              return (
                <tr key={key} className={conflict ? 'is-conflict' : ''} data-conflict={conflict ? 'true' : 'false'}>
                  <td data-label="Field">
                    <strong>{label}</strong>
                    {conflict && (
                      <Chip tone="amber" className="chip--xs">
                        conflict
                      </Chip>
                    )}
                  </td>
                  <td data-label="Value">{fmtValue(key, f.value)}</td>
                  <td data-label="Agree" className="td-wide">
                    {agree.length ? (
                      <div className="chips">
                        {agree.map((s) => (
                          <Chip key={s} tone="green" testId="verification-source">
                            {sourceName(s, names)}
                          </Chip>
                        ))}
                      </div>
                    ) : (
                      <span className="muted">–</span>
                    )}
                  </td>
                  <td data-label="Disagree" className="td-wide">
                    {disagree.length ? (
                      <div className="chips">
                        {disagree.map((d, i) => (
                          <Chip key={`${d.source}${i}`} tone="amber" testId="verification-source">
                            {sourceName(d.source, names)}: {fmtValue(key, d.value)}
                          </Chip>
                        ))}
                      </div>
                    ) : (
                      <span className="muted">none</span>
                    )}
                  </td>
                  <td data-label="Confidence" className="num">
                    <span className={`text-${verificationTone(f.confidence)}`}>{Math.round(f.confidence * 100)}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {conflicts.length > 0 && (
        <ul className="conflicts small">
          {conflicts.map((c, i) => (
            <li key={i}>⚠ {c}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function VerificationView({ race, names }: { race: Race; names?: Record<string, string> }) {
  const v = race.verification ?? { score: 0, sourceCount: 0, conflicts: [], checkedFields: 0, agreedFields: 0 };
  const runners = [...(race.runners ?? [])].sort((a, b) => a.number - b.number);
  const conflicted = runners.filter((r) => (r.verification?.conflicts ?? []).length > 0).length;
  return (
    <section className="verification" data-testid="verification-panel">
      <div className="card verification__summary">
        <Ring value={v.score} size={84} caption={<span className="small muted">{verificationWord(v.score)}</span>} testId="race-verification-ring" />
        <div className="verification__text">
          <h3>Race data check</h3>
          <p>
            We compared <strong>{plural(v.sourceCount, 'source')}</strong> on this race. <strong>{v.agreedFields}</strong> of {v.checkedFields} facts matched across sources.
            {conflicted > 0 ? ` ${plural(conflicted, 'runner')} ${conflicted === 1 ? 'has' : 'have'} a conflict worth a look (highlighted in amber below).` : ' No conflicts found – nice and clean.'}
          </p>
          <div className="chips">
            {(race.sources ?? []).map((s) => (
              <Chip key={s} tone="neutral" testId="verification-source">
                {sourceName(s, names)}
              </Chip>
            ))}
          </div>
          {(v.conflicts ?? []).length > 0 && (
            <ul className="conflicts small">
              {v.conflicts.map((c, i) => (
                <li key={i}>⚠ {c}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {runners.map((r) => (
        <RunnerFields key={r.id} runner={r} names={names} />
      ))}
    </section>
  );
}
