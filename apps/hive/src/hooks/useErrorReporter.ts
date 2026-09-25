import { useEffect } from 'react';
import { reportError } from '@/lib/report-error';

/**
 * Installs window.onerror + unhandledrejection listeners that publish to
 * telemetry.ErrorEvents (AppName='Hive'). Mounted once at the app root.
 */
export function useErrorReporter() {
  useEffect(() => {
    function onError(ev: ErrorEvent) {
      const err = ev.error instanceof Error ? ev.error : null;
      void reportError({
        message: ev.message || err?.message || 'window.onerror',
        stack: err?.stack,
        exceptionType: err?.name || 'Error',
        severity: 4,
      });
    }
    function onRejection(ev: PromiseRejectionEvent) {
      const reason = ev.reason;
      const err = reason instanceof Error ? reason : null;
      const message = err?.message || (typeof reason === 'string' ? reason : 'Unhandled promise rejection');
      void reportError({
        message,
        stack: err?.stack,
        exceptionType: err?.name || 'UnhandledRejection',
        severity: 4,
      });
    }
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
}
