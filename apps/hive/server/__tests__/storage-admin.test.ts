import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { useTempHiveHome } from '../../../../packages/shared/src/test-utils/hive-home.js';

const home = useTempHiveHome();

// These modules aren't in storage/migrations-index.ts yet — register them
// explicitly before the migrations run.
await import('../admin/migrations.js');
await import('../analytics/migrations.js');
await import('../security/migrations.js');

const storage = await import('../../../../packages/shared/src/server/storage/index.js');
const { initSharedStorage } = await import('../storage/init.js');
const { UserManagementClient } = await import('../admin/user-management-client.js');
const { UsageAnalyticsClient } = await import('../admin/usage-analytics-client.js');
const { TeamUsageClient } = await import('../team/ai-usage-client.js');
const { AuditClient } = await import('../security/audit-client.js');
const { TimeClient } = await import('../analytics/time-client.js');
const { recordSessionUpdate, stopUsageLogger, getUsageLogUsername } = await import('../analytics/usage-logger.js');
const { purgeUsageLogForProject } = await import('../privacy/purge.js');

const DAY = 86_400_000;
const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);
const at = (hhmm: string) => `${yesterday}T${hhmm}:00.000Z`;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function aiRow(values: Record<string, unknown>) {
  const db = await storage.getSharedDb();
  const now = storage.nowIso();
  await db.insertInto('ai_usage_log').values({
    provider: 'claude', display_name: null, machine_name: 'm', model: null,
    duration_seconds: 0, input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0,
    message_count: 0, tool_use_count: 0, created_at: now, updated_at: now,
    ...values,
  } as any).execute();
}

