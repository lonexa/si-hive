/**
 * Shared update mechanism for installed Hive instances.
 *
 * Checks for and downloads new source from an UpdateSource — in the app this
 * is a repo/branch on one of the user's connected git hosts (Settings →
 * Updates), fetched through the integration layer. No git CLI required.
 */

import { execSync, spawn } from 'node:child_process';
import {
  existsSync, readFileSync, writeFileSync, unlinkSync,
  cpSync, rmSync, readdirSync, statSync, mkdirSync,
} from 'node:fs';
import { join, resolve, dirname, sep, delimiter as pathDelimiter } from 'node:path';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';

function log(msg: string) {
  console.log(`[updater] ${new Date().toISOString()} ${msg}`);
}

function run(cmd: string, cwd: string): string | null {
  return runWithTimeout(cmd, cwd, 300000);
}

function runWithTimeout(cmd: string, cwd: string, timeout: number): string | null {
  const nodeDir = resolve(join(process.execPath, '..'));
  const env = { ...process.env, PATH: `${nodeDir}${pathDelimiter}${process.env.PATH ?? ''}` };
  try {
    // shell: true is required on Windows so .cmd files (npm, npx) resolve correctly
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout, env, shell: true as unknown as string }).trim();
  } catch (err) {
    log(`Command failed: ${cmd.slice(0, 80)}… — ${(err as Error).message}`);
    return null;
  }
}

function hashFile(filePath: string): string {
  if (!existsSync(filePath)) return '';
  const content = readFileSync(filePath, 'utf-8');
  return createHash('md5').update(content).digest('hex');
}

export interface UpdateStatus {
  upToDate: boolean;
  currentVersion: string;
  latestVersion: string;
  lastChecked: string;
  authConfigured: boolean;
}

export interface UpdateResult {
  success: boolean;
  message: string;
  previousVersion: string;
  newVersion: string;
  dependenciesUpdated: boolean;
  rebuilt: boolean;
  restarting: boolean;
}

/** Where updates come from (a branch of a repo on some git host). */
export interface UpdateSource {
  /** Latest commit sha on the update branch, or null if unavailable. */
  getLatestCommit(): Promise<string | null>;
  /** Most recent commits on the update branch, newest first. */
  listCommits(limit: number): Promise<ChangelogEntry[]>;
  /** Zip archive of the update branch. */
  downloadArchive(): Promise<Buffer>;
}

export interface UpdaterConfig {
  /** Absolute path to the monorepo root */
  repoDir: string;
  /** Absolute path to the server entry (e.g. index.ts) for self-restart */
  serverEntry: string;
  /** Resolves the configured update source; null when updates are off / not configured. */
  getSource: () => UpdateSource | null | Promise<UpdateSource | null>;
}

/** Progress callback for streaming updates to the client */
export type ProgressCallback = (step: string, detail?: string) => void;

