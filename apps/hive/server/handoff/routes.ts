import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import type { AuthenticatedRequest } from '../auth/types.js';
import { HandoffClient } from './client.js';
import { MessagingClient } from '../messaging/client.js';
import { isIncognitoSession } from '../privacy/incognito.js';

/** Cross-user session handoff: route a session's transcript to a teammate. */
export function registerHandoffRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const pathname = url.pathname;
  const method = req.method || 'GET';
  const authReq = req as AuthenticatedRequest;

  if (!pathname.startsWith('/api/handoff')) return false;
  if (!authReq.user) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return true;
  }
  const me = authReq.user;

  // POST /api/handoff — create a handoff addressed to a teammate
  if (pathname === '/api/handoff' && method === 'POST') {
    const client = new HandoffClient();
    (async () => {
      try {
        const body = JSON.parse(await readBody(req) || '{}') as {
          toOid?: string; cwd?: string; provider?: string; transcriptText?: string; note?: string;
          sessionId?: string;
        };
        if (!body.toOid) { sendJson(res, 400, { error: 'toOid is required' }); return; }

        // Handoff uploads the full transcript to the shared session_handoffs table.
        // An incognito session never leaves this machine, so refuse rather
        // than quietly stripping the transcript and shipping an empty handoff.
        if (isIncognitoSession(body.sessionId, body.cwd)) {
          sendJson(res, 403, {
            error: 'This session is incognito — its transcript cannot be handed off. Turn incognito off first.',
            incognito: true,
          });
          return;
        }

        const id = await client.create({
          fromOid: me.oid,
          fromName: me.displayName || me.email || 'A teammate',
          toOid: body.toOid,
          cwd: body.cwd ?? null,
          provider: body.provider || 'claude',
          transcriptText: body.transcriptText ?? null,
          note: body.note ?? null,
        });

        // Best-effort notify via the existing messaging inbox (poll-based banner).
        try {
          const msg = new MessagingClient();
          const fromName = me.displayName || me.email || 'A teammate';
          const threadId = await msg.getOrCreateDirectThread(me.oid, fromName, body.toOid);
          await msg.postMessage(
            threadId, me.oid, fromName,
            `📨 Session handoff from ${fromName}${body.note ? `: ${body.note}` : ''} — open the Attention panel to accept.`,
            'ping',
          );
          await msg.close();
        } catch { /* notification is best-effort */ }

        sendJson(res, 201, { id });
      } catch (err: unknown) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // GET /api/handoff/incoming — pending handoffs for the caller
  if (pathname === '/api/handoff/incoming' && method === 'GET') {
    const client = new HandoffClient();
    (async () => {
      try {
        const handoffs = await client.incoming(me.oid);
        sendJson(res, 200, { handoffs });
      } catch (err: unknown) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // POST /api/handoff/:id/(accept|decline|cancel)
  const action = pathname.match(/^\/api\/handoff\/(\d+)\/(accept|decline|cancel)$/);
  if (action && method === 'POST') {
    const id = Number(action[1]);
    const verb = action[2];
    const client = new HandoffClient();
    (async () => {
      try {
        const row = await client.get(id);
        if (!row) { sendJson(res, 404, { error: 'Handoff not found' }); return; }

        if (verb === 'cancel') {
          if (row.fromOid !== me.oid) { sendJson(res, 403, { error: 'Only the sender can cancel' }); return; }
          await client.respond(id, 'canceled');
          sendJson(res, 200, { ok: true });
          return;
        }

        // accept / decline must be the recipient
        if (row.toOid !== me.oid) { sendJson(res, 403, { error: 'Not your handoff' }); return; }

        if (verb === 'decline') {
          await client.respond(id, 'declined');
          sendJson(res, 200, { ok: true });
          return;
        }

        // accept: materialize the transcript locally so a new session can load it
        const dir = path.join(os.tmpdir(), 'hive-handoffs');
        fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, `handoff-${id}.md`);
        fs.writeFileSync(filePath, row.transcriptText ?? '(no transcript provided)', 'utf-8');
        await client.respond(id, 'accepted');
        sendJson(res, 200, { filePath, cwd: row.cwd, provider: row.provider, fromName: row.fromName });
      } catch (err: unknown) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  return false;
}