describe('shared storage: admin, analytics, audit, privacy', () => {
  const um = new UserManagementClient();

  beforeAll(async () => {
    const report = await initSharedStorage();
    expect(report.error).toBeUndefined();
    expect(report.applied).toEqual(expect.arrayContaining(['users/001_init', 'analytics/001_init', 'security/001_init']));

    // The usage logger attributes rows to the most recent local login.
    const local = new Database(path.join(home, 'hive.db'));
    local.exec(`
      CREATE TABLE users (oid TEXT PRIMARY KEY, email TEXT, displayName TEXT, lastLogin TEXT);
      CREATE TABLE auth_sessions (userOid TEXT, expiresAt TEXT, createdAt TEXT);
    `);
    local.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run('u-alice', 'alice@example.com', 'Alice', new Date().toISOString());
    local.close();
  });
  afterAll(async () => {
    await storage.closeSharedDb();
  });

  it('upserts users on login, keeps admin role overrides, tracks logins', async () => {
    const first = await um.upsertUser({ oid: 'u-alice', email: 'alice@example.com', displayName: 'Alice', role: 'full' });
    expect(first).toMatchObject({ oid: 'u-alice', role: 'full', loginCount: 1, adminRoleOverride: null, forceUpdatePending: false });
    const second = await um.upsertUser({ oid: 'u-alice', email: 'alice@example.com', displayName: 'Alice A.', role: 'full' });
    expect(second.loginCount).toBe(2);
    expect(second.displayName).toBe('Alice A.');
    expect(second.firstLogin).toBe(first.firstLogin);
    await um.upsertUser({ oid: 'u-bob', email: 'bob@example.com', displayName: 'Bob', role: 'full' });

    expect(await um.updateUserRole('u-alice', 'admin')).toBe(true);
    expect(await um.updateUserRole('nobody', 'admin')).toBe(false);
    const relogin = await um.upsertUser({ oid: 'u-alice', email: 'alice@example.com', displayName: 'Alice', role: 'full' });
    expect(relogin.role).toBe('admin');
    expect(relogin.adminRoleOverride).toBe('admin');
    expect(await um.clearAdminOverride('u-alice', 'full')).toBe(true);

    await um.recordLogin('u-alice', 'host-1', '1.2.3');
    await um.recordLogin('u-alice', 'host-2');

    const users = await um.listUsers();
    expect(users.map((u) => u.displayName)).toEqual(['Alice', 'Bob']);
    const alice = users[0];
    expect(alice.role).toBe('full');
    expect(alice.adminRoleOverride).toBeNull();
    expect(alice.lastVersion).toBe('1.2.3');
    expect(alice.lastHeartbeatAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const detail = await um.getUser('u-alice');
    expect(detail?.logins.map((l) => l.machineName).sort()).toEqual(['host-1', 'host-2']);
    expect(await um.getUser('nobody')).toBeNull();
  });

  it('grants and revokes additive feature overrides', async () => {
    expect(await um.grantOverride('u-alice', 'user-management', 'u-admin')).toEqual({ ok: true });
    expect(await um.grantOverride('u-alice', 'user-management', 'u-admin')).toEqual({ ok: true }); // idempotent
    expect((await um.grantOverride('u-alice', 'dashboard', 'u-admin')).ok).toBe(false);          // role already has it
    expect((await um.grantOverride('nobody', 'incognito', 'u-admin')).error).toBe('User not found');

    const overrides = await um.getOverrides('u-alice');
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({ feature: 'user-management', grantedBy: 'u-admin' });
    expect(await um.revokeOverride('u-alice', 'user-management')).toBe(true);
    expect(await um.revokeOverride('u-alice', 'user-management')).toBe(false);
  });

  it('heartbeat delivers a queued force-update exactly once', async () => {
    expect(await um.requestForceUpdate('u-alice', 'u-admin')).toBe(true);
    expect((await um.listUsers())[0]).toMatchObject({ forceUpdatePending: true, forceUpdateRequestedBy: 'u-admin' });

    expect(await um.updateHeartbeat('u-alice', '2.0.0', 'host-1', 'abc123')).toEqual({ forceUpdatePending: true });
    expect(await um.updateHeartbeat('u-alice', '2.0.0', 'host-1')).toEqual({ forceUpdatePending: false });

    const alice = (await um.listUsers())[0];
    expect(alice).toMatchObject({ lastVersion: '2.0.0', lastCommit: 'abc123', forceUpdatePending: false });
  });

  it('debounces activity and records events', async () => {
    await um.recordActivity('u-alice', 'dashboard', 'host-1');
    await um.recordActivity('u-alice', 'dashboard', 'host-1');
    await um.recordActivity('u-alice', 'knowledge', 'host-1');
    const activity = await um.getActivitySummary('u-alice');
    expect(activity.find((a) => a.feature === 'dashboard')?.visitCount).toBe(1);
    expect(activity).toHaveLength(2);

    await um.insertEvents([
      { userOid: 'u-alice', occurredAt: at('10:00'), category: 'nav', name: 'sidebar.a', route: '/a', props: { x: 1 } },
      { userOid: 'u-alice', occurredAt: at('10:01'), category: 'nav', name: 'sidebar.a', route: '/a' },
      { userOid: 'u-alice', occurredAt: at('10:10'), category: 'click', name: 'btn.b', route: '/b' },
      { userOid: 'u-bob', occurredAt: at('11:00'), category: 'nav', name: 'sidebar.a', route: '/a' },
    ]);

    const recent = await um.getRecentEvents('u-alice', 2);
    expect(recent.map((e) => e.name)).toEqual(['btn.b', 'sidebar.a']);
    const detail = await um.getUser('u-alice');
    expect(detail?.recentEvents.at(-1)?.props).toEqual({ x: 1 });
    expect(detail?.events.find((e) => e.name === 'sidebar.a')?.count).toBe(2);
  });

  it('aggregates feature adoption', async () => {
    const adoption = await um.getAdoption(30);
    expect(adoption.totalEvents).toBe(4);
    expect(adoption.activeUsers).toBe(2);
    expect(adoption.topFeatures[0]).toMatchObject({ name: 'sidebar.a', category: 'nav', total: 3, users: 2, lastAt: at('11:00') });
    expect(adoption.byCategory).toEqual([
      { category: 'nav', total: 3, users: 2 },
      { category: 'click', total: 1, users: 1 },
    ]);
    expect(adoption.daily).toEqual([{ day: yesterday, total: 4, users: 2 }]);
  });

  it('usage logger upserts one row per session', async () => {
    const file = path.join(home, 'sess-1.jsonl');
    const t0 = new Date(Date.now() - 120_000).toISOString();
    const t1 = new Date(Date.now() - 60_000).toISOString();
    const line = (ts: string, usage: Record<string, number>, content: unknown[] = []) =>
      JSON.stringify({ type: 'assistant', timestamp: ts, message: { model: 'model-x', usage, content } }) + '\n';
    fs.writeFileSync(file, line(t0, { input_tokens: 100, output_tokens: 50 }, [{ type: 'tool_use' }]));

    expect(getUsageLogUsername()).toBe('alice@example.com');
    recordSessionUpdate('sess-1', file, '/work/alpha');
    await stopUsageLogger();

    fs.appendFileSync(file, line(t1, { input_tokens: 200, output_tokens: 25, cache_read_input_tokens: 10 }));
    recordSessionUpdate('sess-1', file, '/work/alpha');
    await stopUsageLogger();

    const db = await storage.getSharedDb();
    const rows = await db.selectFrom('ai_usage_log').selectAll().where('session_id', '=', 'sess-1').execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: 'claude', username: 'alice@example.com', display_name: 'Alice', project_path: '/work/alpha',
      model: 'model-x', start_time: t0, end_time: t1, duration_seconds: 60, message_count: 2, tool_use_count: 1,
    });
    expect(Number(rows[0].input_tokens)).toBe(300);
    expect(Number(rows[0].output_tokens)).toBe(75);
    expect(Number(rows[0].cache_read_tokens)).toBe(10);
  });

  it('rolls up team AI usage', async () => {
    await aiRow({ session_id: 'sess-2', username: 'bob@example.com', display_name: 'Bob', project_path: '/work/alpha',
      model: 'model-b', start_time: at('11:30'), input_tokens: 1000, duration_seconds: 60, message_count: 3 });
    await aiRow({ session_id: 'sess-3', username: 'alice@example.com', project_path: '/work/beta',
      model: 'model-a', start_time: at('10:05'), input_tokens: 10, output_tokens: 5, duration_seconds: 120, message_count: 4 });
    await aiRow({ session_id: 'sess-old', username: 'alice@example.com', project_path: '/work/alpha',
      start_time: new Date(Date.now() - 100 * DAY).toISOString(), input_tokens: 999 });

    const usage = await new TeamUsageClient().getUsage(30);
    expect(usage.summary).toEqual({ totalSessions: 3, activeUsers: 2, totalActiveSeconds: 240, totalMessages: 9, totalTokens: 1390 });
    const alice = usage.byUser.find((u) => u.user === 'alice@example.com');
    expect(alice).toMatchObject({ sessions: 2, projects: 2, models: ['model-a', 'model-x'], tokens: 390, toolUses: 1 });
    expect(usage.byProject[0]).toMatchObject({ project: '/work/alpha', sessions: 2, users: 2, tokens: 1375 });
    expect(usage.byModel.map((m) => m.model).sort()).toEqual(['model-a', 'model-b', 'model-x']);
    expect(usage.daily.map((d) => d.day)[0]).toBe(yesterday);
    expect(usage.daily.find((d) => d.day === yesterday)).toMatchObject({ sessions: 2, users: 2, activeSeconds: 180 });
  });

  it('builds the usage dashboard rollup, overview and timeline', async () => {
    const analytics = new UsageAnalyticsClient();
    const { rows } = await analytics.getUserRollup(30);
    expect(rows.map((r) => r.oid)).toEqual(['u-alice', 'u-bob']);
    expect(rows[0]).toMatchObject({ events: 3, features: 2, activeDays: 1, activeMinutes: 3, aiSessions: 2, tokens: 390, loginCount: 3 });
    expect(rows[1]).toMatchObject({ events: 1, aiSessions: 1, tokens: 1000, lastActiveAt: at('11:30') });

    const overview = await analytics.getOverview(30);
    expect(overview.summary).toMatchObject({ activeUsers: 2, totalEvents: 4, aiSessions: 3, totalTokens: 1390 });
    expect(overview.daily).toEqual([{ day: yesterday, events: 4, users: 2 }]);
    expect(overview.topProjects[0]).toMatchObject({ project: '/work/alpha', sessions: 2, users: 2 });

    const tl = await analytics.getUserTimeline('u-alice', yesterday);
    expect(tl.displayName).toBe('Alice');
    expect(tl.steps.map((s) => s.kind)).toEqual(['visit', 'login', 'ai', 'idle', 'visit']);
    expect(tl.summary).toMatchObject({ pagesVisited: 2, topRoute: '/a', aiSessions: 1, tokens: 15, activeMinutes: 7 });
  });

  it('deletes a user and their records', async () => {
    expect(await um.deleteUser('u-bob')).toBe(true);
    expect(await um.getUser('u-bob')).toBeNull();
    const db = await storage.getSharedDb();
    expect(await db.selectFrom('user_events').selectAll().where('user_oid', '=', 'u-bob').execute()).toEqual([]);
    expect(await um.deleteUser('u-bob')).toBe(false);
  });

  it('writes and lists the audit log', async () => {
    const audit = new AuditClient();
    expect(await audit.logAction('POST /api/config', 'config', '/api/config', null, 'alice')).toEqual({ success: true, warning: null });
    await audit.logAction('PATCH /api/admin/users', 'admin', '/api/admin/users/u-bob/role', '{"role":"admin"}', 'bob');

    const all = await audit.getAuditLog(30);
    expect(all.totalCount).toBe(2);
    expect(all.entries.find((e) => e.Username === 'bob')).toMatchObject({ Action: 'PATCH /api/admin/users', Username: 'bob', Details: '{"role":"admin"}' });
    expect(typeof all.entries[0]?.Id).toBe('number');
    const filtered = await audit.getAuditLog(30, 'POST /api/config', 'alice');
    expect(filtered.entries.map((e) => e.EntityId)).toEqual(['/api/config']);
    expect((await audit.getDistinctActions()).actions).toEqual(['PATCH /api/admin/users', 'POST /api/config']);
    expect((await audit.getDistinctUsers()).users).toEqual(['alice', 'bob']);
  });

  it('purges one user\'s usage rows for a project tree', async () => {
    const start = storage.nowIso();
    await aiRow({ session_id: 'p-1', username: 'Carol@Example.com', project_path: 'C:\\Work\\Proj_1', start_time: start });
    await aiRow({ session_id: 'p-2', username: 'carol@example.com', project_path: 'c:/work/proj_1/sub', start_time: start });
    await aiRow({ session_id: 'p-3', username: 'carol@example.com', project_path: 'C:\\Work\\Proj_10', start_time: start });
    await aiRow({ session_id: 'p-4', username: 'dave@example.com', project_path: 'C:\\Work\\Proj_1', start_time: start });

    const res = await purgeUsageLogForProject('C:\\Work\\Proj_1\\', 'carol@example.com');
    expect(res).toEqual({ deleted: 2, warning: null });
    const db = await storage.getSharedDb();
    const left = await db.selectFrom('ai_usage_log').select('session_id').where('session_id', 'like', 'p-%').orderBy('session_id').execute();
    expect(left.map((r) => r.session_id)).toEqual(['p-3', 'p-4']);
  });

  it('stores manual time entries and returns the time data shape', async () => {
    const time = new TimeClient();
    const entry = await time.insertManualTime({
      username: 'alice@example.com', projectPath: '/work/alpha', workItemId: 42, hours: 1.5, description: 'review', entryDate: yesterday,
    });
    expect(entry).toMatchObject({ Username: 'alice@example.com', WorkItemId: 42, Hours: 1.5, Source: 'manual', EntryDate: yesterday });
    await time.insertManualTime({
      username: 'alice@example.com', projectPath: '/work/alpha', workItemId: null, hours: 2,
      description: '', entryDate: new Date(Date.now() - 60 * DAY).toISOString().slice(0, 10),
    });

    const data = await time.getTimeData(30);
    expect(Object.keys(data).sort()).toEqual(['autoTime', 'devOpsTime', 'manualTime', 'warnings']);
    expect(data.autoTime).toEqual([]);
    expect(data.devOpsTime).toEqual([]);
    expect(data.warnings).toEqual([]);
    expect(data.manualTime).toHaveLength(1);
    expect(data.manualTime[0]).toEqual({
      Id: entry.Id, Username: 'alice@example.com', ProjectPath: '/work/alpha', WorkItemId: 42, Hours: 1.5,
      Description: 'review', Source: 'manual', EntryDate: yesterday, CreatedAt: entry.CreatedAt,
    });
  });
});
