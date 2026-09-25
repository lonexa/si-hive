/**
 * Settings → Modules.
 *   GET /api/modules            status of every optional module
 *   PUT /api/modules/:id        { enabled: boolean }
 */
import type http from 'node:http';
import type { HiveConfig } from '../types.js';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import { listModuleStatus, setModuleEnabled } from './registry.js';

export function registerModuleRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: HiveConfig,
  saveConfig: (c: HiveConfig) => void,
): boolean {
  if (url.pathname === '/api/modules' && req.method === 'GET') {
    sendJson(res, 200, listModuleStatus(config));
    return true;
  }
  const m = /^\/api\/modules\/([^/]+)$/.exec(url.pathname);
  if (m && req.method === 'PUT') {
    void (async () => {
      try {
        const { enabled } = JSON.parse(await readBody(req)) as { enabled?: boolean };
        if (typeof enabled !== 'boolean') return sendJson(res, 400, { error: 'enabled must be a boolean' });
        if (!setModuleEnabled(config, decodeURIComponent(m[1]), enabled)) return sendJson(res, 404, { error: 'Unknown module' });
        saveConfig(config);
        sendJson(res, 200, listModuleStatus(config));
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
      }
    })();
    return true;
  }
  return false;
}
