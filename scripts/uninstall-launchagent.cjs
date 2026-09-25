#!/usr/bin/env node

/**
 * Uninstall the Hive LaunchAgent on macOS.
 * Usage: node scripts/uninstall-launchagent.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.platform !== 'darwin') {
  console.error('uninstall-launchagent.cjs is macOS-only.');
  process.exit(1);
}

const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'dev.hive.server.plist');

if (!fs.existsSync(plistPath)) {
  console.log('LaunchAgent not installed — nothing to do.');
  process.exit(0);
}

try {
  execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
} catch {
  // ignore — may not be loaded
}

fs.unlinkSync(plistPath);
console.log(`Removed ${plistPath}`);
