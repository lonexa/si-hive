import type { SharedDb } from '../../../../packages/shared/src/server/storage/index.js';

/**
 * Read-only access to the shared user directory (owned by user management).
 * Messaging and the Now board only read it; keeping the table/column names in
 * one place means a rename there is a one-line change here.
 */
export const USERS_TABLE = 'users';

export interface DirectoryUser {
  oid: string;
  displayName: string;
  email: string;
  lastHeartbeatAt: string | null;
}

interface UserRow {
  oid: string;
  display_name: string | null;
  email: string | null;
  last_heartbeat_at: string | null;
}

function toDirectoryUser(r: UserRow): DirectoryUser {
  return {
    oid: r.oid,
    displayName: r.display_name ?? '',
    email: r.email ?? '',
    lastHeartbeatAt: r.last_heartbeat_at ?? null,
  };
}

const COLUMNS = ['oid', 'display_name', 'email', 'last_heartbeat_at'] as const;

/** Every user, ordered by display name. */
export async function listDirectoryUsers(db: SharedDb): Promise<DirectoryUser[]> {
  const rows = (await db.selectFrom(USERS_TABLE).select([...COLUMNS]).orderBy('display_name').execute()) as UserRow[];
  return rows.map(toDirectoryUser);
}

/** Look up a set of users by id (chunked to stay under driver parameter limits). */
export async function lookupDirectoryUsers(db: SharedDb, oids: string[]): Promise<DirectoryUser[]> {
  const out: DirectoryUser[] = [];
  for (const chunk of chunks(Array.from(new Set(oids)), 500)) {
    const rows = (await db.selectFrom(USERS_TABLE).select([...COLUMNS]).where('oid', 'in', chunk).execute()) as UserRow[];
    out.push(...rows.map(toDirectoryUser));
  }
  return out;
}

export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** True when the user's last heartbeat is younger than `thresholdMs`. */
export function isOnline(lastHeartbeatAt: string | null, thresholdMs: number, now = Date.now()): boolean {
  return !!lastHeartbeatAt && now - new Date(lastHeartbeatAt).getTime() < thresholdMs;
}
