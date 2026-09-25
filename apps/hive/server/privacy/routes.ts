/**
 * Incognito API.
 *
 * The marks themselves are purely local state (~/.hive/incognito.json). The
 * one exception is turning a *project* on: that also deletes whatever the
 * project had already logged to shared SQL (see purge.ts), because otherwise
 * the rows stay readable from every other user's Hive.
 *
 * Reads are open to any authenticated user because the UI needs to render the
 * badge on a session it's already showing. *Turning* incognito on or off is
 * admin-only (the `incognito` feature key), since it removes work from team
 * analytics. Per-user grants from the Users page are honored so the button and
 * the endpoint never disagree.
 */

import http from 'node:http';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import type { AuthenticatedRequest } from '../auth/types.js';
import { requireRole } from '../auth/middleware.js';
import { UserManagementClient } from '../admin/user-management-client.js';
import { purgeUsageLogForProject } from './purge.js';
import {
  listIncognito,
  setProjectIncognito,
  setSessionIncognito,
  isIncognitoPath,
  isIncognitoSession,
} from './incognito.js';

const FEATURE = 'incognito';

/**
 * Admin by role, or a `full` user an admin explicitly granted `incognito`.
 * The override lookup hits SQL, so it only runs for non-admins — and only on
 * a toggle, which is a rare click.
 */
async function canToggle(authReq: AuthenticatedRequest): Promise<boolean> {
  if (requireRole(authReq, ['admin'])) return true;
  const client = new UserManagementClient();
  try {
    const overrides = await client.getOverrides(authReq.user!.oid);
    return overrides.some((o) => o.feature === FEATURE);
  } catch {
    // Overrides unavailable — fall back to admin-only.
    return false;
  } finally {
    await client.close().catch(() => {});
  }
}

export function registerIncognitoRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/incognito')) return false;
  const method = req.method || 'GET';
  const authReq = req as AuthenticatedRequest;

  if (!authReq.user) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return true;
  }

  // GET /api/incognito — full local state (projects + marked session ids)
  if (pathname === '/api/incognito' && method === 'GET') {
    sendJson(res, 200, listIncognito());
    return true;
  }

  // GET /api/incognito/check?path=<dir>&sessionId=<id> — single lookup
  if (pathname === '/api/incognito/check' && method === 'GET') {
    const p = url.searchParams.get('path');
    const sessionId = url.searchParams.get('sessionId');
    sendJson(res, 200, {
      project: isIncognitoPath(p),
      session: sessionId ? isIncognitoSession(sessionId, p) : false,
    });
    return true;
  }

  const isProjectToggle = pathname === '/api/incognito/project' && method === 'POST';
  const isSessionToggle = pathname === '/api/incognito/session' && method === 'POST';

  // POST /api/incognito/project { path, enabled }
  // POST /api/incognito/session { id, enabled }
  //
  // A session `id` may be a temp terminal id (`new-*`) minted before Claude has
  // assigned a real session id — linkSession() carries the mark across once the
  // real id is discovered.
  if (isProjectToggle || isSessionToggle) {
    (async () => {
      try {
        if (!await canToggle(authReq)) {
          sendJson(res, 403, { error: 'Incognito is currently limited to admins.' });
          return;
        }
        const parsed = JSON.parse(await readBody(req) || '{}') as {
          path?: string; id?: string; enabled?: boolean;
        };
        const enabled = parsed.enabled !== false;

        if (isProjectToggle) {
          if (!parsed.path || typeof parsed.path !== 'string') {
            sendJson(res, 400, { error: 'path required' });
            return;
          }
          setProjectIncognito(parsed.path, enabled);
          // Marking the project only gates future writes. Sessions logged
          // before the toggle are still in shared SQL, where every other
          // user's Hive can see them, so take them out now — awaited, so the
          // response can say whether it actually worked.
          if (enabled) {
            const purge = await purgeUsageLogForProject(parsed.path, authReq.user!.email);
            sendJson(res, 200, {
              ok: true,
              purgedRows: purge.deleted,
              ...(purge.warning ? { warning: purge.warning } : {}),
              ...listIncognito(),
            });
            return;
          }
        } else {
          if (!parsed.id || typeof parsed.id !== 'string') {
            sendJson(res, 400, { error: 'id required' });
            return;
          }
          setSessionIncognito(parsed.id, enabled);
        }
        sendJson(res, 200, { ok: true, ...listIncognito() });
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }

  return false;
}
