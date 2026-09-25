#!/usr/bin/env node

/**
 * Builds the macOS install bundle: installer/HiveMac.zip
 *
 * Runs on Windows (or anywhere with Node + git) — no Mac needed, because the
 * bundle carries source rather than a built app. install.sh does the
 * platform-specific work (npm install, vite build, LaunchAgent) on the Mac.
 *
 *   node installer/mac/build-mac-bundle.cjs
 *
 * Zip layout:
 *   HiveMac/
 *     install.sh, uninstall.sh, README.md
 *     dev.hive.server.plist        LaunchAgent template
 *     VERSION, NODE_VERSION
 *     node/node-v<ver>-darwin-{arm64,x64}.tar.gz
 *     source/                         apps/hive, packages, scripts, root files, .hive-version
 *
 * Source is taken from the HEAD commit (git archive), not the working tree, and
 * .hive-version is set to that commit — so commit and push before building, or
 * the installed copy will report an update it can't match.
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

// Match installer/portable/node (the Windows installer's bundled runtime).
const NODE_VERSION = process.env.NODE_VERSION || '24.12.0';
const NODE_ARCHES = ['arm64', 'x64'];

const macDir = __dirname;
const repoDir = path.resolve(macDir, '..', '..');
const cacheDir = path.join(macDir, '.node-cache');
const outZip = path.join(repoDir, 'installer', 'HiveMac.zip');
const ROOT = 'HiveMac';

function git(...args) {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024 });
}

/** Committed content of a file (LF, as stored), so CRLF checkouts can't leak into the bundle. */
function committed(relPath) {
  return git('show', `HEAD:${relPath}`);
}

/** Same filter as the Windows installer: apps/hive, packages, scripts, and root-level files. */
function isShipped(entryName) {
  if (entryName.startsWith('apps/hive/')) return true;
  if (entryName.startsWith('packages/')) return true;
  if (entryName.startsWith('scripts/')) return true;
  return !entryName.includes('/');
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function ensureNodeTarballs() {
  fs.mkdirSync(cacheDir, { recursive: true });
  const shasumsPath = path.join(cacheDir, `SHASUMS256-v${NODE_VERSION}.txt`);
  if (!fs.existsSync(shasumsPath)) {
    await download(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`, shasumsPath);
  }
  const shasums = fs.readFileSync(shasumsPath, 'utf-8');

  const tarballs = [];
  for (const arch of NODE_ARCHES) {
    const name = `node-v${NODE_VERSION}-darwin-${arch}.tar.gz`;
    const dest = path.join(cacheDir, name);
    const expected = shasums.split('\n').find((l) => l.trim().endsWith(`  ${name}`))?.split(/\s+/)[0];
    if (!expected) throw new Error(`${name} not listed in SHASUMS256.txt for v${NODE_VERSION}`);

    const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    if (!fs.existsSync(dest) || sha(dest) !== expected) {
      console.log(`Downloading ${name}...`);
      await download(`https://nodejs.org/dist/v${NODE_VERSION}/${name}`, dest);
      if (sha(dest) !== expected) {
        fs.unlinkSync(dest);
        throw new Error(`Checksum mismatch for ${name}`);
      }
    }
    tarballs.push({ name, path: dest });
  }
  return tarballs;
}

async function main() {
  const commit = git('rev-parse', 'HEAD').toString().trim();
  const version = JSON.parse(committed('package.json').toString()).version;
  console.log(`Building HiveMac.zip — SI Hive ${version} @ ${commit.slice(0, 8)}, Node ${NODE_VERSION}`);

  const dirty = git('status', '--porcelain', '--untracked-files=no').toString().trim();
  if (dirty) console.warn('WARNING: uncommitted changes are NOT included — the bundle is built from HEAD.');
  try {
    const onMain = git('branch', '-r', '--contains', commit).toString();
    // Any remote's main (this repo's remote is named "azure", not "origin").
    if (!/^\s*[^\s/]+\/main\s*$/m.test(onMain)) {
      console.warn('WARNING: HEAD is not on the remote main branch — push first so the install can match its update check.');
    }
  } catch { /* no remote info; not fatal */ }

  const out = new AdmZip();

  // Source from HEAD
  const archive = new AdmZip(git('archive', '--format=zip', 'HEAD'));
  let fileCount = 0;
  for (const entry of archive.getEntries()) {
    if (entry.isDirectory || !isShipped(entry.entryName)) continue;
    out.addFile(`${ROOT}/source/${entry.entryName}`, entry.getData());
    fileCount++;
  }
  out.addFile(`${ROOT}/source/.hive-version`, Buffer.from(commit));

  // Installer files (installer/ is export-ignored, so read them from HEAD directly)
  const exec = 0o100755 << 16;
  out.addFile(`${ROOT}/install.sh`, committed('installer/mac/install.sh'), '', exec);
  out.addFile(`${ROOT}/uninstall.sh`, committed('installer/mac/uninstall.sh'), '', exec);
  out.addFile(`${ROOT}/dev.hive.server.plist`, committed('installer/mac/dev.hive.server.plist'));
  out.addFile(`${ROOT}/README.md`, committed('installer/mac/INSTALL.md'));
  out.addFile(`${ROOT}/VERSION`, Buffer.from(`${version} (${commit.slice(0, 8)})\n`));
  out.addFile(`${ROOT}/NODE_VERSION`, Buffer.from(`${NODE_VERSION}\n`));

  for (const t of await ensureNodeTarballs()) {
    out.addFile(`${ROOT}/node/${t.name}`, fs.readFileSync(t.path));
  }

  out.writeZip(outZip);
  const mb = (fs.statSync(outZip).size / 1024 / 1024).toFixed(1);
  console.log(`Packed ${fileCount} source files + Node ${NODE_ARCHES.join('/')}`);
  console.log(`Done: ${outZip} (${mb} MB)`);
}

main().catch((err) => {
  console.error(`FAILED: ${err.message}`);
  process.exit(1);
});
