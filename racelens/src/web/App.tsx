import { useEffect, type ReactNode } from 'react';
import { api, useRequest } from './lib/api';
import { routes, useRoute } from './lib/router';
import { ConfirmProvider } from './components/Confirm';
import { ToastProvider } from './components/Toast';
import { EmptyState } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HomePage } from './pages/HomePage';
import { JobPage } from './pages/JobPage';
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

export default function App() {
  const route = useRoute();
  const health = useRequest(() => api.health(), []);
  const [seg0, seg1, seg2, seg3] = route.path;

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [seg0, seg1]);

  let page: ReactNode;
  if (!seg0) page = <HomePage query={route.query} />;
  else if (seg0 === 'job' && seg1) page = <JobPage id={seg1} query={route.query} />;
  else if (seg0 === 'pack' && seg1) page = <PackPage id={seg1} raceParam={seg2 === 'race' ? seg3 : undefined} />;
  else if (seg0 === 'settings') page = <SettingsPage />;
  else page = <NotFound />;

  const isHome = !seg0 || seg0 === 'job' || seg0 === 'pack';

  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="app">
          <header className="topbar">
            <div className="topbar__inner">
              <a href={routes.home()} className="brand" aria-label="RaceLens home">
                <span className="brand__logo" aria-hidden>
                  <svg viewBox="0 0 64 64" width="28" height="28">
                    <rect width="64" height="64" rx="14" fill="currentColor" />
                    <circle cx="32" cy="32" r="15" fill="none" stroke="#f3c75a" strokeWidth="6" />
                    <circle cx="32" cy="32" r="5" fill="#fff" />
                  </svg>
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
          <main className="container">
            <ErrorBoundary key={`${seg0 ?? ""}/${seg1 ?? ""}`}>{page}</ErrorBoundary>
          </main>
          <footer className="footer">
            <span>Suggestions only. Bet responsibly. Gambling Help 1800 858 858.</span>
            {health.data?.version && <span className="muted"> · RaceLens {health.data.version}</span>}
          </footer>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
