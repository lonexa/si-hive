import http from 'node:http';
import type { LiteConfig } from '../types.js';
import { getTracker } from '../integrations/registry.js';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import { searchAll } from './search-client.js';
import { askHive } from './ask.js';

/**
 * Universal search (B2.1) + Ask Hive RAG (B2.2). Returns true if handled.
 */
export function registerSearchRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: LiteConfig,
): boolean {
  const pathname = url.pathname;

  // GET /api/search?q=...
  if (pathname === '/api/search' && req.method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) {
      sendJson(res, 200, { query: q, kb: [], workItems: [], sessions: [], people: [], warnings: [] });
      return true;
    }
    const tracker = getTracker(config);
    (async () => {
      try {
        sendJson(res, 200, await searchAll(q, tracker));
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      }
    })();
    return true;
  }

  // POST /api/search/ask  { question }
  if (pathname === '/api/search/ask' && req.method === 'POST') {
    const tracker = getTracker(config);
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { question?: string };
        const question = (body.question || '').trim();
        if (question.length < 3) {
          sendJson(res, 400, { error: 'Question too short' });
          return;
        }
        sendJson(res, 200, await askHive(question, tracker));
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      }
    })();
    return true;
  }

  return false;
}
