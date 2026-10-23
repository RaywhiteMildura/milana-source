import { useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import type { Settings } from '@shared/types';
import { api, errorMessage, useRequest } from '../lib/api';
import { fmtMoney } from '../lib/format';
import { useServerNow } from '../lib/session';
import { schedulerLine } from '../lib/raceday';
import { useSession } from '../lib/session';
import { useToast } from '../components/Toast';
import { Chip, Dot, ErrorState, SkeletonCard } from '../components/ui';

const JURISDICTIONS = ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'];

const RISK_PROFILES: Array<{ value: Settings['riskProfile']; label: string; blurb: string }> = [
  { value: 'conservative', label: 'Conservative', blurb: 'Fewer bets, mostly win and place on our strongest picks. Smaller stakes, smaller swings.' },
  { value: 'balanced', label: 'Balanced', blurb: 'A mix of win bets and small exotics (quinella, trifecta) when the numbers stack up.' },
  { value: 'aggressive', label: 'Aggressive', blurb: 'Chases value and roughies with bigger exotics. Expect bigger ups and downs.' },
];

interface Draft {
  bankroll: string;
  unitAmount: string;
  autoRecheck: string;
  autoResults: boolean;
  riskProfile: Settings['riskProfile'];
  jurisdiction: string;
  disabledSources: string[];
}

function toDraft(s: Settings): Draft {
  return {
    bankroll: String(s.bankroll ?? ''),
    unitAmount: String(s.unitAmount ?? ''),
    autoRecheck: String(s.autoRecheckMinutesBeforeRace ?? ''),
    autoResults: s.autoResults !== false,
    riskProfile: s.riskProfile ?? 'balanced',
    jurisdiction: s.jurisdiction || 'VIC',
    disabledSources: [...(s.disabledSources ?? [])],
  };
}

function QrImage({ text }: { text: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(text, { margin: 1, width: 180 })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [text]);
  if (failed) return <span className="small muted">QR code unavailable</span>;
  if (!src) return <span className="qr qr--empty" aria-hidden />;
  return <img className="qr" src={src} width={180} height={180} alt={`QR code for ${text}`} data-testid="phone-qr" />;
}

export function SettingsPage() {
  const toast = useToast();
  const session = useSession();
  const now = useServerNow(15_000);
  const settings = useRequest(() => api.getSettings(), []);
  const sources = useRequest(() => api.getSources().then((r) => r.sources), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (settings.data && !draft) setDraft(toDraft(settings.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);

  // Keep the scheduler status fresh while this page is open.
  useEffect(() => {
    const t = window.setInterval(() => void session.reloadHealth(), 30_000);
    return () => window.clearInterval(t);
  }, [session.reloadHealth]);

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setSavedAt(null);
  };

  const toggleSource = (id: string, enabled: boolean) => {
    if (!draft) return;
    const set = new Set(draft.disabledSources);
    if (enabled) set.delete(id);
    else set.add(id);
    update({ disabledSources: [...set] });
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const errs: Record<string, string> = {};
    const bankroll = Number(draft.bankroll);
    const unit = Number(draft.unitAmount);
    const auto = Number(draft.autoRecheck);
    if (!(bankroll > 0)) errs.bankroll = 'Enter your bankroll as a number above 0.';
    if (!(unit > 0)) errs.unitAmount = 'Enter a unit amount above 0.';
    if (unit > bankroll && bankroll > 0) errs.unitAmount = 'Your unit is bigger than your bankroll.';
    if (!(auto >= 0) || !Number.isInteger(auto)) errs.autoRecheck = 'Whole minutes only (0 turns it off).';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      const saved = await api.saveSettings({
        bankroll,
        unitAmount: unit,
        autoRecheckMinutesBeforeRace: auto,
        autoResults: draft.autoResults,
        riskProfile: draft.riskProfile,
        jurisdiction: draft.jurisdiction,
        disabledSources: draft.disabledSources,
      });
      settings.setData(saved);
      setDraft(toDraft(saved));
      setSavedAt(Date.now());
      toast.success('Settings saved');
      void session.reloadHealth();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await session.signOut();
    } catch (err) {
      toast.error(errorMessage(err));
      setSigningOut(false);
    }
  };

  if (settings.loading && !draft) {
    return (
      <div className="page page--settings">
        <h1>Settings</h1>
        <SkeletonCard lines={4} />
        <SkeletonCard lines={3} />
      </div>
    );
  }
  if (settings.error || !draft) {
    return (
      <div className="page page--settings">
        <h1>Settings</h1>
        <ErrorState title="Couldn't load settings" message={settings.error ?? 'Unknown error'} onRetry={() => settings.reload()} />
      </div>
    );
  }

  const bankrollNum = Number(draft.bankroll);
  const unitNum = Number(draft.unitAmount);
  const unitPct = bankrollNum > 0 && unitNum > 0 ? (unitNum / bankrollNum) * 100 : null;
  const scheduler = session.health?.scheduler;
  const status = schedulerLine(scheduler, now);
  const urls = session.health?.urls ?? [];
  const recheckMins = Number(draft.autoRecheck) > 0 ? Number(draft.autoRecheck) : 0;

  return (
    <div className="page page--settings">
      <div className="section-title">
        <h1>Settings</h1>
        <span className="small muted">These shape the betting suggestions, which sources we use and what runs by itself on race day.</span>
      </div>
      <form onSubmit={save} className="settings" data-testid="settings-form" noValidate>
        <section className="card" data-testid="automation-card">
          <h2>Race day automation</h2>
          <p className="help">The server does the race-day legwork by itself. Your phone only needs to be open to see it.</p>
          <div className="settings__grid">
            <label className="form-row">
              <span className="label">Auto pre-race check</span>
              <span className="help">Minutes before each race to automatically re-check scratchings, odds and track. 0 turns it off.</span>
              <div className="input-money">
                <input type="number" inputMode="numeric" min={0} step="1" className="input" value={draft.autoRecheck} onChange={(e) => update({ autoRecheck: e.target.value })} data-testid="settings-auto-recheck" aria-invalid={!!errors.autoRecheck} />
                <span>min</span>
              </div>
              {errors.autoRecheck && <span className="text-error small">{errors.autoRecheck}</span>}
            </label>
            <div className="form-row">
              <span className="label">Results</span>
              <span className="help">Poll the sources after each race and re-rate the rest of the card when a result lands.</span>
              <ul className="toggle-list">
                <li className={`toggle ${draft.autoResults ? '' : 'is-off'}`}>
                  <label data-testid="settings-auto-results-toggle">
                    <input type="checkbox" checked={draft.autoResults} onChange={(e) => update({ autoResults: e.target.checked })} data-testid="settings-auto-results" />
                    <span className="toggle__switch" aria-hidden />
                    <span className="toggle__body">
                      <strong>Fetch results automatically after each race</strong>
                    </span>
                    <Chip tone={draft.autoResults ? 'green' : 'neutral'} className="chip--xs">
                      {draft.autoResults ? 'On' : 'Off'}
                    </Chip>
                  </label>
                </li>
              </ul>
            </div>
          </div>
          <h4>What happens by itself on race day</h4>
          <ol className="timeline-plain" data-testid="automation-timeline">
            <li>
              <strong>Before each race</strong> – a pre-race check runs {recheckMins > 0 ? `when the ${recheckMins}-minute window opens and again 3 minutes before the jump` : 'only when you tap Pre-race check (automatic checks are off)'}: scratchings, market moves and track changes.
            </li>
            <li>
              <strong>After the jump</strong> – {draft.autoResults ? 'from 2 minutes after each race the result is polled every minute or two until two sources confirm it' : 'results are fetched only when you tap Fetch results'}.
            </li>
            <li>
              <strong>When a result lands</strong> – the remaining races are re-rated with the day's patterns (inside barriers, leaders, favourites) folded in.
            </li>
            <li>
              <strong>On your phone</strong> – an open race page refreshes itself within 30 seconds, and opening a race after a break catches up on anything missed.
            </li>
          </ol>
          <p className={`scheduler-status scheduler-status--${status.tone}`} data-testid="scheduler-status" aria-live="polite">
            <Dot tone={status.tone} /> {status.text}
          </p>
        </section>

        <section className="card" data-testid="phone-card">
          <h2>Use RaceLens on your phone</h2>
          {urls.length > 0 ? (
            <>
              <p className="help">Same Wi-Fi: scan or type this on your phone. Then add it to your home screen so it opens like an app.</p>
              <ul className="phone-urls">
                {urls.map((u) => (
                  <li key={u} className="phone-url" data-testid="phone-url">
                    <QrImage text={u} />
                    <a href={u} className="phone-url__text mono">
                      {u}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="help">
              Start it with <code className="mono">npm run start:phone</code> on your computer to get a QR code here, or see <code className="mono">docs/DEPLOY.md</code> for hosting it online (Tailscale, Fly.io or Render with a password) so it works away from home.
            </p>
          )}
        </section>

        <section className="card">
          <h2>Your bank</h2>
          <div className="settings__grid">
            <label className="form-row">
              <span className="label">Bankroll</span>
              <span className="help">The total you have set aside for punting.</span>
              <div className="input-money">
                <span>$</span>
                <input type="number" inputMode="decimal" min={0} step="1" className="input" value={draft.bankroll} onChange={(e) => update({ bankroll: e.target.value })} data-testid="settings-bankroll" aria-invalid={!!errors.bankroll} />
              </div>
              {errors.bankroll && <span className="text-error small">{errors.bankroll}</span>}
            </label>
            <label className="form-row">
              <span className="label">Unit amount</span>
              <span className="help">One “unit” is your standard bet. 1–2% of bankroll is a sensible unit.</span>
              <div className="input-money">
                <span>$</span>
                <input type="number" inputMode="decimal" min={0} step="0.5" className="input" value={draft.unitAmount} onChange={(e) => update({ unitAmount: e.target.value })} data-testid="settings-unit" aria-invalid={!!errors.unitAmount} />
              </div>
              {unitPct != null && (
                <span className={`small ${unitPct > 5 ? 'text-amber' : 'muted'}`}>
                  That is {unitPct.toFixed(1)}% of your bankroll{unitPct > 5 ? ' – on the high side.' : '.'}
                </span>
              )}
              {errors.unitAmount && <span className="text-error small">{errors.unitAmount}</span>}
            </label>
          </div>
        </section>

        <section className="card">
          <h2>Risk profile</h2>
          <p className="help">How bold should the betting structure be?</p>
          <div className="radio-cards" role="radiogroup" aria-label="Risk profile">
            {RISK_PROFILES.map((r) => (
              <label key={r.value} className={`radio-card ${draft.riskProfile === r.value ? 'is-selected' : ''}`}>
                <input type="radio" name="riskProfile" value={r.value} checked={draft.riskProfile === r.value} onChange={() => update({ riskProfile: r.value })} data-testid={`risk-${r.value}`} />
                <span className="radio-card__body">
                  <strong>{r.label}</strong>
                  <span className="small muted">{r.blurb}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Where you bet</h2>
          <div className="settings__grid">
            <label className="form-row">
              <span className="label">State / territory</span>
              <span className="help">Picks the right TAB and tote pools for your area.</span>
              <select className="input" value={draft.jurisdiction} onChange={(e) => update({ jurisdiction: e.target.value })} data-testid="settings-jurisdiction">
                {JURISDICTIONS.map((j) => (
                  <option key={j} value={j}>
                    {j}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="card">
          <h2>Data sources</h2>
          <p className="help">Turn a source off if it keeps failing or you don't trust it. We will skip it next time you research.</p>
          {sources.loading && !sources.data ? (
            <SkeletonCard lines={3} />
          ) : sources.data && sources.data.length ? (
            <ul className="toggle-list">
              {sources.data.map((s) => {
                const enabled = !draft.disabledSources.includes(s.id);
                return (
                  <li key={s.id} className={`toggle ${enabled ? '' : 'is-off'}`}>
                    <label>
                      <input type="checkbox" checked={enabled} onChange={(e) => toggleSource(s.id, e.target.checked)} data-testid={`source-toggle-${s.id}`} />
                      <span className="toggle__switch" aria-hidden />
                      <span className="toggle__body">
                        <strong>{s.name}</strong>
                        <span className="small muted">
                          {s.kind}
                          {s.capabilities.length ? ` · ${s.capabilities.join(', ')}` : ''}
                          {s.homepage ? ` · ${s.homepage.replace(/^https?:\/\//, '')}` : ''}
                        </span>
                      </span>
                      <Chip tone={enabled ? 'green' : 'neutral'} className="chip--xs">
                        {enabled ? 'On' : 'Off'}
                      </Chip>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted small">
              Could not list sources{sources.error ? ` (${sources.error})` : ''}.
              {draft.disabledSources.length > 0 && ` Currently disabled: ${draft.disabledSources.join(', ')}.`}
            </p>
          )}
        </section>

        <div className="settings__save-row">
          <button type="submit" className="btn btn-primary btn-lg" disabled={saving} data-testid="settings-save">
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          {savedAt && (
            <span className="text-green" data-testid="settings-saved">
              ✓ Saved
            </span>
          )}
        </div>
        <p className="disclaimer">Suggestions only. Bet responsibly. Gambling Help 1800 858 858. Your current unit is {fmtMoney(unitNum || 0)}.</p>
      </form>

      {session.authRequired && (
        <section className="card" data-testid="account-card">
          <h2>Password</h2>
          <p className="help">This RaceLens is protected by a password. You stay signed in on this device for 30 days of use; sign out if you are handing the phone to someone else.</p>
          <button type="button" className="btn btn-secondary" onClick={signOut} disabled={signingOut} data-testid="logout-btn">
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </section>
      )}
    </div>
  );
}
