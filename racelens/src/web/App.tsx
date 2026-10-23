import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AUTH_REQUIRED_EVENT, api, errorMessage, isUnreachable, useRequest, type AuthState } from './lib/api';
import { routes, useRoute } from './lib/router';
import { clearSaved, hasSavedCopies } from './lib/saved';
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
  // The server cannot be reached but this phone has saved copies of the researched meetings: open the app on those.
  const [offline, setOffline] = useState(false);
  const checkAuth = useCallback(async () => {
    let answered = false;
    // A stalled connection: open on the saved copies after a few seconds rather than a skeleton for the whole timeout.
    const early = window.setTimeout(async () => {
      if ((await hasSavedCopies()) && !answered) setOffline(true);
    }, 4000);
    try {
      const a = await api.auth();
      answered = true;
      // Saved copies never outlive this device's sign-in (expired, signed out elsewhere, password changed).
      if (a.required && !a.authenticated) await clearSaved();
      setAuth(a);
      setAuthError(null);
      setOffline(false);
    } catch (e) {
      answered = true;
      // An older server without /api/auth has no login at all; anything else is a real outage.
      if ((e as { status?: number }).status === 404) {
        setAuth({ required: false, authenticated: true });
        setAuthError(null);
        setOffline(false);
      } else {
        setOffline(isUnreachable(e) && (await hasSavedCopies()));
        setAuthError(errorMessage(e));
      }
    } finally {
      window.clearTimeout(early);
    }
  }, []);
  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  // Not through yet (the Mac mini restarting, Tailscale reconnecting, no signal): keep trying by ourselves.
  const waiting = !auth && !!authError;
  useEffect(() => {
    if (!waiting) return;
    let busy = false;
    const retry = async () => {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        await checkAuth();
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(retry, 15_000);
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
    };
  }, [waiting, checkAuth]);

  // Any API call refused for want of a login drops us back to the login screen.
  useEffect(() => {
    const onRequired = () => {
      void clearSaved();
      setAuth((a) => (a && a.required && !a.authenticated ? a : { required: true, authenticated: false }));
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onRequired);
  }, []);

  const signedIn = offline || (!!auth && (!auth.required || auth.authenticated));

  // Health carries the scheduler status and LAN urls only once signed in, so re-fetch it after a login (and once back online).
  const health = useRequest(() => (signedIn && !offline ? api.health() : Promise.resolve(null)), [signedIn, offline]);

  const afterLogin = useCallback(async () => {
    await checkAuth();
  }, [checkAuth]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      await clearSaved();
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
  if (!auth && !offline) {
    if (authError) {
      return (
        <div className="startup">
          <div className="startup__card" data-testid="cant-reach">
            <ErrorState title="Can't reach RaceLens" message={`${authError.replace(/[.!]?\s*$/, '.')} It keeps trying by itself.`} onRetry={() => void checkAuth()} />
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
