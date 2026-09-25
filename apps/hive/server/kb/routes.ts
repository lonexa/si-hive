import http from 'node:http';
import { KBClient } from './client.js';
import { loadKBConfig, getKBScopeOwner } from './env.js';
import { sendJson } from '../../../../packages/shared/src/server/http-utils.js';
import { handleKBRoutes } from '../../../../packages/shared/src/server/kb-routes.js';

function getClient(): KBClient | null {
  return new KBClient();
}

export function registerKBRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const pathname = url.pathname;

  // Full-specific: GET /api/kb/config — describes the shared database the KB lives in
  if (pathname === '/api/kb/config' && req.method === 'GET') {
    const config = loadKBConfig();
    sendJson(res, 200, {
      configured: true,
      dialect: config.dialect,
      server: config.server,
      database: config.database,
      schema: config.schema,
      scopeOwner: getKBScopeOwner(),
    });
    return true;
  }

  // Full-specific: POST /api/kb/test-connection
  if (pathname === '/api/kb/test-connection' && req.method === 'POST') {
    const client = new KBClient();
    (async () => {
      try {
        const result = await client.testConnection();
        sendJson(res, result.ok ? 200 : 500, result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { ok: false, error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // Delegate shared KB routes (entries CRUD, categories, tags)
  return handleKBRoutes(url, req, res, { getClient, getKBScopeOwner });
}
