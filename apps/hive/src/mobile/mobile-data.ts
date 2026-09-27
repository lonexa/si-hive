import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDashboardStore } from '@/stores/dashboard-store';
import { saveSessionIntent, type NewSessionIntent } from '@/lib/session-intent';
import { markTerminalIncognito } from '@/lib/incognito';
import type { ProviderId } from '@/lib/launch-flags';
import type { Session } from '@/stores/types';

export const ATTENTION_STATUSES = new Set<Session['status']>(['waiting-input', 'waiting-approval', 'error']);

/** Same "real session" rule as the desktop pages: no subagents, no abandoned starts. */
export function isListedSession(s: Session): boolean {
  return !s.isSubagent && !!(s.initialPrompt || s.latestPrompt || s.fileSize >= 2048);
}

export function needsAttention(s: Session): boolean {
  return ATTENTION_STATUSES.has(s.status);
}

export function useAttentionCount(): number {
  return useDashboardStore((st) => st.sessions.filter((s) => !s.isSubagent && needsAttention(s)).length);
}

export function statusDotClass(status: Session['status']): string {
  switch (status) {
    case 'working': return 'bg-status-green animate-pulse';
    case 'waiting-input':
    case 'waiting-approval': return 'bg-status-yellow';
    case 'error': return 'bg-status-red';
    default: return 'bg-status-gray';
  }
}

/** Needs-you first, then working, then most recent. */
export function sessionSortKey(s: Session): [number, number] {
  const rank = needsAttention(s) ? 0 : s.status === 'working' ? 1 : 2;
  return [rank, -new Date(s.lastActivity).getTime()];
}

export function compareSessions(a: Session, b: Session): number {
  const [ra, ta] = sessionSortKey(a);
  const [rb, tb] = sessionSortKey(b);
  return ra - rb || ta - tb;
}

/**
 * Every "+AI" launcher stores its request in sessionStorage and navigates to
 * /sessions (see useAISession); the sessions page turns it into a new-session
 * URL. Mirrors the desktop SessionsPage handling.
 */
export function usePendingSpawn(): void {
  const navigate = useNavigate();
  // Re-check on every navigation: a launch from /sessions itself doesn't remount the page.
  const { key } = useLocation();
  useEffect(() => {
    const spawnData = sessionStorage.getItem('hive-terminal-spawn');
    if (!spawnData) return;
    sessionStorage.removeItem('hive-terminal-spawn');
    try {
      const parsed = JSON.parse(spawnData) as {
        cwd?: string;
        command?: string;
        args?: string[];
        initialPrompt?: string;
        provider?: ProviderId;
        account?: string;
        incognito?: boolean;
      };
      const provider: ProviderId = parsed.provider ?? 'claude';
      const newTermId = `new-${provider}-${Date.now()}`;
      if (parsed.incognito) markTerminalIncognito(newTermId);
      const intent: NewSessionIntent = {
        newSession: true,
        cwd: parsed.cwd,
        providerId: provider,
        accountId: parsed.account,
        handoff: {
          command: parsed.command || provider,
          args: parsed.args ?? [],
          provider,
          initialPrompt: parsed.initialPrompt,
        },
      };
      saveSessionIntent(newTermId, intent);
      navigate(`/sessions/${newTermId}`, { state: intent, replace: true });
    } catch {
      // Malformed payload: stay on the list.
    }
  }, [navigate, key]);
}
