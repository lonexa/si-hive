import http from 'node:http';
import { listSessions, getSessionDetail } from './replay-client.js';
import { sendJson } from '../../../../packages/shared/src/server/http-utils.js';

export function registerReplayRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const pathname = url.pathname;

  // GET /api/sessions/replay — list available sessions
  if (pathname === '/api/sessions/replay' && req.method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    (async () => {
      try {
        const result = await listSessions(limit, offset);
        sendJson(res, 200, result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      }
    })();
    return true;
  }

  // GET /api/sessions/replay/:id — get session transcript for replay
  const replayMatch = pathname.match(/^\/api\/sessions\/replay\/(.+)$/);
  if (replayMatch && req.method === 'GET') {
    const sessionId = decodeURIComponent(replayMatch[1]);

    (async () => {
      try {
        const detail = await getSessionDetail(sessionId);
        if (!detail) {
          sendJson(res, 404, { error: 'Session not found' });
          return;
        }
        sendJson(res, 200, detail);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      }
    })();
    return true;
  }

  return false;
}
