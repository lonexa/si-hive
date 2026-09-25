import { create } from 'zustand';
import { API_BASE } from '@/lib/api-config';

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: string;
  type: string;
  content: string;
  toolName?: string | null;
  toolId?: string | null;
  model?: string | null;
  timestamp: string;
}

export interface ChatConversation {
  id: string;
  title: string;
  projectPath: string | null;
  claudeSessionId: string | null;
  ptyTerminalId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  userEmail: string | null;
  isStarred: boolean;
  ptyStatus?: string;
}

export type ViewMode = 'chat' | 'advanced';

export interface PendingApproval {
  description: string;
  rawText: string;
}

interface ChatStore {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  messages: ChatMessage[];
  isTyping: boolean;
  typingText: string;
  inputValue: string;
  status: string; // idle | connecting | ready | working | needs_input | exited | error
  viewMode: ViewMode;
  toolProgress: { tool: string; detail: string } | null;
  pendingApproval: PendingApproval | null;
  sidebarSearch: string;
  activeSkills: string[];
  activeAgents: string[];

  setConversations: (conversations: ChatConversation[]) => void;
  setActiveConversationId: (id: string | null) => void;
  addMessage: (message: ChatMessage) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setIsTyping: (isTyping: boolean) => void;
  setTypingText: (text: string) => void;
  setInputValue: (value: string) => void;
  setStatus: (status: string) => void;
  setViewMode: (mode: ViewMode) => void;
  setToolProgress: (progress: { tool: string; detail: string } | null) => void;
  setPendingApproval: (approval: PendingApproval | null) => void;
  setSidebarSearch: (search: string) => void;
  addActiveSkill: (skill: string) => void;
  removeActiveSkill: (skill: string) => void;
  addActiveAgent: (agent: string) => void;
  removeActiveAgent: (agent: string) => void;
  clearActiveItems: () => void;

  loadConversations: () => Promise<void>;
  createConversation: (opts?: { title?: string; projectPath?: string; permissionMode?: string; model?: string }) => Promise<string | null>;
  deleteConversation: (id: string) => Promise<void>;
  loadMessages: (conversationId: string) => Promise<void>;
  starConversation: (id: string) => Promise<void>;
  unstarConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  moveConversation: (id: string, projectPath: string | null) => Promise<void>;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  isTyping: false,
  typingText: '',
  inputValue: '',
  status: 'idle',
  viewMode: 'chat',
  toolProgress: null,
  pendingApproval: null,
  sidebarSearch: '',
  activeSkills: [],
  activeAgents: [],

  setConversations: (conversations) => set({ conversations }),
  setActiveConversationId: (id) => set({ activeConversationId: id }),
  addMessage: (message) => set((state) => {
    // Deduplicate by id
    if (state.messages.some((m) => m.id === message.id)) return state;
    // Safety net: also deduplicate by role + content + timestamp
    if (state.messages.some((m) =>
      m.role === message.role &&
      m.content === message.content &&
      m.timestamp === message.timestamp
    )) return state;
    return { messages: [...state.messages, message], isTyping: false, typingText: '' };
  }),
  setMessages: (messages) => set({ messages }),
  setIsTyping: (isTyping) => set({ isTyping }),
  setTypingText: (text) => set({ typingText: text, isTyping: true }),
  setInputValue: (value) => set({ inputValue: value }),
  setStatus: (status) => set({ status }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setToolProgress: (progress) => set({ toolProgress: progress }),
  setPendingApproval: (approval) => set({ pendingApproval: approval }),
  setSidebarSearch: (search) => set({ sidebarSearch: search }),
  addActiveSkill: (skill) => set((s) => ({ activeSkills: s.activeSkills.includes(skill) ? s.activeSkills : [...s.activeSkills, skill] })),
  removeActiveSkill: (skill) => set((s) => ({ activeSkills: s.activeSkills.filter((x) => x !== skill) })),
  addActiveAgent: (agent) => set((s) => ({ activeAgents: s.activeAgents.includes(agent) ? s.activeAgents : [...s.activeAgents, agent] })),
  removeActiveAgent: (agent) => set((s) => ({ activeAgents: s.activeAgents.filter((x) => x !== agent) })),
  clearActiveItems: () => set({ activeSkills: [], activeAgents: [] }),

  loadConversations: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/conversations`);
      const data = await res.json() as { conversations: ChatConversation[] };
      set({ conversations: data.conversations ?? [] });
    } catch (err) {
      console.error('[chat-store] Failed to load conversations:', err);
    }
  },

  createConversation: async (opts) => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts ?? {}),
      });
      const data = await res.json() as { id: string; title: string; status: string };
      await get().loadConversations();
      set({ activeConversationId: data.id, messages: [], status: data.status });
      return data.id;
    } catch (err) {
      console.error('[chat-store] Failed to create conversation:', err);
      return null;
    }
  },

  deleteConversation: async (id) => {
    try {
      await fetch(`${API_BASE}/api/chat/conversations/${id}`, { method: 'DELETE' });
      const { activeConversationId } = get();
      if (activeConversationId === id) {
        set({ activeConversationId: null, messages: [] });
      }
      await get().loadConversations();
    } catch (err) {
      console.error('[chat-store] Failed to delete conversation:', err);
    }
  },

  loadMessages: async (conversationId) => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/conversations/${conversationId}/messages`);
      const data = await res.json() as { messages: ChatMessage[] };
      set({ messages: data.messages ?? [] });
    } catch (err) {
      console.error('[chat-store] Failed to load messages:', err);
    }
  },

  starConversation: async (id) => {
    try {
      await fetch(`${API_BASE}/api/chat/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isStarred: true }),
      });
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, isStarred: true } : c
        ),
      }));
    } catch (err) {
      console.error('[chat-store] Failed to star conversation:', err);
    }
  },

  unstarConversation: async (id) => {
    try {
      await fetch(`${API_BASE}/api/chat/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isStarred: false }),
      });
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, isStarred: false } : c
        ),
      }));
    } catch (err) {
      console.error('[chat-store] Failed to unstar conversation:', err);
    }
  },

  renameConversation: async (id, title) => {
    try {
      await fetch(`${API_BASE}/api/chat/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, title } : c
        ),
      }));
    } catch (err) {
      console.error('[chat-store] Failed to rename conversation:', err);
    }
  },

  moveConversation: async (id, projectPath) => {
    try {
      await fetch(`${API_BASE}/api/chat/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath }),
      });
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, projectPath } : c
        ),
      }));
    } catch (err) {
      console.error('[chat-store] Failed to move conversation:', err);
    }
  },
}));
