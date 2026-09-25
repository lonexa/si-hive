import http from 'node:http';
import type { AuthenticatedRequest } from '../auth/types.js';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import { ReviewsClient, type ReviewKind, type ReviewStatus } from './client.js';

const KINDS: ReviewKind[] = ['session', 'commit', 'note'];
const STATUSES: ReviewStatus[] = ['requested', 'approved', 'changes', 'closed'];

/** Hive-native peer review (B3.2). Returns true if handled. */
export function registerReviewRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const pathname = url.pathname;
  const method = req.method || 'GET';
  if (pathname !== '/api/reviews' && !pathname.startsWith('/api/reviews/')) return false;

  const authReq = req as AuthenticatedRequest;
  if (!authReq.user) { sendJson(res, 401, { error: 'Not authenticated' }); return true; }
  const user = authReq.user;

  // GET /api/reviews?box=incoming|outgoing
  if (pathname === '/api/reviews' && method === 'GET') {
    const box = url.searchParams.get('box') === 'outgoing' ? 'outgoing' : 'incoming';
    const client = new ReviewsClient();
    (async () => {
      try {
        sendJson(res, 200, { reviews: await client.list(user.oid, box) });
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      } finally { await client.close(); }
    })();
    return true;
  }

  // POST /api/reviews — create a review request
  if (pathname === '/api/reviews' && method === 'POST') {
    const client = new ReviewsClient();
    (async () => {
      try {
        const b = JSON.parse(await readBody(req)) as {
          reviewerOid?: string; reviewerName?: string; title?: string;
          kind?: string; refId?: string; repo?: string; context?: string;
        };
        if (!b.reviewerOid || !b.title) {
          sendJson(res, 400, { error: 'Missing required fields: reviewerOid, title' });
          return;
        }
        const kind = KINDS.includes(b.kind as ReviewKind) ? (b.kind as ReviewKind) : 'note';
        const review = await client.create({
          requesterOid: user.oid,
          requesterName: user.displayName || user.email || 'unknown',
          reviewerOid: b.reviewerOid,
          reviewerName: b.reviewerName || 'teammate',
          title: b.title.slice(0, 300),
          kind,
          refId: b.refId || null,
          repo: b.repo || null,
          context: b.context || null,
        });
        sendJson(res, 201, { review });
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      } finally { await client.close(); }
    })();
    return true;
  }

  // Sub-resources: /api/reviews/:id , /api/reviews/:id/comments , /api/reviews/:id/status
  const rest = pathname.replace('/api/reviews/', '').split('/').filter(Boolean);
  const id = Number(rest[0]);
  const sub = rest[1];
  if (!Number.isInteger(id)) { sendJson(res, 400, { error: 'Invalid review id' }); return true; }

  // GET /api/reviews/:id
  if (!sub && method === 'GET') {
    const client = new ReviewsClient();
    (async () => {
      try {
        const data = await client.get(id);
        if (!data) { sendJson(res, 404, { error: 'Review not found' }); return; }
        sendJson(res, 200, data);
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      } finally { await client.close(); }
    })();
    return true;
  }

  // POST /api/reviews/:id/comments
  if (sub === 'comments' && method === 'POST') {
    const client = new ReviewsClient();
    (async () => {
      try {
        const b = JSON.parse(await readBody(req)) as { body?: string };
        if (!b.body?.trim()) { sendJson(res, 400, { error: 'Empty comment' }); return; }
        const comment = await client.addComment(id, user.oid, user.displayName || user.email || 'unknown', b.body.trim());
        if (!comment) { sendJson(res, 404, { error: 'Review not found' }); return; }
        sendJson(res, 201, { comment });
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      } finally { await client.close(); }
    })();
    return true;
  }

  // PATCH /api/reviews/:id/status  { status }
  if (sub === 'status' && method === 'PATCH') {
    const client = new ReviewsClient();
    (async () => {
      try {
        const b = JSON.parse(await readBody(req)) as { status?: string };
        if (!STATUSES.includes(b.status as ReviewStatus)) { sendJson(res, 400, { error: 'Invalid status' }); return; }
        const ok = await client.setStatus(id, user.oid, b.status as ReviewStatus);
        sendJson(res, ok ? 200 : 403, ok ? { ok: true } : { error: 'Not permitted or review not found' });
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      } finally { await client.close(); }
    })();
    return true;
  }

  return false;
}
