#!/usr/bin/env node

/**
 * Packages the repo source code into installer/source/ for bundling in the NSIS installer.
 * Excludes node_modules, .git, dist, installer/portable, and other non-source files.
 *
 * Usage: node installer/package-source.cjs
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoDir = path.resolve(path.join(__dirname, '..'));
const sourceDir = path.join(__dirname, 'source');

console.log('Packaging source code for installer...');

// Clean previous
if (fs.existsSync(sourceDir)) {
  fs.rmSync(sourceDir, { recursive: true, force: true });
}
fs.mkdirSync(sourceDir, { recursive: true });

// Use git archive to get a clean copy of tracked files (no .git, no node_modules)
let archived = false;
try {
  // Use zip format on Windows (avoids tar path escaping issues)
  const zipPath = path.join(__dirname, 'source-archive.zip');
  execSync(
    `git archive HEAD --format=zip -o "${zipPath}"`,
    { cwd: repoDir, stdio: 'inherit', shell: true }
  );
  execSync(
    `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${sourceDir}' -Force"`,
    { stdio: 'inherit', shell: true }
  );
  fs.unlinkSync(zipPath);
  archived = true;
} catch {
  // Fallback: use robocopy if git archive fails
  // robocopy returns 1 for "files copied successfully" — codes 0-7 are success
  console.log('git archive failed, using robocopy...');
  try {
    execSync(
      `robocopy "${repoDir}" "${sourceDir}" /E /XD node_modules .git dist dist-server installer docs .claude .playwright-mcp /XF *.exe .env .env.lite .env.lite.enc *.png *.gif *.docx`,
      { stdio: 'inherit', shell: true }
    );
  } catch (err) {
    if (err.status >= 8) {
      throw new Error(`robocopy failed with exit code ${err.status}`);
    }
    // Exit codes 0-7 are success for robocopy
  }
}

// Write version file
try {
  const commit = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
  fs.writeFileSync(path.join(sourceDir, '.hive-version'), commit);
  console.log(`Version: ${commit.slice(0, 8)}`);
} catch {
  fs.writeFileSync(path.join(sourceDir, '.hive-version'), 'unknown');
}

// Remove files that shouldn't be in the installed copy
const removePatterns = [
  'installer',
  'docs',
  '.claude',
  '.playwright-mcp',
  '.env',
  '.env.example',
  'FEATURE-TODO.md',
  'README.md',
];
for (const p of removePatterns) {
  const full = path.join(sourceDir, p);
  if (fs.existsSync(full)) {
    fs.rmSync(full, { recursive: true, force: true });
  }
}

// Remove any images/docs that snuck in at root level
for (const f of fs.readdirSync(sourceDir)) {
  if (/\.(png|gif|docx)$/i.test(f)) {
    fs.unlinkSync(path.join(sourceDir, f));
  }
}

// Count files
let fileCount = 0;
function countFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) countFiles(path.join(dir, entry.name));
    else fileCount++;
  }
}
countFiles(sourceDir);

console.log(`Packaged ${fileCount} files into installer/source/`);
console.log('Ready to build installer with makensis.');
