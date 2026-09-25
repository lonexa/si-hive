import {
  getSharedDb,
  getSharedDialect,
  limitRows,
  nowIso,
} from '../../../../packages/shared/src/server/storage/index.js';
import { isUniqueViolation, toStoredTime } from './db-util.js';
import type { WorkflowClaim } from './types.js';

/**
 * Try to claim a team workflow execution slot.
 * Uses unique constraint on (workflowId, scheduledAt) to ensure at-most-once execution.
 * Returns { claimed: true } if this instance won the slot, { claimed: false } if another instance already claimed it.
 */
export async function tryClaim(
  workflowId: number,
  scheduledAt: string,
  claimedBy: string,
): Promise<{ claimed: boolean }> {
  const db = await getSharedDb();
  try {
    await db.insertInto('workflow_claims').values({
      workflowId,
      scheduledAt: toStoredTime(scheduledAt),
      claimedBy,
      claimedAt: nowIso(),
      status: 'claimed',
    }).execute();
    return { claimed: true };
  } catch (err: unknown) {
    // Unique constraint violation = another instance already claimed this slot
    if (isUniqueViolation(err)) return { claimed: false };
    throw err;
  }
}

/** Update a claim's status after execution completes. */
export async function updateClaim(
  workflowId: number,
  scheduledAt: string,
  status: 'completed' | 'failed',
  runId?: number,
): Promise<void> {
  const db = await getSharedDb();
  const set: Record<string, unknown> = { status };
  if (runId !== undefined) set.runId = runId;
  await db.updateTable('workflow_claims').set(set)
    .where('workflowId', '=', workflowId)
    .where('scheduledAt', '=', toStoredTime(scheduledAt))
    .execute();
}

/**
 * Delete a single claim, releasing the slot so it can be re-claimed.
 * Used when an action workflow run fails transiently (e.g. no auth token yet)
 * so the next scheduler tick can retry it — still at most once per period.
 */
export async function releaseClaim(workflowId: number, scheduledAt: string): Promise<void> {
  const db = await getSharedDb();
  await db.deleteFrom('workflow_claims')
    .where('workflowId', '=', workflowId)
    .where('scheduledAt', '=', toStoredTime(scheduledAt))
    .execute();
}

/** Get the most recent claim for a workflow (used for status display). */
export async function getLastClaim(workflowId: number): Promise<WorkflowClaim | null> {
  const db = await getSharedDb();
  const q = db.selectFrom('workflow_claims').selectAll()
    .where('workflowId', '=', workflowId)
    .orderBy('scheduledAt', 'desc');
  return ((await limitRows(q, getSharedDialect(), 1).executeTakeFirst()) as WorkflowClaim | undefined) ?? null;
}

/** Delete old claims to prevent table bloat. */
export async function pruneOldClaims(workflowId: number, keepDays = 30): Promise<void> {
  const db = await getSharedDb();
  const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString();
  await db.deleteFrom('workflow_claims')
    .where('workflowId', '=', workflowId)
    .where('scheduledAt', '<', cutoff)
    .execute();
}

/** Delete all claims for a workflow (used when deleting the workflow). */
export async function deleteClaimsForWorkflow(workflowId: number): Promise<void> {
  const db = await getSharedDb();
  await db.deleteFrom('workflow_claims').where('workflowId', '=', workflowId).execute();
}
