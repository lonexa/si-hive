/** Small helpers shared by the workflow DB modules. */

/** Shared-DB table holding Hive users (oid, displayName, email, …). */
export const USERS_TABLE = 'users';

/** 0/1 (or boolean) column value → boolean. */
export function toBool(value: unknown): boolean {
  return value === true || Number(value) === 1;
}

/**
 * Normalize a timestamp for storage. Timestamps are compared as text, so
 * anything with a zone designator becomes canonical ISO-8601 UTC. Zone-less
 * values (e.g. the scheduler's period anchors `YYYY-MM-DDT00:00:00`) are kept
 * verbatim so every instance computes the same claim key.
 */
export function toStoredTime(value: string): string {
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return value;
}

/** True for a unique/primary-key violation on SQLite, Postgres or SQL Server. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; number?: unknown } | null;
  if (!e) return false;
  if (typeof e.code === 'string' && (e.code.startsWith('SQLITE_CONSTRAINT_UNIQUE') || e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || e.code === '23505')) return true;
  return e.number === 2627 || e.number === 2601;
}
