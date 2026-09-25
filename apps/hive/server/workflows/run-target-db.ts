/**
 * Per-workflow "run targets" — an allow-list of which team members' machines may
 * execute a team workflow.
 *
 * Semantics:
 *   - NO rows for a workflow  → every team member is eligible (default, backward-compatible).
 *   - one or more rows        → only the listed members' instances may run it.
 *
 * Each Hive instance is a per-user local server, so "which machine runs the daily
 * claim" maps to "which user is logged into that instance". We match the running
 * instance to a target by the user's email (the one field every instance reliably
 * has in its local config), resolved to a target row via the users table.
 *
 * Use case: if a workflow keeps failing on a particular member's machine (stale build,
 * missing CLI, no network), the owner unchecks them and the claim moves to a
 * healthy machine — without disabling the workflow for everyone.
 */

import { getSharedDb, nowIso } from '../../../../packages/shared/src/server/storage/index.js';
import { USERS_TABLE } from './db-util.js';

/** List the selected target user OIDs for a workflow (empty = everyone eligible). */
export async function listRunTargets(workflowId: number): Promise<string[]> {
  const db = await getSharedDb();
  const rows = await db.selectFrom('workflow_run_targets').select('userOid').where('workflowId', '=', workflowId).execute();
  return rows.map((r) => r.userOid as string);
}

/** Replace the full set of run targets for a workflow. Empty array clears it (= everyone). */
export async function setRunTargets(workflowId: number, userOids: string[]): Promise<void> {
  const unique = [...new Set(userOids.map(o => o.trim()).filter(Boolean))];
  const db = await getSharedDb();
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('workflow_run_targets').where('workflowId', '=', workflowId).execute();
    if (unique.length === 0) return;
    const now = nowIso();
    await trx.insertInto('workflow_run_targets')
      .values(unique.map((userOid) => ({ workflowId, userOid, addedAt: now })))
      .execute();
  });
}

/**
 * Is the instance running as `userEmail` allowed to execute this workflow?
 * True when the workflow has no targets (default) OR a target maps to this email.
 * An absent/empty email can only run un-targeted workflows (safe default).
 */
export async function isInstanceAllowed(workflowId: number, userEmail: string | undefined): Promise<boolean> {
  const db = await getSharedDb();
  const anyTarget = await db.selectFrom('workflow_run_targets').select('id').where('workflowId', '=', workflowId).executeTakeFirst();
  if (!anyTarget) return true;
  const email = (userEmail ?? '').trim().toLowerCase();
  if (!email) return false;
  const match = await db.selectFrom('workflow_run_targets as t')
    .innerJoin(`${USERS_TABLE} as u`, 'u.oid', 't.userOid')
    .select('t.id')
    .where('t.workflowId', '=', workflowId)
    .where((eb) => eb(eb.fn('lower', ['u.email']), '=', email))
    .executeTakeFirst();
  return !!match;
}

/** Candidate members (all known Hive users) plus their build/heartbeat info for the picker UI. */
export interface RunTargetMember {
  oid: string;
  displayName: string | null;
  email: string | null;
  lastVersion: string | null;
  lastCommit: string | null;
  lastHeartbeatAt: string | null;
}

export async function listCandidateMembers(): Promise<RunTargetMember[]> {
  const db = await getSharedDb();
  return (await db.selectFrom(USERS_TABLE)
    .select(['oid', 'display_name as displayName', 'email', 'last_version as lastVersion', 'last_commit as lastCommit', 'last_heartbeat_at as lastHeartbeatAt'])
    .where('email', 'is not', null)
    .orderBy('display_name')
    .execute()) as RunTargetMember[];
}

/** Remove all run targets for a workflow (used when the workflow is deleted). */
export async function deleteRunTargetsForWorkflow(workflowId: number): Promise<void> {
  const db = await getSharedDb();
  await db.deleteFrom('workflow_run_targets').where('workflowId', '=', workflowId).execute();
}
