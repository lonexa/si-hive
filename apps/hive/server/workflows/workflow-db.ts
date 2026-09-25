import {
  getSharedDb,
  getSharedDialect,
  insertReturning,
  updateReturning,
  limitRows,
  nowIso,
  affectedRows,
} from '../../../../packages/shared/src/server/storage/index.js';
import { USERS_TABLE, toBool, toStoredTime } from './db-util.js';
import { subscribedWorkflowIds } from './subscription-db.js';
import type { Workflow, WorkflowRun, WorkflowCredential } from './types.js';

function toWorkflow(row: Record<string, unknown>): Workflow {
  return { ...row, enabled: toBool(row.enabled), isDistribution: toBool(row.isDistribution) } as Workflow;
}

// --- Workflows ---

export async function listWorkflows(userId?: string): Promise<Workflow[]> {
  const db = await getSharedDb();
  let q = db.selectFrom('workflows').selectAll();
  if (userId) q = q.where('userId', '=', userId);
  return (await q.orderBy('updatedAt', 'desc').execute()).map(toWorkflow);
}

export async function getWorkflow(id: number, userId?: string): Promise<Workflow | null> {
  const db = await getSharedDb();
  let q = db.selectFrom('workflows').selectAll().where('id', '=', id);
  if (userId) q = q.where('userId', '=', userId);
  const row = await q.executeTakeFirst();
  return row ? toWorkflow(row) : null;
}

export async function createWorkflow(data: {
  name: string;
  description: string;
  type: string;
  templateId?: string;
  definition: string;
  cronExpression: string;
  userId?: string;
  scope?: 'personal' | 'team';
  isDistribution?: boolean;
}): Promise<Workflow> {
  const db = await getSharedDb();
  const now = nowIso();
  const row = await insertReturning(db, getSharedDialect(), 'workflows', {
    userId: data.userId || null,
    name: data.name,
    description: data.description,
    type: data.type,
    templateId: data.templateId || null,
    definition: data.definition,
    cronExpression: data.cronExpression,
    scope: data.scope || 'personal',
    isDistribution: data.isDistribution ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  });
  return toWorkflow(row);
}

export async function updateWorkflow(id: number, data: Partial<{
  name: string;
  description: string;
  definition: string;
  cronExpression: string;
  enabled: boolean;
  lastRunAt: string;
  nextRunAt: string;
  scope: 'personal' | 'team';
  isDistribution: boolean;
  stateJson: string | null;
}>): Promise<Workflow | null> {
  const db = await getSharedDb();
  const set: Record<string, unknown> = { updatedAt: nowIso() };
  if (data.name !== undefined) set.name = data.name;
  if (data.description !== undefined) set.description = data.description;
  if (data.definition !== undefined) set.definition = data.definition;
  if (data.cronExpression !== undefined) set.cronExpression = data.cronExpression;
  if (data.enabled !== undefined) set.enabled = data.enabled ? 1 : 0;
  if (data.lastRunAt !== undefined) set.lastRunAt = data.lastRunAt ? toStoredTime(data.lastRunAt) : null;
  if (data.nextRunAt !== undefined) set.nextRunAt = data.nextRunAt ? toStoredTime(data.nextRunAt) : null;
  if (data.scope !== undefined) set.scope = data.scope;
  if (data.isDistribution !== undefined) set.isDistribution = data.isDistribution ? 1 : 0;
  if (data.stateJson !== undefined) set.stateJson = data.stateJson;
  const row = await updateReturning(db, getSharedDialect(), 'workflows', set, { id });
  return row ? toWorkflow(row) : null;
}

export async function deleteWorkflow(id: number, userId?: string): Promise<boolean> {
  const db = await getSharedDb();
  return db.transaction().execute(async (trx) => {
    let owned = trx.selectFrom('workflows').select('id').where('id', '=', id);
    if (userId) owned = owned.where('userId', '=', userId);
    if (!(await owned.executeTakeFirst())) return false;
    // Delete dependent records first (FK order)
    for (const table of ['workflow_subscriptions', 'workflow_external_subscribers', 'workflow_run_targets', 'workflow_claims', 'workflow_runs']) {
      await trx.deleteFrom(table).where('workflowId', '=', id).execute();
    }
    return affectedRows(await trx.deleteFrom('workflows').where('id', '=', id).executeTakeFirst()) > 0;
  });
}

// --- Workflow Runs ---

export async function listWorkflowRuns(workflowId: number, limit = 50): Promise<WorkflowRun[]> {
  const db = await getSharedDb();
  const q = db.selectFrom('workflow_runs').selectAll()
    .where('workflowId', '=', workflowId)
    .orderBy('startedAt', 'desc')
    .orderBy('id', 'desc');
  return (await limitRows(q, getSharedDialect(), limit).execute()) as WorkflowRun[];
}

