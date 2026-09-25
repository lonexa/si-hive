import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '@/lib/report-error';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Root error boundary. Catches render-time errors anywhere in the React tree,
 * forwards them to telemetry.ErrorEvents (AppName='Hive'), and shows a minimal
 * fallback so the user can recover with a refresh.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void reportError({
      message: error.message || 'React render error',
      stack: `${error.stack ?? ''}\n\nComponent stack:${info.componentStack ?? ''}`,
      exceptionType: error.name || 'ReactError',
      severity: 5,
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md space-y-3 text-center">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              {this.state.error.message || 'An unexpected error occurred. The error has been reported.'}
            </p>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="text-sm px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
