import { useEffect } from 'react';
import { toast } from 'sonner';
import { API_BASE } from '@/lib/api-config';
import { runUpdate } from '@/lib/run-update';

const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Posts a heartbeat to the server every minute while authenticated.
 * The server uses this to populate users.lastVersion / lastHeartbeatAt
 * for admin visibility and to know which clients are currently online.
 *
 * The server records its OWN package.json version (each user runs their
 * own local Hive), so the body is informational only; we still send the
 * version we fetched from /api/version so server-side mismatches are
 * visible if they ever happen.
 */
export function useHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    let version = '';
    let stopped = false;
    let updating = false;

    async function ping() {
      if (stopped) return;
      try {
        const res = await fetch(`${API_BASE}/api/auth/heartbeat`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version }),
        });
        if (!res.ok) return;
        const data = await res.json() as { forceUpdatePending?: boolean };
        // An admin queued a force-update for this user. The flag was cleared
        // server-side when we read it, so run the update exactly once.
        if (data.forceUpdatePending && !updating) {
          updating = true;
          toast.info('Admin triggered an update', {
            description: 'Installing the latest version and restarting…',
            duration: 60_000,
          });
          void runUpdate((step, detail) => {
            if (step === 'building' || step === 'restarting' || step === 'done') {
              toast.info(`Update: ${step}`, { description: detail });
            }
          });
        }
      } catch {
        // Non-fatal: heartbeat will retry on the next tick.
      }
    }

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/version`);
        if (res.ok) {
          const data = await res.json() as { version: string };
          version = data.version || '';
        }
      } catch {
        // ignore
      }
      // Fire immediately, then on an interval.
      ping();
    })();

    const handle = window.setInterval(ping, HEARTBEAT_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(handle);
    };
  }, [enabled]);
}