export async function insertWorkflowRun(data: {
  workflowId: number;
  status: string;
}): Promise<WorkflowRun> {
  const db = await getSharedDb();
  return insertReturning<WorkflowRun>(db, getSharedDialect(), 'workflow_runs', {
    workflowId: data.workflowId,
    status: data.status,
    startedAt: nowIso(),
  });
}

export async function updateWorkflowRun(id: number, data: Partial<{
  status: string;
  finishedAt: string;
  durationMs: number;
  output: string;
  errorMessage: string;
  screenshotPath: string;
  dataJson: string;
}>): Promise<void> {
  const set: Record<string, unknown> = {};
  if (data.status !== undefined) set.status = data.status;
  if (data.finishedAt !== undefined) set.finishedAt = data.finishedAt ? toStoredTime(data.finishedAt) : null;
  if (data.durationMs !== undefined) set.durationMs = data.durationMs;
  if (data.output !== undefined) set.output = data.output;
  if (data.errorMessage !== undefined) set.errorMessage = data.errorMessage;
  if (data.screenshotPath !== undefined) set.screenshotPath = data.screenshotPath;
  if (data.dataJson !== undefined) set.dataJson = data.dataJson;
  if (Object.keys(set).length === 0) return;
  const db = await getSharedDb();
  await db.updateTable('workflow_runs').set(set).where('id', '=', id).execute();
}

/**
 * Record a non-fatal notification-delivery failure on a run. The run itself
 * stays 'completed' (it produced output) — this only surfaces that we couldn't
 * deliver the email/Slack/etc. so a silent send failure stops being invisible.
 *
 * Any error is swallowed — failing to record a warning must never break a
 * successful run.
 */
export async function recordRunNotifyError(runId: number, message: string): Promise<void> {
  try {
    const db = await getSharedDb();
    await db.updateTable('workflow_runs').set({ notifyError: message }).where('id', '=', runId).execute();
  } catch (err) {
    console.error(`[workflow-db] Failed to record notifyError for run ${runId}:`, err);
  }
}

export async function pruneWorkflowRuns(workflowId: number, maxKeep: number): Promise<void> {
  const db = await getSharedDb();
  const keep = limitRows(
    db.selectFrom('workflow_runs').select('id')
      .where('workflowId', '=', workflowId)
      .orderBy('startedAt', 'desc')
      .orderBy('id', 'desc'),
    getSharedDialect(),
    Math.max(0, maxKeep),
  );
  await db.deleteFrom('workflow_runs')
    .where('workflowId', '=', workflowId)
    .where('id', 'not in', keep)
    .execute();
}

async function completedRunData(workflowId: number, limit: number, direction: 'asc' | 'desc'): Promise<Array<{ startedAt: string; dataJson: string }>> {
  const db = await getSharedDb();
  const q = db.selectFrom('workflow_runs').select(['startedAt', 'dataJson'])
    .where('workflowId', '=', workflowId)
    .where('dataJson', 'is not', null)
    .where('status', '=', 'completed')
    .orderBy('startedAt', direction)
    .orderBy('id', direction);
  return (await limitRows(q, getSharedDialect(), limit).execute()) as Array<{ startedAt: string; dataJson: string }>;
}

export async function getWorkflowRunData(workflowId: number, limit = 100): Promise<Array<{ startedAt: string; dataJson: string }>> {
  return completedRunData(workflowId, limit, 'asc');
}

/** Get most recent N completed runs with data (newest first) — used by notification dispatcher */
export async function getWorkflowRunDataRecent(workflowId: number, limit = 1): Promise<Array<{ startedAt: string; dataJson: string }>> {
  return completedRunData(workflowId, limit, 'desc');
}

// --- Credentials ---

export async function listCredentials(): Promise<Omit<WorkflowCredential, 'passwordEnc'>[]> {
  const db = await getSharedDb();
  return (await db.selectFrom('workflow_credentials')
    .select(['id', 'label', 'siteUrl', 'username', 'createdAt'])
    .orderBy('label')
    .execute()) as Omit<WorkflowCredential, 'passwordEnc'>[];
}

export async function getCredential(id: number): Promise<WorkflowCredential | null> {
  const db = await getSharedDb();
  return ((await db.selectFrom('workflow_credentials').selectAll().where('id', '=', id).executeTakeFirst()) as WorkflowCredential | undefined) ?? null;
}

