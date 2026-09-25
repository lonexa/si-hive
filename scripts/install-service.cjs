#!/usr/bin/env node

/**
 * Install Hive as a Windows Service using node-windows.
 * Usage: node scripts/install-service.cjs
 *
 * The service runs as LocalSystem, so we pass the installing user's
 * home directory via USERPROFILE/HOME env vars so os.homedir() resolves
 * to the right path (for ~/.claude, ~/.hive, etc.)
 */

const { resolve, join } = require('path');
const os = require('os');
const { Service } = require('node-windows');

const SERVICE_NAME = 'Hive';
const DESCRIPTION = 'SI Hive (Superintelligence Hive) - AI workflow dashboard';
const PORT = 4747;

const repoDir = resolve(join(__dirname, '..'));
const startupScript = join(repoDir, 'scripts', 'startup.cjs');
const userHome = os.homedir();

console.log(`Installing ${SERVICE_NAME} service...`);
console.log(`  User home: ${userHome}`);
console.log(`  Startup script: ${startupScript}`);

const svc = new Service({
  name: SERVICE_NAME,
  description: DESCRIPTION,
  script: startupScript,
  scriptOptions: '--app=hive',
  nodeOptions: [],
  env: [
    { name: 'HIVE_PORT', value: String(PORT) },
    { name: 'NODE_ENV', value: 'production' },
    // Pass the installing user's home so the service can find ~/.claude, ~/.hive
    { name: 'USERPROFILE', value: userHome },
    { name: 'HOME', value: userHome },
    { name: 'HOMEPATH', value: userHome.split(':')[1] || userHome },
    { name: 'HOMEDRIVE', value: (userHome.split(':')[0] || 'C') + ':' },
    { name: 'HIVE_SERVICE_USER', value: os.userInfo().username },
  ],
});

svc.on('install', () => {
  console.log(`${SERVICE_NAME} service installed successfully.`);
  console.log(`Starting ${SERVICE_NAME}...`);
  svc.start();
});

svc.on('start', () => {
  console.log(`${SERVICE_NAME} service started on port ${PORT}.`);
  console.log(`Open http://localhost:${PORT} in your browser.`);
});

svc.on('alreadyinstalled', () => {
  console.log(`${SERVICE_NAME} service is already installed.`);
});

svc.on('error', (err) => {
  console.error(`Error: ${err}`);
});

svc.install();
