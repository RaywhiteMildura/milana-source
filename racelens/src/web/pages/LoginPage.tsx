import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, errorMessage } from '../lib/api';
import { Logo } from '../components/Logo';

/**
 * Full-screen password prompt shown when the server has RACELENS_PASSWORD set
 * and this browser has no valid session cookie yet.
 */
export function LoginPage({ onSuccess }: { onSuccess: () => Promise<void> | void }) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!password) {
      setError('Type your password first.');
      input.current?.focus();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.login(password);
      setPassword('');
      await onSuccess();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError('That password is not right. Try again.');
      else if (err instanceof ApiError && err.status === 429) setError('Too many attempts. Wait a minute, then try again.');
      else setError(errorMessage(err));
      input.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login" data-testid="login-page">
      <form className="card login__card" onSubmit={submit} data-testid="login-form" noValidate>
        <div className="login__brand">
          <span className="login__logo" aria-hidden>
            <Logo size={44} />
          </span>
          <div>
            <h1 className="login__title">RaceLens</h1>
            <p className="small muted">Every source. Every horse. One clear view.</p>
          </div>
        </div>
        <label className="form-row" htmlFor="login-password">
          <span className="label">Enter your RaceLens password</span>
          <span className="help">It is the RACELENS_PASSWORD set where the server runs. You stay signed in on this device for 30 days.</span>
        </label>
        <div className="login__field">
          <input
            id="login-password"
            ref={input}
            type={show ? 'text' : 'password'}
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={submitting}
            aria-invalid={!!error}
            aria-describedby={error ? 'login-error' : undefined}
            data-testid="login-password"
          />
          <button type="button" className="btn btn-secondary login__show" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'} data-testid="login-show">
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
        {error && (
          <p id="login-error" className="text-error small login__error" role="alert" data-testid="login-error">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-lg login__submit" disabled={submitting} data-testid="login-submit">
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="small muted login__foot">Suggestions only. Bet responsibly. Gambling Help 1800 858 858.</p>
      </form>
    </div>
  );
}
