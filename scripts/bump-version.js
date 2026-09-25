#!/usr/bin/env node

/**
 * Bump the version in root package.json and sync to app package.json files.
 * Usage: node scripts/bump-version.js [--major | --minor | --patch]
 * Default: --patch
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const bump = args.includes('--major') ? 'major'
  : args.includes('--minor') ? 'minor'
  : 'patch';

const pkgFiles = [
  path.join(repoRoot, 'package.json'),
  path.join(repoRoot, 'apps', 'hive', 'package.json'),
];

// Read current version from root package.json
const rootPkg = JSON.parse(fs.readFileSync(pkgFiles[0], 'utf-8'));
const [major, minor, patch] = rootPkg.version.split('.').map(Number);

let newVersion;
switch (bump) {
  case 'major': newVersion = `${major + 1}.0.0`; break;
  case 'minor': newVersion = `${major}.${minor + 1}.0`; break;
  case 'patch': newVersion = `${major}.${minor}.${patch + 1}`; break;
}

console.log(`Bumping version: ${rootPkg.version} → ${newVersion} (${bump})`);

for (const file of pkgFiles) {
  if (!fs.existsSync(file)) continue;
  const pkg = JSON.parse(fs.readFileSync(file, 'utf-8'));
  pkg.version = newVersion;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  console.log(`  Updated ${path.relative(repoRoot, file)}`);
}
