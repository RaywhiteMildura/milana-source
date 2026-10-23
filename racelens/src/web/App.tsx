import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AUTH_REQUIRED_EVENT, api, errorMessage, useRequest, type AuthState } from './lib/api';
import { routes, useRoute } from './lib/router';
import { SessionContext, type Session } from './lib/session';
import { ConfirmProvider } from './components/Confirm';
import { InstallHint } from './components/InstallHint';
import { Logo } from './components/Logo';
import { ToastProvider } from './components/Toast';
import { EmptyState, ErrorState, Skeleton } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HomePage } from './pages/HomePage';
import { JobPage } from './pages/JobPage';
import { LoginPage } from './pages/LoginPage';
import { PackPage } from './pages/PackPage';
import { SettingsPage } from './pages/SettingsPage';

function NotFound() {
  return (
    <div className="page">
      <EmptyState
        icon="🧭"
        title="That page doesn't exist"
        action={
          <a href={routes.home()} className="btn btn-primary">
            Back to race days
          </a>
        }
      >
        The link may be old or mistyped.
      </EmptyState>
    </div>
  );
}

/** Shown for the moment it takes to learn whether a password is needed. */
function StartupSkeleton() {
  return (
    <div className="startup" aria-busy="true" aria-label="Starting RaceLens" data-testid="startup-skeleton">
      <div className="card startup__card">
        <span className="startup__logo" aria-hidden>
          <Logo size={40} />
        </span>
        <Skeleton h={22} w="45%" />
        <Skeleton h={14} w="70%" />
        <Skeleton h={44} w="100%" />
      </div>
    </div>
  );
}

export default function App() {
  const route = useRoute();
  const [seg0, seg1, seg2, seg3] = route.path;

  // --------------------------------------------------------------- auth
  // null = not known yet (show a skeleton); otherwise whether a login is needed.
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const checkAuth = useCallback(async () => {
    try {
      const a = await api.auth();
      setAuth(a);
      setAuthError(null);
    } catch (e) {
      // An older server without /api/auth has no login at all; anything else is a real outage.
      if ((e as { status?: number }).status === 404) {
        setAuth({ required: false, authenticated: true });
        setAuthError(null);
      } else {
        setAuthError(errorMessage(e));
      }
    }
  }, []);
  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  // Any API call refused for want of a login drops us back to the login screen.
  useEffect(() => {
    const onRequired = () => setAuth((a) => (a && a.required && !a.authenticated ? a : { required: true, authenticated: false }));
    window.addEventListener(AUTH_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onRequired);
  }, []);

  const signedIn = !!auth && (!auth.required || auth.authenticated);

  // Health carries the scheduler status and LAN urls only once signed in, so re-fetch it after a login.
  const health = useRequest(() => (signedIn ? api.health() : Promise.resolve(null)), [signedIn]);

  const afterLogin = useCallback(async () => {
    await checkAuth();
  }, [checkAuth]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setAuth({ required: true, authenticated: false });
    }
  }, []);

  // Measured when a health response lands (this memo runs on that render), so it includes little more than the request latency.
  const clockOffset = useMemo(() => {
    const t = health.data?.time ? Date.parse(health.data.time) : NaN;
    return Number.isFinite(t) ? t - Date.now() : 0;
  }, [health.data?.time]);
  const session = useMemo<Session>(
    () => ({ health: health.data, reloadHealth: () => health.reload(true), authRequired: !!auth?.required, signOut, clockOffset }),
    [health.data, health.reload, auth?.required, signOut, clockOffset],
  );

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [seg0, seg1]);

  // ------------------------------------------------------------ shells
  if (!auth) {
    if (authError) {
      return (
        <div className="startup">
          <div className="startup__card">
            <ErrorState title="Could not reach the RaceLens server" message={authError} onRetry={() => void checkAuth()} />
          </div>
        </div>
      );
    }
    return <StartupSkeleton />;
  }

  if (!signedIn) {
    return (
      <ToastProvider>
        <LoginPage onSuccess={afterLogin} />
      </ToastProvider>
    );
  }

  let page: ReactNode;
  if (!seg0) page = <HomePage query={route.query} />;
  else if (seg0 === 'job' && seg1) page = <JobPage id={seg1} query={route.query} />;
  else if (seg0 === 'pack' && seg1) page = <PackPage id={seg1} raceParam={seg2 === 'race' ? seg3 : undefined} />;
  else if (seg0 === 'settings') page = <SettingsPage />;
  else page = <NotFound />;

  const isHome = !seg0 || seg0 === 'job' || seg0 === 'pack';

  return (
    <SessionContext.Provider value={session}>
      <ToastProvider>
        <ConfirmProvider>
          <div className="app">
            <header className="topbar">
              <div className="topbar__inner">
                <a href={routes.home()} className="brand" aria-label="RaceLens home">
                  <span className="brand__logo" aria-hidden>
                    <Logo size={28} />
                  </span>
                  <span className="brand__text">
                    <span className="brand__name">RaceLens</span>
                    <span className="brand__tag">Every source. Every horse. One clear view.</span>
                  </span>
                </a>
                <nav className="topbar__nav" aria-label="Main">
                  <a href={routes.home()} className={`nav-link ${isHome ? 'is-active' : ''}`}>
                    Race days
                  </a>
                  <a href={routes.settings()} className={`nav-link ${seg0 === 'settings' ? 'is-active' : ''}`} data-testid="nav-settings">
                    Settings
                  </a>
                </nav>
              </div>
            </header>
            {health.data?.mode === 'demo' && (
              <div className="banner banner--info" data-testid="demo-banner">
                Demo mode – bundled sample data, not live
              </div>
            )}
            <InstallHint />
            <main className="container">
              <ErrorBoundary key={`${seg0 ?? ''}/${seg1 ?? ''}`}>{page}</ErrorBoundary>
            </main>
            <footer className="footer">
              <span>Suggestions only. Bet responsibly. Gambling Help 1800 858 858.</span>
              {health.data?.version && <span className="muted"> · RaceLens {health.data.version}</span>}
            </footer>
          </div>
        </ConfirmProvider>
      </ToastProvider>
    </SessionContext.Provider>
  );
}
