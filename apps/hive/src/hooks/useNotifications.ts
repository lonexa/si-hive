import { useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useDashboardStore } from '@/stores/dashboard-store';
import { getSessionDisplayName, shortProject } from '@/lib/utils';
import { router } from '@/router';

const DEDUP_WINDOW_MS = 30_000;
const MACOS_SUPPRESS_WINDOW_MS = 5_000;
const NOTIFICATION_FIRED_CLEANUP_MS = 10_000;

/**
 * How long to wait before showing a "done" toast.
 * If the session goes back to "working" within this window, the toast is cancelled.
 * This prevents false "done" toasts when Claude is between tool calls.
 */
const DONE_SETTLE_MS = 12_000;

const notifiedMap = new Map<string, number>();
const pendingDoneTimers = new Map<string, ReturnType<typeof setTimeout>>();

function statusIcon(status: string): string {
  switch (status) {
    case 'done': return '\u2705';
    case 'waiting-input': return '\u2753';
    case 'waiting-approval': return '\u26a0\ufe0f';
    case 'error': return '\u274c';
    default: return '\u2022';
  }
}

function statusToastType(status: string): 'success' | 'warning' | 'error' | 'info' {
  switch (status) {
    case 'done': return 'success';
    case 'error': return 'error';
    case 'waiting-approval': return 'warning';
    default: return 'info';
  }
}

function navigateToSession(sessionId: string) {
  router.navigate(`/sessions/${sessionId}`);
}

function fireToastAndBrowserNotification(
  session: { id: string; status: string; project: string },
  statusLabel: string,
  sessionLabel: string,
  notify: (title: string, body: string, onClick?: () => void) => void,
  browserEnabled: boolean,
) {
  const icon = statusIcon(session.status);
  const goToSession = () => navigateToSession(session.id);

  // In-app toast
  toast[statusToastType(session.status)](
    `${icon} ${statusLabel}: ${sessionLabel}`,
    {
      description: shortProject(session.project),
      duration: 8000,
      action: {
        label: 'View',
        onClick: goToSession,
      },
    },
  );

  // Browser notification (if enabled and permitted)
  if (browserEnabled) {
    notify(
      `SI Hive: ${statusLabel}`,
      `${sessionLabel} — ${session.project}`,
      goToSession,
    );
  }
}

export function useNotifications() {
  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }, []);

  const notify = useCallback((title: string, body: string, onClick?: () => void) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    const notification = new Notification(title, {
      body,
      icon: '/favicon.ico',
      tag: title, // Replaces existing notification with same tag
    });

    if (onClick) {
      notification.onclick = () => {
        window.focus();
        onClick();
        notification.close();
      };
    }
  }, []);

  // Subscribe to store: fire notifications when sessions need attention
  useEffect(() => {
    const unsubscribe = useDashboardStore.subscribe((state, prevState) => {
      const now = Date.now();

      for (const session of state.sessions) {
        // Cancel pending "done" timer if session went back to a non-done status
        if (pendingDoneTimers.has(session.id) && session.status !== 'done') {
          clearTimeout(pendingDoneTimers.get(session.id)!);
          pendingDoneTimers.delete(session.id);
        }

        if (session.status !== 'done' && session.status !== 'waiting-input' && session.status !== 'waiting-approval' && session.status !== 'error') continue;

        // Check if this session was already in this status
        const prev = prevState.sessions.find((s) => s.id === session.id);
        if (prev?.status === session.status) continue;

        // Deduplicate within 30 seconds
        const lastNotified = notifiedMap.get(session.id);
        if (lastNotified && now - lastNotified < DEDUP_WINDOW_MS) continue;

        // Skip if macOS already sent a notification for this session recently
        const macOSFiredAt = state.notificationFired[session.id];
        if (macOSFiredAt && now - macOSFiredAt < MACOS_SUPPRESS_WINDOW_MS) continue;

        // Clean up old entries from notifiedMap
        for (const [key, time] of notifiedMap) {
          if (now - time > DEDUP_WINDOW_MS * 2) {
            notifiedMap.delete(key);
          }
        }

        // Clean up stale entries from notificationFired in the store
        const staleIds = Object.entries(state.notificationFired)
          .filter(([, time]) => now - time > NOTIFICATION_FIRED_CLEANUP_MS)
          .map(([id]) => id);

        if (staleIds.length > 0) {
          const cleaned = { ...state.notificationFired };
          for (const id of staleIds) {
            delete cleaned[id];
          }
          useDashboardStore.setState({ notificationFired: cleaned });
        }

        const statusLabel = session.status === 'error' ? 'Error' :
          session.status === 'done' ? 'Done' :
          session.status === 'waiting-input' ? 'Needs input' : 'Needs approval';

        const sessionLabel = getSessionDisplayName(session);
        const browserEnabled = state.notificationConfig.browser !== false;

        if (session.status === 'done') {
          // Delay "done" notifications — cancel if session resumes working
          if (!pendingDoneTimers.has(session.id)) {
            const sessionSnapshot = { id: session.id, status: session.status, project: session.project };
            const timer = setTimeout(() => {
              pendingDoneTimers.delete(session.id);
              // Re-check: is the session STILL done?
              const current = useDashboardStore.getState().sessions.find(s => s.id === session.id);
              if (current && current.status === 'done') {
                notifiedMap.set(session.id, Date.now());
                fireToastAndBrowserNotification(sessionSnapshot, statusLabel, sessionLabel, notify, browserEnabled);
              }
            }, DONE_SETTLE_MS);
            pendingDoneTimers.set(session.id, timer);
          }
        } else {
          // waiting-input, waiting-approval, error — notify immediately
          notifiedMap.set(session.id, now);
          fireToastAndBrowserNotification(
            { id: session.id, status: session.status, project: session.project },
            statusLabel, sessionLabel, notify, browserEnabled,
          );
        }
      }
    });

    return () => {
      unsubscribe();
      // Clean up pending timers
      for (const timer of pendingDoneTimers.values()) {
        clearTimeout(timer);
      }
      pendingDoneTimers.clear();
    };
  }, [notify]);

  return { requestPermission, notify };
}
