// Shared types for the person-to-person messaging feature.

export type ThreadKind = 'direct' | 'group' | 'broadcast';
export type MessageKind = 'text' | 'ping' | 'announcement';

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
  createdAt: string; // ISO
}

export interface ThreadMemberInfo {
  oid: string;
  name: string;
  email: string;
  lastReadMessageId: number | null; // for read receipts
}

export interface ThreadSummary {
  id: number;
  kind: ThreadKind;
  title: string; // server-computed display title (members for direct/group)
  members: ThreadMemberInfo[];
  lastMessage: Message | null;
  lastMessageAt: string | null;
  unreadCount: number;
  unreadMessages: Message[]; // unread-from-others, for the top banner
}

export interface ThreadDetail {
  id: number;
  kind: ThreadKind;
  title: string;
  members: ThreadMemberInfo[];
  messages: Message[];
}
