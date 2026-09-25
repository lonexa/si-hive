/**
 * Authentication routes.
 *
 * Public:
 *   GET  /api/auth/config               { configured, providers: [{id,type,label,icon}] }
 *   GET  /api/auth/status               { authenticated, user? }
 *   GET  /auth/login[/:providerId]      start sign-in (?keep=true, ?test=1)
 *   GET  /auth/callback/:providerId     provider redirect target
 *   POST /api/auth/local/login          { username, password, keep? }
 * Signed in:
 *   GET  /api/auth/me · POST /api/auth/logout · POST /api/auth/heartbeat
 * Admin (or anyone while login is off — the local user is admin):
 *   GET/PUT  /api/auth/settings                   enabled, allowed domains/emails
 *   GET      /api/auth/provider-types             catalog with config schemas
 *   POST     /api/auth/providers                  { type, label, settings, secrets }
 *   PUT/DELETE /api/auth/providers/:id
 *   GET/POST /api/auth/local-accounts             list / create-or-reset { username, password }
 *   DELETE   /api/auth/local-accounts/:username
 *   GET      /api/auth/users · PATCH /api/auth/users/:oid/role
 *   POST     /api/auth/role-override
 */
import http from 'node:http';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { randomUUID, randomBytes } from 'node:crypto';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import { setSecret, getSecret, deleteSecretsWithPrefix, maskSecret } from '../../../../packages/shared/src/server/credentials.js';
import type { HiveConfig } from '../types.js';
import type { HiveRole, AuthenticatedRequest } from './types.js';
import { upsertUser, createSession, deleteSession, listUsers, updateUserRole } from './session-manager.js';
import { authenticate, setSessionCookie, clearSessionCookie } from './middleware.js';
import { getServerVersion } from '../server-version.js';
import { getLocalCommit } from '../updater.js';
import {
  AUTH_PROVIDER_TYPES,
  authSecretRef,
  isAdminByGroup,
  listAuthProviderTypes,
  type AuthProviderConnection,
  type AuthProviderType,
  type ExternalIdentity,
} from './providers.js';
import { getAuthSettings, isAuthEnabled, isEmailAllowed, type AuthSettings } from './settings.js';
import {
  createLocalAccountTables,
  setLocalPassword,
  verifyLocalPassword,
  listLocalAccounts,
  deleteLocalAccount,
  localUserOid,
} from './local-accounts.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getActualRole(db: Database.Database, oid: string | undefined): HiveRole | null {
  if (!oid) return null;
  const row = db.prepare('SELECT role FROM users WHERE oid = ?').get(oid) as { role: string } | undefined;
  return (row?.role as HiveRole) ?? null;
}

/** Admin checks: while login is off the implicit local user is admin. */
function isAdminRequest(req: AuthenticatedRequest, db: Database.Database, config: HiveConfig): boolean {
  if (!isAuthEnabled(config)) return true;
  return !!req.user && getActualRole(db, req.user.oid) === 'admin';
}

function baseUrl(req: http.IncomingMessage, config: HiveConfig): string {
  const configured = process.env.HIVE_PUBLIC_URL || (config.publicUrl as string | undefined);
  if (configured) return configured.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || 'http';
  return `${proto}://${req.headers.host ?? 'localhost'}`;
}

function callbackUrl(req: http.IncomingMessage, config: HiveConfig, providerId: string): string {
  return `${baseUrl(req, config)}/auth/callback/${encodeURIComponent(providerId)}`;
}

function htmlPage(res: http.ServerResponse, title: string, message: string, status = 200): void {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><body style="font-family:system-ui;background:#0a0a0a;color:#e4e4e7;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="max-width:480px;text-align:center"><h2>${esc(title)}</h2><p>${esc(message)}</p><p><a style="color:#60a5fa" href="/">Back to SI Hive</a></p></div></body></html>`);
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const pair of cookieHeader.split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key.trim()] = rest.join('=').trim();
  }
  return cookies;
}

function providersOf(config: HiveConfig): AuthProviderConnection[] {
  const auth = (config.auth ??= {}) as AuthSettings;
  return (auth.providers ??= []);
}

function publicProvider(p: AuthProviderConnection) {
  const type = AUTH_PROVIDER_TYPES[p.type];
  return { id: p.id, type: p.type, label: p.label, icon: type?.icon ?? 'KeyRound' };
}

function adminProviderView(p: AuthProviderConnection) {
  const secrets: Record<string, string> = {};
  for (const f of AUTH_PROVIDER_TYPES[p.type]?.configSchema ?? []) {
    if (f.type === 'secret') secrets[f.key] = maskSecret(getSecret(authSecretRef(p.id, f.key)));
  }
  return { ...p, secrets };
}

