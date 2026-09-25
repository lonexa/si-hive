import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  createLocalAccountTables,
  setLocalPassword,
  verifyLocalPassword,
  listLocalAccounts,
  deleteLocalAccount,
  localUserOid,
} from '../auth/local-accounts.js';
import { isAuthEnabled, isEmailAllowed, localUser } from '../auth/settings.js';
import type { HiveConfig } from '../types.js';

const baseConfig = { projects: [], claudeHome: '', server: { port: 1 }, notifications: { macOS: false, browser: false }, projectsRoot: '', theme: 'dark' } as unknown as HiveConfig;

describe('local accounts', () => {
  const db = new Database(':memory:');
  createLocalAccountTables(db);

  it('hashes passwords and verifies them case-insensitively by username', () => {
    setLocalPassword(db, 'Alice', 'correct horse battery');
    expect(verifyLocalPassword(db, 'alice', 'correct horse battery')).toBe('alice');
    expect(verifyLocalPassword(db, 'ALICE', 'correct horse battery')).toBe('alice');
    expect(verifyLocalPassword(db, 'alice', 'wrong password!!')).toBeNull();
    expect(verifyLocalPassword(db, 'nobody', 'correct horse battery')).toBeNull();
    const row = db.prepare('SELECT passwordHash FROM local_accounts WHERE username = ?').get('alice') as { passwordHash: string };
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(row.passwordHash).not.toContain('correct horse');
  });

  it('rejects short passwords and odd usernames', () => {
    expect(() => setLocalPassword(db, 'bob', 'short')).toThrow(/at least 10/);
    expect(() => setLocalPassword(db, 'bad name!', 'long enough password')).toThrow(/Usernames/);
  });

  it('resets, lists and deletes', () => {
    setLocalPassword(db, 'alice', 'a brand new password');
    expect(verifyLocalPassword(db, 'alice', 'a brand new password')).toBe('alice');
    expect(listLocalAccounts(db).map((a) => a.username)).toContain('alice');
    expect(localUserOid('Alice')).toBe('local:alice');
    expect(deleteLocalAccount(db, 'alice')).toBe(true);
    expect(verifyLocalPassword(db, 'alice', 'a brand new password')).toBeNull();
  });
});

describe('auth settings', () => {
  afterEach(() => { delete process.env.HIVE_AUTH_DISABLED; });

  it('is off by default and needs a provider', () => {
    expect(isAuthEnabled(baseConfig)).toBe(false);
    expect(isAuthEnabled({ ...baseConfig, auth: { enabled: true, providers: [] } })).toBe(false);
    const on = { ...baseConfig, auth: { enabled: true, providers: [{ id: 'x', type: 'local', label: 'x', settings: {} }] } } as HiveConfig;
    expect(isAuthEnabled(on)).toBe(true);
    process.env.HIVE_AUTH_DISABLED = '1';
    expect(isAuthEnabled(on)).toBe(false);
  });

  it('matches allowed emails and domains', () => {
    const auth = { allowedDomains: ['Example.com', '@corp.io'], allowedEmails: ['guest@other.org'] };
    expect(isEmailAllowed(auth, 'a@example.com')).toBe(true);
    expect(isEmailAllowed(auth, 'a@corp.io')).toBe(true);
    expect(isEmailAllowed(auth, 'Guest@Other.org')).toBe(true);
    expect(isEmailAllowed(auth, 'a@evil-example.com')).toBe(false);
    expect(isEmailAllowed(auth, 'a@sub.example.com')).toBe(false);
    expect(isEmailAllowed(auth, 'not-an-email')).toBe(false);
  });

  it('local user is an admin', () => {
    expect(localUser(baseConfig).role).toBe('admin');
    expect(localUser(baseConfig).oid).toBe('local');
  });
});
