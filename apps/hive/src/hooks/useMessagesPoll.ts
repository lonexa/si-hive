import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { useMessagesStore } from '@/stores/messages-store';
import { messagesApi, type Message } from '@/lib/messages-api';

const POLL_INTERVAL_MS = 15_000;

function browserNotify(title: string, body: string, onClick?: () => void) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const n = new Notification(title, { body, icon: '/favicon.ico', tag: title });
  if (onClick) {
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  }
}

/**
 * Polls the messaging inbox every ~15s (and on window focus) while authenticated
 * and feature-enabled. Pushes results into the store (which drives the badge +
 * top banners) and fires a toast/notification for messages that arrive after mount.
 */
export function useMessagesPoll() {
  const { isAuthenticated, hasAccess } = useAuth();
  const setThreads = useMessagesStore((s) => s.setThreads);
  const openThread = useMessagesStore((s) => s.openThread);
  // Highest message id we've already alerted on. Seeded on first poll so we don't
  // toast for the backlog already shown as banners.
  const lastAlertedId = useRef<number | null>(null);

  const enabled = isAuthenticated && hasAccess('messages');

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;

    async function poll() {
      if (stopped) return;
      try {
        const { threads } = await messagesApi.inbox();
        if (stopped) return;
        setThreads(threads);

        const incoming: Message[] = threads.flatMap((t) => t.unreadMessages);
        const maxId = incoming.reduce((m, msg) => Math.max(m, msg.id), 0);

        if (lastAlertedId.current === null) {
          // First poll — establish baseline, don't replay the backlog as toasts.
          lastAlertedId.current = maxId;
          return;
        }

        const fresh = incoming.filter((m) => m.id > lastAlertedId.current!);
        lastAlertedId.current = maxId;
        if (fresh.length > 0) {
          // One toast per sending thread to avoid spam.
          const byThread = new Map<number, Message>();
          for (const m of fresh) byThread.set(m.threadId, m);
          for (const m of byThread.values()) {
            const label =
              m.kind === 'ping' ? `👋 ${m.senderName} pinged you`
              : m.kind === 'announcement' ? `📢 ${m.senderName}`
              : `💬 ${m.senderName}`;
            const body = m.kind === 'ping' ? 'Open Messages to reply' : m.body;
            toast.info(label, {
              description: body.slice(0, 140),
              duration: 8000,
              action: { label: 'Open', onClick: () => openThread(m.threadId) },
            });
            browserNotify(`SI Hive: ${m.senderName}`, body, () => openThread(m.threadId));
          }
        }
      } catch {
        // Non-fatal: retry on the next tick.
      }
    }

    poll();
    const handle = window.setInterval(poll, POLL_INTERVAL_MS);
    const onFocus = () => poll();
    window.addEventListener('focus', onFocus);

    return () => {
      stopped = true;
      window.clearInterval(handle);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, setThreads, openThread]);
}
