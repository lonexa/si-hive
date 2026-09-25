/**
 * Settings → Integrations API.
 *
 *   GET    /api/integrations/providers        provider catalog (config schemas for the UI forms)
 *   GET    /api/integrations                  configured connections (secrets masked)
 *   POST   /api/integrations                  create   { providerId, label, kinds, settings, secrets, defaultTracker? }
 *   PUT    /api/integrations/:id              update   (same body; omitted/empty secrets are kept)
 *   DELETE /api/integrations/:id              remove + delete its secrets
 *   POST   /api/integrations/test             test unsaved settings { providerId, kinds, settings, secrets }
 *   POST   /api/integrations/:id/test         test a saved connection
 *   GET    /api/integrations/projects         per-project tracker/git mapping
 *   PUT    /api/integrations/projects         { projectPath, tracker?, git? }
 */
import type http from 'node:http';
import crypto from 'node:crypto';
import type { HiveConfig } from '../types.js';
import type { ConnectionContext, IntegrationConnection, IntegrationKind } from './types.js';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import { setSecret, getSecret, deleteSecret, deleteSecretsWithPrefix, maskSecret } from '../../../../packages/shared/src/server/credentials.js';
import {
  listProviderDefinitions,
  getProviderDefinition,
  connectionContext,
  secretRef,
  invalidateConnection,
} from './registry.js';

interface ConnectionBody {
  providerId?: string;
  label?: string;
  kinds?: IntegrationKind[];
  settings?: Record<string, unknown>;
  secrets?: Record<string, string>;
  defaultTracker?: boolean;
}

function publicConnection(conn: IntegrationConnection) {
  const def = getProviderDefinition(conn.providerId);
  const secrets: Record<string, string> = {};
  for (const f of def?.configSchema ?? []) {
    if (f.type === 'secret') secrets[f.key] = maskSecret(getSecret(secretRef(conn.id, f.key)));
  }
  return { ...conn, secrets, providerName: def?.displayName ?? conn.providerId, available: !!def };
}

/** Keep only schema-declared, non-secret settings with primitive values. */
function cleanSettings(providerId: string, settings: Record<string, unknown> = {}): Record<string, string | boolean | undefined> {
  const def = getProviderDefinition(providerId);
  const out: Record<string, string | boolean | undefined> = {};
  for (const f of def?.configSchema ?? []) {
    if (f.type === 'secret') continue;
    const v = settings[f.key];
    if (typeof v === 'string') out[f.key] = v.trim();
    else if (typeof v === 'boolean') out[f.key] = v;
  }
  return out;
}

function validKinds(providerId: string, kinds: unknown): IntegrationKind[] {
  const supported = getProviderDefinition(providerId)?.kinds ?? [];
  const wanted = Array.isArray(kinds) ? kinds.filter((k): k is IntegrationKind => k === 'git' || k === 'tracker') : supported;
  const result = wanted.filter((k) => supported.includes(k));
  return result.length ? result : supported;
}

