import {
  getSharedDb,
  getSharedDialect,
  insertReturning,
  nowIso,
  type SharedDb,
} from '../../../../packages/shared/src/server/storage/index.js';
import { chunks, isOnline, listDirectoryUsers, lookupDirectoryUsers } from './directory.js';
import type { Message, MessageKind, MessagingUser, ThreadDetail, ThreadKind, ThreadMemberInfo, ThreadSummary } from './types.js';

// A user is "online" if their heartbeat is younger than this (2.5 missed 60s beats),
// matching the rule used by user-management presence.
const ONLINE_THRESHOLD_MS = 150_000;

interface MessageRow {
  id: number;
  thread_id: number;
  sender_oid: string;
  sender_name: string;
  body: string;
  kind: string;
  created_at: string;
}

interface MemberRow {
  thread_id: number;
  member_oid: string;
  member_name: string;
  member_email: string;
  last_read_message_id: number | null;
}

interface NewMember {
  oid: string;
  name: string;
  email: string;
}

const MESSAGE_COLUMNS = ['id', 'thread_id', 'sender_oid', 'sender_name', 'body', 'kind', 'created_at'] as const;

function toMessage(r: MessageRow): Message {
  return {
    id: Number(r.id),
    threadId: Number(r.thread_id),
    senderOid: r.sender_oid,
    senderName: r.sender_name,
    body: r.body,
    kind: (r.kind || 'text') as MessageKind,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
  };
}

function toMemberInfo(m: MemberRow): ThreadMemberInfo {
  return {
    oid: m.member_oid,
    name: m.member_name,
    email: m.member_email,
    lastReadMessageId: m.last_read_message_id == null ? null : Number(m.last_read_message_id),
  };
}

/** Insert member rows, chunked to stay under driver parameter limits. */
async function insertMembers(db: SharedDb, threadId: number, members: NewMember[]): Promise<void> {
  const now = nowIso();
  for (const chunk of chunks(members, 200)) {
    await db.insertInto('message_thread_members')
      .values(chunk.map((m) => ({
        thread_id: threadId,
        member_oid: m.oid,
        member_name: m.name,
        member_email: m.email,
        added_at: now,
      })))
      .execute();
  }
}

/**
 * MessagingClient — person-to-person messaging in the shared database.
 * Threads, members (with read markers) and messages; delivery is by polling.
 */
export class MessagingClient {
  // ── Directory ─────────────────────────────────────────────────────────

  async listUsers(): Promise<MessagingUser[]> {
    const db = await getSharedDb();
    const now = Date.now();
    return (await listDirectoryUsers(db)).map((u) => ({
      oid: u.oid,
      displayName: u.displayName,
      email: u.email,
      online: isOnline(u.lastHeartbeatAt, ONLINE_THRESHOLD_MS, now),
    }));
  }

  private async lookupUsers(oids: string[]): Promise<Map<string, { name: string; email: string }>> {
    const map = new Map<string, { name: string; email: string }>();
    if (oids.length === 0) return map;
    const db = await getSharedDb();
    for (const u of await lookupDirectoryUsers(db, oids)) map.set(u.oid, { name: u.displayName, email: u.email });
    return map;
  }

  // ── Thread creation ───────────────────────────────────────────────────

  /** Find an existing 1:1 direct thread between two users, or create one. */
  async getOrCreateDirectThread(meOid: string, meName: string, otherOid: string): Promise<number> {
    const db = await getSharedDb();
    const existing = await db.selectFrom('message_threads as t')
      .select('t.id')
      .where('t.kind', '=', 'direct')
      .where((eb) => eb.and([
        eb.exists(eb.selectFrom('message_thread_members as m').select('m.thread_id')
          .whereRef('m.thread_id', '=', 't.id').where('m.member_oid', '=', meOid)),
        eb.exists(eb.selectFrom('message_thread_members as m').select('m.thread_id')
          .whereRef('m.thread_id', '=', 't.id').where('m.member_oid', '=', otherOid)),
        eb(
          eb.selectFrom('message_thread_members as m')
            .select((sb) => sb.fn.countAll().as('n'))
            .whereRef('m.thread_id', '=', 't.id'),
          '=',
          2,
        ),
      ]))
      .orderBy('t.id')
      .execute();
    if (existing[0]) return Number(existing[0].id);
    return this.createThread('direct', meOid, meName, [otherOid], null);
  }

