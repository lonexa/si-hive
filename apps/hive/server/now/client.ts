import { getSharedDb, nowIso, upsert } from '../../../../packages/shared/src/server/storage/index.js';
import { USERS_TABLE, isOnline } from '../messaging/directory.js';

/** One session in a published snapshot. */
export interface NowSession {
  slug: string;
  project: string;
  status: string;
  model?: string;
  lastActivity: string;
}

export interface NowPush {
  working: number;
  waiting: number;
  errorCount: number;
  total: number;
  topProject: string | null;
  topStatus: string | null;
  sessions: NowSession[];
  machineName: string;
}

export type Availability = 'available' | 'busy' | 'away' | 'dnd';

export interface NowBoardRow {
  oid: string;
  displayName: string;
  email: string;
  online: boolean;
  updatedAt: string | null;
  machineName: string | null;
  working: number;
  waiting: number;
  errorCount: number;
  total: number;
  topProject: string | null;
  topStatus: string | null;
  sessions: NowSession[];
  /** User-set presence (not machine-derived); persists across snapshots. */
  availability: Availability | null;
  manualStatus: string | null;
}

const ONLINE_THRESHOLD_MS = 150_000;
const SNAPSHOT_STALE_MS = 3 * 60_000; // snapshots older than this are treated as "no live sessions"

interface BoardRow {
  oid: string;
  display_name: string | null;
  email: string | null;
  last_heartbeat_at: string | null;
  updated_at: string | null;
  machine_name: string | null;
  working: number | null;
  waiting: number | null;
  error_count: number | null;
  total: number | null;
  top_project: string | null;
  top_status: string | null;
  sessions_json: string | null;
  availability: string | null;
  manual_status: string | null;
}

/**
 * Shared `user_now` store for the Team "Now" board. Each Hive instance
 * publishes its machine's live-session snapshot; the board reads everyone's.
 */
export class NowClient {
  async push(userOid: string, p: NowPush): Promise<void> {
    const db = await getSharedDb();
    await upsert(db, 'user_now', { user_oid: userOid }, {
      updated_at: nowIso(),
      machine_name: p.machineName ?? '',
      working: p.working,
      waiting: p.waiting,
      error_count: p.errorCount,
      total: p.total,
      top_project: p.topProject,
      top_status: p.topStatus,
      sessions_json: JSON.stringify(p.sessions ?? []),
    });
  }

  /**
   * Set the user's manual presence. Only touches the availability/manualStatus
   * columns so the 45s session snapshot push() never clobbers it (and vice
   * versa). Upserts so a status can be set before any snapshot exists.
   */
  async setStatus(userOid: string, availability: Availability | null, manualStatus: string | null): Promise<void> {
    const db = await getSharedDb();
    const now = nowIso();
    await upsert(
      db,
      'user_now',
      { user_oid: userOid },
      { availability, manual_status: manualStatus, manual_status_at: now },
      { updated_at: now },
    );
  }

  async getBoard(): Promise<NowBoardRow[]> {
    const db = await getSharedDb();
    const rows = (await db.selectFrom(`${USERS_TABLE} as u`)
      .leftJoin('user_now as n', 'n.user_oid', 'u.oid')
      .select([
        'u.oid', 'u.display_name', 'u.email', 'u.last_heartbeat_at',
        'n.updated_at', 'n.machine_name', 'n.working', 'n.waiting', 'n.error_count', 'n.total',
        'n.top_project', 'n.top_status', 'n.sessions_json', 'n.availability', 'n.manual_status',
      ])
      .orderBy('u.display_name')
      .execute()) as BoardRow[];
    const now = Date.now();
    return rows.map((r) => {
      const updatedMs = r.updated_at ? new Date(r.updated_at).getTime() : 0;
      const fresh = updatedMs > 0 && now - updatedMs < SNAPSHOT_STALE_MS;
      let sessions: NowSession[] = [];
      if (fresh && r.sessions_json) {
        try { sessions = JSON.parse(r.sessions_json) as NowSession[]; } catch { /* ignore */ }
      }
      const num = (v: number | null) => (fresh ? Number(v ?? 0) : 0);
      return {
        oid: r.oid,
        displayName: r.display_name ?? '',
        email: r.email ?? '',
        online: isOnline(r.last_heartbeat_at, ONLINE_THRESHOLD_MS, now),
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
        machineName: r.machine_name ?? null,
        working: num(r.working),
        waiting: num(r.waiting),
        errorCount: num(r.error_count),
        total: num(r.total),
        topProject: fresh ? r.top_project ?? null : null,
        topStatus: fresh ? r.top_status ?? null : null,
        sessions,
        availability: (r.availability as Availability | null) ?? null,
        manualStatus: r.manual_status ?? null,
      };
    });
  }

  /** Kept for API compatibility — the shared DB connection is process-wide. */
  async close(): Promise<void> {
    /* no-op */
  }
}
