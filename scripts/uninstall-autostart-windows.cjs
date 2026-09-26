#!/usr/bin/env node

/**
 * Undo install-autostart-windows.cjs.
 * Usage: node scripts/uninstall-autostart-windows.cjs [--stop] [--restore-service]
 *
 * Removes the login entry (Startup\SIHive.vbs) and the launcher.
 * --stop             also stop the running per-user SI Hive (node processes
 *                    started from this install's node.exe).
 * --restore-service  set the "Hive" service back to automatic and start it
 *                    (needs an elevated shell).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.platform !== 'win32') {
  console.error('uninstall-autostart-windows.cjs is Windows-only.');
  process.exit(1);
}

const args = process.argv.slice(2);
const SERVICE_NAME = 'Hive';
const userHome = os.homedir();
const hiveHome = process.env.HIVE_HOME || path.join(userHome, '.hive');
const vbsPath = path.join(
  process.env.APPDATA || path.join(userHome, 'AppData', 'Roaming'),
  'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'SIHive.vbs',
);

function log(msg) {
  console.log(`[uninstall-autostart] ${msg}`);
}

for (const file of [vbsPath, path.join(hiveHome, 'start-si-hive.cmd')]) {
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    log(`Removed ${file}`);
  }
}

if (args.includes('--stop')) {
  // Only this install's node.exe, so unrelated Node processes are untouched.
  const nodeBin = process.execPath.replace(/'/g, "''");
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -eq '${nodeBin}' -and $_.ProcessId -ne ${process.pid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
  ], { stdio: 'inherit' });
  log('Stopped the running SI Hive.');
}

if (args.includes('--restore-service')) {
  try {
    execFileSync('sc', ['config', SERVICE_NAME, 'start=', 'auto'], { stdio: 'ignore' });
    execFileSync('sc', ['start', SERVICE_NAME], { stdio: 'ignore' });
    log(`Set the "${SERVICE_NAME}" service back to automatic and started it.`);
  } catch (err) {
    console.error(`Could not restore the "${SERVICE_NAME}" service (run from an elevated shell): ${String(err.message).split('\n')[0]}`);
    process.exit(1);
  }
}