  /**
   * Create a thread of the given kind with `me` plus `otherOids` as members.
   * Member display names/emails are snapshotted from the user directory.
   */
  async createThread(kind: ThreadKind, meOid: string, meName: string, otherOids: string[], title: string | null): Promise<number> {
    const db = await getSharedDb();
    const allOids = Array.from(new Set([meOid, ...otherOids]));
    const info = await this.lookupUsers(allOids);
    const members = allOids.map((oid) => {
      const u = info.get(oid) ?? { name: oid === meOid ? meName : oid, email: '' };
      return { oid, name: u.name, email: u.email };
    });
    return this.insertThread(db, kind, title, meOid, meName, members);
  }

  private async insertThread(
    db: SharedDb, kind: ThreadKind, title: string | null, meOid: string, meName: string, members: NewMember[],
  ): Promise<number> {
    const dialect = getSharedDialect();
    return db.transaction().execute(async (trx) => {
      const now = nowIso();
      const created = await insertReturning<{ id: number }>(trx, dialect, 'message_threads', {
        kind,
        title,
        created_by: meOid,
        created_by_name: meName,
        created_at: now,
        last_message_at: now,
      });
      const threadId = Number(created.id);
      await insertMembers(trx, threadId, members);
      return threadId;
    });
  }

  /** Create a broadcast thread snapshotting ALL current users as members. */
  async createBroadcastThread(meOid: string, meName: string, title = 'Announcement'): Promise<number> {
    const db = await getSharedDb();
    const users = await listDirectoryUsers(db);
    const members = users.map((u) => ({ oid: u.oid, name: u.displayName, email: u.email }));
    return this.insertThread(db, 'broadcast', title, meOid, meName, members);
  }

  // ── Messages ──────────────────────────────────────────────────────────

  /** Post a message, bump the thread, and mark the sender as having read it. */
  async postMessage(threadId: number, senderOid: string, senderName: string, body: string, kind: MessageKind = 'text'): Promise<Message> {
    const db = await getSharedDb();
    const dialect = getSharedDialect();
    return db.transaction().execute(async (trx) => {
      const now = nowIso();
      const row = await insertReturning<MessageRow>(trx, dialect, 'messages', {
        thread_id: threadId,
        sender_oid: senderOid,
        sender_name: senderName,
        body,
        kind,
        created_at: now,
      });
      const msg = toMessage(row);
      await trx.updateTable('message_threads').set({ last_message_at: now }).where('id', '=', threadId).execute();
      // Sender has implicitly read up to their own message.
      await trx.updateTable('message_thread_members')
        .set({ last_read_message_id: msg.id, last_read_at: now })
        .where('thread_id', '=', threadId).where('member_oid', '=', senderOid)
        .execute();
      return msg;
    });
  }

  /** Mark a thread read up to its latest message for the given user. */
  async markRead(threadId: number, oid: string): Promise<void> {
    const db = await getSharedDb();
    const latest = await db.selectFrom('messages')
      .select((eb) => eb.fn.max('id').as('max_id'))
      .where('thread_id', '=', threadId)
      .executeTakeFirst();
    const maxId = latest?.max_id == null ? null : Number(latest.max_id);
    await db.updateTable('message_thread_members')
      .set({ last_read_message_id: maxId, last_read_at: nowIso() })
      .where('thread_id', '=', threadId).where('member_oid', '=', oid)
      .execute();
  }

  /** Is the user a member of this thread? (authorization guard) */
  async isMember(threadId: number, oid: string): Promise<boolean> {
    const db = await getSharedDb();
    const row = await db.selectFrom('message_thread_members').select('thread_id')
      .where('thread_id', '=', threadId).where('member_oid', '=', oid)
      .executeTakeFirst();
    return !!row;
  }

  // ── Reads ─────────────────────────────────────────────────────────────

  private async getMembers(threadIds: number[]): Promise<Map<number, MemberRow[]>> {
    const map = new Map<number, MemberRow[]>();
    if (threadIds.length === 0) return map;
    const db = await getSharedDb();
    for (const chunk of chunks(threadIds, 500)) {
      const rows = (await db.selectFrom('message_thread_members')
        .select(['thread_id', 'member_oid', 'member_name', 'member_email', 'last_read_message_id'])
        .where('thread_id', 'in', chunk)
        .orderBy('added_at')
        .orderBy('member_oid')
        .execute()) as MemberRow[];
      for (const r of rows) {
        const tid = Number(r.thread_id);
        const arr = map.get(tid) ?? [];
        arr.push(r);
        map.set(tid, arr);
      }
    }
    return map;
  }

  private displayTitle(kind: ThreadKind, title: string | null, members: ThreadMemberInfo[], meOid: string): string {
    if (title) return title;
    if (kind === 'broadcast') return 'Announcement';
    const others = members.filter((m) => m.oid !== meOid).map((m) => m.name);
    if (others.length === 0) return 'You';
    return others.join(', ');
  }

