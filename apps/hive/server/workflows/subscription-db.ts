import { getSharedDb, nowIso } from '../../../../packages/shared/src/server/storage/index.js';
import { USERS_TABLE, isUniqueViolation, toBool } from './db-util.js';
import type { Workflow } from './types.js';

/** List all distribution workflows with subscriber count and current user's subscription status. */
export async function listDistributions(currentUserOid?: string): Promise<
  Array<Workflow & { subscriberCount: number; isSubscribed: boolean; ownerName: string | null }>
> {
  const db = await getSharedDb();
  const rows = await db.selectFrom('workflows as w')
    .leftJoin(`${USERS_TABLE} as u`, 'u.oid', 'w.userId')
    .selectAll('w')
    .select((eb) => [
      eb.selectFrom('workflow_subscriptions as s')
        .select((eb2) => eb2.fn.countAll().as('n'))
        .whereRef('s.workflowId', '=', 'w.id')
        .as('subscriberCount'),
      'u.display_name as ownerName',
    ])
    .where('w.isDistribution', '=', 1)
    .orderBy('w.updatedAt', 'desc')
    .execute();
  const subscribed = currentUserOid ? await subscribedWorkflowIds(currentUserOid) : new Set<number>();
  return rows.map((r) => ({
    ...r,
    enabled: toBool(r.enabled),
    isDistribution: toBool(r.isDistribution),
    subscriberCount: Number(r.subscriberCount ?? 0),
    isSubscribed: subscribed.has(Number(r.id)),
    ownerName: (r.ownerName ?? null) as string | null,
  })) as Array<Workflow & { subscriberCount: number; isSubscribed: boolean; ownerName: string | null }>;
}

/** Ids of every workflow `userOid` is subscribed to. */
export async function subscribedWorkflowIds(userOid: string): Promise<Set<number>> {
  const db = await getSharedDb();
  const rows = await db.selectFrom('workflow_subscriptions').select('workflowId').where('userOid', '=', userOid).execute();
  return new Set(rows.map((r) => Number(r.workflowId)));
}

/** Subscribe a user to a distribution workflow. Idempotent. */
export async function subscribe(workflowId: number, userOid: string): Promise<void> {
  if (await isSubscribed(workflowId, userOid)) return;
  const db = await getSharedDb();
  try {
    await db.insertInto('workflow_subscriptions').values({ workflowId, userOid, subscribedAt: nowIso() }).execute();
  } catch (err) {
    // Lost a race with a concurrent subscribe — already subscribed.
    if (!isUniqueViolation(err)) throw err;
  }
}

/** Unsubscribe a user from a distribution workflow. */
export async function unsubscribe(workflowId: number, userOid: string): Promise<void> {
  const db = await getSharedDb();
  await db.deleteFrom('workflow_subscriptions').where('workflowId', '=', workflowId).where('userOid', '=', userOid).execute();
}

/**
 * Get email addresses of all subscribers for a distribution workflow.
 * Unions internal Hive users (via workflow_subscriptions) with externally-added
 * emails (workflow_external_subscribers). Dedupes case-insensitively so an
 * external email matching an internal user's email only sends one copy.
 */
export async function getSubscriberEmails(workflowId: number): Promise<string[]> {
  const db = await getSharedDb();
  const internal = await db.selectFrom('workflow_subscriptions as s')
    .innerJoin(`${USERS_TABLE} as u`, 'u.oid', 's.userOid')
    .select('u.email as email')
    .where('s.workflowId', '=', workflowId)
    .where('u.email', 'is not', null)
    .execute();
  const external = await db.selectFrom('workflow_external_subscribers')
    .select('email')
    .where('workflowId', '=', workflowId)
    .execute();
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const row of [...internal, ...external] as { email: string | null }[]) {
    const trimmed = (row.email ?? '').trim();
    const lower = trimmed.toLowerCase();
    if (!lower || seen.has(lower)) continue;
    seen.add(lower);
    emails.push(trimmed);
  }
  return emails;
}

/** Get subscriber count (internal + external) for a workflow. */
export async function getSubscriberCount(workflowId: number): Promise<number> {
  const db = await getSharedDb();
  const count = async (table: string) => {
    const row = await db.selectFrom(table)
      .select((eb) => eb.fn.countAll().as('n'))
      .where('workflowId', '=', workflowId)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  };
  return (await count('workflow_subscriptions')) + (await count('workflow_external_subscribers'));
}

// ── External subscribers ──

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Add an external email subscriber. Idempotent (case-insensitive on email). */
export async function addExternalEmail(
  workflowId: number,
  email: string,
  addedByOid: string | null,
): Promise<void> {
  const trimmed = email.trim();
  if (!EMAIL_RE.test(trimmed)) throw new Error(`Invalid email address: ${email}`);
  const db = await getSharedDb();
  const existing = await db.selectFrom('workflow_external_subscribers').select('id')
    .where('workflowId', '=', workflowId)
    .where((eb) => eb(eb.fn('lower', ['email']), '=', trimmed.toLowerCase()))
    .executeTakeFirst();
  if (existing) return;
  try {
    await db.insertInto('workflow_external_subscribers')
      .values({ workflowId, email: trimmed, addedByOid, addedAt: nowIso() })
      .execute();
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
}

/** Remove an external email subscriber (case-insensitive match). */
export async function removeExternalEmail(workflowId: number, email: string): Promise<void> {
  const db = await getSharedDb();
  await db.deleteFrom('workflow_external_subscribers')
    .where('workflowId', '=', workflowId)
    .where((eb) => eb(eb.fn('lower', ['email']), '=', email.trim().toLowerCase()))
    .execute();
}

/** List external email subscribers for a workflow. */
export async function listExternalEmails(
  workflowId: number,
): Promise<Array<{ email: string; addedByOid: string | null; addedAt: string }>> {
  const db = await getSharedDb();
  return (await db.selectFrom('workflow_external_subscribers')
    .select(['email', 'addedByOid', 'addedAt'])
    .where('workflowId', '=', workflowId)
    .orderBy('addedAt', 'desc')
    .orderBy('id', 'desc')
    .execute()) as Array<{ email: string; addedByOid: string | null; addedAt: string }>;
}

/** Check if a specific user is subscribed. */
export async function isSubscribed(workflowId: number, userOid: string): Promise<boolean> {
  const db = await getSharedDb();
  const row = await db.selectFrom('workflow_subscriptions').select('id')
    .where('workflowId', '=', workflowId).where('userOid', '=', userOid)
    .executeTakeFirst();
  return !!row;
}

/** Delete all subscriptions (internal + external) for a workflow. Used when deleting the workflow. */
export async function deleteSubscriptionsForWorkflow(workflowId: number): Promise<void> {
  const db = await getSharedDb();
  await db.deleteFrom('workflow_subscriptions').where('workflowId', '=', workflowId).execute();
  await db.deleteFrom('workflow_external_subscribers').where('workflowId', '=', workflowId).execute();
}
