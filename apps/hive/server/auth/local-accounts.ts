/**
 * Local username/password accounts, for installs without an identity
 * provider. Passwords are scrypt-hashed (per-account salt) in the local
 * SQLite DB. Each account maps to a Hive user `local:<username>`.
 */
import type Database from 'better-sqlite3';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 64;
const SCRYPT = { N: 16384, r: 8, p: 1 } as const;

export function createLocalAccountTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_accounts (
      username TEXT PRIMARY KEY,
      passwordHash TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
}

function hash(password: string, salt = randomBytes(16)): string {
  const key = scryptSync(password, salt, KEY_LEN, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verify(password: string, stored: string): boolean {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return timingSafeEqual(actual, expected);
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function validatePassword(password: string): string | null {
  if (password.length < 10) return 'Password must be at least 10 characters';
  return null;
}

export function localUserOid(username: string): string {
  return `local:${normalizeUsername(username)}`;
}

export function setLocalPassword(db: Database.Database, username: string, password: string): void {
  const u = normalizeUsername(username);
  if (!/^[a-z0-9._@-]{2,64}$/.test(u)) throw new Error('Usernames are 2-64 characters: letters, digits, . _ @ -');
  const problem = validatePassword(password);
  if (problem) throw new Error(problem);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO local_accounts (username, passwordHash, createdAt, updatedAt) VALUES (?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET passwordHash = excluded.passwordHash, updatedAt = excluded.updatedAt
  `).run(u, hash(password), now, now);
}

/** Returns the normalized username on success, null otherwise (constant-ish time). */
export function verifyLocalPassword(db: Database.Database, username: string, password: string): string | null {
  const u = normalizeUsername(username);
  const row = db.prepare('SELECT passwordHash FROM local_accounts WHERE username = ?').get(u) as { passwordHash: string } | undefined;
  // Hash anyway when the user doesn't exist so timing doesn't reveal usernames.
  const ok = verify(password, row?.passwordHash ?? hash('invalid-password-placeholder'));
  return row && ok ? u : null;
}

export function listLocalAccounts(db: Database.Database): { username: string; createdAt: string }[] {
  return db.prepare('SELECT username, createdAt FROM local_accounts ORDER BY username').all() as { username: string; createdAt: string }[];
}

export function deleteLocalAccount(db: Database.Database, username: string): boolean {
  return db.prepare('DELETE FROM local_accounts WHERE username = ?').run(normalizeUsername(username)).changes > 0;
}