function cleanSettings(type: AuthProviderType, settings: Record<string, unknown> = {}) {
  const out: Record<string, string | boolean | undefined> = {};
  for (const f of AUTH_PROVIDER_TYPES[type]?.configSchema ?? []) {
    if (f.type === 'secret') continue;
    const v = settings[f.key];
    if (typeof v === 'string') out[f.key] = v.trim();
    else if (typeof v === 'boolean') out[f.key] = v;
  }
  return out;
}

// In-memory sign-in attempts (short-lived).
interface PendingLogin {
  providerId: string;
  stored: Record<string, string>;
  keepLoggedIn: boolean;
  redirectUri: string;
  test: boolean;
  createdAt: number;
}
const pendingLogins = new Map<string, PendingLogin>();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of pendingLogins) if (v.createdAt < cutoff) pendingLogins.delete(k);
}, 5 * 60 * 1000).unref();

/**
 * Admission + user upsert for a verified identity. Returns the Hive user oid
 * or throws with a user-facing reason.
 */
function admit(db: Database.Database, auth: AuthSettings, conn: AuthProviderConnection, identity: ExternalIdentity): string {
  const oid = `${conn.type}:${identity.subject}`;
  const existing = db.prepare('SELECT role FROM users WHERE oid = ?').get(oid) as { role: string } | undefined;
  const anyUsers = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n > 0;
  const adminByGroup = isAdminByGroup(conn, identity);

  if (!existing) {
    const bootstrap = !anyUsers; // the very first sign-in becomes the admin
    const allowed = bootstrap || adminByGroup || (identity.emailVerified !== false && isEmailAllowed(auth, identity.email));
    if (!allowed) {
      throw new Error(`${identity.email || 'This account'} is not allowed to sign in. Ask an SI Hive admin to add your email or domain.`);
    }
    upsertUser(db, { oid, email: identity.email, displayName: identity.name, role: bootstrap || adminByGroup ? 'admin' : 'full', roleFromGroups: adminByGroup });
  } else {
    upsertUser(db, { oid, email: identity.email, displayName: identity.name, role: adminByGroup ? 'admin' : (existing.role as HiveRole), roleFromGroups: adminByGroup });
  }
  return oid;
}