export async function createCredential(data: {
  label: string;
  siteUrl: string;
  username: string;
  passwordEnc: string;
}): Promise<Omit<WorkflowCredential, 'passwordEnc'>> {
  const db = await getSharedDb();
  const row = await insertReturning<WorkflowCredential>(db, getSharedDialect(), 'workflow_credentials', {
    label: data.label,
    siteUrl: data.siteUrl,
    username: data.username,
    passwordEnc: data.passwordEnc,
    createdAt: nowIso(),
  });
  return { id: row.id, label: row.label, siteUrl: row.siteUrl, username: row.username, createdAt: row.createdAt };
}

export async function deleteCredential(id: number): Promise<boolean> {
  const db = await getSharedDb();
  return affectedRows(await db.deleteFrom('workflow_credentials').where('id', '=', id).executeTakeFirst()) > 0;
}

// --- Team Workflows ---

/** List all team-scoped workflows (no userId filter). */
export async function listTeamWorkflows(): Promise<Workflow[]> {
  const db = await getSharedDb();
  return (await db.selectFrom('workflows').selectAll()
    .where('scope', '=', 'team')
    .orderBy('updatedAt', 'desc')
    .execute()).map(toWorkflow);
}

/** List enabled personal workflows for a specific user (used by scheduler on login). */
export async function listPersonalWorkflows(userId: string): Promise<Workflow[]> {
  const db = await getSharedDb();
  return (await db.selectFrom('workflows').selectAll()
    .where('userId', '=', userId)
    .where('scope', '=', 'personal')
    .where('enabled', '=', 1)
    .orderBy('updatedAt', 'desc')
    .execute()).map(toWorkflow);
}

/** List all team workflows enriched with subscriber count, subscription status, owner name, and last claim info. */
export async function listTeamWorkflowsEnriched(currentUserOid?: string): Promise<
  Array<Workflow & { subscriberCount: number; isSubscribed: boolean; ownerName: string | null; lastClaimedBy: string | null }>
> {
  const db = await getSharedDb();
  const dialect = getSharedDialect();
  const rows = await db.selectFrom('workflows as w')
    .leftJoin(`${USERS_TABLE} as u`, 'u.oid', 'w.userId')
    .selectAll('w')
    .select((eb) => [
      eb.selectFrom('workflow_subscriptions as s')
        .select((eb2) => eb2.fn.countAll().as('n'))
        .whereRef('s.workflowId', '=', 'w.id')
        .as('subscriberCount'),
      'u.display_name as ownerName',
      limitRows(
        eb.selectFrom('workflow_claims as c')
          .select('c.claimedBy')
          .whereRef('c.workflowId', '=', 'w.id')
          .orderBy('c.scheduledAt', 'desc'),
        dialect,
        1,
      ).as('lastClaimedBy'),
    ])
    .where('w.scope', '=', 'team')
    .orderBy('w.updatedAt', 'desc')
    .execute();
  const subscribed = currentUserOid ? await subscribedWorkflowIds(currentUserOid) : new Set<number>();
  return rows.map((r) => ({
    ...toWorkflow(r),
    subscriberCount: Number(r.subscriberCount ?? 0),
    isSubscribed: subscribed.has(Number(r.id)),
    ownerName: (r.ownerName ?? null) as string | null,
    lastClaimedBy: (r.lastClaimedBy ?? null) as string | null,
  }));
}

/**
 * Email address of the workflow's owner (the user who created it).
 *
 * Used to address a team workflow's email deterministically. Without this, a
 * scheduled team run mails "the current machine's user", so the recipient
 * changes depending on which teammate's scheduler won the claim.
 */
export async function getWorkflowOwnerEmail(workflowId: number): Promise<string | null> {
  const db = await getSharedDb();
  const row = await db.selectFrom('workflows as w')
    .innerJoin(`${USERS_TABLE} as u`, 'u.oid', 'w.userId')
    .select('u.email as email')
    .where('w.id', '=', workflowId)
    .where('u.email', 'is not', null)
    .executeTakeFirst();
  const email = row?.email;
  return typeof email === 'string' && email.trim() ? email.trim() : null;
}

// --- Workflow State ---

/** Get persistent state JSON for a workflow (used for deduplication). */
export async function getWorkflowState(id: number): Promise<string | null> {
  const db = await getSharedDb();
  const row = await db.selectFrom('workflows').select('stateJson').where('id', '=', id).executeTakeFirst();
  return (row?.stateJson ?? null) as string | null;
}

/** Set persistent state JSON for a workflow. */
export async function setWorkflowState(id: number, stateJson: string | null): Promise<void> {
  const db = await getSharedDb();
  await db.updateTable('workflows').set({ stateJson }).where('id', '=', id).execute();
}
