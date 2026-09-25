import { useEffect, useCallback } from 'react';
import ChatSidebar from './ChatSidebar';
import ChatMain from './ChatMain';
import { useChatStore } from '@/stores/chat-store';

export default function ChatPage() {
  const { loadConversations, activeConversationId, setActiveConversationId, conversations, starConversation, unstarConversation } = useChatStore();

  // Load conversations on mount
  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  // Restore last active conversation from localStorage
  useEffect(() => {
    if (!activeConversationId && conversations.length > 0) {
      const saved = localStorage.getItem('hive-chat-active-conversation');
      if (saved && conversations.some((c) => c.id === saved)) {
        setActiveConversationId(saved);
      }
    }
  }, [activeConversationId, conversations, setActiveConversationId]);

  // Persist active conversation
  useEffect(() => {
    if (activeConversationId) {
      localStorage.setItem('hive-chat-active-conversation', activeConversationId);
    }
  }, [activeConversationId]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ctrl+N: New conversation
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      const btn = document.querySelector('[data-new-chat-trigger]') as HTMLButtonElement | null;
      btn?.click();
    }
    // Ctrl+F: Focus sidebar search
    if (e.ctrlKey && e.key === 'f') {
      // Only intercept if not in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        const input = document.querySelector('[data-sidebar-search]') as HTMLInputElement | null;
        input?.focus();
      }
    }
    // Ctrl+Shift+S: Star/unstar current conversation
    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      const active = useChatStore.getState();
      const conv = active.conversations.find((c) => c.id === active.activeConversationId);
      if (conv) {
        if (conv.isStarred) unstarConversation(conv.id);
        else starConversation(conv.id);
      }
    }
  }, [starConversation, unstarConversation]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <ChatSidebar />
      <ChatMain />
    </div>
  );
}
