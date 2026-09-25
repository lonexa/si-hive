import { create } from 'zustand';
import type { ThreadSummary } from '@/lib/messages-api';

interface MessagesState {
  threads: ThreadSummary[];
  isOpen: boolean;
  activeThreadId: number | null;
  // When composing a brand-new message before a thread exists.
  composeWith: string[] | null;
  composeBroadcast: boolean;
  // Banners dismissed locally this session (until the next poll confirms them read).
  dismissed: Set<number>;

  setThreads: (threads: ThreadSummary[]) => void;
  openWidget: () => void;
  closeWidget: () => void;
  toggleWidget: () => void;
  openThread: (id: number) => void;
  startCompose: (oids: string[]) => void;
  startBroadcast: () => void;
  clearCompose: () => void;
  dismissBanner: (threadId: number) => void;
}

export const useMessagesStore = create<MessagesState>((set) => ({
  threads: [],
  isOpen: false,
  activeThreadId: null,
  composeWith: null,
  composeBroadcast: false,
  dismissed: new Set(),

  setThreads: (threads) => set({ threads }),
  openWidget: () => set({ isOpen: true }),
  closeWidget: () => set({ isOpen: false }),
  toggleWidget: () => set((s) => ({ isOpen: !s.isOpen })),
  openThread: (id) =>
    set((s) => {
      const dismissed = new Set(s.dismissed);
      dismissed.add(id);
      return { isOpen: true, activeThreadId: id, composeWith: null, composeBroadcast: false, dismissed };
    }),
  startCompose: (oids) => set({ isOpen: true, activeThreadId: null, composeWith: oids, composeBroadcast: false }),
  startBroadcast: () => set({ isOpen: true, activeThreadId: null, composeWith: null, composeBroadcast: true }),
  clearCompose: () => set({ composeWith: null, composeBroadcast: false }),
  dismissBanner: (threadId) =>
    set((s) => {
      const dismissed = new Set(s.dismissed);
      dismissed.add(threadId);
      return { dismissed };
    }),
}));

/** Total unread across all threads — drives the launcher badge. */
export function selectUnreadCount(s: MessagesState): number {
  return s.threads.reduce((n, t) => n + t.unreadCount, 0);
}

/**
 * Threads with unread incoming messages that should surface as top banners.
 * Excludes locally-dismissed threads and the thread currently open in the widget.
 */
export function selectBannerThreads(s: MessagesState): ThreadSummary[] {
  return s.threads.filter(
    (t) =>
      t.unreadMessages.length > 0 &&
      !s.dismissed.has(t.id) &&
      !(s.isOpen && s.activeThreadId === t.id),
  );
}
