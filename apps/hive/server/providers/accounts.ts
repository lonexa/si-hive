/**
 * Multiple credential identities per AI provider.
 *
 * A provider CLI keeps its credentials, settings, skills, agents, plugins and
 * session history in one config dir (~/.claude). Pointing the CLI at a second
 * dir via CLAUDE_CONFIG_DIR gives you a second, fully-scoped login — but a bare
 * second dir also means no skills, no agents, no session history.
 *
 * So an account dir is not a copy. The account-agnostic entries are junctioned
 * (Windows) or symlinked (POSIX) straight back to the primary dir, so there is
 * exactly ONE copy on disk of skills/agents/plugins and — importantly — of
 * `projects/`, where session transcripts live. Both accounts read and write the
 * same session pool, so any session can be resumed under either account.
 * Transcripts carry no account identity, so that resume is clean.
 *
 * Only genuinely per-account state stays private: the credentials themselves
 * plus live-process and telemetry files that would corrupt each other if shared.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isWindows } from '../platform.js';
import { getProvider } from './registry.js';
import type { ProviderId, AccountConfig, AccountStatus, ProvidersConfig } from './types.js';

/** Reserved id of the implicit account backed by the provider's own homeDir(). */
export const DEFAULT_ACCOUNT_ID = 'default';

/** Providers where a second credential identity is supported. */
const MULTI_ACCOUNT_PROVIDERS = new Set<ProviderId>(['claude']);

interface ShareSpec {
  /** Directories junctioned back to the primary config dir. */
  linkDirs: string[];
  /** Files copied once at creation (no junction — single files break on rewrite). */
  copyFiles: string[];
  /**
   * State file seeded from the primary account with the identity-bearing keys
   * removed. Lives beside the config dir for the default account and inside it
   * for a CLAUDE_CONFIG_DIR account, so it needs its own resolution.
   */
  seedStateFile?: { name: string; stripKeys: string[] };
}

const SHARE_SPECS: Partial<Record<ProviderId, ShareSpec>> = {
  claude: {
    // `projects` is the important one — all session transcripts live there, and
    // sharing it is what lets either account resume any session.
    linkDirs: ['projects', 'skills', 'agents', 'plugins', 'commands'],
    // Rewritten via temp-and-rename by the CLI, which breaks hardlinks, so these
    // are copied and re-synced on demand instead of linked.
    copyFiles: ['settings.json', 'CLAUDE.md'],
    // `.claude.json` carries per-project trust (hasTrustDialogAccepted),
    // allowedTools and project-scoped MCP servers. Without seeding it, a new
    // account re-prompts "do you trust this folder?" for every project and
    // loses its tool permissions — a visible difference from single-account use.
    // It ALSO carries the signed-in identity and entitlement caches, which must
    // not be carried across, hence the strip list.
    seedStateFile: {
      name: '.claude.json',
      stripKeys: [
        'oauthAccount',
        'userID',
        'machineID',
        'passesEligibilityCache',
        'passesLastSeenRemaining',
        'passesUpsellSeenCount',
        'hasVisitedPasses',
        'overageCreditGrantCache',
        'overageCreditUpsellSeenCount',
        'cachedExtraUsageDisabledReason',
        'modelAccessCache',
        'orgModelDefaultCache',
        'additionalModelOptionsCache',
        'additionalModelCostsCache',
        'metricsStatusCache',
        'penguinModeOrgEnabled',
        'hasRemoteEnvironment',
        'clientDataCacheSlots',
        'groveConfigCache',
      ],
    },
  },
};

/**
 * Where the provider's mutable state file lives for a given config dir.
 * For the default account it sits BESIDE the config dir (~/.claude.json); for
 * a CLAUDE_CONFIG_DIR account the CLI writes it INSIDE (verified by running the
 * CLI against an empty dir). Prefer the inside path when present.
 */
function stateFilePath(configDir: string, name: string): string {
  const inside = path.join(configDir, name);
  if (fs.existsSync(inside)) return inside;
  return path.join(path.dirname(configDir), name);
}

/**
 * Seed an account's state file from the primary one, dropping identity and
 * entitlement keys so the new account authenticates as itself. On a re-sync the
 * destination's own identity keys are preserved — only the shared settings
 * (project trust, allowedTools, MCP servers) are refreshed.
 */
