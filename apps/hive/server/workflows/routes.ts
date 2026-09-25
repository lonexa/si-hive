import type http from 'node:http';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import * as db from './workflow-db.js';
import * as connectorDb from './connector-db.js';
import * as recipeDb from './recipe-db.js';
import * as subscriptionDb from './subscription-db.js';
import * as runTargetDb from './run-target-db.js';
import { generateWorkflowDefinition } from './workflow-ai.js';
import { encrypt, tryDecryptJson, undecryptableConfigMessage } from './workflow-crypto.js';
import { WORKFLOW_TEMPLATES } from './templates.js';
import type { WorkflowScheduler } from './workflow-scheduler.js';
import type { ConnectorType } from './types.js';
import type { AuthenticatedRequest } from '../auth/types.js';

export function handleWorkflowRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  scheduler: WorkflowScheduler,
): boolean {
  const userId = (req as AuthenticatedRequest).user?.oid;

  // --- Distribution routes ---

  // GET /api/distributions — list all distribution workflows (visible to all users)
  if (url.pathname === '/api/distributions' && req.method === 'GET') {
    subscriptionDb.listDistributions(userId).then((distributions) => {
      sendJson(res, 200, { distributions });
    }).catch((err) => {
      sendJson(res, 500, { error: String(err) });
    });
    return true;
  }

  // POST /api/distributions/:id/subscribe
  const subMatch = /^\/api\/distributions\/(\d+)\/subscribe$/.exec(url.pathname);
  if (subMatch && req.method === 'POST') {
    const id = parseInt(subMatch[1]);
    if (!userId) { sendJson(res, 401, { error: 'Authentication required' }); return true; }
    subscriptionDb.subscribe(id, userId).then(() => {
      sendJson(res, 200, { ok: true });
    }).catch((err) => {
      sendJson(res, 500, { error: String(err) });
    });
    return true;
  }

  // POST /api/distributions/:id/unsubscribe
  const unsubMatch = /^\/api\/distributions\/(\d+)\/unsubscribe$/.exec(url.pathname);
  if (unsubMatch && req.method === 'POST') {
    const id = parseInt(unsubMatch[1]);
    if (!userId) { sendJson(res, 401, { error: 'Authentication required' }); return true; }
    subscriptionDb.unsubscribe(id, userId).then(() => {
      sendJson(res, 200, { ok: true });
    }).catch((err) => {
      sendJson(res, 500, { error: String(err) });
    });
    return true;
  }

  // GET /api/distributions/:id/subscribers — subscriber count (owner sees full list + externals)
  const subsListMatch = /^\/api\/distributions\/(\d+)\/subscribers$/.exec(url.pathname);
  if (subsListMatch && req.method === 'GET') {
    const id = parseInt(subsListMatch[1]);
    (async () => {
      try {
        const count = await subscriptionDb.getSubscriberCount(id);
        const workflow = await db.getWorkflow(id);
        if (workflow && workflow.userId === userId) {
          const emails = await subscriptionDb.getSubscriberEmails(id);
          const externals = await subscriptionDb.listExternalEmails(id);
          sendJson(res, 200, { count, emails, externals });
        } else {
          sendJson(res, 200, { count });
        }
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // POST /api/distributions/:id/external-subscribers — owner adds an external email
  const extAddMatch = /^\/api\/distributions\/(\d+)\/external-subscribers$/.exec(url.pathname);
  if (extAddMatch && req.method === 'POST') {
    const id = parseInt(extAddMatch[1]);
    (async () => {
      try {
        const workflow = await db.getWorkflow(id);
        if (!workflow) { sendJson(res, 404, { error: 'Workflow not found' }); return; }
        if (workflow.userId !== userId) { sendJson(res, 403, { error: 'Only the workflow owner can add subscribers' }); return; }
        const body = await readBody(req);
        const { email } = JSON.parse(body) as { email?: string };
        if (!email || typeof email !== 'string') { sendJson(res, 400, { error: 'email required' }); return; }
        await subscriptionDb.addExternalEmail(id, email, userId ?? null);
        sendJson(res, 200, { ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 400, { error: msg });
      }
    })();
    return true;
  }

  // DELETE /api/distributions/:id/external-subscribers?email=foo@bar — owner removes an external email
  const extDelMatch = /^\/api\/distributions\/(\d+)\/external-subscribers$/.exec(url.pathname);
  if (extDelMatch && req.method === 'DELETE') {
    const id = parseInt(extDelMatch[1]);
    (async () => {
      try {
        const workflow = await db.getWorkflow(id);
        if (!workflow) { sendJson(res, 404, { error: 'Workflow not found' }); return; }
        if (workflow.userId !== userId) { sendJson(res, 403, { error: 'Only the workflow owner can remove subscribers' }); return; }
        const email = url.searchParams.get('email');
        if (!email) { sendJson(res, 400, { error: 'email query param required' }); return; }
        await subscriptionDb.removeExternalEmail(id, email);
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // --- Workflow routes ---

  // GET /api/workflows/templates
  if (url.pathname === '/api/workflows/templates' && req.method === 'GET') {
    sendJson(res, 200, { templates: WORKFLOW_TEMPLATES });
    return true;
  }

  // GET /api/workflows/automations — built-in action catalog (Team Workflow automations)
  if (url.pathname === '/api/workflows/automations' && req.method === 'GET') {
    (async () => {
      try {
        const { listBuiltinActions } = await import('./actions/index.js');
        sendJson(res, 200, { automations: listBuiltinActions() });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // POST /api/workflows/generate — AI: interpret description → draft definition
  if (url.pathname === '/api/workflows/generate' && req.method === 'POST') {
    (async () => {
      try {
        const body = await readBody(req);
        const { description } = JSON.parse(body) as { description: string };
        if (!description) { sendJson(res, 400, { error: 'description required' }); return; }
        const result = await generateWorkflowDefinition(description);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // GET /api/workflows — returns personal workflows + enriched team workflows as separate arrays
  if (url.pathname === '/api/workflows' && req.method === 'GET') {
    (async () => {
      try {
        const [personal, teamWorkflows] = await Promise.all([
          db.listWorkflows(userId),
          db.listTeamWorkflowsEnriched(userId),
        ]);
        // Filter personal list to only scope='personal' (exclude team workflows the user created)
        const personalOnly = personal.filter(w => w.scope !== 'team');
        sendJson(res, 200, { workflows: personalOnly, teamWorkflows });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // POST /api/workflows
  if (url.pathname === '/api/workflows' && req.method === 'POST') {
    (async () => {
      try {
        const body = await readBody(req);
        const data = JSON.parse(body) as {
          name: string; description: string; type: string;
          templateId?: string; definition: unknown; cronExpression: string;
          scope?: 'personal' | 'team';
          isDistribution?: boolean;
          publishAsRecipe?: boolean;
        };
        if (!data.name || !data.definition || !data.cronExpression) {
          sendJson(res, 400, { error: 'name, definition, and cronExpression required' });
          return;
        }
        // Determine scope: explicit scope > isDistribution implies team > default personal
        const scope = data.scope || (data.isDistribution ? 'team' as const : 'personal' as const);
        const definitionStr = typeof data.definition === 'string' ? data.definition : JSON.stringify(data.definition);
        const workflow = await db.createWorkflow({
          ...data,
          userId,
          definition: definitionStr,
          scope,
          isDistribution: data.isDistribution,
        });
        // Arm in scheduler
        scheduler.armWorkflow(workflow);

        // If publishAsRecipe, also create a recipe entry
        let recipeId: number | undefined;
        if (data.publishAsRecipe) {
          const defObj = JSON.parse(definitionStr);
          delete defObj.notify;
          delete defObj.credentialId;
          const recipe = await recipeDb.createRecipe({
            name: data.name,
            description: data.description,
            type: data.type,
            definition: JSON.stringify(defObj),
          });
          recipeId = recipe.id;
        }

        sendJson(res, 201, { ...workflow, recipeId });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // Routes with :id
  const idMatch = /^\/api\/workflows\/(\d+)$/.exec(url.pathname);
  const runsMatch = /^\/api\/workflows\/(\d+)\/runs$/.exec(url.pathname);
  const dataMatch = /^\/api\/workflows\/(\d+)\/data$/.exec(url.pathname);
  const runMatch = /^\/api\/workflows\/(\d+)\/run$/.exec(url.pathname);
  const toggleMatch = /^\/api\/workflows\/(\d+)\/toggle$/.exec(url.pathname);
  const runTargetsMatch = /^\/api\/workflows\/(\d+)\/run-targets$/.exec(url.pathname);

  // GET /api/workflows/:id
  if (idMatch && req.method === 'GET') {
    const id = parseInt(idMatch[1]);
    (async () => {
      try {
        // Try user-owned first, then check if it's a team workflow
        let workflow = await db.getWorkflow(id, userId);
        if (!workflow) {
          const teamWf = await db.getWorkflow(id);
          if (teamWf && teamWf.scope === 'team') workflow = teamWf;
        }
        if (!workflow) { sendJson(res, 404, { error: 'Not found' }); return; }
        const runs = await db.listWorkflowRuns(id, 10);

        // Enrich team workflows with subscription and claim info
        let enrichment = {};
        if (workflow.scope === 'team') {
          const [subCount, isSub, claimDb] = await Promise.all([
            subscriptionDb.getSubscriberCount(id),
            userId ? subscriptionDb.isSubscribed(id, userId) : Promise.resolve(false),
            import('./claim-db.js'),
          ]);
          const lastClaim = await claimDb.getLastClaim(id);
          enrichment = {
            subscriberCount: subCount,
            isSubscribed: isSub,
            lastClaimedBy: lastClaim?.claimedBy ?? null,
          };
        }

        sendJson(res, 200, { ...workflow, ...enrichment, recentRuns: runs });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // PUT /api/workflows/:id
  if (idMatch && req.method === 'PUT') {
    const id = parseInt(idMatch[1]);
    (async () => {
      try {
        // Verify ownership
        const existing = await db.getWorkflow(id, userId);
        if (!existing) { sendJson(res, 404, { error: 'Not found' }); return; }
        const body = await readBody(req);
        const data = JSON.parse(body);
        if (data.definition && typeof data.definition !== 'string') {
          data.definition = JSON.stringify(data.definition);
        }
        const workflow = await db.updateWorkflow(id, data);
        if (!workflow) { sendJson(res, 404, { error: 'Not found' }); return; }
        // Re-arm if enabled
        if (workflow.enabled) scheduler.armWorkflow(workflow);
        else scheduler.disarm(workflow.id);
        sendJson(res, 200, workflow);
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // DELETE /api/workflows/:id
  if (idMatch && req.method === 'DELETE') {
    const id = parseInt(idMatch[1]);
    scheduler.disarm(id);
    db.deleteWorkflow(id, userId).then(async (ok) => {
      if (ok) {
        // Best-effort cleanup of the run-target allow-list (separate table; ignore errors).
        await runTargetDb.deleteRunTargetsForWorkflow(id).catch(() => { /* ignore */ });
      }
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Not found' });
    }).catch((err) => {
      sendJson(res, 500, { error: String(err) });
    });
    return true;
  }

  // POST /api/workflows/:id/run — trigger immediate run
  if (runMatch && req.method === 'POST') {
    const id = parseInt(runMatch[1]);
    (async () => {
      try {
        // Allow any user to trigger team workflows; personal requires ownership
        let workflow = await db.getWorkflow(id, userId);
        if (!workflow) {
          const teamWf = await db.getWorkflow(id);
          if (teamWf && teamWf.scope === 'team') workflow = teamWf;
        }
        if (!workflow) { sendJson(res, 404, { error: 'Not found' }); return; }
        await scheduler.triggerRun(id);
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // POST /api/workflows/:id/toggle — enable/disable
  if (toggleMatch && req.method === 'POST') {
    const id = parseInt(toggleMatch[1]);
    (async () => {
      try {
        // Allow any user to toggle team workflows; personal requires ownership
        let workflow = await db.getWorkflow(id, userId);
        if (!workflow) {
          const teamWf = await db.getWorkflow(id);
          if (teamWf && teamWf.scope === 'team') workflow = teamWf;
        }
        if (!workflow) { sendJson(res, 404, { error: 'Not found' }); return; }
        const updated = await db.updateWorkflow(id, { enabled: !workflow.enabled });
        if (updated?.enabled) scheduler.armWorkflow(updated);
        else scheduler.disarm(id);
        sendJson(res, 200, updated);
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // GET /api/workflows/:id/run-targets — owner-only: candidate members + current selection.
  // Returns 403 to non-owners so the UI panel hides itself (mirrors external-subscribers).
  if (runTargetsMatch && req.method === 'GET') {
    const id = parseInt(runTargetsMatch[1]);
    (async () => {
      try {
        const workflow = await db.getWorkflow(id);
        if (!workflow) { sendJson(res, 404, { error: 'Workflow not found' }); return; }
        if (workflow.scope !== 'team') { sendJson(res, 400, { error: 'Run targets apply to team workflows only' }); return; }
        if (workflow.userId !== userId) { sendJson(res, 403, { error: 'Only the workflow owner can view run targets' }); return; }
        const [members, selected] = await Promise.all([
          runTargetDb.listCandidateMembers(),
          runTargetDb.listRunTargets(id),
        ]);
        // "Online" = a heartbeat within the last 150s (tolerates one missed 60s beat).
        const now = Date.now();
        const enriched = members.map(m => ({
          ...m,
          isOnline: m.lastHeartbeatAt ? (now - new Date(m.lastHeartbeatAt).getTime()) < 150_000 : false,
        }));
        sendJson(res, 200, { members: enriched, selected });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // PUT /api/workflows/:id/run-targets — owner-only: replace the selected member set.
  // Body: { userOids: string[] }. Empty array = every member is eligible (default).
  if (runTargetsMatch && req.method === 'PUT') {
    const id = parseInt(runTargetsMatch[1]);
    (async () => {
      try {
        const workflow = await db.getWorkflow(id);
        if (!workflow) { sendJson(res, 404, { error: 'Workflow not found' }); return; }
        if (workflow.scope !== 'team') { sendJson(res, 400, { error: 'Run targets apply to team workflows only' }); return; }
        if (workflow.userId !== userId) { sendJson(res, 403, { error: 'Only the workflow owner can change run targets' }); return; }
        const body = await readBody(req);
        const { userOids } = JSON.parse(body) as { userOids?: unknown };
        if (!Array.isArray(userOids) || userOids.some(o => typeof o !== 'string')) {
          sendJson(res, 400, { error: 'userOids must be an array of strings' });
          return;
        }
        await runTargetDb.setRunTargets(id, userOids as string[]);
        sendJson(res, 200, { ok: true, selected: userOids });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // GET /api/workflows/:id/runs
  if (runsMatch && req.method === 'GET') {
    const id = parseInt(runsMatch[1]);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    (async () => {
      try {
        const workflow = await db.getWorkflow(id, userId);
        if (!workflow) { sendJson(res, 404, { error: 'Not found' }); return; }
        const runs = await db.listWorkflowRuns(id, limit);
        sendJson(res, 200, { runs });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // GET /api/workflows/:id/data — aggregated data for charts
  if (dataMatch && req.method === 'GET') {
    const id = parseInt(dataMatch[1]);
    (async () => {
      try {
        const workflow = await db.getWorkflow(id, userId);
        if (!workflow) { sendJson(res, 404, { error: 'Not found' }); return; }
        const rows = await db.getWorkflowRunData(id);
        const dataPoints = rows.map(r => {
          try {
            return { timestamp: r.startedAt, ...JSON.parse(r.dataJson) };
          } catch {
            return { timestamp: r.startedAt };
          }
        });
        sendJson(res, 200, { data: dataPoints });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // --- Credentials ---

  // POST /api/workflow-credentials
  if (url.pathname === '/api/workflow-credentials' && req.method === 'POST') {
    (async () => {
      try {
        const body = await readBody(req);
        const data = JSON.parse(body) as { label: string; siteUrl: string; username: string; password: string };
        if (!data.label || !data.username || !data.password) {
          sendJson(res, 400, { error: 'label, username, and password required' });
          return;
        }
        const passwordEnc = encrypt(data.password);
        const cred = await db.createCredential({ ...data, passwordEnc });
        sendJson(res, 201, cred);
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // GET /api/workflow-credentials
  if (url.pathname === '/api/workflow-credentials' && req.method === 'GET') {
    db.listCredentials().then((creds) => {
      sendJson(res, 200, { credentials: creds });
    }).catch((err) => {
      sendJson(res, 500, { error: String(err) });
    });
    return true;
  }

  // DELETE /api/workflow-credentials/:id
  const credMatch = /^\/api\/workflow-credentials\/(\d+)$/.exec(url.pathname);
  if (credMatch && req.method === 'DELETE') {
    const id = parseInt(credMatch[1]);
    db.deleteCredential(id).then((ok) => {
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Not found' });
    }).catch((err) => {
      sendJson(res, 500, { error: String(err) });
    });
    return true;
  }

  // --- Connectors ---

  // GET /api/connectors
  if (url.pathname === '/api/connectors' && req.method === 'GET') {
    connectorDb.listConnectors().then((connectors) => {
      // Strip encrypted config, return only metadata
      const safe = connectors.map(c => ({
        id: c.id,
        type: c.type,
        name: c.name,
        isSystem: c.isSystem,
        isDefault: c.isDefault,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }));
      sendJson(res, 200, { connectors: safe });
    }).catch((err) => {
      sendJson(res, 500, { error: String(err) });
    });
    return true;
  }

  // POST /api/connectors
  if (url.pathname === '/api/connectors' && req.method === 'POST') {
    (async () => {
      try {
        const body = await readBody(req);
        const data = JSON.parse(body) as {
          type: ConnectorType;
          name: string;
          config: Record<string, unknown>;
          isDefault?: boolean;
        };
        if (!data.type || !data.name || !data.config) {
          sendJson(res, 400, { error: 'type, name, and config required' });
          return;
        }
        const encConfig = encrypt(JSON.stringify(data.config));
        const connector = await connectorDb.createConnector({
          type: data.type,
          name: data.name,
          config: encConfig,
          isDefault: data.isDefault,
        });
        sendJson(res, 201, {
          id: connector.id,
          type: connector.type,
          name: connector.name,
          isSystem: connector.isSystem,
          isDefault: connector.isDefault,
          createdAt: connector.createdAt,
        });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // POST /api/connectors/system-email — set/update the system email connector
  if (url.pathname === '/api/connectors/system-email' && req.method === 'POST') {
    (async () => {
      try {
        const existing = await connectorDb.getConnectorByName('Gmail');
        const encConfig = encrypt(JSON.stringify({ useGmail: true }));
        if (existing) {
          await connectorDb.updateConnector(existing.id, { config: encConfig });
        } else {
          await connectorDb.createConnector({
            type: 'email',
            name: 'Gmail',
            config: encConfig,
            isSystem: true,
            isDefault: true,
          });
        }
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // DELETE /api/connectors/:id
  const connectorDeleteMatch = /^\/api\/connectors\/(\d+)$/.exec(url.pathname);
  if (connectorDeleteMatch && req.method === 'DELETE') {
    const id = parseInt(connectorDeleteMatch[1]);
    connectorDb.deleteConnector(id).then((ok) => {
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Not found or is system connector' });
    }).catch((err) => {
      sendJson(res, 500, { error: String(err) });
    });
    return true;
  }

  // PUT /api/connectors/:id
  const connectorUpdateMatch = /^\/api\/connectors\/(\d+)$/.exec(url.pathname);
  if (connectorUpdateMatch && req.method === 'PUT') {
    const id = parseInt(connectorUpdateMatch[1]);
    (async () => {
      try {
        const body = await readBody(req);
        const data = JSON.parse(body) as { name?: string; config?: Record<string, unknown>; isDefault?: boolean };
        const updates: Parameters<typeof connectorDb.updateConnector>[1] = {};
        if (data.name) updates.name = data.name;
        if (data.config) updates.config = encrypt(JSON.stringify(data.config));
        if (data.isDefault !== undefined) updates.isDefault = data.isDefault;
        const result = await connectorDb.updateConnector(id, updates);
        if (!result) { sendJson(res, 404, { error: 'Not found' }); return; }
        sendJson(res, 200, {
          id: result.id,
          type: result.type,
          name: result.name,
          isSystem: result.isSystem,
          isDefault: result.isDefault,
        });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // POST /api/connectors/:id/test — test a connector by sending a test message
  const connectorTestMatch = /^\/api\/connectors\/(\d+)\/test$/.exec(url.pathname);
  if (connectorTestMatch && req.method === 'POST') {
    const id = parseInt(connectorTestMatch[1]);
    (async () => {
      try {
        const connector = await connectorDb.getConnector(id);
        if (!connector) { sendJson(res, 404, { error: 'Not found' }); return; }

        // Null when the connector was created on a different machine (host-derived
        // crypto key + shared [Hive].[Connectors]). Email doesn't use the config;
        // every other channel needs it, so fail with an actionable message.
        const connectorConfig = tryDecryptJson<Record<string, unknown>>(connector.config);
        if (!connectorConfig && connector.type !== 'email') {
          sendJson(res, 400, { error: undecryptableConfigMessage(connector.name) });
          return;
        }

        const testData = [{ timestamp: new Date().toISOString(), test: 'Hello from SI Hive!' }];
        const testDirective = { connector: connector.name, template: 'summary_text' as const, lookbackRuns: 1, message: 'This is a test notification.' };

        // Use the appropriate handler directly
        switch (connector.type) {
          case 'slack': {
            const { sendSlackNotification } = await import('./connectors/slack-handler.js');
            await sendSlackNotification('Test Workflow', testData, testDirective, connectorConfig as never);
            break;
          }
          case 'google-chat': {
            const { sendGoogleChatNotification } = await import('./connectors/google-chat-handler.js');
            await sendGoogleChatNotification('Test Workflow', testData, testDirective, connectorConfig as never);
            break;
          }
          case 'webhook': {
            const { sendWebhookNotification } = await import('./connectors/webhook-handler.js');
            await sendWebhookNotification('Test Workflow', testData, testDirective, connectorConfig as never);
            break;
          }
          case 'email':
            // Email test requires config/saveConfig — can't easily do here without refactor
            sendJson(res, 200, { ok: true, message: 'Email connector uses Gmail OAuth. Send a test workflow run to verify.' });
            return;
        }
        sendJson(res, 200, { ok: true, message: 'Test notification sent' });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // --- Recipes ---

  // GET /api/workflow-recipes
  if (url.pathname === '/api/workflow-recipes' && req.method === 'GET') {
    recipeDb.listRecipes().then((recipes) => {
      sendJson(res, 200, { recipes });
    }).catch((err) => {
      sendJson(res, 500, { error: String(err) });
    });
    return true;
  }

  // POST /api/workflow-recipes
  if (url.pathname === '/api/workflow-recipes' && req.method === 'POST') {
    (async () => {
      try {
        const body = await readBody(req);
        const data = JSON.parse(body) as {
          name: string; description: string; type: string; definition: unknown;
          tags?: string; author?: string; requiresCredential?: boolean; credentialHint?: string;
        };
        if (!data.name || !data.definition) {
          sendJson(res, 400, { error: 'name and definition required' });
          return;
        }
        const recipe = await recipeDb.createRecipe({
          ...data,
          definition: typeof data.definition === 'string' ? data.definition : JSON.stringify(data.definition),
        });
        sendJson(res, 201, recipe);
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // GET /api/workflow-recipes/:id
  const recipeGetMatch = /^\/api\/workflow-recipes\/(\d+)$/.exec(url.pathname);
  if (recipeGetMatch && req.method === 'GET') {
    const id = parseInt(recipeGetMatch[1]);
    recipeDb.getRecipe(id).then((recipe) => {
      if (!recipe) { sendJson(res, 404, { error: 'Not found' }); return; }
      sendJson(res, 200, recipe);
    }).catch((err) => {
      sendJson(res, 500, { error: String(err) });
    });
    return true;
  }

  // PUT /api/workflow-recipes/:id
  const recipeUpdateMatch = /^\/api\/workflow-recipes\/(\d+)$/.exec(url.pathname);
  if (recipeUpdateMatch && req.method === 'PUT') {
    const id = parseInt(recipeUpdateMatch[1]);
    (async () => {
      try {
        const body = await readBody(req);
        const data = JSON.parse(body);
        if (data.definition && typeof data.definition !== 'string') {
          data.definition = JSON.stringify(data.definition);
        }
        const result = await recipeDb.updateRecipe(id, data);
        if (!result) { sendJson(res, 404, { error: 'Not found' }); return; }
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // DELETE /api/workflow-recipes/:id
  const recipeDeleteMatch = /^\/api\/workflow-recipes\/(\d+)$/.exec(url.pathname);
  if (recipeDeleteMatch && req.method === 'DELETE') {
    const id = parseInt(recipeDeleteMatch[1]);
    recipeDb.deleteRecipe(id).then((ok) => {
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Not found' });
    }).catch((err) => {
      sendJson(res, 500, { error: String(err) });
    });
    return true;
  }

  // POST /api/workflows/:id/publish-recipe — publish a working workflow as a recipe
  const publishMatch = /^\/api\/workflows\/(\d+)\/publish-recipe$/.exec(url.pathname);
  if (publishMatch && req.method === 'POST') {
    const id = parseInt(publishMatch[1]);
    (async () => {
      try {
        const body = await readBody(req);
        const meta = JSON.parse(body) as {
          name: string; description: string; tags?: string; author?: string;
          requiresCredential?: boolean; credentialHint?: string;
        };
        if (!meta.name || !meta.description) {
          sendJson(res, 400, { error: 'name and description required' });
          return;
        }

        const workflow = await db.getWorkflow(id, userId);
        if (!workflow) { sendJson(res, 404, { error: 'Workflow not found' }); return; }

        // Strip user-specific fields from definition
        const def = JSON.parse(workflow.definition);
        delete def.notify;
        delete def.credentialId;

        // Check for existing recipe with same name — overwrite if found
        const existing = (await recipeDb.listRecipes()).find(r => r.name === meta.name);
        let recipe;
        if (existing) {
          await recipeDb.updateRecipe(existing.id, {
            description: meta.description,
            definition: JSON.stringify(def),
            tags: meta.tags,
            requiresCredential: meta.requiresCredential,
            credentialHint: meta.credentialHint,
          });
          recipe = await recipeDb.getRecipe(existing.id);
          sendJson(res, 200, recipe);
        } else {
          recipe = await recipeDb.createRecipe({
            name: meta.name,
            description: meta.description,
            type: workflow.type,
            definition: JSON.stringify(def),
            tags: meta.tags,
            author: meta.author,
            requiresCredential: meta.requiresCredential,
            credentialHint: meta.credentialHint,
          });
          sendJson(res, 201, recipe);
        }
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  return false;
}
