import http from 'node:http';
import { sendJson } from '../../../../packages/shared/src/server/http-utils.js';
import { TeamUsageClient } from './ai-usage-client.js';

/**
 * Handle Team API routes. Returns true if the route was handled, false otherwise.
 */
export function handleTeamRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const pathname = url.pathname;

  // GET /api/team/ai-usage?days=30 — team-wide Claude usage (B1.5)
  if (pathname === '/api/team/ai-usage' && req.method === 'GET') {
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
    const client = new TeamUsageClient();
    (async () => {
      try {
        const data = await client.getUsage(days);
        sendJson(res, 200, { ...data, days });
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  return false;
}
