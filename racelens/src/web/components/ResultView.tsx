import { useState, type FormEvent } from 'react';
import type { Prediction, Race, RaceResult } from '@shared/types';
import { fmtDateTime, fmtMoney, ordinal, sourceName } from '../lib/format';
import { Saddle } from './ui';

function Scorecard({ result, prediction }: { result: RaceResult; prediction?: Prediction }) {
  const sc = result.scorecard;
  if (!sc) return <p className="muted small">No scorecard yet – run a results fetch to score this prediction.</p>;
  const winnerNo = result.placings[0]?.[0];
  const ourPick = prediction?.top[0];
  const lines: Array<{ ok: boolean | null; text: string }> = [];
  if (sc.winnerRank != null) lines.push({ ok: sc.winnerRank <= 3, text: `Winner was our ${ordinal(sc.winnerRank)} pick` });
  else lines.push({ ok: false, text: 'Winner was outside our ranked list' });
  if (ourPick) lines.push({ ok: sc.predictedWinnerPosition === 1, text: `Our top pick (${ourPick.number} ${ourPick.name}) ran ${sc.predictedWinnerPosition != null ? ordinal(sc.predictedWinnerPosition) : 'unplaced'}` });
  lines.push({ ok: sc.winnerInTop3, text: 'Winner in our top 3' });
  lines.push({ ok: sc.winnerInTop6, text: 'Winner in our top 6' });
  lines.push({ ok: sc.placegettersInTop6 >= 2, text: `${sc.placegettersInTop6} of the placegetters were in our top 6` });
  lines.push({ ok: sc.quinellaHit, text: 'Quinella (top 2 in our top picks)' });
  lines.push({ ok: sc.exactaHit, text: 'Exacta in order' });
  lines.push({ ok: sc.trifectaBoxHit, text: 'Trifecta box' });
  return (
    <ul className="scorecard" data-testid="scorecard">
      {lines.map((l, i) => (
        <li key={i} className={l.ok ? 'is-hit' : 'is-miss'}>
          <span className="scorecard__mark">{l.ok ? '✓' : '✗'}</span>
          {l.text}
          {i === 0 && winnerNo != null && <span className="muted"> (No. {winnerNo})</span>}
        </li>
      ))}
    </ul>
  );
}

export function ResultView({
  race,
  result,
  prediction,
  onManual,
  onFetch,
  busy,
  names,
}: {
  race: Race;
  result?: RaceResult;
  prediction?: Prediction;
  onManual: (placings: number[][]) => Promise<boolean>;
  onFetch: () => void;
  busy?: boolean;
  names?: Record<string, string>;
}) {
  const byNo = new Map((race.runners ?? []).map((r) => [r.number, r]));
  const [vals, setVals] = useState(['', '', '', '']);
  const [showForm, setShowForm] = useState(!result);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const nums = vals.map((v) => v.trim()).filter(Boolean).map(Number);
    if (nums.length < 1 || nums.some((n) => !Number.isInteger(n) || n <= 0)) {
      setErr('Enter the runner numbers for at least the winner (whole numbers).');
      return;
    }
    const unknown = nums.filter((n) => !byNo.has(n));
    if (unknown.length) {
      setErr(`No runner with number ${unknown.join(', ')} in this race.`);
      return;
    }
    if (new Set(nums).size !== nums.length) {
      setErr('Each placing must be a different runner.');
      return;
    }
    setSaving(true);
    try {
      const ok = await onManual(nums.map((n) => [n]));
      if (ok) setShowForm(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="result" data-testid="result-panel">
      {result ? (
        <div className="card">
          <header className="result__head">
            <h3>Result</h3>
            <span className="small muted">
              {sourceName(result.source, names)} · {fmtDateTime(result.recordedAt)}
              {result.time && ` · time ${result.time}`}
            </span>
          </header>
          <ol className="placings" data-testid="placings">
            {(result.placings ?? []).map((group, i) => (
              <li key={i} className={`placing placing--${i + 1}`}>
                <span className="placing__pos">{ordinal(i + 1)}</span>
                <span className="placing__runners">
                  {group.map((n, j) => {
                    const r = byNo.get(n);
                    return (
                      <span key={n} className="placing__runner">
                        {j > 0 && <span className="muted"> = </span>}
                        <Saddle number={n} /> {r?.name ?? `No. ${n}`}
                        {r?.jockey && <span className="muted small"> ({r.jockey})</span>}
                      </span>
                    );
                  })}
                </span>
                {result.margins?.[i - 1] != null && i > 0 && <span className="muted small">{result.margins[i - 1]}L</span>}
              </li>
            ))}
          </ol>
          {result.dividends && Object.keys(result.dividends).length > 0 && (
            <div className="chips">
              {Object.entries(result.dividends).map(([k, v]) => (
                <span key={k} className="chip chip--neutral">
                  {k}: {fmtMoney(v)}
                </span>
              ))}
            </div>
          )}
          <h4>How did we go?</h4>
          <Scorecard result={result} prediction={prediction} />
        </div>
      ) : (
        <div className="card result__none">
          <h3>No result yet</h3>
          <p className="muted">When the race has run, fetch the result from the sources or type it in below if they are slow.</p>
          <button type="button" className="btn btn-secondary" onClick={onFetch} disabled={busy} data-testid="fetch-result-btn">
            {busy ? 'Fetching…' : 'Fetch result from sources'}
          </button>
        </div>
      )}

      <div className="card manual-result">
        <button type="button" className="btn btn-ghost manual-result__toggle" onClick={() => setShowForm((s) => !s)} aria-expanded={showForm}>
          {showForm ? 'Hide manual entry ▲' : 'Enter result manually ▼'}
        </button>
        {showForm && (
          <form onSubmit={submit} className="manual-result__form" data-testid="manual-result-form">
            <p className="small muted">Type the saddlecloth numbers in finishing order. Only 1st is required.</p>
            <div className="manual-result__inputs">
              {['1st', '2nd', '3rd', '4th'].map((lbl, i) => (
                <label key={lbl} className="field-label">
                  <span>{lbl}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    className="input"
                    value={vals[i]}
                    placeholder="No."
                    onChange={(e) => setVals((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
                    data-testid={`manual-place-${i + 1}`}
                  />
                  {vals[i] && byNo.get(Number(vals[i])) && <span className="small muted">{byNo.get(Number(vals[i]))?.name}</span>}
                </label>
              ))}
            </div>
            {err && (
              <p className="text-error small" role="alert">
                {err}
              </p>
            )}
            <button type="submit" className="btn btn-primary" disabled={saving} data-testid="manual-result-save">
              {saving ? 'Saving…' : 'Save result'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
