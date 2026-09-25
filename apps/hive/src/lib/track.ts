/**
 * Lightweight, batched client-event tracker for Hive admin visibility.
 *
 * Events are buffered in memory and flushed either:
 *   - every FLUSH_INTERVAL_MS (5s), or
 *   - when the buffer reaches BATCH_SIZE (25), or
 *   - on `pagehide` (via sendBeacon for the last-ditch push).
 *
 * All writes are fire-and-forget. The server resolves the user via the
 * session cookie, so the client never needs to know its own OID.
 */

import { API_BASE } from '@/lib/api-config';

const FLUSH_INTERVAL_MS = 5_000;
const BATCH_SIZE = 25;
const ENDPOINT = `${API_BASE}/api/events/track`;

export interface TrackedEvent {
  name: string;
  category: string;
  route: string;
  occurredAt: string;
  props?: Record<string, unknown>;
}

let buffer: TrackedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; void flushEvents(false); }, FLUSH_INTERVAL_MS);
}

export function trackEvent(
  name: string,
  props?: Record<string, unknown>,
  category = 'click',
): void {
  if (!name) return;
  buffer.push({
    name: name.slice(0, 150),
    category: category.slice(0, 50),
    route: typeof window !== 'undefined' ? window.location.pathname.slice(0, 200) : '',
    occurredAt: new Date().toISOString(),
    props,
  });
  if (buffer.length >= BATCH_SIZE) {
    void flushEvents(false);
  } else {
    scheduleFlush();
  }
}

/**
 * Drain the buffer to the server. `useBeacon=true` uses navigator.sendBeacon
 * so the request survives a page unload.
 */
export async function flushEvents(useBeacon: boolean): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  const payload = JSON.stringify({ events: batch });
  try {
    if (useBeacon && typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(ENDPOINT, blob);
      return;
    }
    await fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    });
  } catch {
    // On failure we drop this batch — these are best-effort analytics, not
    // billing events. Re-queueing risks unbounded memory growth on long
    // outages.
  }
}
