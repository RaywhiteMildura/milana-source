import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Catches render crashes so the person never sees a blank screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('RaceLens UI error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="empty card empty--error" role="alert" data-testid="error-boundary">
          <div className="empty__icon" aria-hidden>
            ⚠
          </div>
          <h3>Something went wrong showing this page</h3>
          <p className="muted">The data may be in an unexpected shape. Reloading usually fixes it.</p>
          <p className="small muted mono">{this.state.error.message}</p>
          <div className="empty__action">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>{' '}
            <a href="#/" className="btn btn-secondary" onClick={() => this.setState({ error: null })}>
              Back to race days
            </a>
          </div>
        </div>
      </div>
    );
  }
}
