import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { useTempHiveHome } from '../../../../packages/shared/src/test-utils/hive-home.js';

useTempHiveHome();

const storage = await import('../../../../packages/shared/src/server/storage/index.js');
await import('../workflows/migrations.js');
const { initSharedStorage } = await import('../storage/init.js');
const { USERS_TABLE } = await import('../workflows/db-util.js');
const workflowDb = await import('../workflows/workflow-db.js');
const connectorDb = await import('../workflows/connector-db.js');
const recipeDb = await import('../workflows/recipe-db.js');
const claimDb = await import('../workflows/claim-db.js');
const runTargetDb = await import('../workflows/run-target-db.js');
const subscriptionDb = await import('../workflows/subscription-db.js');
const settingsDb = await import('../workflows/settings-db.js');
const crypto = await import('../workflows/workflow-crypto.js');

const baseWorkflow = {
  name: 'Daily report',
  description: 'desc',
  type: 'api',
  definition: '{"version":1}',
  cronExpression: '0 9 * * *',
};

describe('workflows storage (sqlite)', () => {
  beforeAll(async () => {
    const report = await initSharedStorage();
    expect(report.error).toBeUndefined();

    // Seed the user directory (table owned by admin/migrations.ts).
    const db = await storage.getSharedDb();
    const seen = new Date().toISOString();
    await db.insertInto(USERS_TABLE).values([
      { oid: 'oid-alice', display_name: 'Alice', email: 'Alice@Example.com', role: 'full', first_login: seen, last_login: seen },
      { oid: 'oid-bob', display_name: 'Bob', email: 'bob@example.com', role: 'full', first_login: seen, last_login: seen },
    ]).execute();
  });
  afterAll(async () => {
    await storage.closeSharedDb();
  });

  it('applies workflow migrations idempotently', async () => {
    const again = await initSharedStorage();
    expect(again.error).toBeUndefined();
    expect(again.applied).toEqual([]);
  });

  it('workflows CRUD, state and booleans', async () => {
    const wf = await workflowDb.createWorkflow({ ...baseWorkflow, userId: 'oid-alice' });
    expect(wf.id).toBeTypeOf('number');
    expect(wf.enabled).toBe(true);
    expect(wf.isDistribution).toBe(false);
    expect(wf.scope).toBe('personal');
    expect(wf.maxRunsKept).toBe(50);

    expect((await workflowDb.listWorkflows('oid-alice')).map((w) => w.id)).toContain(wf.id);
    expect(await workflowDb.listWorkflows('oid-bob')).toEqual([]);
    expect(await workflowDb.getWorkflow(wf.id, 'oid-bob')).toBeNull();
    expect((await workflowDb.listPersonalWorkflows('oid-alice')).map((w) => w.id)).toEqual([wf.id]);

    const next = '2026-09-25T09:00:00.000Z';
    const updated = await workflowDb.updateWorkflow(wf.id, { enabled: false, nextRunAt: next, name: 'Renamed' });
    expect(updated?.enabled).toBe(false);
    expect(updated?.nextRunAt).toBe(next);
    expect(updated?.name).toBe('Renamed');
    expect(await workflowDb.listPersonalWorkflows('oid-alice')).toEqual([]);
    expect(await workflowDb.updateWorkflow(99999, { name: 'x' })).toBeNull();

    expect(await workflowDb.getWorkflowState(wf.id)).toBeNull();
    await workflowDb.setWorkflowState(wf.id, '{"seen":[1]}');
    expect(await workflowDb.getWorkflowState(wf.id)).toBe('{"seen":[1]}');

    expect(await workflowDb.getWorkflowOwnerEmail(wf.id)).toBe('Alice@Example.com');

    // Wrong owner cannot delete, and dependents stay intact.
    const run = await workflowDb.insertWorkflowRun({ workflowId: wf.id, status: 'running' });
    expect(await workflowDb.deleteWorkflow(wf.id, 'oid-bob')).toBe(false);
    expect((await workflowDb.listWorkflowRuns(wf.id)).map((r) => r.id)).toEqual([run.id]);
    expect(await workflowDb.deleteWorkflow(wf.id, 'oid-alice')).toBe(true);
    expect(await workflowDb.getWorkflow(wf.id)).toBeNull();
    expect(await workflowDb.listWorkflowRuns(wf.id)).toEqual([]);
  });

  it('workflow runs: insert, update, data queries, prune, notifyError', async () => {
    const wf = await workflowDb.createWorkflow(baseWorkflow);
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const run = await workflowDb.insertWorkflowRun({ workflowId: wf.id, status: 'running' });
      expect(run.status).toBe('running');
      expect(run.startedAt).toMatch(/Z$/);
      await workflowDb.updateWorkflowRun(run.id, {
        status: i === 3 ? 'failed' : 'completed',
        finishedAt: new Date().toISOString(),
        durationMs: 10 + i,
        dataJson: JSON.stringify({ i }),
      });
      ids.push(run.id);
    }
    await workflowDb.recordRunNotifyError(ids[0], 'smtp down');

    const runs = await workflowDb.listWorkflowRuns(wf.id, 10);
    expect(runs.map((r) => r.id)).toEqual([...ids].reverse());
    expect(runs.find((r) => r.id === ids[0])?.notifyError).toBe('smtp down');
    expect(await workflowDb.listWorkflowRuns(wf.id, 2)).toHaveLength(2);

    const asc = await workflowDb.getWorkflowRunData(wf.id);
    expect(asc.map((r) => JSON.parse(r.dataJson).i)).toEqual([0, 1, 2]);
    const recent = await workflowDb.getWorkflowRunDataRecent(wf.id);
    expect(recent.map((r) => JSON.parse(r.dataJson).i)).toEqual([2]);

    await workflowDb.pruneWorkflowRuns(wf.id, 2);
    expect((await workflowDb.listWorkflowRuns(wf.id)).map((r) => r.id)).toEqual([ids[3], ids[2]]);
    await workflowDb.deleteWorkflow(wf.id);
  });

  it('credentials CRUD with encrypted password round trip', async () => {
    const created = await workflowDb.createCredential({
      label: 'Portal',
      siteUrl: 'https://portal.example.com',
      username: 'svc',
      passwordEnc: crypto.encrypt('s3cret!'),
    });
    expect(created).not.toHaveProperty('passwordEnc');
    expect((await workflowDb.listCredentials()).map((c) => c.label)).toContain('Portal');
    const full = await workflowDb.getCredential(created.id);
    expect(full?.passwordEnc).not.toContain('s3cret');
    expect(crypto.decrypt(full!.passwordEnc)).toBe('s3cret!');
    expect(await workflowDb.deleteCredential(created.id)).toBe(true);
    expect(await workflowDb.getCredential(created.id)).toBeNull();
  });

  it('encryption: store-key round trip, plain JSON fallback, foreign key rejected', async () => {
    const blob = crypto.encrypt(JSON.stringify({ webhookUrl: 'https://hooks.example.com/x' }));
    expect(crypto.tryDecryptJson<{ webhookUrl: string }>(blob)?.webhookUrl).toBe('https://hooks.example.com/x');
    expect(crypto.tryDecryptJson<{ useGmail: boolean }>('{"useGmail":true}')?.useGmail).toBe(true);
    expect(crypto.encrypt('same')).not.toBe(crypto.encrypt('same'));

    // A blob made with a different key must not decrypt.
    const nodeCrypto = await import('node:crypto');
    const iv = nodeCrypto.randomBytes(12);
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', nodeCrypto.randomBytes(32), iv);
    const data = Buffer.concat([cipher.update('{"a":1}', 'utf-8'), cipher.final()]);
    const foreign = Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
    expect(() => crypto.decrypt(foreign)).toThrow();
    expect(crypto.tryDecryptJson(foreign)).toBeNull();
  });

  it('connectors CRUD; system connectors are not deletable', async () => {
    const c = await connectorDb.createConnector({ type: 'slack', name: 'Dev channel', config: crypto.encrypt('{}') });
    expect(c.isSystem).toBe(false);
    expect(c.isDefault).toBe(false);
    const sys = await connectorDb.createConnector({ type: 'email', name: 'Email', config: '{"useGmail":true}', isSystem: true, isDefault: true });
    expect(sys.isSystem).toBe(true);
    expect(sys.isDefault).toBe(true);

    expect((await connectorDb.listConnectors()).map((x) => x.name)).toEqual(['Dev channel', 'Email']);
    expect((await connectorDb.getConnectorByName('Dev channel'))?.id).toBe(c.id);
    expect(await connectorDb.getConnectorByName('missing')).toBeNull();

    const upd = await connectorDb.updateConnector(c.id, { name: 'Ops channel', isDefault: true });
    expect(upd?.name).toBe('Ops channel');
    expect(upd?.isDefault).toBe(true);
    expect((await connectorDb.getConnector(c.id))?.isDefault).toBe(true);

    expect(await connectorDb.deleteConnector(sys.id)).toBe(false);
    expect(await connectorDb.deleteConnector(c.id)).toBe(true);
    expect(await connectorDb.getConnector(c.id)).toBeNull();
    expect(await connectorDb.getConnector(sys.id)).not.toBeNull();
  });

  it('recipes CRUD with version bump', async () => {
    const r = await recipeDb.createRecipe({ name: 'Uptime', description: 'd', type: 'monitor', definition: '{}', requiresCredential: true, credentialHint: 'login' });
    expect(r.version).toBe(1);
    expect(r.requiresCredential).toBe(true);
    expect(r.tags).toBeNull();
    const u = await recipeDb.updateRecipe(r.id, { tags: 'ops', requiresCredential: false });
    expect(u?.version).toBe(2);
    expect(u?.tags).toBe('ops');
    expect(u?.requiresCredential).toBe(false);
    expect((await recipeDb.listRecipes()).map((x) => x.id)).toContain(r.id);
    expect((await recipeDb.getRecipe(r.id))?.version).toBe(2);
    expect(await recipeDb.deleteRecipe(r.id)).toBe(true);
    expect(await recipeDb.getRecipe(r.id)).toBeNull();
  });

  it('claims: at most once per (workflow, period)', async () => {
    const wf = await workflowDb.createWorkflow({ ...baseWorkflow, scope: 'team', userId: 'oid-alice' });
    const slot = '2026-09-24T00:00:00';
    expect(await claimDb.tryClaim(wf.id, slot, 'host-a')).toEqual({ claimed: true });
    expect(await claimDb.tryClaim(wf.id, slot, 'host-b')).toEqual({ claimed: false });
    // Equivalent instants in different spellings are the same slot.
    expect(await claimDb.tryClaim(wf.id, '2026-09-24T09:00:00Z', 'host-a')).toEqual({ claimed: true });
    expect(await claimDb.tryClaim(wf.id, '2026-09-24T09:00:00.000Z', 'host-b')).toEqual({ claimed: false });

    await claimDb.updateClaim(wf.id, slot, 'completed', 42);
    const last = await claimDb.getLastClaim(wf.id);
    expect(last?.scheduledAt).toBe('2026-09-24T09:00:00.000Z');
    expect(last?.claimedBy).toBe('host-a');

    const enriched = (await workflowDb.listTeamWorkflowsEnriched('oid-bob')).find((w) => w.id === wf.id);
    expect(enriched?.lastClaimedBy).toBe('host-a');
    expect(enriched?.ownerName).toBe('Alice');
    expect(enriched?.subscriberCount).toBe(0);
    expect(enriched?.isSubscribed).toBe(false);
    expect((await workflowDb.listTeamWorkflows()).map((w) => w.id)).toContain(wf.id);

    // Releasing re-opens the slot.
    await claimDb.releaseClaim(wf.id, slot);
    expect(await claimDb.tryClaim(wf.id, slot, 'host-b')).toEqual({ claimed: true });

    const db = await storage.getSharedDb();
    await db.insertInto('workflow_claims').values({ workflowId: wf.id, scheduledAt: '2020-01-01T00:00:00.000Z', claimedBy: 'old', claimedAt: 'x', status: 'completed' }).execute();
    await claimDb.pruneOldClaims(wf.id, 30);
    const remaining = await db.selectFrom('workflow_claims').select('claimedBy').where('workflowId', '=', wf.id).execute();
    expect(remaining.map((r) => r.claimedBy).sort()).toEqual(['host-a', 'host-b']);

    await claimDb.deleteClaimsForWorkflow(wf.id);
    expect(await claimDb.getLastClaim(wf.id)).toBeNull();
    await workflowDb.deleteWorkflow(wf.id);
  });

  it('run targets: empty = everyone, otherwise matched by email', async () => {
    const wf = await workflowDb.createWorkflow({ ...baseWorkflow, scope: 'team' });
    expect(await runTargetDb.listRunTargets(wf.id)).toEqual([]);
    expect(await runTargetDb.isInstanceAllowed(wf.id, undefined)).toBe(true);

    await runTargetDb.setRunTargets(wf.id, [' oid-alice ', 'oid-alice', '']);
    expect(await runTargetDb.listRunTargets(wf.id)).toEqual(['oid-alice']);
    expect(await runTargetDb.isInstanceAllowed(wf.id, 'alice@example.COM')).toBe(true);
    expect(await runTargetDb.isInstanceAllowed(wf.id, 'bob@example.com')).toBe(false);
    expect(await runTargetDb.isInstanceAllowed(wf.id, undefined)).toBe(false);

    expect((await runTargetDb.listCandidateMembers()).map((m) => m.displayName)).toEqual(['Alice', 'Bob']);

    await runTargetDb.setRunTargets(wf.id, []);
    expect(await runTargetDb.isInstanceAllowed(wf.id, 'bob@example.com')).toBe(true);
    await runTargetDb.setRunTargets(wf.id, ['oid-bob']);
    await runTargetDb.deleteRunTargetsForWorkflow(wf.id);
    expect(await runTargetDb.listRunTargets(wf.id)).toEqual([]);
    await workflowDb.deleteWorkflow(wf.id);
  });

  it('subscriptions: internal + external, idempotent, deduped', async () => {
    const wf = await workflowDb.createWorkflow({ ...baseWorkflow, scope: 'team', isDistribution: true, userId: 'oid-bob' });
    await subscriptionDb.subscribe(wf.id, 'oid-alice');
    await subscriptionDb.subscribe(wf.id, 'oid-alice');
    expect(await subscriptionDb.isSubscribed(wf.id, 'oid-alice')).toBe(true);
    expect(await subscriptionDb.isSubscribed(wf.id, 'oid-bob')).toBe(false);

    await subscriptionDb.addExternalEmail(wf.id, ' partner@example.org ', 'oid-bob');
    await subscriptionDb.addExternalEmail(wf.id, 'PARTNER@example.org', 'oid-bob');
    await subscriptionDb.addExternalEmail(wf.id, 'alice@example.com', null); // same as an internal user
    await expect(subscriptionDb.addExternalEmail(wf.id, 'not-an-email', null)).rejects.toThrow(/Invalid email/);

    const external = await subscriptionDb.listExternalEmails(wf.id);
    expect(external.map((e) => e.email).sort()).toEqual(['alice@example.com', 'partner@example.org']);
    expect(await subscriptionDb.getSubscriberCount(wf.id)).toBe(3);
    expect((await subscriptionDb.getSubscriberEmails(wf.id)).map((e) => e.toLowerCase()).sort())
      .toEqual(['alice@example.com', 'partner@example.org']);

    const dist = (await subscriptionDb.listDistributions('oid-alice')).find((w) => w.id === wf.id);
    expect(dist?.isSubscribed).toBe(true);
    expect(dist?.isDistribution).toBe(true);
    expect(dist?.subscriberCount).toBe(1);
    expect(dist?.ownerName).toBe('Bob');
    expect((await subscriptionDb.listDistributions()).find((w) => w.id === wf.id)?.isSubscribed).toBe(false);

    await subscriptionDb.removeExternalEmail(wf.id, 'Partner@Example.org');
    await subscriptionDb.unsubscribe(wf.id, 'oid-alice');
    expect(await subscriptionDb.getSubscriberCount(wf.id)).toBe(1);
    await subscriptionDb.deleteSubscriptionsForWorkflow(wf.id);
    expect(await subscriptionDb.getSubscriberCount(wf.id)).toBe(0);
    expect(await workflowDb.deleteWorkflow(wf.id)).toBe(true);
  });

  it('settings get/set with cache', async () => {
    expect(await settingsDb.getSetting('relay.key')).toBeNull();
    await settingsDb.setSetting('relay.key', 'abc');
    expect(await settingsDb.getSetting('relay.key')).toBe('abc');
    await settingsDb.setSetting('relay.key', 'def');
    settingsDb.clearSettingsCache();
    expect(await settingsDb.getSetting('relay.key')).toBe('def');
  });
});
