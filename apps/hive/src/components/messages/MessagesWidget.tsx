import { MessageCircle } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { useMessagesStore, selectUnreadCount } from '@/stores/messages-store';
import MessagesPanel from './MessagesPanel';

/** Bottom-right launcher + popup. Mounted globally so it appears on every page. */
export default function MessagesWidget() {
  const { hasAccess } = useAuth();
  const isOpen = useMessagesStore((s) => s.isOpen);
  const toggleWidget = useMessagesStore((s) => s.toggleWidget);
  const unread = useMessagesStore(selectUnreadCount);

  if (!hasAccess('messages')) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {isOpen && <MessagesPanel />}
      <button
        onClick={toggleWidget}
        className="relative h-11 w-11 flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
        title="Messages"
      >
        <MessageCircle className="h-5 w-5" />
        {unread > 0 && !isOpen && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-0.5 flex items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white border border-card">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    </div>
  );
}
