/**
 * AI provider account management (admin-only).
 *
 * Creating an account makes a second provider config dir with the
 * account-agnostic entries junctioned back to the primary dir, then hands the
 * caller a terminal id. The client opens that terminal and the provider CLI —
 * launched against a dir with no credentials — drops straight into its own
 * login flow. There is no bespoke auth here: it is the real login, just pointed
 * at a different directory, which is why the resulting account is full-scope.
 *
 * Selecting an account at launch time is NOT gated: accounts live in the
 * calling user's own home dir and Hive runs one server per user, so a user with
 * no configured accounts simply sees no picker.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import type { AuthenticatedRequest } from '../auth/types.js';
import type { HiveConfig } from '../types.js';
import { loadConfig, saveConfig } from '../config.js';
import { spawnPty, destroyPty } from '../terminal-pty.js';
import { getProvider } from './registry.js';
import type { ProviderId, AccountConfig } from './types.js';
import {
  DEFAULT_ACCOUNT_ID,
  createAccountDir,
  getAuthStatus,
  invalidateAuthStatus,
  defaultConfigDirFor,
  isValidAccountId,
  linkSharedEntries,
  listAccounts,
  primaryHomeFor,
  removeAccountDir,
  supportsAccounts,
} from './accounts.js';

const VALID_PROVIDERS: ProviderId[] = ['claude', 'gemini', 'codex'];

/** readBody resolves the raw request text; treat an empty/invalid body as {}. */
function parseBody(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/**
 * Real admin role from the DB, not the request's effective role — this mirrors
 * user-management so an admin using "view as" cannot mutate account plumbing
 * while simulating a non-admin.
 */
function isActualAdmin(db: Database.Database, oid: string | undefined): boolean {
  if (!oid) return false;
  const row = db.prepare('SELECT role FROM users WHERE oid = ?').get(oid) as { role: string } | undefined;
  return row?.role === 'admin';
}

function requireAdmin(req: AuthenticatedRequest, res: http.ServerResponse, db: Database.Database): boolean {
  if (isActualAdmin(db, req.user?.oid)) return true;
  sendJson(res, 403, { error: 'Admin role required to manage AI provider accounts' });
  return false;
}

/** Persist an accounts list for a provider, preserving the rest of the config. */
function writeAccounts(
  providerId: ProviderId,
  mutate: (accounts: AccountConfig[]) => AccountConfig[],
  defaultAccount?: string,
): HiveConfig {
  const cfg = loadConfig();
  const aiProviders = cfg.aiProviders ?? { primary: 'claude' as ProviderId, providers: { claude: { enabled: true } } };
  const providers = { ...aiProviders.providers };
  const existing = providers[providerId] ?? { enabled: providerId === 'claude' };
  const next = mutate(existing.accounts ?? []);
  providers[providerId] = {
    ...existing,
    accounts: next,
    ...(defaultAccount !== undefined ? { defaultAccount } : {}),
  };
  const updated: HiveConfig = { ...cfg, aiProviders: { ...aiProviders, providers } };
  saveConfig(updated);
  return updated;
}

export function registerAccountRoutes(
  url: URL,
  req: AuthenticatedRequest,
  res: http.ServerResponse,
  db: Database.Database,
): boolean {
  const m = url.pathname.match(/^\/api\/providers\/([a-z]+)\/accounts(?:\/([a-z0-9-]+))?(?:\/([a-z-]+))?$/);
  if (!m) return false;

  const providerId = m[1] as ProviderId;
  const accountId = m[2];
  const action = m[3];

  if (!VALID_PROVIDERS.includes(providerId)) {
    sendJson(res, 400, { error: `Unknown provider: ${providerId}` });
    return true;
  }

  // --- List accounts (any authenticated user — this drives the launch picker) ---
  if (req.method === 'GET' && !accountId) {
    const config = loadConfig();
    sendJson(res, 200, {
      supported: supportsAccounts(providerId),
      primaryHome: supportsAccounts(providerId) ? primaryHomeFor(providerId, config) : null,
      accounts: listAccounts(config, providerId),
    });
    return true;
  }

  // --- Everything below mutates on-disk account plumbing: admin only ---

  // Create an account dir + shared links, and return a terminal id to log in with.
  if (req.method === 'POST' && !accountId) {
    if (!requireAdmin(req, res, db)) return true;
    readBody(req).then((raw) => {
      const { id, label, configDir: requestedDir } = parseBody(raw) as {
        id?: string; label?: string; configDir?: string;
      };
      if (!id || !isValidAccountId(id)) {
        sendJson(res, 400, {
          error: 'Account id must be lowercase letters, numbers and dashes (max 31), and cannot be "default"',
        });
        return;
      }
      if (!supportsAccounts(providerId)) {
        sendJson(res, 400, { error: `${getProvider(providerId).displayName} does not support multiple accounts yet` });
        return;
      }
      const config = loadConfig();
      const existing = config.aiProviders?.providers?.[providerId]?.accounts ?? [];
      if (existing.some((a) => a.id === id)) {
        sendJson(res, 409, { error: `An account named "${id}" already exists` });
        return;
      }
      const primaryHome = primaryHomeFor(providerId, config);
      const configDir = requestedDir || defaultConfigDirFor(providerId, id, config);

      let report;
      try {
        report = createAccountDir(providerId, id, configDir, primaryHome);
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
        return;
      }

      writeAccounts(providerId, (accts) => [...accts, { id, label: label || id, configDir }]);
      sendJson(res, 200, {
        ok: true,
        account: { id, label: label || id, configDir, authenticated: false, isDefault: false },
        report,
        // The client opens a terminal with this id, then POSTs .../login to spawn
        // the CLI inside it against the new config dir.
        loginTerminalId: `account-login-${providerId}-${id}`,
      });
    }).catch((err) => sendJson(res, 500, { error: (err as Error).message }));
    return true;
  }

  if (!accountId) {
    sendJson(res, 405, { error: 'Method not allowed' });
    return true;
  }

  // --- Spawn the provider CLI against this account's dir to run its login ---
  if (req.method === 'POST' && action === 'login') {
    if (!requireAdmin(req, res, db)) return true;
    const config = loadConfig();
    const acct = (config.aiProviders?.providers?.[providerId]?.accounts ?? []).find((a) => a.id === accountId);
    if (!acct) {
      sendJson(res, 404, { error: `No such account: ${accountId}` });
      return true;
    }
    const configDir = acct.configDir ?? defaultConfigDirFor(providerId, accountId, config);
    if (!fs.existsSync(configDir)) {
      sendJson(res, 400, { error: `Config dir missing: ${configDir}. Repair the account first.` });
      return true;
    }
    const terminalId = `account-login-${providerId}-${accountId}`;
    // Replace any previous login terminal for this account so a retry is clean.
    try { destroyPty(terminalId); } catch { /* nothing running */ }
    // Drop any cached "signed out" reading so the poll sees the new login promptly.
    invalidateAuthStatus(configDir);

    const provider = getProvider(providerId);
    const providerCfg = config.aiProviders?.providers?.[providerId];
    let exe: string;
    try {
      exe = provider.exePath(providerCfg?.customPath);
    } catch (err) {
      sendJson(res, 500, { error: `Could not locate the ${provider.displayName} binary: ${(err as Error).message}` });
      return true;
    }

    // `auth login` rather than a bare `claude`: it runs ONLY the sign-in flow and
    // opens no workspace. Launching the REPL instead made the CLI ask to trust
    // whatever cwd it was given — and pre-approve that folder's
    // .claude/settings.local.json tool permissions — which is both wrong for a
    // login and a prompt the user should never have been shown here.
    // cwd is the account's own config dir: nothing is read from it, and it holds
    // no settings of its own.
    spawnPty(terminalId, configDir, 100, 28, exe, ['auth', 'login'], providerId, undefined, accountId)
      .then(() => {
        sendJson(res, 200, { ok: true, terminalId, configDir });
      })
      .catch((err: Error) => sendJson(res, 500, { error: err.message }));
    return true;
  }

  // --- Re-create missing junctions / re-copy settings from the primary dir ---
  if (req.method === 'POST' && action === 'repair') {
    if (!requireAdmin(req, res, db)) return true;
    readBody(req).then((raw) => {
      const { resyncFiles } = parseBody(raw) as { resyncFiles?: boolean };
      const config = loadConfig();
      const acct = (config.aiProviders?.providers?.[providerId]?.accounts ?? []).find((a) => a.id === accountId);
      if (!acct) {
        sendJson(res, 404, { error: `No such account: ${accountId}` });
        return;
      }
      const configDir = acct.configDir ?? defaultConfigDirFor(providerId, accountId, config);
      try {
        const report = linkSharedEntries(providerId, configDir, {
          resyncFiles: !!resyncFiles,
          primaryHome: primaryHomeFor(providerId, config),
        });
        sendJson(res, 200, { ok: true, report });
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
      }
    }).catch((err) => sendJson(res, 500, { error: (err as Error).message }));
    return true;
  }

  // --- Set the account preselected in launch dialogs ---
  if (req.method === 'POST' && action === 'set-default') {
    if (!requireAdmin(req, res, db)) return true;
    const config = loadConfig();
    const known = accountId === DEFAULT_ACCOUNT_ID
      || (config.aiProviders?.providers?.[providerId]?.accounts ?? []).some((a) => a.id === accountId);
    if (!known) {
      sendJson(res, 404, { error: `No such account: ${accountId}` });
      return true;
    }
    writeAccounts(providerId, (accts) => accts, accountId);
    sendJson(res, 200, { ok: true, defaultAccount: accountId });
    return true;
  }

  // --- Delete an account (config entry + its dir; shared targets untouched) ---
  if (req.method === 'DELETE') {
    if (!requireAdmin(req, res, db)) return true;
    if (accountId === DEFAULT_ACCOUNT_ID) {
      sendJson(res, 400, { error: 'The default account cannot be removed' });
      return true;
    }
    const config = loadConfig();
    const acct = (config.aiProviders?.providers?.[providerId]?.accounts ?? []).find((a) => a.id === accountId);
    if (!acct) {
      sendJson(res, 404, { error: `No such account: ${accountId}` });
      return true;
    }
    const configDir = acct.configDir ?? defaultConfigDirFor(providerId, accountId, config);
    try { destroyPty(`account-login-${providerId}-${accountId}`); } catch { /* none running */ }
    try {
      // Unlinks junctions before deleting, so shared skills and session history
      // are never followed into.
      removeAccountDir(configDir);
    } catch (err) {
      sendJson(res, 400, { error: (err as Error).message });
      return true;
    }
    const stillDefault = config.aiProviders?.providers?.[providerId]?.defaultAccount === accountId;
    writeAccounts(
      providerId,
      (accts) => accts.filter((a) => a.id !== accountId),
      stillDefault ? DEFAULT_ACCOUNT_ID : undefined,
    );
    sendJson(res, 200, { ok: true, removed: accountId, configDir });
    return true;
  }

  // --- Authentication status poll (client waits on this after login) ---
  if (req.method === 'GET' && accountId) {
    const config = loadConfig();
    const acct = listAccounts(config, providerId).find((a) => a.id === accountId);
    if (!acct) {
      sendJson(res, 404, { error: `No such account: ${accountId}` });
      return true;
    }
    // Ask the CLI rather than trusting the credentials-file check: credentials
    // do not always land in a file, and this is also where the signed-in email
    // comes from, which is what tells two accounts apart in the UI. Internally
    // cached for a few seconds so polling cannot spawn a process per request.
    let enriched = acct;
    if (acct.configDir && supportsAccounts(providerId)) {
      const status = getAuthStatus(
        providerId,
        acct.configDir,
        config.aiProviders?.providers?.[providerId]?.customPath,
      );
      enriched = {
        ...acct,
        authenticated: status.loggedIn || acct.authenticated,
        email: status.email,
        orgName: status.orgName,
        subscriptionType: status.subscriptionType,
      };
    }
    sendJson(res, 200, enriched);
    return true;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
  return true;
}

/** Exposed for tests / diagnostics: where an account's dir would live. */
export function accountDirPreview(providerId: ProviderId, accountId: string): string {
  return path.normalize(defaultConfigDirFor(providerId, accountId, loadConfig()));
}
