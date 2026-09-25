import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LAUNCH_AGENT_LABEL } from '../../../../packages/shared/src/brand.js';

// Same label and plist as installer/mac/install.sh, so the Settings toggle and
// the installer manage one LaunchAgent rather than two competing ones.
const LABEL = LAUNCH_AGENT_LABEL;
const LAUNCH_AGENTS_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const PLIST_PATH = path.join(LAUNCH_AGENTS_DIR, `${LABEL}.plist`);
const LOG_DIR = path.join(os.homedir(), 'Library', 'Logs', 'Hive');
const REPO_DIR = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const TEMPLATE = path.join(REPO_DIR, 'installer', 'mac', `${LABEL}.plist`);

function buildPlist(): string {
  const nodeBin = process.execPath;
  const serverPath = [
    path.dirname(nodeBin),
    path.join(os.homedir(), '.local', 'bin'),
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  ].join(':');

  return fs.readFileSync(TEMPLATE, 'utf-8')
    .replace(/@@HIVE_HOME@@/g, REPO_DIR)
    .replace(/@@NODE_BIN@@/g, nodeBin)
    .replace(/@@LOG_FILE@@/g, path.join(LOG_DIR, 'server.log'))
    .replace(/@@HIVE_PORT@@/g, process.env.HIVE_PORT || '4747')
    .replace(/@@PATH@@/g, serverPath)
    .replace(/@@USER_HOME@@/g, os.homedir())
    .replace(/@@SERVICE_USER@@/g, os.userInfo().username);
}

export function enableAutostart(): { ok: boolean; message?: string; error?: string } {
  try {
    // Already installed (normally by install.sh). Reloading it from here would
    // unload the agent this very server may be running under, killing the
    // process before it could load the new one.
    if (fs.existsSync(PLIST_PATH)) {
      return { ok: true, message: 'Auto-start already enabled' };
    }
    fs.mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(PLIST_PATH, buildPlist(), 'utf-8');
    // Register for future logins only. Loading it now would start a second
    // server on the port this one already holds.
    return { ok: true, message: 'Auto-start enabled — SI Hive will start at your next login' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export function disableAutostart(): { ok: boolean; message?: string; error?: string } {
  try {
    if (fs.existsSync(PLIST_PATH)) {
      // Remove the file only. Unloading the agent would stop this server if it
      // is the one launchd is running; with the plist gone it won't come back
      // at the next login.
      fs.unlinkSync(PLIST_PATH);
    }
    return {
      ok: true,
      message: process.env.HIVE_SERVICE === '1'
        ? 'Auto-start disabled — SI Hive keeps running until you log out'
        : 'Auto-start disabled',
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export function isAutostartEnabled(): boolean {
  return fs.existsSync(PLIST_PATH);
}