async function testContext(providerId: string, kinds: IntegrationKind[], ctx: ConnectionContext) {
  const def = getProviderDefinition(providerId);
  if (!def) return { ok: false, results: [{ kind: 'provider', ok: false, error: `Unknown provider ${providerId}` }] };
  const missing = def.configSchema.filter((f) => f.required && !(f.type === 'secret' ? ctx.secrets[f.key] : ctx.settings[f.key]));
  if (missing.length) {
    return { ok: false, results: [{ kind: 'settings', ok: false, error: `Missing: ${missing.map((f) => f.label).join(', ')}` }] };
  }
  const results: { kind: string; ok: boolean; user?: string; error?: string }[] = [];
  for (const kind of kinds) {
    try {
      const provider = kind === 'git' ? def.createGitHost?.(ctx) : def.createTracker?.(ctx);
      if (!provider) throw new Error(`${def.displayName} does not support ${kind}`);
      const me = await provider.whoAmI();
      results.push({ kind, ok: true, user: me.name || me.id });
    } catch (err) {
      results.push({ kind, ok: false, error: (err as Error).message });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}

export function registerIntegrationRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: HiveConfig,
  saveConfig: (c: HiveConfig) => void,
): boolean {
  const { pathname } = url;
  if (!pathname.startsWith('/api/integrations')) return false;
  const connections = (): IntegrationConnection[] => (config.integrations ??= []);

  if (pathname === '/api/integrations/providers' && req.method === 'GET') {
    sendJson(res, 200, listProviderDefinitions().map((d) => ({
      id: d.id, displayName: d.displayName, icon: d.icon, kinds: d.kinds, configSchema: d.configSchema,
    })));
    return true;
  }

  if (pathname === '/api/integrations' && req.method === 'GET') {
    sendJson(res, 200, connections().map(publicConnection));
    return true;
  }

  if (pathname === '/api/integrations/projects' && req.method === 'GET') {
    sendJson(res, 200, config.projectIntegrations ?? {});
    return true;
  }

  if (pathname === '/api/integrations/projects' && req.method === 'PUT') {
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { projectPath?: string; tracker?: string | null; git?: string | null };
        if (!body.projectPath) return sendJson(res, 400, { error: 'projectPath is required' });
        const map = (config.projectIntegrations ??= {});
        const next = { ...(map[body.projectPath] ?? {}) };
        if (body.tracker !== undefined) body.tracker ? (next.tracker = body.tracker) : delete next.tracker;
        if (body.git !== undefined) body.git ? (next.git = body.git) : delete next.git;
        if (Object.keys(next).length) map[body.projectPath] = next;
        else delete map[body.projectPath];
        saveConfig(config);
        sendJson(res, 200, map);
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
      }
    })();
    return true;
  }

  if (pathname === '/api/integrations/test' && req.method === 'POST') {
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as ConnectionBody & { id?: string };
        if (!body.providerId) return sendJson(res, 400, { error: 'providerId is required' });
        // Editing an existing connection: fall back to its stored secrets.
        const secrets: Record<string, string | undefined> = {};
        for (const f of getProviderDefinition(body.providerId)?.configSchema ?? []) {
          if (f.type !== 'secret') continue;
          secrets[f.key] = body.secrets?.[f.key] || (body.id ? getSecret(secretRef(body.id, f.key)) : undefined);
        }
        const ctx = { settings: cleanSettings(body.providerId, body.settings), secrets };
        sendJson(res, 200, await testContext(body.providerId, validKinds(body.providerId, body.kinds), ctx));
      } catch (err) {
        sendJson(res, 400, { ok: false, error: (err as Error).message });
      }
    })();
    return true;
  }

  if (pathname === '/api/integrations' && req.method === 'POST') {
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as ConnectionBody;
        const def = body.providerId ? getProviderDefinition(body.providerId) : undefined;
        if (!def) return sendJson(res, 400, { error: 'Unknown provider' });
        const id = `${def.id}-${crypto.randomBytes(3).toString('hex')}`;
        const conn: IntegrationConnection = {
          id,
          providerId: def.id,
          label: body.label?.trim() || def.displayName,
          kinds: validKinds(def.id, body.kinds),
          settings: cleanSettings(def.id, body.settings),
        };
        for (const f of def.configSchema) {
          if (f.type === 'secret' && body.secrets?.[f.key]) setSecret(secretRef(id, f.key), body.secrets[f.key]);
        }
        if (body.defaultTracker && conn.kinds.includes('tracker')) {
          for (const c of connections()) delete c.defaultTracker;
          conn.defaultTracker = true;
        }
        connections().push(conn);
        saveConfig(config);
        sendJson(res, 201, publicConnection(conn));
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
      }
    })();
    return true;
  }

  const idMatch = /^\/api\/integrations\/([^/]+)(\/test)?$/.exec(pathname);
  if (!idMatch) return false;
  const id = decodeURIComponent(idMatch[1]);
  const conn = connections().find((c) => c.id === id);
  if (!conn) {
    sendJson(res, 404, { error: 'Connection not found' });
    return true;
  }

  if (idMatch[2] && req.method === 'POST') {
    void (async () => sendJson(res, 200, await testContext(conn.providerId, conn.kinds, connectionContext(conn))))();
    return true;
  }

  if (!idMatch[2] && req.method === 'PUT') {
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as ConnectionBody;
        const def = getProviderDefinition(conn.providerId);
        if (body.label !== undefined) conn.label = body.label.trim() || conn.label;
        if (body.kinds !== undefined) conn.kinds = validKinds(conn.providerId, body.kinds);
        if (body.settings !== undefined) conn.settings = cleanSettings(conn.providerId, body.settings);
        for (const f of def?.configSchema ?? []) {
          if (f.type !== 'secret' || body.secrets?.[f.key] === undefined) continue;
          if (body.secrets[f.key]) setSecret(secretRef(id, f.key), body.secrets[f.key]);
          else deleteSecret(secretRef(id, f.key));
        }
        if (body.defaultTracker !== undefined) {
          if (body.defaultTracker && conn.kinds.includes('tracker')) {
            for (const c of connections()) delete c.defaultTracker;
            conn.defaultTracker = true;
          } else {
            delete conn.defaultTracker;
          }
        }
        invalidateConnection(id);
        saveConfig(config);
        sendJson(res, 200, publicConnection(conn));
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
      }
    })();
    return true;
  }

  if (!idMatch[2] && req.method === 'DELETE') {
    config.integrations = connections().filter((c) => c.id !== id);
    for (const [path, prefs] of Object.entries(config.projectIntegrations ?? {})) {
      if (prefs.tracker === id) delete prefs.tracker;
      if (prefs.git === id) delete prefs.git;
      if (!prefs.tracker && !prefs.git) delete config.projectIntegrations![path];
    }
    deleteSecretsWithPrefix(`integration:${id}:`);
    invalidateConnection(id);
    saveConfig(config);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
