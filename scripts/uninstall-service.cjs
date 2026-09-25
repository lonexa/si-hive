#!/usr/bin/env node

/**
 * Uninstall the Hive Windows Service.
 * Usage: node scripts/uninstall-service.cjs
 */

const { resolve, join } = require('path');
const { Service } = require('node-windows');

const SERVICE_NAME = 'Hive';

const repoDir = resolve(join(__dirname, '..'));
const startupScript = join(repoDir, 'scripts', 'startup.cjs');

const svc = new Service({
  name: SERVICE_NAME,
  script: startupScript,
});

svc.on('uninstall', () => {
  console.log(`${SERVICE_NAME} service uninstalled successfully.`);
});

svc.on('error', (err) => {
  console.error(`Error: ${err}`);
});

console.log(`Uninstalling ${SERVICE_NAME} service...`);
svc.uninstall();
