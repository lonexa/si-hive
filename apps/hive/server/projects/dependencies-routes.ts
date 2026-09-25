import http from 'node:http';
import { dependenciesClient } from './dependencies-client.js';
import { sendJson } from '../../../../packages/shared/src/server/http-utils.js';

/**
 * Register dependency-related project routes.
 * Returns true if the route was handled.
 *
 * Routes:
 *   GET /api/projects/:path/dependencies
 */
export function registerDependencyRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse
): boolean {
  const pathname = url.pathname;

  const match = pathname.match(/^\/api\/projects\/(.+)\/dependencies$/);
  if (match && req.method === 'GET') {
    const projectPath = decodeURIComponent(match[1]);
    try {
      const result = dependenciesClient.scan(projectPath);
      sendJson(res, 200, result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: 'Failed to scan dependencies', detail: message });
    }
    return true;
  }

  return false;
}
