import type http from 'node:http';
import type Database from 'better-sqlite3';
import { getSession } from './session-manager.js';
import type { AuthUser, AuthenticatedRequest, HiveRole } from './types.js';

/**
 * Parse cookies from a Cookie header string.
 */
function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const pair of cookieHeader.split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key.trim()] = rest.join('=').trim();
  }
  return cookies;
}

/**
 * Extract the auth session cookie and look up the user.
 * Returns the authenticated user or null.
 */
export function authenticate(
  req: AuthenticatedRequest,
  db: Database.Database,
  roleOverride?: string,
): AuthUser | null {
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies['hive_session'];
  if (!sessionToken) return null;

  const session = getSession(db, sessionToken);
  if (!session) return null;

  // Apply role override if admin is testing another role
  let effectiveRole = session.role;
  if (roleOverride && session.role === 'admin') {
    effectiveRole = roleOverride as HiveRole;
  }

  // Attach user context to request
  const user: AuthUser = {
    oid: session.oid,
    email: session.email,
    displayName: session.displayName,
    role: effectiveRole,
  };

  req.user = user;
  req.authSession = session;

  return user;
}

/**
 * Check if the authenticated user has one of the required roles.
 */
export function requireRole(
  req: AuthenticatedRequest,
  allowedRoles: HiveRole[],
): boolean {
  if (!req.user) return false;
  return allowedRoles.includes(req.user.role);
}

/**
 * Set the session cookie on a response.
 */
export function setSessionCookie(
  res: http.ServerResponse,
  sessionToken: string,
  keepLoggedIn: boolean,
): void {
  const maxAge = keepLoggedIn ? 30 * 24 * 60 * 60 : undefined; // 30 days or session cookie
  const parts = [
    `hive_session=${sessionToken}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (maxAge !== undefined) {
    parts.push(`Max-Age=${maxAge}`);
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

/**
 * Clear the session cookie on a response.
 */
export function clearSessionCookie(res: http.ServerResponse): void {
  res.setHeader('Set-Cookie', 'hive_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

/**
 * URL paths that don't require authentication.
 */
/** Reachable without a session from anywhere. */
const PUBLIC_PATHS = [
  '/auth/',
  '/api/auth/config',
  '/api/auth/status',
  '/api/health',
  '/api/gmail/oauth/callback',
  // Accept anonymous client error reports so errors during login (before a
  // session exists) are still logged.
  '/api/errors/report',
  '/api/version',
];

/**
 * Reachable without a session only from this machine (127.0.0.1 / ::1):
 * Claude Code hook callbacks and headless CLI sessions (e.g. the
 * knowledge-base skill) that run next to the server.
 */
const LOOPBACK_PUBLIC_PATHS = [
  '/api/hooks/stop',
  '/api/hooks/user-prompt-submit',
  '/api/events',
  '/api/kb/',
];

export function isLoopbackAddress(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * Check if a URL path can be served without authentication.
 * `remoteAddress` enables the loopback-only exemptions.
 */
export function isPublicPath(pathname: string, remoteAddress?: string): boolean {
  // Static files (no /api prefix) are always public
  if (!pathname.startsWith('/api/') && !pathname.startsWith('/auth/')) {
    return true;
  }
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return true;
  return isLoopbackAddress(remoteAddress) && LOOPBACK_PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}
