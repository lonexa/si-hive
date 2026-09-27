/**
 * Local model endpoints (see endpoints.ts). Everything but the list is admin-only.
 *
 *   GET    /api/local-models           list (any user — drives the launch picker)
 *   POST   /api/local-models           { label, baseUrl, model, contextTokens?, apiKey? }
 *   PUT    /api/local-models/:id       { label?, baseUrl?, model?, contextTokens?, apiKey? } ('' clears)
 *   DELETE /api/local-models/:id
 *   POST   /api/local-models/probe     { baseUrl, apiKey? } → models (+ context sizes) on the server
 *   POST   /api/local-models/test      { baseUrl, model, apiKey? } — test before saving
 *   POST   /api/local-models/:id/test  test a saved endpoint
 */

import type http from 'node:http';
import type Database from 'better-sqlite3';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import { getSecret, setSecret, deleteSecret } from '../../../../packages/shared/src/server/credentials.js';
import type { AuthenticatedRequest } from '../auth/types.js';
import type { HiveConfig } from '../types.js';
import { loadConfig, saveConfig } from '../config.js';
import { requireAdmin } from '../providers/account-routes.js';
import {
  apiKeyRef,
  isValidEndpointId,
  listEndpoints,
  localAccountId,
  normalizeBaseUrl,
  parseContextTokens,
  LOCAL_MODEL_PROVIDER,
  type LocalModelEndpoint,
} from './endpoints.js';
import { listModels, testMessages } from './probe.js';

/** Path segments that are actions, so they can never be endpoint ids. */
const RESERVED_IDS = new Set(['probe', 'test']);