function getLocalVersion(repoDir: string): string {
  const versionFile = join(repoDir, '.hive-version');
  if (existsSync(versionFile)) {
    return readFileSync(versionFile, 'utf-8').trim();
  }
  try {
    return execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * The local commit hash for this install (.hive-version or git HEAD). This is the
 * reliable identity for staleness checks — unlike the semver in package.json, it
 * is identical across every machine that pulled the same source.
 */
export function getLocalCommit(repoDir: string): string {
  return getLocalVersion(repoDir);
}

function selfRestart(cfg: UpdaterConfig): void {
  log('Restarting process...');

  if (process.env.HIVE_SERVICE === '1') {
    log('Running under service manager (HIVE_SERVICE=1), exiting for auto-restart...');
    process.exit(0);
    return;
  }

  // Standalone: spawn a new server process, then exit
  const tsxCli = join(cfg.repoDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const nodeExe = process.execPath;

  log(`Re-launching: ${nodeExe} ${tsxCli} ${cfg.serverEntry}`);

  const child = spawn(nodeExe, [tsxCli, cfg.serverEntry], {
    cwd: join(cfg.repoDir, 'apps', 'hive'),
    stdio: 'inherit',
    detached: true,
    env: { ...process.env },
  });

  child.unref();

  setTimeout(() => {
    log('Old process exiting.');
    process.exit(0);
  }, 1500);
}

export async function checkForUpdates(cfg: UpdaterConfig): Promise<UpdateStatus> {
  log('Checking for updates...');

  const source = await cfg.getSource();
  const currentVersion = getLocalVersion(cfg.repoDir);
  const status = (latestVersion: string, upToDate = true): UpdateStatus => ({
    upToDate,
    currentVersion,
    latestVersion,
    lastChecked: new Date().toISOString(),
    authConfigured: !!source,
  });

  if (!source) return status('unknown');

  try {
    const latestVersion = await source.getLatestCommit();
    if (!latestVersion) return status('error');
    const upToDate = currentVersion === latestVersion;
    log(`Current: ${currentVersion.slice(0, 8)}, Latest: ${latestVersion.slice(0, 8)}, Up to date: ${upToDate}`);
    return status(latestVersion, upToDate);
  } catch (err) {
    log(`Error checking for updates: ${(err as Error).message}`);
    return status('error');
  }
}

export interface ChangelogEntry {
  commitId: string;
  message: string;
  author: string;
  date: string;
}

export async function getChangelog(cfg: UpdaterConfig): Promise<ChangelogEntry[]> {
  const source = await cfg.getSource();
  const currentVersion = getLocalVersion(cfg.repoDir);
  if (!source || currentVersion === 'unknown') return [];

  try {
    // Commits up to (but not including) the installed version
    const entries: ChangelogEntry[] = [];
    for (const c of await source.listCommits(50)) {
      if (c.commitId === currentVersion) break;
      entries.push({ ...c, message: c.message.split(/\r?\n/)[0] });
    }
    return entries;
  } catch (err) {
    log(`Error fetching changelog: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Files whose absence would leave a broken or stale install. Anything outside
 * these prefixes may fail to extract without aborting the update.
 *
 * `installer/` is deliberately NOT critical: it holds third-party binaries
 * (nssm.exe) that endpoint protection may quarantine the moment they are
 * written, and none of them are needed to run the app — the installed service
 * uses its own copy outside the app directory.
 */
export function isCriticalEntry(entryName: string): boolean {
  const p = entryName.replace(/\\/g, '/');
  if (p.startsWith('apps/') || p.startsWith('packages/') || p.startsWith('scripts/')) return true;
  // Root-level files (package.json, package-lock.json, config templates).
  return !p.includes('/');
}

interface ExtractionResult {
  written: number;
  failedCritical: Array<{ entry: string; reason: string }>;
  failedOptional: Array<{ entry: string; reason: string }>;
}

/**
 * Extract a zip entry-by-entry, tolerating per-file failures.
 *
 * Replaces AdmZip.extractAllTo, which aborts the whole extraction on the first
 * failed file. Worse, its writeFileTo() reports such failures misleadingly: it
 * chmods the path in a catch block, so a blocked or externally-deleted file
 * surfaces as "ENOENT ... chmod <path>" rather than the real cause. Writing the
 * bytes ourselves keeps the actual error and lets a non-essential file be
 * skipped instead of failing the update.
 */
export function extractTolerantly(
  zip: AdmZip,
  targetDir: string,
  logFn: (msg: string) => void,
): ExtractionResult {
  const result: ExtractionResult = { written: 0, failedCritical: [], failedOptional: [] };
  const resolvedTarget = resolve(targetDir);

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const entryName = entry.entryName.replace(/\\/g, '/');
    const destPath = resolve(resolvedTarget, entryName);

    // Zip-slip guard: never write outside the target directory.
    if (destPath !== resolvedTarget && !destPath.startsWith(resolvedTarget + sep)) {
      result.failedCritical.push({ entry: entryName, reason: 'path escapes the extract directory' });
      continue;
    }

    try {
      const content = entry.getData();
      if (!content) throw new Error('entry has no data');
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, content);
      result.written++;
    } catch (err) {
      const reason = (err as Error).message;
      if (isCriticalEntry(entryName)) {
        result.failedCritical.push({ entry: entryName, reason });
        logFn(`Failed to extract required file ${entryName}: ${reason}`);
      } else {
        result.failedOptional.push({ entry: entryName, reason });
        logFn(`Skipping ${entryName}: ${reason}`);
      }
    }
  }
  return result;
}

export async function applyUpdates(cfg: UpdaterConfig, onProgress?: ProgressCallback): Promise<UpdateResult> {
  const progress = onProgress ?? (() => {});
  log('Applying updates...');
  progress('starting', 'Preparing update...');

  const source = await cfg.getSource();
  const previousVersion = getLocalVersion(cfg.repoDir);
  const { repoDir } = cfg;
  const versionFile = join(repoDir, '.hive-version');

  if (!source) {
    return {
      success: false,
      message: 'No update source configured. Choose a repository in Settings → Updates.',
      previousVersion,
      newVersion: previousVersion,
      dependenciesUpdated: false,
      rebuilt: false,
      restarting: false,
    };
  }

  try {
    // Save package.json hashes before update
    const pkgPath = join(repoDir, 'package.json');
    const lockPath = join(repoDir, 'package-lock.json');
    const oldPkgHash = hashFile(pkgPath);
    const oldLockHash = hashFile(lockPath);

    // Download latest source as a zip from the update source
    progress('downloading', 'Downloading latest source...');
    log('Downloading latest source...');
    const zipPath = join(repoDir, '.update.zip');
    try { unlinkSync(zipPath); } catch { /* ignore */ }
    const latestBefore = await source.getLatestCommit();
    writeFileSync(zipPath, await source.downloadArchive());

    // Validate the downloaded zip is not empty/partial (expect at least 100KB for a real repo zip)
    const zipStat = existsSync(zipPath) ? readFileSync(zipPath).length : 0;
    if (zipStat < 100_000) {
      try { unlinkSync(zipPath); } catch { /* ignore */ }
      throw new Error(`Downloaded zip is too small (${zipStat} bytes) — likely a partial or failed download`);
    }
    log(`Download complete (${(zipStat / 1024 / 1024).toFixed(1)} MB)`);

    // Extract zip using adm-zip (no PowerShell needed)
    progress('extracting', 'Extracting update...');
    log('Extracting update...');
    const tmpDir = join(repoDir, '.update-tmp');
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    const zip = new AdmZip(zipPath);
    const extraction = extractTolerantly(zip, tmpDir, log);
    if (extraction.failedCritical.length > 0) {
      throw new Error(
        `Could not extract required files: ${extraction.failedCritical
          .map((f) => `${f.entry} (${f.reason})`)
          .join('; ')}`,
      );
    }
    if (extraction.failedOptional.length > 0) {
      // Non-critical files (third-party binaries under installer/, docs) are
      // allowed to fail. On endpoint-protected machines an AV can delete a
      // flagged binary — nssm.exe is a known example — the instant it is
      // written, and one such file must not abort the whole update.
      log(
        `Skipped ${extraction.failedOptional.length} non-essential file(s): ` +
        extraction.failedOptional.map((f) => `${f.entry} (${f.reason})`).join('; '),
      );
      progress('extracting', `Skipped ${extraction.failedOptional.length} non-essential file(s) — continuing`);
    }
    log(`Extracted ${extraction.written} file(s)`);

    // Detect extracted root: archives may be flat (no wrapper dir) or wrapped.
    let extractedRoot = tmpDir;
    if (!existsSync(join(tmpDir, 'apps'))) {
      const entries = readdirSync(tmpDir);
      const subDir = entries.find(e => statSync(join(tmpDir, e)).isDirectory());
      if (!subDir) {
        throw new Error('Could not find extracted source directory');
      }
      extractedRoot = join(tmpDir, subDir);
      log(`Detected wrapped zip, root: ${extractedRoot}`);
    } else {
      log('Detected flat zip (no wrapper directory)');
    }

    // Copy directories from extracted source to installed location using Node fs.cpSync
    progress('copying', 'Copying updated files...');
    const dirsToSync = ['apps', 'packages', 'scripts', 'installer'];
    for (const dir of dirsToSync) {
      const src = join(extractedRoot, dir);
      const dest = join(repoDir, dir);
      if (existsSync(src)) {
        // If dest exists as a file but src is a directory (or vice versa), remove dest first
        if (existsSync(dest)) {
          const srcIsDir = statSync(src).isDirectory();
          const destIsDir = statSync(dest).isDirectory();
          if (srcIsDir !== destIsDir) {
            log(`Removing conflicting ${destIsDir ? 'directory' : 'file'} at ${dir} (replacing with ${srcIsDir ? 'directory' : 'file'})`);
            rmSync(dest, { recursive: true, force: true });
          }
        }
        log(`Copying ${dir}...`);
        cpSync(src, dest, { recursive: true, force: true });
      } else {
        log(`Skipping ${dir} (not in update)`);
      }
    }

    // Copy root-level files (package.json, etc.)
    log('Copying root files...');
    const rootEntries = readdirSync(extractedRoot);
    for (const entry of rootEntries) {
      const srcPath = join(extractedRoot, entry);
      if (statSync(srcPath).isFile()) {
        cpSync(srcPath, join(repoDir, entry), { force: true });
      }
    }

    // Clean up temp files using Node fs
    log('Cleaning up temp files...');
    rmSync(tmpDir, { recursive: true, force: true });
    try { unlinkSync(zipPath); } catch { /* ignore */ }

    // Record the version we just installed
    progress('versioning', 'Recording version...');
    const newVersion = latestBefore ?? 'unknown';
    log(`Writing version file: ${newVersion.slice(0, 8)} → ${versionFile}`);
    try {
      writeFileSync(versionFile, newVersion, 'utf-8');
    } catch (writeErr) {
      log(`Failed to write version file: ${(writeErr as Error).message}`);
    }

    // Check if dependencies changed
    const newPkgHash = hashFile(pkgPath);
    const newLockHash = hashFile(lockPath);
    let dependenciesUpdated = false;

    if (newPkgHash !== oldPkgHash || newLockHash !== oldLockHash) {
      progress('installing', 'Installing dependencies...');
      log('Dependencies changed, running npm install...');
      const installResult = run('npm install', repoDir);
      log(`npm install ${installResult !== null ? 'succeeded' : 'FAILED'}`);
      dependenciesUpdated = true;
    } else {
      log('Dependencies unchanged, skipping npm install');
    }

    // Ensure Playwright's Chromium is present (used by the Claude Design "Capture preview" feature).
    // Best-effort: if it fails the rest of the update still applies and only the screenshot
    // route degrades. Idempotent — Playwright's CLI is a fast no-op when up to date.
    // We deliberately do NOT override PLAYWRIGHT_BROWSERS_PATH here: the install-time and
    // service runtime must agree on a single browser location. Fresh installs (hive.nsi) set
    // the env on the service, so updater inherits it and downloads to the matching path.
    // Existing services with no env var use Playwright's default cache; updater follows suit.
    if (existsSync(join(repoDir, 'node_modules', 'playwright'))) {
      progress('installing-browser', 'Installing Chromium for screenshots...');
      log(`Ensuring Playwright Chromium is installed (PLAYWRIGHT_BROWSERS_PATH=${process.env.PLAYWRIGHT_BROWSERS_PATH ?? '<default>'})...`);
      const pwResult = runWithTimeout('npx playwright install chromium', repoDir, 600000);
      log(`playwright install chromium ${pwResult !== null ? 'succeeded' : 'FAILED (screenshot Capture will be disabled)'}`);
    }

    // Rebuild
    progress('building', `Building app...`);
    log('Rebuilding (npm run build:hive)...');
    const buildResult = run('npm run build:hive', repoDir);
    log(`Build ${buildResult !== null ? 'succeeded' : 'FAILED'}`);
    const rebuilt = buildResult !== null;

    if (rebuilt) {
      progress('restarting', 'Restarting server...');
      log('Rebuild complete. Scheduling restart...');
      setTimeout(() => selfRestart(cfg), 2000);
    }

    progress('done', rebuilt ? 'Update complete!' : 'Build failed after update');

    return {
      success: rebuilt,
      message: rebuilt ? 'Update applied successfully. Restarting...' : 'Build failed after update',
      previousVersion,
      newVersion,
      dependenciesUpdated,
      rebuilt,
      restarting: rebuilt,
    };
  } catch (err) {
    progress('error', `Update failed: ${(err as Error).message}`);
    return {
      success: false,
      message: `Update failed: ${(err as Error).message}`,
      previousVersion,
      newVersion: previousVersion,
      dependenciesUpdated: false,
      rebuilt: false,
      restarting: false,
    };
  }
}
