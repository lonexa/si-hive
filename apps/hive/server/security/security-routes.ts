import http from 'node:http';
import { SecretsClient } from './secrets-client.js';
import { AuditClient } from './audit-client.js';
import { PermissionsClient } from './permissions-client.js';
import { sendJson } from '../../../../packages/shared/src/server/http-utils.js';

export function registerSecurityRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const pathname = url.pathname;

  // GET /api/security/scan-secrets?projectPath=...
  if (pathname === '/api/security/scan-secrets' && req.method === 'GET') {
    const projectPath = url.searchParams.get('projectPath');
    if (!projectPath) {
      sendJson(res, 400, { error: 'Missing projectPath query parameter' });
      return true;
    }

    try {
      const client = new SecretsClient();
      const report = client.scanProject(projectPath);
      sendJson(res, 200, report);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: msg });
    }
    return true;
  }

  // GET /api/security/audit-log?days=30&action=&user=
  if (pathname === '/api/security/audit-log' && req.method === 'GET') {
    const days = parseInt(url.searchParams.get('days') || '30', 10);
    const action = url.searchParams.get('action') || undefined;
    const user = url.searchParams.get('user') || undefined;
    const client = new AuditClient();
    (async () => {
      try {
        const data = await client.getAuditLog(isNaN(days) ? 30 : days, action, user);
        sendJson(res, 200, data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // GET /api/security/audit-log/actions — distinct action types for filter
  if (pathname === '/api/security/audit-log/actions' && req.method === 'GET') {
    const client = new AuditClient();
    (async () => {
      try {
        const data = await client.getDistinctActions();
        sendJson(res, 200, data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // GET /api/security/audit-log/users — distinct usernames for filter
  if (pathname === '/api/security/audit-log/users' && req.method === 'GET') {
    const client = new AuditClient();
    (async () => {
      try {
        const data = await client.getDistinctUsers();
        sendJson(res, 200, data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // GET /api/security/permission-audit
  if (pathname === '/api/security/permission-audit' && req.method === 'GET') {
    const client = new PermissionsClient();
    (async () => {
      try {
        const data = await client.getPermissionAudit();
        sendJson(res, 200, data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      }
    })();
    return true;
  }

  return false;
}
