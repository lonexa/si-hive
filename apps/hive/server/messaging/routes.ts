import type http from 'node:http';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import type { AuthenticatedRequest } from '../auth/types.js';
import { MessagingClient } from './client.js';
import type { MessageKind } from './types.js';

const PING_BODY = '👋 pinged you';

/**
 * Person-to-person messaging routes. All paths are under /api/messaging/.
 * The caller (index.ts) has already authenticated the request, so req.user is set.
 */
export function handleMessagingRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const pathname = url.pathname;
  const method = req.method || 'GET';
  const authReq = req as AuthenticatedRequest;
  const user = authReq.user;

  if (!user) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return true;
  }
  const meOid = user.oid;
  const meName = user.displayName || user.email || meOid;

  // GET /api/messaging/users — directory for the recipient picker.
  if (pathname === '/api/messaging/users' && method === 'GET') {
    const client = new MessagingClient();
    void (async () => {
      try {
        const users = await client.listUsers();
        sendJson(res, 200, { users: users.filter((u) => u.oid !== meOid) });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // GET /api/messaging/inbox — the poll endpoint.
  if (pathname === '/api/messaging/inbox' && method === 'GET') {
    const client = new MessagingClient();
    void (async () => {
      try {
        const threads = await client.getInbox(meOid);
        sendJson(res, 200, { threads });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // POST /api/messaging/broadcast — send an announcement to everyone.
  if (pathname === '/api/messaging/broadcast' && method === 'POST') {
    const client = new MessagingClient();
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { body?: string };
        const text = (body.body || '').trim();
        if (!text) { sendJson(res, 400, { error: 'body is required' }); return; }
        const threadId = await client.createBroadcastThread(meOid, meName);
        const message = await client.postMessage(threadId, meOid, meName, text, 'announcement');
        sendJson(res, 201, { threadId, message });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // POST /api/messaging/ping — nudge one user.
  if (pathname === '/api/messaging/ping' && method === 'POST') {
    const client = new MessagingClient();
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { toOid?: string };
        if (!body.toOid) { sendJson(res, 400, { error: 'toOid is required' }); return; }
        const threadId = await client.getOrCreateDirectThread(meOid, meName, body.toOid);
        const message = await client.postMessage(threadId, meOid, meName, PING_BODY, 'ping');
        sendJson(res, 201, { threadId, message });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // POST /api/messaging/threads — get/create a direct or group thread.
  if (pathname === '/api/messaging/threads' && method === 'POST') {
    const client = new MessagingClient();
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { memberOids?: string[]; title?: string };
        const others = (body.memberOids || []).filter((o) => o && o !== meOid);
        if (others.length === 0) { sendJson(res, 400, { error: 'memberOids is required' }); return; }
        let threadId: number;
        if (others.length === 1) {
          threadId = await client.getOrCreateDirectThread(meOid, meName, others[0]);
        } else {
          threadId = await client.createThread('group', meOid, meName, others, body.title?.trim() || null);
        }
        const thread = await client.getThread(threadId, meOid);
        sendJson(res, 201, { thread });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // Routes with a :id segment.
  const threadMatch = pathname.match(/^\/api\/messaging\/threads\/(\d+)$/);
  const messagesMatch = pathname.match(/^\/api\/messaging\/threads\/(\d+)\/messages$/);
  const readMatch = pathname.match(/^\/api\/messaging\/threads\/(\d+)\/read$/);

  // GET /api/messaging/threads/:id — full history.
  if (threadMatch && method === 'GET') {
    const threadId = parseInt(threadMatch[1], 10);
    const client = new MessagingClient();
    void (async () => {
      try {
        if (!(await client.isMember(threadId, meOid))) { sendJson(res, 403, { error: 'Not a member' }); return; }
        const thread = await client.getThread(threadId, meOid);
        if (!thread) { sendJson(res, 404, { error: 'Thread not found' }); return; }
        sendJson(res, 200, { thread });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // POST /api/messaging/threads/:id/messages — send into a thread.
  if (messagesMatch && method === 'POST') {
    const threadId = parseInt(messagesMatch[1], 10);
    const client = new MessagingClient();
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { body?: string; kind?: MessageKind };
        const text = (body.body || '').trim();
        if (!text) { sendJson(res, 400, { error: 'body is required' }); return; }
        if (!(await client.isMember(threadId, meOid))) { sendJson(res, 403, { error: 'Not a member' }); return; }
        const message = await client.postMessage(threadId, meOid, meName, text, body.kind || 'text');
        sendJson(res, 201, { message });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // POST /api/messaging/threads/:id/read — mark read (X-dismiss / open).
  if (readMatch && method === 'POST') {
    const threadId = parseInt(readMatch[1], 10);
    const client = new MessagingClient();
    void (async () => {
      try {
        await client.markRead(threadId, meOid);
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  return false;
}