function seedStateFile(
  primaryHome: string,
  configDir: string,
  spec: NonNullable<ShareSpec['seedStateFile']>,
): { seeded: boolean; reason?: string } {
  const src = stateFilePath(primaryHome, spec.name);
  if (!fs.existsSync(src)) return { seeded: false, reason: 'no primary state file' };
  const dest = path.join(configDir, spec.name);

  let source: Record<string, unknown>;
  try {
    source = JSON.parse(fs.readFileSync(src, 'utf-8')) as Record<string, unknown>;
  } catch (err) {
    return { seeded: false, reason: `unreadable primary state file: ${(err as Error).message}` };
  }

  const shared: Record<string, unknown> = { ...source };
  for (const key of spec.stripKeys) delete shared[key];

  // Preserve whatever identity the destination already established.
  let preserved: Record<string, unknown> = {};
  if (fs.existsSync(dest)) {
    try {
      const existing = JSON.parse(fs.readFileSync(dest, 'utf-8')) as Record<string, unknown>;
      for (const key of spec.stripKeys) {
        if (key in existing) preserved[key] = existing[key];
      }
    } catch {
      preserved = {};
    }
  }

  fs.writeFileSync(dest, JSON.stringify({ ...shared, ...preserved }, null, 2), 'utf-8');
  return { seeded: true };
}

export function supportsAccounts(providerId: ProviderId): boolean {
  return MULTI_ACCOUNT_PROVIDERS.has(providerId);
}

/** Account ids are used as directory-name suffixes — keep them boring. */
export function isValidAccountId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,30}$/.test(id) && id !== DEFAULT_ACCOUNT_ID;
}

/**
 * The provider's PRIMARY config dir — the one accounts share entries back to.
 *
 * Must not lean on os.homedir() alone: when Hive runs as a Windows service under
 * LocalSystem, os.homedir() is the system profile dir, not the real user's, so
 * account dirs would be created in the wrong place and share nothing. Mirrors
 * getClaudeHomeDir() in sessions/replay-client.ts.
 */
export function primaryHomeFor(
  providerId: ProviderId,
  config?: { claudeHome?: string },
): string {
  if (providerId === 'claude') {
    if (config?.claudeHome && path.isAbsolute(config.claudeHome)) return config.claudeHome;
    if (process.env['CLAUDE_HOME']) return process.env['CLAUDE_HOME'];
    let home = os.homedir();
    try {
      const userHomePath = path.join(path.dirname(process.execPath), '..', 'user-home.txt');
      if (fs.existsSync(userHomePath)) {
        home = fs.readFileSync(userHomePath, 'utf-8').trim();
      }
    } catch { /* ignore */ }
    return path.join(home, '.claude');
  }
  return getProvider(providerId).homeDir();
}

/** Default location for a new account's config dir, e.g. ~/.claude-personal. */
export function defaultConfigDirFor(
  providerId: ProviderId,
  accountId: string,
  config?: { claudeHome?: string },
): string {
  return `${primaryHomeFor(providerId, config)}-${accountId}`;
}

function providersConfigOf(config: { aiProviders?: ProvidersConfig }): ProvidersConfig {
  return config.aiProviders ?? { primary: 'claude', providers: { claude: { enabled: true } } };
}

/** Configured (non-default) accounts for a provider. */
export function configuredAccounts(
  config: { aiProviders?: ProvidersConfig },
  providerId: ProviderId,
): AccountConfig[] {
  if (!supportsAccounts(providerId)) return [];
  return providersConfigOf(config).providers?.[providerId]?.accounts ?? [];
}

/** True once this account dir holds a credentials FILE. Cheap; no process spawn. */
export function hasCredentialsFile(configDir: string): boolean {
  try {
    return fs.existsSync(path.join(configDir, '.credentials.json'));
  } catch {
    return false;
  }
}

export interface AuthStatus {
  loggedIn: boolean;
  email?: string;
  orgName?: string;
  subscriptionType?: string;
}

/**
 * Cache for `auth status`, which costs a process spawn (~1s). Keyed by config
 * dir. Short-lived so a completed login is noticed promptly while a poll loop
 * cannot spawn a process per request.
 */
const authStatusCache = new Map<string, { at: number; status: AuthStatus }>();
const AUTH_STATUS_TTL_MS = 5000;

/**
 * Authoritative sign-in state, straight from the CLI.
 *
 * Preferred over looking for `.credentials.json` because credentials do not
 * always land in a file — Windows Credential Manager is used in some setups —
 * and because the CLI also reports which account is signed in, which is what
 * makes an account distinguishable in the UI.
 */
export function getAuthStatus(
  providerId: ProviderId,
  configDir: string,
  customPath?: string,
): AuthStatus {
  const cached = authStatusCache.get(configDir);
  if (cached && Date.now() - cached.at < AUTH_STATUS_TTL_MS) return cached.status;

  let status: AuthStatus = { loggedIn: hasCredentialsFile(configDir) };
  try {
    const exe = getProvider(providerId).exePath(customPath);
    const out = execFileSync(exe, ['auth', 'status', '--json'], {
      encoding: 'utf-8',
      timeout: 20000,
      windowsHide: true,
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    });
    const parsed = JSON.parse(out) as {
      loggedIn?: boolean; email?: string; orgName?: string; subscriptionType?: string;
    };
    status = {
      loggedIn: parsed.loggedIn === true,
      email: parsed.email,
      orgName: parsed.orgName,
      subscriptionType: parsed.subscriptionType,
    };
  } catch {
    // CLI missing, too slow, or output not JSON — fall back to the file check
    // rather than reporting a logged-in account as signed out.
  }
  authStatusCache.set(configDir, { at: Date.now(), status });
  return status;
}

