import { useEffect } from 'react';
import { API_BASE } from '@/lib/api-config';
import { useDashboardStore } from '@/stores/dashboard-store';
import type { Session } from '@/stores/types';

const PUBLISH_INTERVAL_MS = 45_000;

const ACTIVE = new Set(['working', 'waiting-input', 'waiting-approval', 'error', 'paused']);

/**
 * Publishes this machine's live-session snapshot to the shared [Hive].[user_now]
 * table on an interval, so the Team "Now" board can show what everyone is doing.
 * Only runs while authenticated. Each instance only sees its own local sessions,
 * which is exactly the point — the board aggregates everyone's snapshots.
 */
export function useNowPublisher(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;

    async function publish() {
      if (stopped) return;
      const sessions = useDashboardStore.getState().sessions
        // Incognito sessions never reach the team board. `incognito` is
        // resolved server-side by the aggregator, so this covers both the
        // per-project and the per-session flag.
        .filter((s: Session) => !s.isSubagent && !s.incognito && ACTIVE.has(s.status))
        .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

      const working = sessions.filter((s) => s.status === 'working').length;
      const waiting = sessions.filter((s) => s.status === 'waiting-input' || s.status === 'waiting-approval').length;
      const errorCount = sessions.filter((s) => s.status === 'error').length;
      const top = sessions[0];

      const payload = {
        working,
        waiting,
        errorCount,
        total: sessions.length,
        topProject: top?.project ?? null,
        topStatus: top?.status ?? null,
        sessions: sessions.slice(0, 20).map((s) => ({
          slug: s.slug || s.id.slice(0, 8),
          project: s.project,
          status: s.status,
          model: s.model,
          lastActivity: s.lastActivity,
        })),
      };

      try {
        await fetch(`${API_BASE}/api/now/push`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        // Non-fatal: next tick retries.
      }
    }

    void publish();
    const handle = window.setInterval(() => void publish(), PUBLISH_INTERVAL_MS);
    return () => { stopped = true; window.clearInterval(handle); };
  }, [enabled]);
}
