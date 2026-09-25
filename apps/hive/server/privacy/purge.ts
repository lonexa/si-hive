/**
 * Retroactive purge for incognito projects.
 *
 * The write gate in incognito.ts is forward-looking: it stops new rows, but a
 * project marked today has usually already logged sessions. Read-side filters
 * hide those rows on *this* machine — every other user's Hive reads the same
 * shared ai_usage_log and has no idea the project is incognito, so the rows
 * have to actually go.
 *
 * Only ai_usage_log keeps per-session history keyed by project path. The
 * presence table holds a single continuously-overwritten row per user (and its
 * publisher already skips incognito sessions), and the other shared tables are
 * gated at the write and carry no project path — so there is nothing
 * historical to purge from them.
 *
 * Scoped to one username on purpose: the toggle is a local decision on one
 * person's machine, and a teammate may legitimately have rows for a
 * same-named directory of their own.
 */

import { sql } from 'kysely';
import { getSharedDb } from '../../../../packages/shared/src/server/storage/index.js';
import { clearPendingPurge, listPendingPurges } from './incognito.js';
import { getUsageLogUsername } from '../analytics/usage-logger.js';

/** Normalize a path the same way incognito.ts does: `/`, no trailing slash, lowercase. */
function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

const DELETE_CHUNK = 500;

/**
 * Delete this user's ai_usage_log rows for a project root and everything
 * under it.
 *
 * Returns the number of rows removed, or a `warning` when the shared database
 * couldn't be reached — the caller should surface that rather than claim
 * success, since the rows are still out there.
 */
export async function purgeUsageLogForProject(
  projectPath: string,
  username: string,
): Promise<{ deleted: number; warning: string | null }> {
  const root = norm(projectPath);
  if (!root || !username) return { deleted: 0, warning: null };

  try {
    const db = await getSharedDb();
    // Path matching happens in JS rather than with LIKE: `_`, `%` and `[` are
    // all legal in a Windows path and all LIKE metacharacters.
    const candidates = await db.selectFrom('ai_usage_log')
      .select(['id', 'project_path'])
      .where(sql<string>`lower(${sql.ref('username')})`, '=', username.toLowerCase())
      .execute();
    const ids = candidates
      .filter((r) => {
        const p = norm((r.project_path as string | null) ?? '');
        return p === root || p.startsWith(`${root}/`);
      })
      .map((r) => Number(r.id));

    let deleted = 0;
    await db.transaction().execute(async (trx) => {
      for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
        const res = await trx.deleteFrom('ai_usage_log').where('id', 'in', ids.slice(i, i + DELETE_CHUNK)).executeTakeFirst();
        deleted += Number(res.numDeletedRows ?? 0);
      }
    });
    // Only a committed DELETE retires the queue entry — a failure above leaves
    // it queued for the next attempt.
    clearPendingPurge(root);
    if (deleted > 0) {
      console.log(`[incognito] Purged ${deleted} ai_usage_log row(s) for ${projectPath}`);
    }
    return { deleted, warning: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[incognito] Purge failed for ${projectPath}: ${msg}`);
    return { deleted: 0, warning: `Could not remove already-logged rows from the shared database: ${msg}` };
  }
}

/**
 * Retry every queued purge. Called at server start, which is where a toggle
 * made while the shared database was unreachable finally gets its deletion —
 * and a no-op with nothing queued.
 */
export async function runPendingPurges(): Promise<void> {
  const pending = listPendingPurges();
  if (pending.length === 0) return;
  const username = getUsageLogUsername();
  if (!username) return;   // nobody has logged in on this instance yet
  console.log(`[incognito] Retrying ${pending.length} pending purge(s)`);
  for (const root of pending) {
    await purgeUsageLogForProject(root, username);
  }
}
