import { create } from 'zustand';

interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
  labelIds: string[];
  isUnread: boolean;
}

interface GmailMessageDetail extends GmailMessage {
  body: string;
  to: string;
  cc: string;
}

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  location?: string;
  attendees: Array<{ email: string; displayName?: string; responseStatus?: string }>;
  htmlLink?: string;
  meetLink?: string;
  isAllDay: boolean;
}

interface GmailLabel {
  id: string;
  name: string;
  type: string;
}

interface GmailState {
  connected: boolean;
  configured: boolean;
  messages: GmailMessage[];
  selectedMessage: GmailMessageDetail | null;
  events: CalendarEvent[];
  todayEvents: CalendarEvent[];
  labels: GmailLabel[];
  unreadCount: number;
  loading: boolean;
  error: string | null;

  setConnected: (connected: boolean) => void;
  setConfigured: (configured: boolean) => void;
  setMessages: (messages: GmailMessage[]) => void;
  setSelectedMessage: (message: GmailMessageDetail | null) => void;
  setEvents: (events: CalendarEvent[]) => void;
  setTodayEvents: (events: CalendarEvent[]) => void;
  setLabels: (labels: GmailLabel[]) => void;
  setUnreadCount: (count: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useGmailStore = create<GmailState>((set) => ({
  connected: false,
  configured: false,
  messages: [],
  selectedMessage: null,
  events: [],
  todayEvents: [],
  labels: [],
  unreadCount: 0,
  loading: false,
  error: null,

  setConnected: (connected) => set({ connected }),
  setConfigured: (configured) => set({ configured }),
  setMessages: (messages) => set({ messages }),
  setSelectedMessage: (message) => set({ selectedMessage: message }),
  setEvents: (events) => set({ events }),
  setTodayEvents: (events) => set({ todayEvents: events }),
  setLabels: (labels) => set({ labels }),
  setUnreadCount: (count) => set({ unreadCount: count }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