/** Drop the cached status for a dir, so the next read reflects a just-finished login. */
export function invalidateAuthStatus(configDir: string): void {
  authStatusCache.delete(configDir);
}

/** @deprecated prefer hasCredentialsFile (cheap) or getAuthStatus (authoritative). */
export function isAuthenticated(configDir: string): boolean {
  return hasCredentialsFile(configDir);
}

/**
 * Selectable accounts for a provider, implicit default first. A provider with
 * no configured accounts returns just the default, so callers that don't care
 * about accounts see exactly the pre-existing single-identity behaviour.
 */
export function listAccounts(
  config: { aiProviders?: ProvidersConfig; claudeHome?: string },
  providerId: ProviderId,
): AccountStatus[] {
  let primaryHome: string | null = null;
  try {
    primaryHome = primaryHomeFor(providerId, config);
  } catch { /* provider can't resolve a home — default account has no dir */ }

  const accounts: AccountStatus[] = [{
    id: DEFAULT_ACCOUNT_ID,
    label: 'Default',
    configDir: primaryHome,
    authenticated: primaryHome ? isAuthenticated(primaryHome) : false,
    isDefault: true,
  }];

  for (const acct of configuredAccounts(config, providerId)) {
    const dir = acct.configDir ?? defaultConfigDirFor(providerId, acct.id, config);
    accounts.push({
      id: acct.id,
      label: acct.label || acct.id,
      configDir: dir,
      authenticated: isAuthenticated(dir),
      isDefault: false,
    });
  }
  return accounts;
}

/** Account id to preselect, falling back to default when the stored one is gone. */
export function defaultAccountId(
  config: { aiProviders?: ProvidersConfig },
  providerId: ProviderId,
): string {
  const stored = providersConfigOf(config).providers?.[providerId]?.defaultAccount;
  if (!stored || stored === DEFAULT_ACCOUNT_ID) return DEFAULT_ACCOUNT_ID;
  const exists = configuredAccounts(config, providerId).some((a) => a.id === stored);
  return exists ? stored : DEFAULT_ACCOUNT_ID;
}

/**
 * Config dir to launch under, or undefined for the default account.
 *
 * Deliberately forgiving: an unknown or unauthenticated account id resolves to
 * undefined (the default account) rather than throwing. The provider CLI
 * auto-updates underneath us and Hive ships to the whole team on every push, so
 * a launch must never hard-fail because account plumbing drifted.
 */
export function resolveAccountConfigDir(
  config: { aiProviders?: ProvidersConfig; claudeHome?: string },
  providerId: ProviderId,
  accountId?: string,
): string | undefined {
  if (!accountId || accountId === DEFAULT_ACCOUNT_ID) return undefined;
  if (!supportsAccounts(providerId)) return undefined;

  const acct = configuredAccounts(config, providerId).find((a) => a.id === accountId);
  if (!acct) {
    console.warn(`[accounts] Unknown ${providerId} account "${accountId}" — using default`);
    return undefined;
  }
  const dir = acct.configDir ?? defaultConfigDirFor(providerId, acct.id, config);
  if (!fs.existsSync(dir)) {
    console.warn(`[accounts] Config dir missing for "${accountId}" (${dir}) — using default`);
    return undefined;
  }
  return dir;
}

/** Create a directory junction (Windows) or symlink (POSIX). No admin needed. */
function linkDir(target: string, linkPath: string): void {
  if (isWindows) {
    // mklink is a cmd builtin, not an exe — and /J junctions need no elevation.
    execFileSync('cmd.exe', ['/c', 'mklink', '/J', linkPath, target], {
      encoding: 'utf-8',
      timeout: 15000,
      windowsHide: true,
    });
  } else {
    fs.symlinkSync(target, linkPath, 'dir');
  }
}

/** True when the path is already a junction/symlink (not a real directory). */
function isLink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export interface LinkReport {
  linked: string[];
  copied: string[];
  skipped: Array<{ entry: string; reason: string }>;
}

/**
 * Build (or repair) the shared-entry links for an account dir. Idempotent:
 * existing links are left alone, so this doubles as the repair path when a
 * provider update or a manual delete removes one.
 */