async function syncCentralDirectory(db: Database.Database, oid: string): Promise<void> {
  try {
    const row = db.prepare('SELECT email, displayName, role FROM users WHERE oid = ?').get(oid) as { email: string; displayName: string; role: HiveRole };
    const { UserManagementClient } = await import('../admin/user-management-client.js');
    const um = new UserManagementClient();
    const central = await um.upsertUser({ oid, email: row.email, displayName: row.displayName, role: row.role });
    await um.recordLogin(oid, os.hostname(), getServerVersion());
    if (central?.adminRoleOverride) db.prepare('UPDATE users SET role = ? WHERE oid = ?').run(central.adminRoleOverride, oid);
    await um.close();
  } catch (err) {
    console.warn('[auth] Shared user directory sync failed (non-fatal):', (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

let tablesReady = false;

export function registerAuthRoutes(
  url: URL,
  req: AuthenticatedRequest,
  res: http.ServerResponse,
  db: Database.Database,
  config: HiveConfig,
  saveConfig: (config: HiveConfig) => void,
): boolean {
  if (!tablesReady) { createLocalAccountTables(db); tablesReady = true; }
  const pathname = url.pathname;
  const method = req.method || 'GET';
  const auth = getAuthSettings(config);

  // ------------------------------------------------------------- public
  if (pathname === '/api/auth/config' && method === 'GET') {
    sendJson(res, 200, isAuthEnabled(config)
      ? { configured: true, providers: (auth.providers ?? []).map(publicProvider) }
      : { configured: false, providers: [] });
    return true;
  }

  if (pathname === '/api/auth/status' && method === 'GET') {
    const user = authenticate(req, db);
    sendJson(res, 200, user ? { authenticated: true, user } : { authenticated: false });
    return true;
  }

  const loginMatch = /^\/auth\/login(?:\/([^/]+))?$/.exec(pathname);
  if (loginMatch && method === 'GET') {
    const providers = (auth.providers ?? []).filter((p) => p.type !== 'local');
    const conn = loginMatch[1] ? providers.find((p) => p.id === decodeURIComponent(loginMatch[1])) : providers.length === 1 ? providers[0] : undefined;
    const type = conn ? AUTH_PROVIDER_TYPES[conn.type] : undefined;
    if (!conn || !type?.begin) {
      htmlPage(res, 'Sign-in unavailable', 'That sign-in method is not configured.', 404);
      return true;
    }
    const test = url.searchParams.get('test') === '1';
    if (test && !isAdminRequest(req, db, config)) {
      htmlPage(res, 'Not allowed', 'Only admins can test sign-in providers.', 403);
      return true;
    }
    const state = randomUUID();
    const redirectUri = callbackUrl(req, config, conn.id);
    void type.begin(conn, redirectUri, state)
      .then(({ url: authUrl, state: stored }) => {
        pendingLogins.set(state, { providerId: conn.id, stored, keepLoggedIn: url.searchParams.get('keep') === 'true', redirectUri, test, createdAt: Date.now() });
        res.writeHead(302, { Location: authUrl });
        res.end();
      })
      .catch((err) => htmlPage(res, 'Sign-in failed', `Could not start sign-in: ${(err as Error).message}`, 502));
    return true;
  }

  const callbackMatch = /^\/auth\/callback\/([^/]+)$/.exec(pathname);
  if (callbackMatch && method === 'GET') {
    const error = url.searchParams.get('error');
    if (error) {
      htmlPage(res, 'Sign-in failed', url.searchParams.get('error_description') || error);
      return true;
    }
    const state = url.searchParams.get('state') ?? '';
    const pending = pendingLogins.get(state);
    pendingLogins.delete(state);
    const conn = (auth.providers ?? []).find((p) => p.id === decodeURIComponent(callbackMatch[1]));
    const type = conn ? AUTH_PROVIDER_TYPES[conn.type] : undefined;
    if (!pending || !conn || pending.providerId !== conn.id || !type?.complete) {
      htmlPage(res, 'Sign-in failed', 'This sign-in link expired or is invalid. Please try again.', 400);
      return true;
    }
    void (async () => {
      try {
        const current = new URL(`${baseUrl(req, config)}${req.url ?? pathname}`);
        const identity = await type.complete!(conn, current, pending.redirectUri, pending.stored, state);
        const oid = admit(db, auth, conn, identity);
        if (pending.test) {
          conn.verifiedAt = new Date().toISOString();
          saveConfig(config);
        }
        await syncCentralDirectory(db, oid);
        const token = createSession(db, oid, { keepLoggedIn: pending.keepLoggedIn });
        setSessionCookie(res, token, pending.keepLoggedIn);
        res.writeHead(302, { Location: pending.test ? '/settings?tab=authentication&tested=1' : '/' });
        res.end();
      } catch (err) {
        console.warn('[auth] Sign-in rejected:', (err as Error).message);
        htmlPage(res, 'Sign-in failed', (err as Error).message, 403);
      }
    })();
    return true;
  }

  if (pathname === '/api/auth/local/login' && method === 'POST') {
    void (async () => {
      try {
        if (!(auth.providers ?? []).some((p) => p.type === 'local')) return sendJson(res, 404, { error: 'Password sign-in is not enabled' });
        const body = JSON.parse(await readBody(req)) as { username?: string; password?: string; keep?: boolean };
        const username = verifyLocalPassword(db, body.username ?? '', body.password ?? '');
        if (!username) {
          await new Promise((r) => setTimeout(r, 400)); // slow down guessing
          return sendJson(res, 401, { error: 'Invalid username or password' });
        }
        const oid = localUserOid(username);
        if (!getActualRole(db, oid)) upsertUser(db, { oid, email: '', displayName: username, role: 'full', roleFromGroups: false });
        const token = createSession(db, oid, { keepLoggedIn: !!body.keep });
        setSessionCookie(res, token, !!body.keep);
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 400, { error: 'Invalid request' });
      }
    })();
    return true;
  }

  // ------------------------------------------------------------ signed in
  if (pathname === '/api/auth/me' && method === 'GET') {
    if (!req.user) { sendJson(res, 401, { error: 'Not authenticated' }); return true; }
    const dbRole = getActualRole(db, req.user.oid) ?? req.user.role;
    const override = auth.roleOverride;
    sendJson(res, 200, { ...req.user, role: dbRole === 'admin' && override ? override : dbRole, actualRole: dbRole, roleOverride: dbRole === 'admin' ? override ?? null : null });
    return true;
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const token = parseCookies(req.headers.cookie)['hive_session'];
    if (token) deleteSession(db, token);
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/auth/heartbeat' && method === 'POST') {
    if (!req.user) { sendJson(res, 401, { error: 'Not authenticated' }); return true; }
    void (async () => {
      try {
        const body = JSON.parse((await readBody(req)) || '{}') as { version?: string };
        const { UserManagementClient } = await import('../admin/user-management-client.js');
        const client = new UserManagementClient();
        try {
          const { forceUpdatePending } = await client.updateHeartbeat(req.user!.oid, body.version || getServerVersion(), os.hostname(), getLocalCommit());
          sendJson(res, 200, { ok: true, serverVersion: getServerVersion(), forceUpdatePending });
        } finally {
          await client.close();
        }
      } catch (err) {
        sendJson(res, 200, { ok: true, warning: (err as Error).message });
      }
    })();
    return true;
  }

  // --------------------------------------------------------------- admin
  const adminOnly = () => {
    if (isAdminRequest(req, db, config)) return false;
    sendJson(res, 403, { error: 'Admin access required' });
    return true;
  };

  if (pathname === '/api/auth/provider-types' && method === 'GET') {
    if (adminOnly()) return true;
    sendJson(res, 200, listAuthProviderTypes());
    return true;
  }

  if (pathname === '/api/auth/settings' && method === 'GET') {
    if (adminOnly()) return true;
    sendJson(res, 200, {
      enabled: !!auth.enabled,
      active: isAuthEnabled(config),
      disabledByEnv: process.env.HIVE_AUTH_DISABLED === '1',
      providers: (auth.providers ?? []).map(adminProviderView),
      allowedDomains: auth.allowedDomains ?? [],
      allowedEmails: auth.allowedEmails ?? [],
      callbackBase: `${baseUrl(req, config)}/auth/callback/`,
      admins: (db.prepare("SELECT oid, email, displayName FROM users WHERE role = 'admin'").all() as { oid: string; email: string; displayName: string }[]),
    });
    return true;
  }

  if (pathname === '/api/auth/settings' && method === 'PUT') {
    if (adminOnly()) return true;
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { enabled?: boolean; allowedDomains?: string[]; allowedEmails?: string[] };
        const settings = (config.auth ??= {}) as AuthSettings;
        const list = (v: unknown) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : undefined);
        if (body.allowedDomains !== undefined) settings.allowedDomains = list(body.allowedDomains);
        if (body.allowedEmails !== undefined) settings.allowedEmails = list(body.allowedEmails);
        if (body.enabled === true && !settings.enabled) {
          // Lock-out guard: someone must already be able to sign in as admin.
          const providers = settings.providers ?? [];
          const verified = providers.filter((p) => p.type !== 'local' && p.verifiedAt).map((p) => `${p.type}:`);
          const hasLocal = providers.some((p) => p.type === 'local');
          const admins = db.prepare("SELECT oid FROM users WHERE role = 'admin'").all() as { oid: string }[];
          const reachableAdmin = admins.some((a) => verified.some((prefix) => a.oid.startsWith(prefix)) || (hasLocal && a.oid.startsWith('local:') && listLocalAccounts(db).some((l) => localUserOid(l.username) === a.oid)));
          if (!reachableAdmin) {
            return sendJson(res, 400, { error: 'Before turning login on, sign in once with a provider using "Test sign-in" (or create a local admin account) so an admin can get back in.' });
          }
        }
        if (body.enabled !== undefined) settings.enabled = body.enabled;
        saveConfig(config);
        sendJson(res, 200, { ok: true, enabled: !!settings.enabled, active: isAuthEnabled(config) });
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
      }
    })();
    return true;
  }

  if (pathname === '/api/auth/providers' && method === 'POST') {
    if (adminOnly()) return true;
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { type?: AuthProviderType; label?: string; settings?: Record<string, unknown>; secrets?: Record<string, string> };
        const type = body.type ? AUTH_PROVIDER_TYPES[body.type] : undefined;
        if (!type) return sendJson(res, 400, { error: 'Unknown provider type' });
        if (type.type === 'local' && providersOf(config).some((p) => p.type === 'local')) return sendJson(res, 400, { error: 'Password sign-in is already enabled' });
        const conn: AuthProviderConnection = {
          id: `${type.type}-${randomBytes(3).toString('hex')}`,
          type: type.type,
          label: body.label?.trim() || type.displayName,
          settings: cleanSettings(type.type, body.settings),
        };
        for (const f of type.configSchema) {
          if (f.type === 'secret' && body.secrets?.[f.key]) setSecret(authSecretRef(conn.id, f.key), body.secrets[f.key]);
        }
        providersOf(config).push(conn);
        saveConfig(config);
        sendJson(res, 201, { ...adminProviderView(conn), callbackUrl: callbackUrl(req, config, conn.id) });
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
      }
    })();
    return true;
  }

  const providerMatch = /^\/api\/auth\/providers\/([^/]+)$/.exec(pathname);
  if (providerMatch) {
    if (adminOnly()) return true;
    const id = decodeURIComponent(providerMatch[1]);
    const conn = providersOf(config).find((p) => p.id === id);
    if (!conn) { sendJson(res, 404, { error: 'Provider not found' }); return true; }
    if (method === 'DELETE') {
      const settings = config.auth as AuthSettings;
      settings.providers = providersOf(config).filter((p) => p.id !== id);
      if (!settings.providers.length) settings.enabled = false;
      deleteSecretsWithPrefix(`auth:${id}:`);
      saveConfig(config);
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method === 'PUT') {
      void (async () => {
        try {
          const body = JSON.parse(await readBody(req)) as { label?: string; settings?: Record<string, unknown>; secrets?: Record<string, string> };
          if (body.label !== undefined) conn.label = body.label.trim() || conn.label;
          if (body.settings !== undefined) conn.settings = cleanSettings(conn.type, body.settings);
          for (const f of AUTH_PROVIDER_TYPES[conn.type].configSchema) {
            if (f.type === 'secret' && body.secrets?.[f.key]) setSecret(authSecretRef(conn.id, f.key), body.secrets[f.key]);
          }
          delete conn.verifiedAt; // settings changed → re-test before relying on it
          saveConfig(config);
          sendJson(res, 200, adminProviderView(conn));
        } catch (err) {
          sendJson(res, 400, { error: (err as Error).message });
        }
      })();
      return true;
    }
  }

  if (pathname === '/api/auth/local-accounts' && method === 'GET') {
    if (adminOnly()) return true;
    sendJson(res, 200, listLocalAccounts(db).map((a) => ({ ...a, role: getActualRole(db, localUserOid(a.username)) ?? 'full' })));
    return true;
  }

  if (pathname === '/api/auth/local-accounts' && method === 'POST') {
    if (adminOnly()) return true;
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { username?: string; password?: string; admin?: boolean };
        setLocalPassword(db, body.username ?? '', body.password ?? '');
        const oid = localUserOid(body.username ?? '');
        const anyAdmins = !!db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get();
        const role: HiveRole = body.admin || !anyAdmins ? 'admin' : (getActualRole(db, oid) ?? 'full');
        upsertUser(db, { oid, email: '', displayName: (body.username ?? '').trim(), role, roleFromGroups: role === 'admin' });
        sendJson(res, 201, { ok: true, oid, role });
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
      }
    })();
    return true;
  }

  const localMatch = /^\/api\/auth\/local-accounts\/([^/]+)$/.exec(pathname);
  if (localMatch && method === 'DELETE') {
    if (adminOnly()) return true;
    sendJson(res, deleteLocalAccount(db, decodeURIComponent(localMatch[1])) ? 200 : 404, { ok: true });
    return true;
  }

  if (pathname === '/api/auth/role-override' && method === 'POST') {
    if (!req.user || getActualRole(db, req.user.oid) !== 'admin') { sendJson(res, 403, { error: 'Admin access required' }); return true; }
    void (async () => {
      try {
        const { role } = JSON.parse(await readBody(req)) as { role: string | null };
        if (role && !['admin', 'full'].includes(role)) return sendJson(res, 400, { error: 'Invalid role' });
        const settings = (config.auth ??= {}) as AuthSettings;
        if (role) settings.roleOverride = role as HiveRole;
        else delete settings.roleOverride;
        saveConfig(config);
        sendJson(res, 200, { ok: true, roleOverride: role || null });
      } catch {
        sendJson(res, 400, { error: 'Invalid request' });
      }
    })();
    return true;
  }

  if (pathname === '/api/auth/users' && method === 'GET') {
    if (adminOnly()) return true;
    sendJson(res, 200, listUsers(db));
    return true;
  }

  const roleMatch = /^\/api\/auth\/users\/([^/]+)\/role$/.exec(pathname);
  if (roleMatch && method === 'PATCH') {
    if (adminOnly()) return true;
    void (async () => {
      try {
        const { role } = JSON.parse(await readBody(req)) as { role: HiveRole };
        if (!['admin', 'full'].includes(role)) return sendJson(res, 400, { error: 'Invalid role. Must be admin or full.' });
        const oid = decodeURIComponent(roleMatch[1]);
        if (role !== 'admin' && req.user?.oid === oid) return sendJson(res, 400, { error: 'You cannot remove your own admin role' });
        sendJson(res, updateUserRole(db, oid, role) ? 200 : 404, { ok: true });
      } catch {
        sendJson(res, 400, { error: 'Invalid request body' });
      }
    })();
    return true;
  }

  return false;
}
