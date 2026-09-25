import {
  getSharedDb,
  getSharedDialect,
  limitRows,
  nowIso,
  affectedRows,
} from '../../../../packages/shared/src/server/storage/index.js';
import { roleHasAccess } from '../../../../packages/shared/src/lib/feature-roles.js';
import type { HiveRole } from '../../../../packages/shared/src/lib/feature-roles.js';

// ── Types ─────────────────────────────────────────────────────────────

export interface CentralUser {
  oid: string;
  email: string;
  displayName: string;
  role: HiveRole;
  adminRoleOverride: HiveRole | null;
  firstLogin: string;
  lastLogin: string;
  loginCount: number;
  lastVersion: string | null;
  lastVersionAt: string | null;
  lastHeartbeatAt: string | null;
  lastCommit: string | null;
  forceUpdatePending: boolean;
  forceUpdateRequestedAt: string | null;
  forceUpdateRequestedBy: string | null;
}

export interface UserDetail extends CentralUser {
  logins: LoginEntry[];
  activity: ActivitySummary[];
  overrides: FeatureOverride[];
  events: UserEventSummary[];
  recentEvents: UserEventRow[];
}

export interface LoginEntry {
  loginAt: string;
  machineName: string;
  version: string | null;
}

export interface UserEventRow {
  occurredAt: string;
  category: string;
  name: string;
  route: string | null;
  props: Record<string, unknown> | null;
  version: string | null;
  machineName: string | null;
}

export interface UserEventSummary {
  name: string;
  category: string;
  count: number;
  lastAt: string;
}

export interface EventInsert {
  userOid: string;
  occurredAt?: string;
  category: string;
  name: string;
  route?: string | null;
  props?: unknown;
  version?: string | null;
  machineName?: string | null;
}

export interface ActivitySummary {
  feature: string;
  visitCount: number;
  lastVisit: string;
}

export interface FeatureOverride {
  feature: string;
  grantedBy: string;
  grantedAt: string;
}

/** A `users` row as stored (snake_case, 0/1 booleans). */
interface UserRow {
  oid: string;
  email: string;
  display_name: string;
  role: string;
  admin_role_override: string | null;
  first_login: string;
  last_login: string;
  login_count: number;
  last_version: string | null;
  last_version_at: string | null;
  last_heartbeat_at: string | null;
  last_commit: string | null;
  force_update_pending: number;
  force_update_requested_at: string | null;
  force_update_requested_by: string | null;
}

const ACTIVITY_DEBOUNCE_MS = 5 * 60_000;

// ── Client ────────────────────────────────────────────────────────────

export class UserManagementClient {
  // ── User directory ──────────────────────────────────────────────────

  async listUsers(): Promise<CentralUser[]> {
    const db = await getSharedDb();
    const rows = await db.selectFrom('users').selectAll().orderBy('display_name').execute();
    return rows.map((r) => toCentralUser(r as UserRow));
  }

  async getUser(oid: string): Promise<UserDetail | null> {
    const db = await getSharedDb();
    const user = await db.selectFrom('users').selectAll().where('oid', '=', oid).executeTakeFirst();
    if (!user) return null;

    // Fetch logins, activity, overrides, events in parallel
    const [logins, activity, overrides, events, recentEvents] = await Promise.all([
      this.getLoginHistory(oid, 90),
      this.getActivitySummary(oid, 90),
      this.getOverrides(oid),
      this.getEventSummary(oid, 7),
      this.getRecentEvents(oid, 200),
    ]);

    return { ...toCentralUser(user as UserRow), logins, activity, overrides, events, recentEvents };
  }

  /**
   * Upsert user on login. Returns the central user record (with adminRoleOverride).
   * If adminRoleOverride is set, the caller should use that as the effective role.
   */
  async upsertUser(user: { oid: string; email: string; displayName: string; role: HiveRole }): Promise<CentralUser> {
    const db = await getSharedDb();
    const now = nowIso();
    const row = await db.transaction().execute(async (trx) => {
      const existing = await trx.selectFrom('users').select('admin_role_override')
        .where('oid', '=', user.oid).executeTakeFirst();
      if (existing) {
        await trx.updateTable('users')
          .set((eb) => ({
            email: user.email,
            display_name: user.displayName,
            // Only take the sign-in role if an admin hasn't overridden it
            role: existing.admin_role_override || user.role,
            last_login: now,
            login_count: eb('login_count', '+', 1),
          }))
          .where('oid', '=', user.oid)
          .execute();
      } else {
        await trx.insertInto('users').values({
          oid: user.oid,
          email: user.email,
          display_name: user.displayName,
          role: user.role,
          first_login: now,
          last_login: now,
          login_count: 1,
          force_update_pending: 0,
        }).execute();
      }
      return trx.selectFrom('users').selectAll().where('oid', '=', user.oid).executeTakeFirstOrThrow();
    });
    return toCentralUser(row as UserRow);
  }

