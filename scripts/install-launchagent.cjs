#!/usr/bin/env node

/**
 * Install Hive as a per-user macOS LaunchAgent.
 * Usage: node scripts/install-launchagent.cjs [--port=4747]
 *
 * Renders installer/mac/dev.hive.server.plist with the current install
 * paths, writes it to ~/Library/LaunchAgents/, then runs launchctl load.
 *
 * Mirrors scripts/install-service.cjs (Windows) but uses launchd instead
 * of node-windows. Runs as the invoking user — no sudo required.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.platform !== 'darwin') {
  console.error('install-launchagent.cjs is macOS-only. Use install-service.cjs on Windows.');
  process.exit(1);
}

const args = process.argv.slice(2);
const portArg = args.find((a) => a.startsWith('--port='));
const port = portArg ? portArg.split('=')[1] : '4747';

const repoDir = path.resolve(path.join(__dirname, '..'));
const templatePath = path.join(repoDir, 'installer', 'mac', 'dev.hive.server.plist');
const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
const plistDest = path.join(launchAgentsDir, 'dev.hive.server.plist');
const logDir = path.join(os.homedir(), 'Library', 'Logs', 'Hive');
const logFile = path.join(logDir, 'server.log');
const nodeBin = process.execPath;

function log(msg) {
  console.log(`[install-launchagent] ${msg}`);
}

if (!fs.existsSync(templatePath)) {
  console.error(`Template not found: ${templatePath}`);
  process.exit(1);
}

fs.mkdirSync(launchAgentsDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });

const rendered = fs.readFileSync(templatePath, 'utf-8')
  .replace(/@@HIVE_HOME@@/g, repoDir)
  .replace(/@@NODE_BIN@@/g, nodeBin)
  .replace(/@@LOG_FILE@@/g, logFile)
  .replace(/@@HIVE_PORT@@/g, port)
  .replace(/@@PATH@@/g, [
    path.dirname(nodeBin),
    path.join(os.homedir(), '.local', 'bin'),
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  ].join(':'))
  .replace(/@@USER_HOME@@/g, os.homedir())
  .replace(/@@SERVICE_USER@@/g, os.userInfo().username);

// Try to stop any existing instance first so launchctl load doesn't error.
if (fs.existsSync(plistDest)) {
  log('Existing LaunchAgent found — unloading first.');
  try {
    execFileSync('launchctl', ['unload', plistDest], { stdio: 'ignore' });
  } catch {
    // ignore — may not be loaded
  }
}

fs.writeFileSync(plistDest, rendered, 'utf-8');
log(`Wrote ${plistDest}`);

try {
  execFileSync('launchctl', ['load', plistDest], { stdio: 'pipe' });
  log(`Loaded LaunchAgent — SI Hive will start now and on every login.`);
  log(`Open http://localhost:${port}`);
} catch (err) {
  console.error(`launchctl load failed: ${err.message}`);
  process.exit(1);
}