  /** Full inbox for the current user: threads, unread counts, banner messages, read receipts. */
  async getInbox(meOid: string): Promise<ThreadSummary[]> {
    const db = await getSharedDb();

    // Threads I'm a member of + my read marker.
    const threadRows = (await db.selectFrom('message_threads as t')
      .innerJoin('message_thread_members as m', (j) => j.onRef('m.thread_id', '=', 't.id').on('m.member_oid', '=', meOid))
      .select(['t.id', 't.kind', 't.title', 't.last_message_at', 'm.last_read_message_id'])
      .orderBy('t.last_message_at', 'desc')
      .orderBy('t.id', 'desc')
      .execute()) as Array<{ id: number; kind: string; title: string | null; last_message_at: string | null; last_read_message_id: number | null }>;
    if (threadRows.length === 0) return [];
    const threadIds = threadRows.map((t) => Number(t.id));

    const membersByThread = await this.getMembers(threadIds);

    // Unread-from-others across all my threads (for badge + banner).
    const unreadRows = (await db.selectFrom('messages as msg')
      .innerJoin('message_thread_members as m', (j) => j.onRef('m.thread_id', '=', 'msg.thread_id').on('m.member_oid', '=', meOid))
      .select(MESSAGE_COLUMNS.map((c) => `msg.${c}` as const))
      .where((eb) => eb('msg.id', '>', eb.fn.coalesce('m.last_read_message_id', eb.lit(0))))
      .where('msg.sender_oid', '<>', meOid)
      .orderBy('msg.id', 'asc')
      .execute()) as MessageRow[];
    const unreadByThread = new Map<number, Message[]>();
    for (const r of unreadRows) {
      const tid = Number(r.thread_id);
      const arr = unreadByThread.get(tid) ?? [];
      arr.push(toMessage(r));
      unreadByThread.set(tid, arr);
    }

    // Latest message per thread (for thread-list preview).
    const lastRows = (await db.selectFrom('messages as msg')
      .innerJoin(
        (eb) => eb.selectFrom('messages as msg2')
          .innerJoin('message_thread_members as m', (j) => j.onRef('m.thread_id', '=', 'msg2.thread_id').on('m.member_oid', '=', meOid))
          .select((sb) => ['msg2.thread_id', sb.fn.max('msg2.id').as('max_id')])
          .groupBy('msg2.thread_id')
          .as('last'),
        (j) => j.onRef('last.thread_id', '=', 'msg.thread_id').onRef('last.max_id', '=', 'msg.id'),
      )
      .select(MESSAGE_COLUMNS.map((c) => `msg.${c}` as const))
      .execute()) as MessageRow[];
    const lastByThread = new Map<number, Message>();
    for (const r of lastRows) lastByThread.set(Number(r.thread_id), toMessage(r));

    return threadRows.map((t) => {
      const id = Number(t.id);
      const kind = (t.kind || 'direct') as ThreadKind;
      const members = (membersByThread.get(id) ?? []).map(toMemberInfo);
      const unreadMessages = unreadByThread.get(id) ?? [];
      return {
        id,
        kind,
        title: this.displayTitle(kind, t.title, members, meOid),
        members,
        lastMessage: lastByThread.get(id) ?? null,
        lastMessageAt: t.last_message_at ? new Date(t.last_message_at).toISOString() : null,
        unreadCount: unreadMessages.length,
        unreadMessages,
      };
    });
  }

  /** Full message history + members for one thread. */
  async getThread(threadId: number, meOid: string): Promise<ThreadDetail | null> {
    const db = await getSharedDb();
    const t = (await db.selectFrom('message_threads').select(['id', 'kind', 'title'])
      .where('id', '=', threadId).executeTakeFirst()) as { id: number; kind: string; title: string | null } | undefined;
    if (!t) return null;

    const membersByThread = await this.getMembers([threadId]);
    const members = (membersByThread.get(threadId) ?? []).map(toMemberInfo);

    const messages = (await db.selectFrom('messages').select([...MESSAGE_COLUMNS])
      .where('thread_id', '=', threadId).orderBy('id', 'asc').execute()) as MessageRow[];

    const kind = (t.kind || 'direct') as ThreadKind;
    return {
      id: Number(t.id),
      kind,
      title: this.displayTitle(kind, t.title, members, meOid),
      members,
      messages: messages.map(toMessage),
    };
  }

  /** Kept for API compatibility — the shared DB connection is process-wide. */
  async close(): Promise<void> {
    /* no-op */
  }
}
