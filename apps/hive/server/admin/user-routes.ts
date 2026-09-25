/**
 * User Management API routes.
 *
 * Admin endpoints for centralized user directory, role management,
 * feature overrides, and analytics. Also includes non-admin endpoints
 * for the current user's own overrides and activity tracking.
 */

import http from 'node:http';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import type { AuthenticatedRequest } from '../auth/types.js';
import { UserManagementClient } from './user-management-client.js';
import { UsageAnalyticsClient } from './usage-analytics-client.js';
import type { HiveRole } from '../../../../packages/shared/src/lib/feature-roles.js';
import { getLatestCommit } from '../updater.js';

// A user is "online" if they've sent a heartbeat recently. Heartbeats fire every
// 60s, so a 150s window tolerates one missed beat. Presence MUST come from the
// shared DB, not WebSocket connections — every user runs their own local Hive
// server, so this server only ever sees its own admin's browser sockets.
const ONLINE_THRESHOLD_MS = 150_000;

function isOnlineFromHeartbeat(lastHeartbeatAt: string | null): boolean {
  if (!lastHeartbeatAt) return false;
  const ts = new Date(lastHeartbeatAt).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < ONLINE_THRESHOLD_MS;
}

function isActualAdmin(db: Database.Database, oid: string): boolean {
  const row = db.prepare('SELECT role FROM users WHERE oid = ?').get(oid) as { role: string } | undefined;
  return row?.role === 'admin';
}

