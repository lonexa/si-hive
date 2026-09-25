import { API_BASE } from '@/lib/api-config';

let cachedVersion: string | null = null;

async function getVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  try {
    const res = await fetch(`${API_BASE}/api/version`);
    if (res.ok) {
      const data = await res.json() as { version: string };
      cachedVersion = data.version || '';
    }
  } catch {
    cachedVersion = '';
  }
  return cachedVersion || '';
}

export interface ReportedError {
  message: string;
  stack?: string;
  exceptionType?: string;
  route?: string;
  severity?: 3 | 4 | 5;
  source?: 'client';
}

/**
 * Fire-and-forget POST to /api/errors/report. Used by ErrorBoundary,
 * window.onerror, and unhandledrejection listeners.
 */
export async function reportError(err: ReportedError): Promise<void> {
  try {
    const version = await getVersion();
    await fetch(`${API_BASE}/api/errors/report`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: err.message,
        stack: err.stack,
        exceptionType: err.exceptionType,
        route: err.route ?? window.location.pathname,
        userAgent: navigator.userAgent,
        version,
        severity: err.severity ?? 4,
        source: err.source ?? 'client',
      }),
    });
  } catch {
    // Telemetry write failures must not cascade.
  }
}