  /**
   * Admin sets a user's role. Persists as adminRoleOverride so it survives later logins.
   */
  async updateUserRole(oid: string, role: HiveRole): Promise<boolean> {
    const db = await getSharedDb();
    const result = await db.updateTable('users')
      .set({ role, admin_role_override: role })
      .where('oid', '=', oid)
      .executeTakeFirst();
    return affectedRows(result) > 0;
  }

  /**
   * Clear admin override — next login will use the sign-in role.
   */
  async clearAdminOverride(oid: string, adRole: HiveRole): Promise<boolean> {
    const db = await getSharedDb();
    const result = await db.updateTable('users')
      .set({ admin_role_override: null, role: adRole })
      .where('oid', '=', oid)
      .executeTakeFirst();
    return affectedRows(result) > 0;
  }

  // ── Login history ───────────────────────────────────────────────────

  async recordLogin(userOid: string, machineName: string, version: string | null = null): Promise<void> {
    const db = await getSharedDb();
    const now = nowIso();
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('user_logins')
        .values({ user_oid: userOid, login_at: now, machine_name: machineName, version })
        .execute();
      await trx.updateTable('users')
        .set(version !== null
          ? { last_version: version, last_version_at: now, last_heartbeat_at: now }
          : { last_heartbeat_at: now })
        .where('oid', '=', userOid)
        .execute();
    });
  }

  /**
   * Update last-seen version/commit + heartbeat. Called every ~60s from each
   * client (and immediately on app start). Also delivers a queued force-update
   * exactly once: the flag is cleared with a conditional UPDATE (`WHERE
   * pending = 1`), so only the heartbeat that actually flips it sees a row
   * affected, and a flag set between two heartbeats is never lost. Returns
   * whether an update was pending for this user.
   */
  async updateHeartbeat(
    userOid: string,
    version: string,
    _machineName: string,
    commit: string | null = null,
  ): Promise<{ forceUpdatePending: boolean }> {
    const db = await getSharedDb();
    const now = nowIso();
    const cleared = await db.updateTable('users')
      .set({ force_update_pending: 0 })
      .where('oid', '=', userOid)
      .where('force_update_pending', '=', 1)
      .executeTakeFirst();
    await db.updateTable('users')
      .set({
        last_version: version,
        ...(commit !== null ? { last_commit: commit } : {}),
        last_version_at: now,
        last_heartbeat_at: now,
      })
      .where('oid', '=', userOid)
      .execute();
    return { forceUpdatePending: affectedRows(cleared) > 0 };
  }

  /**
   * Queue a force-update for a user by setting a DB flag. The user's own local
   * Hive picks it up on its next heartbeat (including the one fired on app
   * start), so this works even when the user is currently offline.
   */
  async requestForceUpdate(userOid: string, requestedBy: string): Promise<boolean> {
    const db = await getSharedDb();
    const result = await db.updateTable('users')
      .set({
        force_update_pending: 1,
        force_update_requested_at: nowIso(),
        force_update_requested_by: requestedBy,
      })
      .where('oid', '=', userOid)
      .executeTakeFirst();
    return affectedRows(result) > 0;
  }

  /** Delete a user and all of their dependent records. */
  async deleteUser(userOid: string): Promise<boolean> {
    const db = await getSharedDb();
    return db.transaction().execute(async (trx) => {
      for (const table of ['user_feature_overrides', 'user_logins', 'user_activity', 'user_events']) {
        await trx.deleteFrom(table).where('user_oid', '=', userOid).execute();
      }
      return affectedRows(await trx.deleteFrom('users').where('oid', '=', userOid).executeTakeFirst()) > 0;
    });
  }

  async getLoginHistory(userOid: string, days = 90): Promise<LoginEntry[]> {
    const db = await getSharedDb();
    const rows = await db.selectFrom('user_logins')
      .select(['login_at', 'machine_name', 'version'])
      .where('user_oid', '=', userOid)
      .where('login_at', '>', daysAgoIso(days))
      .orderBy('login_at', 'desc')
      .execute();
    return rows.map((r) => ({ loginAt: r.login_at, machineName: r.machine_name, version: r.version ?? null }));
  }

  // ── Feature overrides ───────────────────────────────────────────────

  async getOverrides(userOid: string): Promise<FeatureOverride[]> {
    const db = await getSharedDb();
    const rows = await db.selectFrom('user_feature_overrides')
      .select(['feature', 'granted_by', 'granted_at'])
      .where('user_oid', '=', userOid)
      .orderBy('granted_at', 'desc')
      .execute();
    return rows.map((r) => ({ feature: r.feature, grantedBy: r.granted_by, grantedAt: r.granted_at }));
  }

  /**
   * Grant a feature to a user (additive only).
   * Rejects if the user's role already grants access to this feature.
   */
  async grantOverride(userOid: string, feature: string, grantedBy: string): Promise<{ ok: boolean; error?: string }> {
    const db = await getSharedDb();

    // Look up user's role to enforce additive-only
    const user = await db.selectFrom('users').select('role').where('oid', '=', userOid).executeTakeFirst();
    if (!user) return { ok: false, error: 'User not found' };

    if (roleHasAccess(user.role as HiveRole, feature)) {
      return { ok: false, error: `User's role (${user.role}) already has access to ${feature}` };
    }

    try {
      const existing = await db.selectFrom('user_feature_overrides').select('id')
        .where('user_oid', '=', userOid).where('feature', '=', feature).executeTakeFirst();
      if (!existing) {
        await db.insertInto('user_feature_overrides')
          .values({ user_oid: userOid, feature, granted_by: grantedBy, granted_at: nowIso() })
          .execute();
      }
      return { ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  async revokeOverride(userOid: string, feature: string): Promise<boolean> {
    const db = await getSharedDb();
    const result = await db.deleteFrom('user_feature_overrides')
      .where('user_oid', '=', userOid).where('feature', '=', feature)
      .executeTakeFirst();
    return affectedRows(result) > 0;
  }

  // ── Activity tracking ───────────────────────────────────────────────

  /**
   * Record a page/feature visit. Debounced: skips if same user+feature within 5 minutes.
   */
  async recordActivity(userOid: string, feature: string, machineName: string): Promise<void> {
    const db = await getSharedDb();
    const recent = await db.selectFrom('user_activity').select('id')
      .where('user_oid', '=', userOid)
      .where('feature', '=', feature)
      .where('visited_at', '>', new Date(Date.now() - ACTIVITY_DEBOUNCE_MS).toISOString())
      .executeTakeFirst();
    if (recent) return;
    await db.insertInto('user_activity')
      .values({ user_oid: userOid, feature, visited_at: nowIso(), machine_name: machineName })
      .execute();
  }

  async getActivitySummary(userOid: string, days = 90): Promise<ActivitySummary[]> {
    const db = await getSharedDb();
    const rows = await db.selectFrom('user_activity')
      .select((eb) => ['feature', eb.fn.countAll().as('visit_count'), eb.fn.max('visited_at').as('last_visit')])
      .where('user_oid', '=', userOid)
      .where('visited_at', '>', daysAgoIso(days))
      .groupBy('feature')
      .execute();
    return rows
      .map((r) => ({ feature: r.feature as string, visitCount: Number(r.visit_count), lastVisit: String(r.last_visit ?? '') }))
      .sort((a, b) => b.visitCount - a.visitCount);
  }

  // ── Granular event tracking ─────────────────────────────────────────

  /**
   * Batch insert events in a single multi-row INSERT.
   * Caller is expected to cap batch size (~50 events) to stay under parameter limits.
   */
  async insertEvents(events: EventInsert[]): Promise<void> {
    if (events.length === 0) return;
    const db = await getSharedDb();
    await db.insertInto('user_events').values(events.map((ev) => ({
      user_oid: ev.userOid,
      occurred_at: toIsoOrNow(ev.occurredAt),
      version: ev.version ?? null,
      machine_name: ev.machineName ?? null,
      category: ev.category,
      name: ev.name,
      route: ev.route ?? null,
      props_json: ev.props ? JSON.stringify(ev.props) : null,
    }))).execute();
  }

  async getRecentEvents(userOid: string, limit = 200): Promise<UserEventRow[]> {
    const db = await getSharedDb();
    const q = db.selectFrom('user_events')
      .select(['occurred_at', 'category', 'name', 'route', 'props_json', 'version', 'machine_name'])
      .where('user_oid', '=', userOid)
      .orderBy('occurred_at', 'desc');
    const rows = await limitRows(q, getSharedDialect(), limit).execute();
    return rows.map((r) => ({
      occurredAt: r.occurred_at ?? '',
      category: r.category,
      name: r.name,
      route: r.route ?? null,
      props: r.props_json ? safeJsonParse(r.props_json) : null,
      version: r.version ?? null,
      machineName: r.machine_name ?? null,
    }));
  }

  async getEventSummary(userOid: string, days = 7): Promise<UserEventSummary[]> {
    const db = await getSharedDb();
    const q = db.selectFrom('user_events')
      .select((eb) => ['name', 'category', eb.fn.countAll().as('count'), eb.fn.max('occurred_at').as('last_at')])
      .where('user_oid', '=', userOid)
      .where('occurred_at', '>', daysAgoIso(days))
      .groupBy(['name', 'category'])
      .orderBy('count', 'desc');
    const rows = await limitRows(q, getSharedDialect(), 25).execute();
    return rows.map((r) => ({
      name: r.name as string,
      category: r.category as string,
      count: Number(r.count),
      lastAt: String(r.last_at ?? ''),
    }));
  }

  // ── System-wide feature adoption (Hive's own usage) ─────────────────

  /**
   * Aggregate user_events across all users into a feature-adoption summary.
   * This is Hive's OWN usage telemetry.
   */
  async getAdoption(days = 30): Promise<{
    topFeatures: Array<{ name: string; category: string; total: number; users: number; lastAt: string }>;
    byCategory: Array<{ category: string; total: number; users: number }>;
    daily: Array<{ day: string; total: number; users: number }>;
    activeUsers: number;
    totalEvents: number;
  }> {
    const db = await getSharedDb();
    const since = daysAgoIso(days);

    const topQ = db.selectFrom('user_events')
      .select((eb) => [
        'name', 'category',
        eb.fn.countAll().as('total'),
        eb.fn.count('user_oid').distinct().as('users'),
        eb.fn.max('occurred_at').as('last_at'),
      ])
      .where('occurred_at', '>', since)
      .groupBy(['name', 'category'])
      .orderBy('total', 'desc');
    const topFeatures = (await limitRows(topQ, getSharedDialect(), 50).execute()).map((r) => ({
      name: r.name as string,
      category: r.category as string,
      total: Number(r.total),
      users: Number(r.users),
      lastAt: String(r.last_at ?? ''),
    }));

    const byCategory = (await db.selectFrom('user_events')
      .select((eb) => ['category', eb.fn.countAll().as('total'), eb.fn.count('user_oid').distinct().as('users')])
      .where('occurred_at', '>', since)
      .groupBy('category')
      .execute())
      .map((r) => ({ category: r.category as string, total: Number(r.total), users: Number(r.users) }))
      .sort((a, b) => b.total - a.total);

    // Daily buckets + distinct-user totals are computed in JS from the ISO
    // date prefix — date truncation isn't portable across dialects.
    const rows = await db.selectFrom('user_events')
      .select(['user_oid', 'occurred_at'])
      .where('occurred_at', '>', since)
      .execute();
    const byDay = new Map<string, { total: number; users: Set<string> }>();
    const allUsers = new Set<string>();
    for (const r of rows) {
      const day = String(r.occurred_at).slice(0, 10);
      const cur = byDay.get(day) ?? { total: 0, users: new Set<string>() };
      cur.total++;
      cur.users.add(r.user_oid);
      byDay.set(day, cur);
      allUsers.add(r.user_oid);
    }
    const daily = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, v]) => ({ day, total: v.total, users: v.users.size }));

    return { topFeatures, byCategory, daily, activeUsers: allUsers.size, totalEvents: rows.length };
  }

  // ── Cleanup ─────────────────────────────────────────────────────────

  /** Kept for API compatibility — the shared DB connection is process-wide. */
  async close(): Promise<void> {
    /* no-op */
  }
}

function toCentralUser(row: UserRow): CentralUser {
  return {
    oid: row.oid,
    email: row.email ?? '',
    displayName: row.display_name ?? '',
    role: row.role as HiveRole,
    adminRoleOverride: (row.admin_role_override || null) as HiveRole | null,
    firstLogin: row.first_login ?? '',
    lastLogin: row.last_login ?? '',
    loginCount: Number(row.login_count) || 0,
    lastVersion: row.last_version ?? null,
    lastVersionAt: row.last_version_at ?? null,
    lastHeartbeatAt: row.last_heartbeat_at ?? null,
    lastCommit: row.last_commit ?? null,
    forceUpdatePending: Number(row.force_update_pending) === 1,
    forceUpdateRequestedAt: row.force_update_requested_at ?? null,
    forceUpdateRequestedBy: row.force_update_requested_by ?? null,
  };
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** Client-supplied timestamps are normalized so they compare correctly as text. */
function toIsoOrNow(value: string | undefined): string {
  if (value) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  }
  return nowIso();
}

function safeJsonParse(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s); } catch { return null; }
}
