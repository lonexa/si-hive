/**
 * Auth settings (`config.auth`) and the single-user default.
 *
 * Login is OFF unless `auth.enabled` is true, at least one provider is
 * configured, and HIVE_AUTH_DISABLED is not set (the recovery switch if an
 * admin locks themselves out).
 */
import os from 'node:os';
import type { HiveConfig } from '../types.js';
import type { AuthUser } from './types.js';
import type { AuthProviderConnection } from './providers.js';

export interface AuthSettings {
  enabled?: boolean;
  providers?: AuthProviderConnection[];
  /** New users may sign up only if their email matches one of these (or an admin added them). */
  allowedDomains?: string[];
  allowedEmails?: string[];
  /** Admin-only: preview the app as another role. */
  roleOverride?: 'admin' | 'full';
}

export function getAuthSettings(config: HiveConfig): AuthSettings {
  return (config.auth as AuthSettings | undefined) ?? {};
}

export function isAuthEnabled(config: HiveConfig): boolean {
  if (process.env.HIVE_AUTH_DISABLED === '1') return false;
  const auth = getAuthSettings(config);
  return !!auth.enabled && (auth.providers?.length ?? 0) > 0;
}

/**
 * The implicit user when login is off: this machine's OS user, as admin.
 * Keeps per-user features (reviews, handoff, personal workflows) working in
 * single-user installs.
 */
export function localUser(config: HiveConfig): AuthUser {
  let name = 'local';
  try { name = os.userInfo().username || name; } catch { /* ignore */ }
  const configured = config.user as { email?: string; displayName?: string } | undefined;
  return {
    oid: 'local',
    email: configured?.email ?? '',
    displayName: configured?.displayName || name,
    role: 'admin',
  };
}

/** Whether a never-seen identity may create an account. */
export function isEmailAllowed(auth: AuthSettings, email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!e.includes('@')) return false;
  if ((auth.allowedEmails ?? []).some((a) => a.trim().toLowerCase() === e)) return true;
  const domain = e.split('@')[1];
  return (auth.allowedDomains ?? []).some((d) => d.trim().toLowerCase().replace(/^@/, '') === domain);
}
