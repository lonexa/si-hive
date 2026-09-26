#!/usr/bin/env node

/**
 * Run SI Hive as the logged-in Windows user, started at login.
 * Usage: node scripts/install-autostart-windows.cjs [--port=4747] [--replace-service] [--no-start]
 *
 * The Windows equivalent of install-launchagent.cjs (macOS). Unlike the NSSM
 * service (install-service.cjs / the installer's service mode), which runs as
 * SYSTEM in the hidden session 0, this runs in the user's own desktop session:
 * AI sessions run as the user (git trusts their repos), terminals use ConPTY,
 * and browsers/GPU are available. It only runs while the user is logged in.
 *
 * Writes:
 *   <hive home>\start-si-hive.cmd   launcher (env + node startup.cjs, logs to si-hive.log)
 *   <Startup folder>\SIHive.vbs     runs the launcher hidden at login
 *
 * --replace-service  stop the "Hive" service and set it to manual (needs an
 *                    elevated shell). Its HIVE_* settings are carried over.
 * --no-start         only set up; don't start SI Hive now.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

if (process.platform !== 'win32') {
  console.error('install-autostart-windows.cjs is Windows-only. Use install-launchagent.cjs on macOS.');
  process.exit(1);
}

const args = process.argv.slice(2);
const portArg = args.find((a) => a.startsWith('--port='));
const replaceService = args.includes('--replace-service');
const noStart = args.includes('--no-start');
const SERVICE_NAME = 'Hive';

const repoDir = path.resolve(path.join(__dirname, '..'));
const nodeBin = process.execPath;
const userHome = os.homedir();
const hiveHome = process.env.HIVE_HOME || path.join(userHome, '.hive');
const launcherPath = path.join(hiveHome, 'start-si-hive.cmd');
const logFile = path.join(hiveHome, 'si-hive.log');
const startupDir = path.join(
  process.env.APPDATA || path.join(userHome, 'AppData', 'Roaming'),
  'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
);
const vbsPath = path.join(startupDir, 'SIHive.vbs');

function log(msg) {
  console.log(`[install-autostart] ${msg}`);
}

function isSystemAccount() {
  return os.userInfo().username.toUpperCase().endsWith('$') || /systemprofile/i.test(userHome);
}

if (isSystemAccount()) {
  console.error('Run this as the Windows user SI Hive should run as (not as SYSTEM).');
  process.exit(1);
}

/** HIVE_* (and Playwright) settings of the existing NSSM service, if any. */
function serviceEnv() {
  try {
    const out = execFileSync('reg', ['query', `HKLM\\SYSTEM\\CurrentControlSet\\Services\\${SERVICE_NAME}\\Parameters`, '/v', 'AppEnvironmentExtra'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/AppEnvironmentExtra\s+REG_MULTI_SZ\s+(.*)/);
    if (!m) return {};
    const env = {};
    for (const entry of m[1].trim().split('\\0')) {
      const kv = entry.replace(/^\+/, '');
      const i = kv.indexOf('=');
      if (i <= 0) continue;
      const key = kv.slice(0, i);
      // Service-only values (HIVE_SERVICE, USERPROFILE, HOME, NODE_ENV) don't apply.
      if ((key.startsWith('HIVE_') && key !== 'HIVE_SERVICE') || key === 'PLAYWRIGHT_BROWSERS_PATH') env[key] = kv.slice(i + 1);
    }
    return env;
  } catch {
    return {};
  }
}

const env = serviceEnv();
for (const key of ['HIVE_PORT', 'HIVE_HOST', 'HIVE_ALLOWED_HOSTS', 'HIVE_PUBLIC_URL', 'HIVE_HOME', 'HIVE_SECRET_KEY']) {
  if (process.env[key]) env[key] = process.env[key];
}
if (portArg) env.HIVE_PORT = portArg.split('=')[1];
const browsers = path.join(repoDir, '.playwright-browsers');
if (!env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(browsers)) env.PLAYWRIGHT_BROWSERS_PATH = browsers;
const port = env.HIVE_PORT || '4747';

fs.mkdirSync(hiveHome, { recursive: true });
fs.mkdirSync(startupDir, { recursive: true });

const launcher = [
  '@echo off',
  'rem Starts SI Hive in this user\'s session. Written by scripts\\install-autostart-windows.cjs.',
  ...Object.entries(env).map(([k, v]) => `set "${k}=${v}"`),
  `cd /d "${repoDir}"`,
  `"${nodeBin}" "${path.join(repoDir, 'scripts', 'startup.cjs')}" --app=hive >> "${logFile}" 2>&1`,
  '',
].join('\r\n');
fs.writeFileSync(launcherPath, launcher, 'utf-8');
log(`Wrote ${launcherPath}${Object.keys(env).length ? ` (settings: ${Object.keys(env).join(', ')})` : ''}`);

const vbs = [
  "' Starts SI Hive hidden at login. Written by scripts\\install-autostart-windows.cjs.",
  `CreateObject("WScript.Shell").Run """${launcherPath}""", 0, False`,
  '',
].join('\r\n');
fs.writeFileSync(vbsPath, vbs, 'utf-8');
log(`Wrote ${vbsPath}`);

// Running as the user, SI Hive (and its in-app updater) must be able to write
// its own install. Under Program Files that needs a grant; it only succeeds
// from an elevated shell (installer, --replace-service) and is skipped otherwise.
try {
  fs.accessSync(repoDir, fs.constants.W_OK);
  const probe = path.join(repoDir, `.write-test-${process.pid}`);
  fs.writeFileSync(probe, '');
  fs.unlinkSync(probe);
} catch {
  try {
    execFileSync('icacls', [repoDir, '/grant', `${os.userInfo().username}:(OI)(CI)M`], { stdio: 'ignore' });
    log(`Gave ${os.userInfo().username} write access to ${repoDir} (needed for updates).`);
  } catch {
    log(`Warning: ${repoDir} isn't writable by ${os.userInfo().username}; in-app updates will fail. Re-run from an elevated shell to fix.`);
  }
}

if (replaceService) {
  try {
    execFileSync('sc', ['stop', SERVICE_NAME], { stdio: 'ignore' });
  } catch { /* not running or not installed */ }
  try {
    execFileSync('sc', ['config', SERVICE_NAME, 'start=', 'demand'], { stdio: 'pipe' });
    log(`Stopped the "${SERVICE_NAME}" service and set it to manual.`);
  } catch (err) {
    console.error(`Could not reconfigure the "${SERVICE_NAME}" service (run from an elevated shell): ${String(err.message).split('\n')[0]}`);
    process.exit(1);
  }
  // Wait for the port to free up before starting the per-user instance.
  for (let i = 0; i < 30; i++) {
    try {
      execFileSync('powershell', ['-NoProfile', '-Command', `if (Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue) { exit 1 }`], { stdio: 'ignore' });
      break;
    } catch {
      execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 500'], { stdio: 'ignore' });
    }
  }
}

if (!noStart) {
  // Launch through explorer.exe so SI Hive runs un-elevated, like it will at
  // login, even when this script was run from an elevated shell or installer.
  spawn('explorer.exe', [vbsPath], { detached: true, stdio: 'ignore' }).unref();
  log(`Starting SI Hive — open http://localhost:${port} (log: ${logFile})`);
}
log('SI Hive will start automatically each time you log in.');
