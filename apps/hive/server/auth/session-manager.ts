import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { AuthUser, AuthSession, HiveRole } from './types.js';

/**
 * Create auth-related tables in SQLite if they don't exist.
 */
export function createAuthTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      oid TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      displayName TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'full',
      lastLogin TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      userOid TEXT NOT NULL,
      accessToken TEXT,
      refreshToken TEXT,
      tokenExpiry TEXT,
      expiresAt TEXT NOT NULL,
      keepLoggedIn INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL
    );
  `);
}

/**
 * Upsert a user record (create or update on login).
 *
 * Role precedence:
 * - If the provider's admin group/team resolved to admin, always apply it
 * - Otherwise preserve the existing DB role so admin overrides via the Users page stick
 * - New users get the role the caller decided (see auth/routes.ts admit())
 */
export function upsertUser(
  db: Database.Database,
  user: { oid: string; email: string; displayName: string; role: HiveRole; roleFromGroups: boolean },
): void {
  const existing = db.prepare('SELECT role FROM users WHERE oid = ?').get(user.oid) as { role: string } | undefined;
  const now = new Date().toISOString();

  if (existing) {
    const newRole = user.roleFromGroups && user.role === 'admin' ? 'admin' : existing.role;
    db.prepare(`
      UPDATE users SET email = ?, displayName = ?, role = ?, lastLogin = ? WHERE oid = ?
    `).run(user.email, user.displayName, newRole, now, user.oid);
  } else {
    db.prepare(`
      INSERT INTO users (oid, email, displayName, role, lastLogin, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(user.oid, user.email, user.displayName, user.role, now, now);
  }
}

/**
 * One-shot migration: any pre-existing 'lite' users get promoted to 'full'.
 * Idempotent — safe to run every boot.
 */
export function migrateLiteToFull(db: Database.Database): void {
  db.prepare("UPDATE users SET role = 'full' WHERE role = 'lite'").run();
}

/**
 * Create a new auth session and return the session token.
 */
export function createSession(
  db: Database.Database,
  userOid: string,
  opts: {
    accessToken?: string;
    refreshToken?: string;
    tokenExpiry?: string;
    keepLoggedIn?: boolean;
  } = {},
): string {
  const token = randomUUID();
  const now = new Date();
  const keepLoggedIn = opts.keepLoggedIn ?? false;

  // 30 days if "keep me signed in", otherwise 8 hours
  const expiresAt = new Date(
    now.getTime() + (keepLoggedIn ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000),
  );

  const stmt = db.prepare(`
    INSERT INTO auth_sessions (token, userOid, accessToken, refreshToken, tokenExpiry, expiresAt, keepLoggedIn, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    token,
    userOid,
    opts.accessToken ?? null,
    opts.refreshToken ?? null,
    opts.tokenExpiry ?? null,
    expiresAt.toISOString(),
    keepLoggedIn ? 1 : 0,
    now.toISOString(),
  );

  return token;
}

/**
 * Look up a session by token. Returns null if expired or not found.
 */
export function getSession(db: Database.Database, token: string): (AuthSession & AuthUser) | null {
  const row = db.prepare(`
    SELECT
      s.token, s.userOid, s.accessToken, s.refreshToken, s.tokenExpiry,
      s.expiresAt, s.keepLoggedIn, s.createdAt as sessionCreatedAt,
      u.oid, u.email, u.displayName, u.role
    FROM auth_sessions s
    JOIN users u ON s.userOid = u.oid
    WHERE s.token = ?
  `).get(token) as Record<string, unknown> | undefined;

  if (!row) return null;

  // Check expiry
  const expiresAt = new Date(row.expiresAt as string);
  if (expiresAt < new Date()) {
    // Expired — clean up
    db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
    return null;
  }

  return {
    token: row.token as string,
    userOid: row.userOid as string,
    accessToken: row.accessToken as string | null,
    refreshToken: row.refreshToken as string | null,
    tokenExpiry: row.tokenExpiry as string | null,
    expiresAt: row.expiresAt as string,
    keepLoggedIn: (row.keepLoggedIn as number) === 1,
    createdAt: row.sessionCreatedAt as string,
    oid: row.oid as string,
    email: row.email as string,
    displayName: row.displayName as string,
    role: row.role as HiveRole,
  };
}

/**
 * Delete a session (logout).
 */
export function deleteSession(db: Database.Database, token: string): void {
  db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
}

/**
 * List all users (admin only).
 */
export function listUsers(db: Database.Database): AuthUser[] {
  const rows = db.prepare('SELECT oid, email, displayName, role FROM users ORDER BY email').all() as AuthUser[];
  return rows;
}

/**
 * Update a user's role (admin only).
 */
export function updateUserRole(db: Database.Database, oid: string, role: HiveRole): boolean {
  const result = db.prepare('UPDATE users SET role = ? WHERE oid = ?').run(role, oid);
  return result.changes > 0;
}

/**
 * Clean up expired sessions. Call periodically.
 */
export function cleanExpiredSessions(db: Database.Database): number {
  const result = db.prepare('DELETE FROM auth_sessions WHERE expiresAt < ?').run(new Date().toISOString());
  return result.changes;
}
