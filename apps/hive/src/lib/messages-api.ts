import { API_BASE } from '@/lib/api-config';

export type ThreadKind = 'direct' | 'group' | 'broadcast';
export type MessageKind = 'text' | 'ping' | 'announcement' | 'poll';

export interface MessagingUser {
  oid: string;
  displayName: string;
  email: string;
  online: boolean;
}

export interface Message {
  id: number;
  threadId: number;
  senderOid: string;
  senderName: string;
  body: string;
  kind: MessageKind;
  createdAt: string;
}

export interface ThreadMemberInfo {
  oid: string;
  name: string;
  email: string;
  lastReadMessageId: number | null;
}

export interface ThreadSummary {
  id: number;
  kind: ThreadKind;
  title: string;
  members: ThreadMemberInfo[];
  lastMessage: Message | null;
  lastMessageAt: string | null;
  unreadCount: number;
  unreadMessages: Message[];
}

export interface ThreadDetail {
  id: number;
  kind: ThreadKind;
  title: string;
  members: ThreadMemberInfo[];
  messages: Message[];
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const messagesApi = {
  inbox: () => req<{ threads: ThreadSummary[] }>('/api/messaging/inbox'),
  users: () => req<{ users: MessagingUser[] }>('/api/messaging/users'),
  thread: (id: number) => req<{ thread: ThreadDetail }>(`/api/messaging/threads/${id}`),
  createThread: (memberOids: string[], title?: string) =>
    req<{ thread: ThreadDetail }>('/api/messaging/threads', {
      method: 'POST',
      body: JSON.stringify({ memberOids, title }),
    }),
  send: (threadId: number, body: string) =>
    req<{ message: Message }>(`/api/messaging/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  markRead: (threadId: number) =>
    req<{ ok: boolean }>(`/api/messaging/threads/${threadId}/read`, { method: 'POST' }),
  broadcast: (body: string) =>
    req<{ threadId: number; message: Message }>('/api/messaging/broadcast', {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  ping: (toOid: string) =>
    req<{ threadId: number; message: Message }>('/api/messaging/ping', {
      method: 'POST',
      body: JSON.stringify({ toOid }),
    }),
};
