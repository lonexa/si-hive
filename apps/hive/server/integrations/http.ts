/**
 * Minimal HTTP client for integration providers: JSON in/out, timeouts, and
 * errors that carry the status + a readable message (never the auth header).
 */

export class IntegrationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly provider: string,
  ) {
    super(message);
    this.name = 'IntegrationError';
  }
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Serialized as JSON unless it is already a string. */
  body?: unknown;
  /** Response handling: parsed JSON (default), raw text, bytes, or nothing. */
  as?: 'json' | 'text' | 'buffer' | 'none';
  timeoutMs?: number;
  /** Treat 404 as `null` instead of throwing. */
  allow404?: boolean;
}

export type HttpClient = <T = unknown>(url: string, opts?: RequestOptions) => Promise<T>;

/**
 * Build a client bound to a provider name and default headers (auth etc.).
 * Relative URLs resolve against `baseUrl`.
 */
export function createHttpClient(provider: string, baseUrl: string, defaultHeaders: Record<string, string>): HttpClient {
  return async function request<T>(url: string, opts: RequestOptions = {}): Promise<T> {
    const full = /^https?:\/\//i.test(url) ? url : `${baseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
    const headers: Record<string, string> = { Accept: 'application/json', ...defaultHeaders, ...opts.headers };
    let body: string | undefined;
    if (opts.body !== undefined) {
      body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      headers['Content-Type'] ??= 'application/json';
    }

    let res: Response;
    try {
      res = await fetch(full, {
        method: opts.method ?? (body ? 'POST' : 'GET'),
        headers,
        body,
        redirect: 'follow',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
    } catch (err) {
      throw new IntegrationError(`${provider}: request failed (${(err as Error).message})`, 0, provider);
    }

    if (res.status === 404 && opts.allow404) return null as T;
    if (!res.ok) {
      let detail = '';
      try {
        const text = await res.text();
        try {
          const j = JSON.parse(text) as Record<string, unknown>;
          detail = String(j.message ?? j.error_description ?? j.error ?? (Array.isArray(j.errors) ? JSON.stringify(j.errors) : '') ?? '');
        } catch {
          detail = text.slice(0, 300);
        }
      } catch { /* ignore */ }
      const hint = res.status === 401 ? ' — check the token' : res.status === 403 ? ' — token lacks permission or rate-limited' : '';
      throw new IntegrationError(`${provider}: ${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}${hint}`, res.status, provider);
    }

    switch (opts.as ?? 'json') {
      case 'none': return undefined as T;
      case 'text': return (await res.text()) as T;
      case 'buffer': return Buffer.from(await res.arrayBuffer()) as T;
      default: {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }
    }
  };
}

/** Last `maxChars` characters of a (log) string. */
export function tail(text: string, maxChars = 20_000): string {
  return text.length > maxChars ? text.slice(text.length - maxChars) : text;
}

/** Normalize a user-entered base URL (adds https://, strips trailing slash). */
export function normalizeBaseUrl(url: string | boolean | undefined, fallback: string): string {
  const raw = typeof url === 'string' && url.trim() ? url.trim() : fallback;
  return (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, '');
}
