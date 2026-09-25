import type WebSocket from 'ws';
import { WebSocketServer } from 'ws';

/**
 * Lightweight pub/sub for per-session activity (bytes/sec). The PTY layer
 * calls `noteBytes(sessionId, bytes)` on every output chunk; an interval
 * flushes accumulated counts to all connected dashboard clients as
 * `{ type: 'activity', sessions: [{ sessionId, bytesPerSec, name?, provider? }] }`.
 *
 * The flush interval is only allocated while at least one client is
 * subscribed, so the cost is zero when nothing's watching.
 */

const FLUSH_INTERVAL_MS = 1000;
/** How long since the last byte arrived before we stop reporting a session. */
const IDLE_FORGET_MS = 60_000;

interface SessionCounter {
  sessionId: string;
  bytes: number;
  lastBytesAt: number;
  name?: string;
  provider?: string;
}

const counters = new Map<string, SessionCounter>();
let flushTimer: ReturnType<typeof setInterval> | null = null;

interface MetaUpdate {
  name?: string;
  provider?: string;
}

/**
 * Record a chunk of PTY output for a given session. Called from
 * terminal-pty.ts:onData. Cheap — just increments a counter.
 */
export function noteBytes(sessionId: string, byteLength: number, meta?: MetaUpdate): void {
  let counter = counters.get(sessionId);
  if (!counter) {
    counter = { sessionId, bytes: 0, lastBytesAt: Date.now() };
    counters.set(sessionId, counter);
  }
  counter.bytes += byteLength;
  counter.lastBytesAt = Date.now();
  if (meta?.name) counter.name = meta.name;
  if (meta?.provider) counter.provider = meta.provider;
}

/**
 * Drop a counter when its PTY exits. Otherwise idle sessions linger in
 * the broadcast for up to IDLE_FORGET_MS.
 */
export function forgetSession(sessionId: string): void {
  counters.delete(sessionId);
}

export const activityWss: WebSocketServer = new WebSocketServer({ noServer: true });

activityWss.on('connection', (ws) => {
  ensureFlushTimer();
  ws.on('close', () => {
    if (activityWss.clients.size === 0 && flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
  });
});

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    const now = Date.now();
    const sessions: Array<{
      sessionId: string;
      bytesPerSec: number;
      name?: string;
      provider?: string;
      lastBytesAt: number;
    }> = [];

    for (const [id, counter] of counters.entries()) {
      // Forget stale entries entirely.
      if (now - counter.lastBytesAt > IDLE_FORGET_MS) {
        counters.delete(id);
        continue;
      }
      sessions.push({
        sessionId: counter.sessionId,
        bytesPerSec: counter.bytes, // per 1-second interval
        name: counter.name,
        provider: counter.provider,
        lastBytesAt: counter.lastBytesAt,
      });
      counter.bytes = 0;
    }

    if (activityWss.clients.size === 0) {
      // No subscribers — keep counters resetting but skip the JSON work.
      return;
    }

    const message = JSON.stringify({ type: 'activity', sessions, sentAt: now });
    for (const client of activityWss.clients) {
      if (client.readyState === 1 /* OPEN */) {
        try { (client as WebSocket).send(message); } catch { /* ignore */ }
      }
    }
  }, FLUSH_INTERVAL_MS);
}
