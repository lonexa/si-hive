import os from 'node:os';
import {
  getSharedDb,
  getSharedDialect,
  limitRows,
  nowIso,
} from '../../../../packages/shared/src/server/storage/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  Id: number;
  Action: string;
  EntityType: string | null;
  EntityId: string | null;
  Details: string | null;
  Username: string;
  MachineName: string | null;
  Timestamp: string;
}

export interface AuditLogResult {
  entries: AuditLogEntry[];
  warning: string | null;
  totalCount: number;
}

export interface LogActionResult {
  success: boolean;
  warning: string | null;
}

const MAX_ENTRIES = 1000;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class AuditClient {
  /** Kept for API compatibility — the shared DB connection is process-wide. */
  async close(): Promise<void> {
    /* no-op */
  }

  // -------------------------------------------------------------------------
  // Read audit log entries
  // -------------------------------------------------------------------------

  async getAuditLog(
    days: number = 30,
    action?: string,
    user?: string,
  ): Promise<AuditLogResult> {
    const db = await getSharedDb();
    let base = db.selectFrom('audit_log')
      .where('logged_at', '>=', new Date(Date.now() - days * 86_400_000).toISOString());
    if (action) base = base.where('action', '=', action);
    if (user) base = base.where('username', '=', user);

    const count = await base.select((eb) => eb.fn.countAll().as('cnt')).executeTakeFirst();
    const rows = await limitRows(base.selectAll().orderBy('logged_at', 'desc'), getSharedDialect(), MAX_ENTRIES).execute();

    return {
      entries: rows.map((r) => ({
        Id: Number(r.id),
        Action: r.action,
        EntityType: r.entity_type ?? null,
        EntityId: r.entity_id ?? null,
        Details: r.details ?? null,
        Username: r.username,
        MachineName: r.machine_name ?? null,
        Timestamp: r.logged_at,
      })),
      warning: null,
      totalCount: count ? Number(count.cnt) : rows.length,
    };
  }

  // -------------------------------------------------------------------------
  // Get distinct action types (for filter dropdown)
  // -------------------------------------------------------------------------

  async getDistinctActions(): Promise<{ actions: string[]; warning: string | null }> {
    const db = await getSharedDb();
    const rows = await db.selectFrom('audit_log').select('action').distinct().orderBy('action').execute();
    return { actions: rows.map((r) => r.action as string), warning: null };
  }

  // -------------------------------------------------------------------------
  // Get distinct usernames (for filter dropdown)
  // -------------------------------------------------------------------------

  async getDistinctUsers(): Promise<{ users: string[]; warning: string | null }> {
    const db = await getSharedDb();
    const rows = await db.selectFrom('audit_log').select('username').distinct().orderBy('username').execute();
    return { users: rows.map((r) => r.username as string), warning: null };
  }

  // -------------------------------------------------------------------------
  // Write an audit log entry
  // -------------------------------------------------------------------------

  async logAction(
    action: string,
    entityType: string | null,
    entityId: string | null,
    details: string | null,
    username: string,
  ): Promise<LogActionResult> {
    const db = await getSharedDb();
    await db.insertInto('audit_log').values({
      action: action.slice(0, 200),
      entity_type: entityType?.slice(0, 100) ?? null,
      entity_id: entityId?.slice(0, 500) ?? null,
      details,
      username: username.slice(0, 200),
      machine_name: os.hostname().slice(0, 100),
      logged_at: nowIso(),
    }).execute();
    return { success: true, warning: null };
  }
}
