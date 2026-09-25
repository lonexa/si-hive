import http from 'node:http';
import os from 'node:os';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import type { AuthenticatedRequest } from '../auth/types.js';
import { NowClient, type NowSession, type Availability } from './client.js';
import { isIncognitoId, isIncognitoPath } from '../privacy/incognito.js';

const AVAILABILITY: Availability[] = ['available', 'busy', 'away', 'dnd'];

/** Team "Now" board: each instance publishes its live-session snapshot; board reads all. */
export function registerNowRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const pathname = url.pathname;
  const method = req.method || 'GET';
  const authReq = req as AuthenticatedRequest;

  if (pathname !== '/api/now/push' && pathname !== '/api/now/board' && pathname !== '/api/now/status') return false;

  if (!authReq.user) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return true;
  }

  // POST /api/now/push — publish this machine's snapshot
  if (pathname === '/api/now/push' && method === 'POST') {
    const client = new NowClient();
    (async () => {
      try {
        const body = JSON.parse(await readBody(req) || '{}') as {
          working?: number; waiting?: number; errorCount?: number; total?: number;
          topProject?: string | null; topStatus?: string | null; sessions?: NowSession[];
        };
        // Backstop: the client filters incognito sessions out before pushing,
        // but a stale tab (or a project marked incognito since it loaded) could
        // still include one. Drop them and re-derive the counts so the board
        // never shows a session that isn't supposed to exist off-machine.
        const pushed = (body.sessions ?? []).filter(
          (s) => !isIncognitoId(s.slug) && !isIncognitoPath(s.project),
        );
        const dropped = (body.sessions ?? []).length - pushed.length;
        const counts = dropped > 0
          ? {
              working: pushed.filter((s) => s.status === 'working').length,
              waiting: pushed.filter((s) => s.status === 'waiting-input' || s.status === 'waiting-approval').length,
              errorCount: pushed.filter((s) => s.status === 'error').length,
              total: pushed.length,
              topProject: pushed[0]?.project ?? null,
              topStatus: pushed[0]?.status ?? null,
            }
          : {
              working: body.working ?? 0,
              waiting: body.waiting ?? 0,
              errorCount: body.errorCount ?? 0,
              total: body.total ?? 0,
              topProject: body.topProject ?? null,
              topStatus: body.topStatus ?? null,
            };

        await client.push(authReq.user!.oid, {
          ...counts,
          sessions: pushed.slice(0, 20),
          machineName: os.hostname(),
        });
        sendJson(res, 200, { ok: true });
      } catch (err: unknown) {
        // Telemetry-style write: never surface failures hard.
        sendJson(res, 200, { ok: true, warning: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // POST /api/now/status — set the current user's manual presence
  if (pathname === '/api/now/status' && method === 'POST') {
    const client = new NowClient();
    (async () => {
      try {
        const body = JSON.parse(await readBody(req) || '{}') as { availability?: string | null; manualStatus?: string | null };
        const availability = body.availability && AVAILABILITY.includes(body.availability as Availability)
          ? (body.availability as Availability)
          : null;
        const manualStatus = body.manualStatus ? String(body.manualStatus).slice(0, 120) : null;
        await client.setStatus(authReq.user!.oid, availability, manualStatus);
        sendJson(res, 200, { ok: true });
      } catch (err: unknown) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // GET /api/now/board — everyone's latest snapshot
  if (pathname === '/api/now/board' && method === 'GET') {
    const client = new NowClient();
    (async () => {
      try {
        const board = await client.getBoard();
        sendJson(res, 200, { board });
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