function parseBody(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function publicView(e: LocalModelEndpoint) {
  return { ...e, accountId: localAccountId(e.id), hasApiKey: !!getSecret(apiKeyRef(e.id)) };
}

/**
 * Persist to disk AND to the server's in-memory config: /api/config builds the
 * picker's provider status from the in-memory copy, and a settings save writes
 * that copy back whole, which would otherwise drop these changes.
 */
function persist(liveConfig: HiveConfig | undefined, updated: HiveConfig): void {
  saveConfig(updated);
  if (liveConfig) {
    liveConfig.localModels = updated.localModels;
    liveConfig.aiProviders = updated.aiProviders;
  }
}

function writeEndpoints(
  liveConfig: HiveConfig | undefined,
  mutate: (endpoints: LocalModelEndpoint[]) => LocalModelEndpoint[],
): HiveConfig {
  const cfg = loadConfig();
  const updated: HiveConfig = { ...cfg, localModels: { endpoints: mutate(listEndpoints(cfg)) } };
  persist(liveConfig, updated);
  return updated;
}

/** A readable, unique slug from the label: "LM Studio" → "lm-studio", "lm-studio-2", … */
function slugFor(label: string, taken: Set<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'model';
  const root = RESERVED_IDS.has(base) ? `${base}-model` : base;
  let id = root;
  for (let n = 2; taken.has(id); n++) id = `${root}-${n}`;
  return id;
}

export function registerLocalModelRoutes(
  url: URL,
  req: AuthenticatedRequest,
  res: http.ServerResponse,
  db: Database.Database,
  liveConfig?: HiveConfig,
): boolean {
  const m = url.pathname.match(/^\/api\/local-models(?:\/([a-z0-9-]+))?(?:\/(test))?$/);
  if (!m) return false;
  const segment = m[1];
  const action = m[2];

  if (req.method === 'GET' && !segment) {
    sendJson(res, 200, { endpoints: listEndpoints(loadConfig()).map(publicView) });
    return true;
  }

  // Everything else reaches out to arbitrary URLs or rewrites config: admin only.
  if (!requireAdmin(req, res, db)) return true;

  if (req.method === 'POST' && segment === 'probe' && !action) {
    readBody(req).then(async (raw) => {
      const body = parseBody(raw);
      const baseUrl = str(body.baseUrl);
      if (!baseUrl) return sendJson(res, 400, { error: 'baseUrl is required' });
      sendJson(res, 200, { baseUrl: normalizeBaseUrl(baseUrl), ...(await listModels(baseUrl, str(body.apiKey))) });
    }).catch((err) => sendJson(res, 500, { error: (err as Error).message }));
    return true;
  }

  if (req.method === 'POST' && segment === 'test' && !action) {
    readBody(req).then(async (raw) => {
      const body = parseBody(raw);
      const baseUrl = str(body.baseUrl);
      const model = str(body.model);
      if (!baseUrl || !model) return sendJson(res, 400, { error: 'baseUrl and model are required' });
      sendJson(res, 200, await testMessages(baseUrl, model, str(body.apiKey)));
    }).catch((err) => sendJson(res, 500, { error: (err as Error).message }));
    return true;
  }

  if (req.method === 'POST' && !segment) {
    readBody(req).then((raw) => {
      const body = parseBody(raw);
      const label = str(body.label);
      const baseUrl = str(body.baseUrl);
      const model = str(body.model);
      if (!label || !baseUrl || !model) {
        return sendJson(res, 400, { error: 'label, baseUrl and model are required' });
      }
      const taken = new Set(listEndpoints(loadConfig()).map((e) => e.id));
      const endpoint: LocalModelEndpoint = {
        id: slugFor(label, taken),
        label,
        baseUrl: normalizeBaseUrl(baseUrl),
        model,
        contextTokens: parseContextTokens(body.contextTokens),
      };
      if (!isValidEndpointId(endpoint.id)) return sendJson(res, 400, { error: 'Could not derive an id from that label' });
      const apiKey = str(body.apiKey);
      if (apiKey) setSecret(apiKeyRef(endpoint.id), apiKey);
      writeEndpoints(liveConfig, (eps) => [...eps, endpoint]);
      sendJson(res, 200, { endpoint: publicView(endpoint) });
    }).catch((err) => sendJson(res, 500, { error: (err as Error).message }));
    return true;
  }

  if (!segment || RESERVED_IDS.has(segment)) {
    sendJson(res, 405, { error: 'Method not allowed' });
    return true;
  }

  const existing = listEndpoints(loadConfig()).find((e) => e.id === segment);
  if (!existing) {
    sendJson(res, 404, { error: `No such local model: ${segment}` });
    return true;
  }

  if (req.method === 'POST' && action === 'test') {
    testMessages(existing.baseUrl, existing.model, getSecret(apiKeyRef(existing.id)))
      .then((result) => sendJson(res, 200, result))
      .catch((err) => sendJson(res, 500, { error: (err as Error).message }));
    return true;
  }

  if (req.method === 'PUT' && !action) {
    readBody(req).then((raw) => {
      const body = parseBody(raw);
      const updated: LocalModelEndpoint = {
        ...existing,
        label: str(body.label) ?? existing.label,
        baseUrl: str(body.baseUrl) ? normalizeBaseUrl(str(body.baseUrl)!) : existing.baseUrl,
        model: str(body.model) ?? existing.model,
        // Present-but-empty clears it; absent keeps it.
        contextTokens: 'contextTokens' in body ? parseContextTokens(body.contextTokens) : existing.contextTokens,
      };
      if (typeof body.apiKey === 'string') {
        if (body.apiKey.trim()) setSecret(apiKeyRef(existing.id), body.apiKey.trim());
        else deleteSecret(apiKeyRef(existing.id));
      }
      writeEndpoints(liveConfig, (eps) => eps.map((e) => (e.id === existing.id ? updated : e)));
      sendJson(res, 200, { endpoint: publicView(updated) });
    }).catch((err) => sendJson(res, 500, { error: (err as Error).message }));
    return true;
  }

  if (req.method === 'DELETE' && !action) {
    deleteSecret(apiKeyRef(existing.id));
    const cfg = writeEndpoints(liveConfig, (eps) => eps.filter((e) => e.id !== existing.id));
    // Don't leave the launch dialog preselecting an endpoint that no longer exists.
    const claude = cfg.aiProviders?.providers?.[LOCAL_MODEL_PROVIDER];
    if (cfg.aiProviders && claude?.defaultAccount === localAccountId(existing.id)) {
      persist(liveConfig, {
        ...cfg,
        aiProviders: {
          ...cfg.aiProviders,
          providers: { ...cfg.aiProviders.providers, [LOCAL_MODEL_PROVIDER]: { ...claude, defaultAccount: 'default' } },
        },
      });
    }
    sendJson(res, 200, { ok: true, removed: existing.id });
    return true;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
  return true;
}