export function linkSharedEntries(
  providerId: ProviderId,
  configDir: string,
  opts?: { resyncFiles?: boolean; primaryHome?: string },
): LinkReport {
  const spec = SHARE_SPECS[providerId];
  const report: LinkReport = { linked: [], copied: [], skipped: [] };
  if (!spec) return report;

  const primaryHome = opts?.primaryHome ?? primaryHomeFor(providerId);
  if (path.resolve(primaryHome) === path.resolve(configDir)) {
    throw new Error('Refusing to link a config dir onto itself');
  }
  fs.mkdirSync(configDir, { recursive: true });

  for (const entry of spec.linkDirs) {
    const target = path.join(primaryHome, entry);
    const linkPath = path.join(configDir, entry);
    try {
      if (isLink(linkPath)) {
        report.skipped.push({ entry, reason: 'already linked' });
        continue;
      }
      if (fs.existsSync(linkPath)) {
        // A real directory sitting where the link belongs — refuse rather than
        // delete, since it may hold sessions created before the link existed.
        report.skipped.push({ entry, reason: 'real directory present, not replaced' });
        continue;
      }
      // Create the target in the primary dir if it doesn't exist yet, so the
      // link resolves now and stays shared once the CLI populates it.
      fs.mkdirSync(target, { recursive: true });
      linkDir(target, linkPath);
      report.linked.push(entry);
    } catch (err) {
      report.skipped.push({ entry, reason: (err as Error).message });
    }
  }

  if (spec.seedStateFile) {
    const entry = spec.seedStateFile.name;
    const dest = path.join(configDir, entry);
    try {
      if (fs.existsSync(dest) && !opts?.resyncFiles) {
        report.skipped.push({ entry, reason: 'already present' });
      } else {
        const result = seedStateFile(primaryHome, configDir, spec.seedStateFile);
        if (result.seeded) report.copied.push(`${entry} (project trust + tool permissions)`);
        else report.skipped.push({ entry, reason: result.reason ?? 'not seeded' });
      }
    } catch (err) {
      report.skipped.push({ entry, reason: (err as Error).message });
    }
  }

  for (const file of spec.copyFiles) {
    const src = path.join(primaryHome, file);
    const dest = path.join(configDir, file);
    try {
      if (!fs.existsSync(src)) {
        report.skipped.push({ entry: file, reason: 'not present in primary dir' });
        continue;
      }
      if (fs.existsSync(dest) && !opts?.resyncFiles) {
        report.skipped.push({ entry: file, reason: 'already present' });
        continue;
      }
      fs.copyFileSync(src, dest);
      report.copied.push(file);
    } catch (err) {
      report.skipped.push({ entry: file, reason: (err as Error).message });
    }
  }

  return report;
}

/**
 * Create the on-disk dir for a new account. Does NOT authenticate — the caller
 * opens a PTY running the provider CLI against this dir, which drops into the
 * normal login flow because no credentials are present yet.
 */
export function createAccountDir(
  providerId: ProviderId,
  accountId: string,
  configDir: string,
  primaryHome: string,
): LinkReport {
  if (!supportsAccounts(providerId)) {
    throw new Error(`${providerId} does not support multiple accounts`);
  }
  if (!isValidAccountId(accountId)) {
    throw new Error('Account id must be lowercase letters, numbers and dashes, and cannot be "default"');
  }
  if (path.resolve(primaryHome) === path.resolve(configDir)) {
    throw new Error('Account config dir cannot be the primary provider dir');
  }
  if (fs.existsSync(path.join(configDir, '.credentials.json'))) {
    throw new Error(`${configDir} already holds credentials`);
  }
  return linkSharedEntries(providerId, configDir, { primaryHome });
}

/**
 * Remove an account's config dir. Junctions are removed with rmdir (which
 * deletes the link, never the target) before the dir itself, so shared skills
 * and — critically — shared session history are never touched.
 */
export function removeAccountDir(configDir: string): void {
  if (!fs.existsSync(configDir)) return;

  const primaryDirs = new Set(
    Object.values(SHARE_SPECS).flatMap((s) => s?.linkDirs ?? []),
  );
  for (const entry of fs.readdirSync(configDir)) {
    const p = path.join(configDir, entry);
    if (isLink(p)) {
      // rmdir on a junction unlinks it and leaves the target intact.
      try { fs.rmdirSync(p); } catch { /* fall through to the recursive delete */ }
    } else if (primaryDirs.has(entry)) {
      // Defensive: a shared-name entry that is NOT a link means real data got
      // written here. Leave it and let the caller see the dir survive.
      throw new Error(
        `Refusing to delete ${configDir}: "${entry}" is a real directory, not a link. ` +
        'Move anything you need out of it first.',
      );
    }
  }
  fs.rmSync(configDir, { recursive: true, force: true });
}
