import { X, Reply } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAuth } from '@/auth/AuthProvider';
import { useMessagesStore, selectBannerThreads } from '@/stores/messages-store';
import { messagesApi } from '@/lib/messages-api';
import { cn } from '@/lib/utils';

/**
 * Top-of-page stack of unread incoming messages. X dismisses (marks read),
 * Reply opens the thread in the widget. Broadcasts pin above normal cards.
 */
export default function IncomingBanner() {
  const { hasAccess } = useAuth();
  // selectBannerThreads returns a fresh array each call; without a shallow
  // equality check zustand's getSnapshot reference never stabilizes, which
  // triggers React error #185 (max update depth) on every mount.
  const banners = useMessagesStore(useShallow(selectBannerThreads));
  const openThread = useMessagesStore((s) => s.openThread);
  const dismissBanner = useMessagesStore((s) => s.dismissBanner);

  const chatBanners = banners.filter(
    (t) => t.unreadMessages.length > 0,
  );

  if (!hasAccess('messages') || chatBanners.length === 0) return null;

  // Announcements first, then most-recent activity.
  const sorted = [...chatBanners].sort((a, b) => {
    const aa = a.kind === 'broadcast' ? 1 : 0;
    const bb = b.kind === 'broadcast' ? 1 : 0;
    if (aa !== bb) return bb - aa;
    return (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '');
  });

  function dismiss(threadId: number) {
    dismissBanner(threadId);
    void messagesApi.markRead(threadId).catch(() => {});
  }

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-3 space-y-2 pointer-events-none">
      {sorted.slice(0, 4).map((t) => {
        const latest = t.unreadMessages[t.unreadMessages.length - 1];
        const isAnnouncement = t.kind === 'broadcast';
        return (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto relative overflow-hidden flex items-start gap-2 rounded-lg border shadow-lg px-3 py-2 bg-card',
              isAnnouncement ? 'border-primary/40' : 'border-border',
            )}
          >
            {/* Broadcasts pulse until read so they can't be missed. */}
            {isAnnouncement && <div className="absolute inset-0 bg-primary/20 animate-pulse pointer-events-none" />}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {isAnnouncement && <span className="text-[11px]">📢</span>}
                <span className="text-xs font-semibold text-foreground truncate">
                  {latest?.senderName ?? t.title}
                </span>
                {t.unreadCount > 1 && (
                  <span className="text-[9px] text-muted-foreground">+{t.unreadCount - 1} more</span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                {latest?.kind === 'ping' ? '👋 pinged you' : latest?.body}
              </div>
            </div>
            <button
              onClick={() => openThread(t.id)}
              className="h-6 px-1.5 flex items-center gap-1 rounded text-[10px] text-primary hover:bg-accent shrink-0"
              title="Reply"
            >
              <Reply className="h-3 w-3" />
              Reply
            </button>
            <button
              onClick={() => dismiss(t.id)}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground shrink-0"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
