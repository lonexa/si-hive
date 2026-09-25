#!/usr/bin/env node

/**
 * GIT_ASKPASS helper — answers git credential prompts from Hive's configured
 * git-host connections (Settings → Integrations).
 *
 * git calls this with a prompt such as
 *   "Username for 'https://github.com': "
 *   "Password for 'https://x-access-token@github.com': "
 * and reads the answer from stdout. We match the prompt's host against each
 * git connection's host and reply with that connection's username/token. The
 * token is decrypted from $HIVE_HOME/credentials.json using the same scheme as
 * packages/shared/src/server/credentials.ts.
 *
 * This lets a Hive running as a background service (no OS credential manager)
 * push and pull with the same tokens the UI uses.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const prompt = process.argv[2] || '';
const isUsername = /^username/i.test(prompt);
const isPassword = /^(password|token)/i.test(prompt);
if (!isUsername && !isPassword) process.exit(0);

const hostMatch = /'https?:\/\/(?:[^@']*@)?([^/':]+)/i.exec(prompt);
const promptHost = hostMatch ? hostMatch[1].toLowerCase() : '';
if (!promptHost) process.exit(1);

const home = process.env.HIVE_HOME
  ? path.resolve(process.env.HIVE_HOME)
  : path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.hive');

/** Default host + git username per built-in provider (self-hosted uses settings.baseUrl). */
const PROVIDER_DEFAULTS = {
  github: { host: 'github.com', username: 'x-access-token' },
  gitlab: { host: 'gitlab.com', username: 'oauth2' },
  'azure-devops': { host: 'dev.azure.com', username: 'pat' },
};

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function getKey() {
  if (process.env.HIVE_SECRET_KEY) return crypto.scryptSync(process.env.HIVE_SECRET_KEY, 'hive-credential-store', 32);
  const keyPath = path.join(home, 'secret.key');
  if (!fs.existsSync(keyPath)) return null;
  return Buffer.from(fs.readFileSync(keyPath, 'utf-8').trim(), 'base64');
}

function getSecret(ref) {
  try {
    const store = JSON.parse(fs.readFileSync(path.join(home, 'credentials.json'), 'utf-8'));
    const entry = store.entries && store.entries[ref];
    const key = getKey();
    if (!entry || !key) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(entry.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(entry.data, 'base64')), decipher.final()]).toString('utf-8');
  } catch {
    return null;
  }
}

let config;
try {
  config = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf-8'));
} catch {
  process.exit(1);
}

for (const conn of config.integrations || []) {
  if (!Array.isArray(conn.kinds) || !conn.kinds.includes('git')) continue;
  const defaults = PROVIDER_DEFAULTS[conn.providerId] || {};
  const settings = conn.settings || {};
  const baseUrl = settings.baseUrl || settings.organizationUrl;
  const host = (baseUrl && hostOf(baseUrl)) || defaults.host;
  if (!host || (host !== promptHost && !promptHost.endsWith(`.${host}`))) continue;

  if (isUsername) {
    process.stdout.write(String(settings.gitUsername || defaults.username || 'git'));
    process.exit(0);
  }
  const token = getSecret(`integration:${conn.id}:token`);
  if (token) {
    process.stdout.write(token);
    process.exit(0);
  }
}

// No matching connection — let git fall through to its normal auth failure.
process.exit(1);
