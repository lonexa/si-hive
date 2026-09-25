import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { useTempHiveHome } from '../../../../packages/shared/src/test-utils/hive-home.js';

useTempHiveHome();

const storage = await import('../../../../packages/shared/src/server/storage/index.js');
// Not yet in storage/migrations-index.ts — register explicitly.
await import('../messaging/migrations.js');
await import('../now/migrations.js');
await import('../handoff/migrations.js');
await import('../reviews/migrations.js');
const { initSharedStorage } = await import('../storage/init.js');
const { USERS_TABLE } = await import('../messaging/directory.js');
const { MessagingClient } = await import('../messaging/client.js');
const { NowClient } = await import('../now/client.js');
const { HandoffClient } = await import('../handoff/client.js');
const { ReviewsClient } = await import('../reviews/client.js');

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

describe('shared storage — team modules (sqlite)', () => {
  beforeAll(async () => {
    const report = await initSharedStorage();
    expect(report.error).toBeUndefined();
    const db = await storage.getSharedDb();
    // Seed the user directory (table owned by admin/migrations.ts).
    const seen = new Date().toISOString();
    await db.insertInto(USERS_TABLE).values([
      { role: 'full', first_login: seen, last_login: seen, oid: 'u-alice', display_name: 'Alice', email: 'alice@example.test', last_heartbeat_at: minutesAgo(0) },
      { role: 'full', first_login: seen, last_login: seen, oid: 'u-bob', display_name: 'Bob', email: 'bob@example.test', last_heartbeat_at: minutesAgo(10) },
      { role: 'full', first_login: seen, last_login: seen, oid: 'u-carol', display_name: 'Carol', email: 'carol@example.test', last_heartbeat_at: null },
    ]).execute();
  });
  afterAll(async () => {
    await storage.closeSharedDb();
  });

  it('applies team migrations idempotently', async () => {
    const again = await initSharedStorage();
    expect(again.error).toBeUndefined();
    expect(again.applied).toEqual([]);
  });

  it('messaging: directory, direct + group threads, send/list/unread/markRead', async () => {
    const m = new MessagingClient();

    const users = await m.listUsers();
    expect(users.map((u) => [u.oid, u.online])).toEqual([['u-alice', true], ['u-bob', false], ['u-carol', false]]);

    const direct = await m.getOrCreateDirectThread('u-alice', 'Alice', 'u-bob');
    expect(await m.getOrCreateDirectThread('u-bob', 'Bob', 'u-alice')).toBe(direct);
    expect(await m.isMember(direct, 'u-alice')).toBe(true);
    expect(await m.isMember(direct, 'u-carol')).toBe(false);

    const group = await m.createThread('group', 'u-alice', 'Alice', ['u-bob', 'u-carol'], null);
    expect(group).not.toBe(direct);
    // A group containing the same pair must not be mistaken for the direct thread.
    expect(await m.getOrCreateDirectThread('u-alice', 'Alice', 'u-bob')).toBe(direct);

    const m1 = await m.postMessage(direct, 'u-alice', 'Alice', 'hi bob');
    expect(m1).toMatchObject({ threadId: direct, senderOid: 'u-alice', body: 'hi bob', kind: 'text' });
    expect(m1.id).toBeTypeOf('number');
    expect(new Date(m1.createdAt).toISOString()).toBe(m1.createdAt);
    await m.postMessage(direct, 'u-alice', 'Alice', 'you there?');
    const g1 = await m.postMessage(group, 'u-carol', 'Carol', 'group hello');

    // Sender sees nothing unread; Bob sees two in direct + one in group.
    const aliceInbox = await m.getInbox('u-alice');
    const aliceDirect = aliceInbox.find((t) => t.id === direct)!;
    expect(aliceDirect.unreadCount).toBe(0);
    expect(aliceDirect.title).toBe('Bob');
    expect(aliceInbox.find((t) => t.id === group)!.unreadCount).toBe(1);

    const bobInbox = await m.getInbox('u-bob');
    expect(bobInbox.map((t) => t.id)).toEqual([group, direct]); // newest activity first
    const bobDirect = bobInbox.find((t) => t.id === direct)!;
    expect(bobDirect.kind).toBe('direct');
    expect(bobDirect.title).toBe('Alice');
    expect(bobDirect.unreadCount).toBe(2);
    expect(bobDirect.unreadMessages.map((x) => x.body)).toEqual(['hi bob', 'you there?']);
    expect(bobDirect.lastMessage?.body).toBe('you there?');
    expect(bobDirect.lastMessageAt).toBeTypeOf('string');
    const bobGroup = bobInbox.find((t) => t.id === group)!;
    expect(bobGroup.title).toBe('Alice, Carol');
    expect(bobGroup.lastMessage?.id).toBe(g1.id);
    expect(bobGroup.members.map((x) => x.oid).sort()).toEqual(['u-alice', 'u-bob', 'u-carol']);
    expect(bobGroup.members.find((x) => x.oid === 'u-bob')!.email).toBe('bob@example.test');

    await m.markRead(direct, 'u-bob');
    const after = (await m.getInbox('u-bob')).find((t) => t.id === direct)!;
    expect(after.unreadCount).toBe(0);
    // Read receipt: Bob's marker is now the latest message id.
    const thread = await m.getThread(direct, 'u-alice');
    expect(thread!.messages.map((x) => x.body)).toEqual(['hi bob', 'you there?']);
    expect(thread!.members.find((x) => x.oid === 'u-bob')!.lastReadMessageId).toBe(after.lastMessage!.id);
    expect(await m.getThread(987654, 'u-alice')).toBeNull();

    // Empty inbox for someone with no threads.
    expect(await m.getInbox('u-nobody')).toEqual([]);
  });

  it('messaging: broadcast threads', async () => {
    const m = new MessagingClient();
    const b = await m.createBroadcastThread('u-alice', 'Alice');
    await m.postMessage(b, 'u-alice', 'Alice', 'All hands at 3', 'announcement');
    const carolB = (await m.getInbox('u-carol')).find((t) => t.id === b)!;
    expect(carolB.title).toBe('Announcement');
    expect(carolB.unreadMessages[0].kind).toBe('announcement');

  });

  it('now: push, status, board with stale filtering', async () => {
    const n = new NowClient();
    // Status before any snapshot exists.
    await n.setStatus('u-bob', 'busy', 'heads down');
    await n.push('u-alice', {
      working: 1, waiting: 1, errorCount: 0, total: 2, topProject: 'proj-a', topStatus: 'working',
      sessions: [{ slug: 's1', project: 'proj-a', status: 'working', lastActivity: minutesAgo(0) }],
      machineName: 'box-1',
    });
    await n.setStatus('u-alice', 'available', null);
    // A later snapshot must not clobber the manual presence.
    await n.push('u-alice', {
      working: 2, waiting: 0, errorCount: 1, total: 3, topProject: 'proj-b', topStatus: 'error',
      sessions: [], machineName: 'box-1',
    });

    let board = await n.getBoard();
    const alice = board.find((r) => r.oid === 'u-alice')!;
    expect(alice).toMatchObject({
      displayName: 'Alice', online: true, machineName: 'box-1',
      working: 2, waiting: 0, errorCount: 1, total: 3, topProject: 'proj-b', topStatus: 'error',
      availability: 'available', manualStatus: null,
    });
    const bob = board.find((r) => r.oid === 'u-bob')!;
    expect(bob).toMatchObject({ availability: 'busy', manualStatus: 'heads down', online: false, total: 0 });
    const carol = board.find((r) => r.oid === 'u-carol')!;
    expect(carol).toMatchObject({ updatedAt: null, machineName: null, total: 0, sessions: [], availability: null });

    // Age Alice's snapshot past the stale window: counts drop, presence stays.
    const db = await storage.getSharedDb();
    await db.updateTable('user_now').set({ updated_at: minutesAgo(10) }).where('user_oid', '=', 'u-alice').execute();
    board = await n.getBoard();
    expect(board.find((r) => r.oid === 'u-alice')).toMatchObject({
      working: 0, waiting: 0, errorCount: 0, total: 0, topProject: null, topStatus: null, sessions: [],
      availability: 'available',
    });

    const rows = await db.selectFrom('user_now').select('user_oid').where('user_oid', '=', 'u-alice').execute();
    expect(rows).toHaveLength(1);
  });

  it('handoff: create, incoming, accept, decline, cancel', async () => {
    const h = new HandoffClient();
    const a = await h.create({ fromOid: 'u-alice', fromName: 'Alice', toOid: 'u-bob', cwd: '/w', provider: 'claude', transcriptText: '# transcript', note: 'take over' });
    const d = await h.create({ fromOid: 'u-carol', fromName: 'Carol', toOid: 'u-bob', cwd: null, provider: 'claude', transcriptText: null, note: null });
    expect(a).toBeTypeOf('number');

    const incoming = await h.incoming('u-bob');
    expect(incoming.map((x) => x.id).sort()).toEqual([a, d].sort());
    expect(incoming[0]).not.toHaveProperty('transcriptText');
    expect(incoming.find((x) => x.id === a)).toMatchObject({ fromOid: 'u-alice', status: 'pending', respondedAt: null, cwd: '/w' });

    const row = await h.get(a);
    expect(row).toMatchObject({ transcriptText: '# transcript', note: 'take over', status: 'pending' });

    await h.respond(a, 'accepted');
    await h.respond(d, 'declined');
    expect(await h.incoming('u-bob')).toEqual([]);
    const accepted = await h.get(a);
    expect(accepted!.status).toBe('accepted');
    expect(accepted!.respondedAt).toBeTypeOf('string');
    expect((await h.get(d))!.status).toBe('declined');
    expect(await h.get(999999)).toBeNull();
  });

  it('reviews: create, comment, approve, request changes, queues', async () => {
    const r = new ReviewsClient();
    const base = { requesterOid: 'u-alice', requesterName: 'Alice', reviewerOid: 'u-bob', reviewerName: 'Bob', refId: null, repo: null, context: null };
    const r1 = await r.create({ ...base, title: 'Look at session', kind: 'session', refId: 'sess-1' });
    const r2 = await r.create({ ...base, title: 'Look at commit', kind: 'commit', repo: 'repo-x' });
    expect(r1).toMatchObject({ status: 'requested', kind: 'session', refId: 'sess-1', respondedAt: null });
    expect(r1.createdAt).toBe(r1.updatedAt);

    const c = await r.addComment(r1.id, 'u-bob', 'Bob', 'Looks mostly fine');
    expect(c).toMatchObject({ reviewId: r1.id, authorOid: 'u-bob', body: 'Looks mostly fine' });
    expect(await r.addComment(424242, 'u-bob', 'Bob', 'x')).toBeNull();

    expect(await r.incomingOpenCount('u-bob')).toBe(2);

    // Only the reviewer may approve / request changes.
    expect(await r.setStatus(r1.id, 'u-alice', 'approved')).toBe(false);
    expect(await r.setStatus(r1.id, 'u-bob', 'approved')).toBe(true);
    expect(await r.setStatus(r2.id, 'u-bob', 'changes')).toBe(true);

    const detail = await r.get(r1.id);
    expect(detail!.review.status).toBe('approved');
    expect(detail!.review.respondedAt).toBeTypeOf('string');
    expect(detail!.comments.map((x) => x.body)).toEqual(['Looks mostly fine']);
    expect(await r.get(424242)).toBeNull();

    // Incoming queue: open 'changes' sorts ahead of 'approved'.
    const incoming = await r.list('u-bob', 'incoming');
    expect(incoming.map((x) => [x.id, x.status])).toEqual([[r2.id, 'changes'], [r1.id, 'approved']]);
    expect(await r.incomingOpenCount('u-bob')).toBe(1);
    const outgoing = await r.list('u-alice', 'outgoing');
    expect(outgoing.map((x) => x.id).sort()).toEqual([r1.id, r2.id].sort());
    expect(await r.list('u-alice', 'incoming')).toEqual([]);

    // Either party may close; strangers may not.
    expect(await r.setStatus(r2.id, 'u-carol', 'closed')).toBe(false);
    expect(await r.setStatus(r2.id, 'u-alice', 'closed')).toBe(true);
    expect(await r.incomingOpenCount('u-bob')).toBe(0);
  });
});
