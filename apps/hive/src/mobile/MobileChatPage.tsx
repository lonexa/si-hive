import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import ChatSidebar from '@/components/chat/ChatSidebar';
import ChatMain from '@/components/chat/ChatMain';
import { useChatStore } from '@/stores/chat-store';

/**
 * Chat on a phone: the conversation list and the open conversation take
 * turns filling the screen instead of sitting side by side.
 */
export default function MobileChatPage() {
  const { loadConversations, activeConversationId, setActiveConversationId, conversations } = useChatStore();
  const active = conversations.find((c) => c.id === activeConversationId);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  if (activeConversationId) {
    return (
      <div className="mobile-chat flex h-full flex-col bg-background">
        <button
          type="button"
          onClick={() => setActiveConversationId(null)}
          className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3 text-xs text-muted-foreground active:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" /> All conversations
          {active && <span className="min-w-0 flex-1 truncate text-right text-foreground/70">{active.title}</span>}
        </button>
        <div className="flex min-h-0 flex-1">
          <ChatMain />
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-chat-list flex h-full overflow-hidden bg-background">
      <ChatSidebar />
    </div>
  );
}