export function registerUserManagementRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  db: Database.Database,
): boolean {
  const authReq = req as AuthenticatedRequest;
  const pathname = url.pathname;
  const method = req.method || 'GET';

  // ── Non-admin endpoints ─────────────────────────────────────────────

  // GET /api/auth/my-overrides — current user's own feature overrides
  if (pathname === '/api/auth/my-overrides' && method === 'GET') {
    if (!authReq.user) {
      sendJson(res, 401, { error: 'Not authenticated' });
      return true;
    }
    const client = new UserManagementClient();
    (async () => {
      try {
        const overrides = await client.getOverrides(authReq.user!.oid);
        sendJson(res, 200, { overrides: overrides.map(o => o.feature) });
      } catch (err: unknown) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // POST /api/activity/track — record page/feature visit
  if (pathname === '/api/activity/track' && method === 'POST') {
    if (!authReq.user) {
      sendJson(res, 401, { error: 'Not authenticated' });
      return true;
    }
    const client = new UserManagementClient();
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { feature: string };
        if (!body.feature) {
          sendJson(res, 400, { error: 'Missing feature' });
          return;
        }
        await client.recordActivity(authReq.user!.oid, body.feature, os.hostname());
        sendJson(res, 200, { ok: true });
      } catch (err: unknown) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // GET /api/admin/adoption — system-wide Hive feature-adoption (admin only)
  if (pathname === '/api/admin/adoption' && method === 'GET') {
    if (!authReq.user || !isActualAdmin(db, authReq.user.oid)) {
      sendJson(res, 403, { error: 'Admin access required' });
      return true;
    }
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
    const client = new UserManagementClient();
    (async () => {
      try {
        const data = await client.getAdoption(days);
        sendJson(res, 200, { ...data, days });
      } catch (err: unknown) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // ── Usage analytics (admin only) ────────────────────────────────────
  // Per-user, per-day activity journal + rollups. Built on already-captured
  // data (user_events, users, ai_usage_log) — see usage-analytics-client.

  if (pathname.startsWith('/api/admin/usage/') && method === 'GET') {
    if (!authReq.user || !isActualAdmin(db, authReq.user.oid)) {
      sendJson(res, 403, { error: 'Admin access required' });
      return true;
    }
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
    const client = new UsageAnalyticsClient();
    (async () => {
      try {
        if (pathname === '/api/admin/usage/overview') {
          sendJson(res, 200, { ...(await client.getOverview(days)), days });
        } else if (pathname === '/api/admin/usage/users') {
          const { rows, warning } = await client.getUserRollup(days);
          sendJson(res, 200, { users: rows, days, warning });
        } else if (pathname === '/api/admin/usage/timeline') {
          const oid = url.searchParams.get('oid') || '';
          const date = url.searchParams.get('date') || '';
          if (!oid || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            sendJson(res, 400, { error: 'oid and date (YYYY-MM-DD) are required' });
            return;
          }
          sendJson(res, 200, await client.getUserTimeline(oid, date));
        } else {
          sendJson(res, 404, { error: 'Not found' });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // ── Admin-only endpoints ────────────────────────────────────────────

  if (!pathname.startsWith('/api/admin/users')) return false;

  if (!authReq.user || !isActualAdmin(db, authReq.user.oid)) {
    sendJson(res, 403, { error: 'Admin access required' });
    return true;
  }

  // Parse path: /api/admin/users, /api/admin/users/:oid, /api/admin/users/:oid/role, etc.
  const parts = pathname.replace('/api/admin/users', '').split('/').filter(Boolean);
  const targetOid = parts[0] ? decodeURIComponent(parts[0]) : null;
  const subResource = parts[1] || null;
  const subId = parts[2] || null;

  // GET /api/admin/users — list all users
  if (!targetOid && method === 'GET') {
    const client = new UserManagementClient();
    (async () => {
      try {
        const [users, latestCommit] = await Promise.all([client.listUsers(), getLatestCommit()]);
        const enriched = users.map(u => ({ ...u, isOnline: isOnlineFromHeartbeat(u.lastHeartbeatAt) }));
        sendJson(res, 200, { users: enriched, latestCommit });
      } catch (err: unknown) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // GET /api/admin/users/:oid — user detail
  if (targetOid && !subResource && method === 'GET') {
    const client = new UserManagementClient();
    (async () => {
      try {
        const user = await client.getUser(targetOid);
        if (!user) {
          sendJson(res, 404, { error: 'User not found' });
          return;
        }
        const latestCommit = await getLatestCommit();
        const isOnline = isOnlineFromHeartbeat(user.lastHeartbeatAt);
        sendJson(res, 200, { user: { ...user, isOnline }, latestCommit });
      } catch (err: unknown) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // POST /api/admin/users/:oid/force-update — queue an update via a DB flag.
  // The user's own local Hive reads (and clears) the flag on its next heartbeat
  // — including the heartbeat fired immediately on app start — and runs the
  // standard update flow. Works whether the user is currently online or not.
  if (targetOid && subResource === 'force-update' && method === 'POST') {
    const client = new UserManagementClient();
    (async () => {
      try {
        const ok = await client.requestForceUpdate(targetOid, authReq.user!.oid);
        if (!ok) {
          sendJson(res, 404, { error: 'User not found' });
          return;
        }
        sendJson(res, 200, { ok: true });
      } catch (err: unknown) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // DELETE /api/admin/users/:oid — permanently remove a user and their records.
  if (targetOid && !subResource && method === 'DELETE') {
    if (targetOid === authReq.user!.oid) {
      sendJson(res, 400, { error: 'You cannot delete your own account' });
      return true;
    }
    const client = new UserManagementClient();
    (async () => {
      try {
        const ok = await client.deleteUser(targetOid);
        if (!ok) {
          sendJson(res, 404, { error: 'User not found' });
          return;
        }
        // Also remove from local SQLite if this user exists locally.
        try { db.prepare('DELETE FROM users WHERE oid = ?').run(targetOid); } catch { /* table may differ */ }
        sendJson(res, 200, { ok: true });
      } catch (err: unknown) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // PATCH /api/admin/users/:oid/role — update role (sets adminRoleOverride)
  if (targetOid && subResource === 'role' && method === 'PATCH') {
    const client = new UserManagementClient();
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { role: HiveRole };
        if (!['admin', 'full'].includes(body.role)) {
          sendJson(res, 400, { error: 'Invalid role' });
          return;
        }
        const ok = await client.updateUserRole(targetOid, body.role);
        if (!ok) {
          sendJson(res, 404, { error: 'User not found' });
          return;
        }
        // Also sync to local SQLite if this user exists locally
        const localUser = db.prepare('SELECT oid FROM users WHERE oid = ?').get(targetOid);
        if (localUser) {
          db.prepare('UPDATE users SET role = ? WHERE oid = ?').run(body.role, targetOid);
        }
        sendJson(res, 200, { ok: true });
      } catch (err: unknown) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // DELETE /api/admin/users/:oid/role-override — clear admin override
  if (targetOid && subResource === 'role-override' && method === 'DELETE') {
    const client = new UserManagementClient();
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { adRole: HiveRole };
        const ok = await client.clearAdminOverride(targetOid, body.adRole || 'full');
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'User not found' });
      } catch (err: unknown) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // GET /api/admin/users/:oid/overrides — list feature overrides
  if (targetOid && subResource === 'overrides' && !subId && method === 'GET') {
    const client = new UserManagementClient();
    (async () => {
      try {
        const overrides = await client.getOverrides(targetOid);
        sendJson(res, 200, { overrides });
      } catch (err: unknown) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // POST /api/admin/users/:oid/overrides — grant feature override
  if (targetOid && subResource === 'overrides' && !subId && method === 'POST') {
    const client = new UserManagementClient();
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { feature: string };
        if (!body.feature) {
          sendJson(res, 400, { error: 'Missing feature' });
          return;
        }
        const result = await client.grantOverride(targetOid, body.feature, authReq.user!.oid);
        if (!result.ok) {
          sendJson(res, 400, { error: result.error });
          return;
        }
        sendJson(res, 200, { ok: true });
      } catch (err: unknown) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // DELETE /api/admin/users/:oid/overrides/:feature — revoke feature override
  if (targetOid && subResource === 'overrides' && subId && method === 'DELETE') {
    const client = new UserManagementClient();
    (async () => {
      try {
        const ok = await client.revokeOverride(targetOid, subId);
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Override not found' });
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
