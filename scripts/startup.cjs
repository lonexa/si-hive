#!/usr/bin/env node

/**
 * Hive Startup Script — runs on Windows Service start (NSSM), from the Windows
 * login entry (install-autostart-windows.cjs), or on macOS from the
 * LaunchAgent at login.
 * Starts the server and restarts it when it exits. No git operations.
 * Updates are handled via the "Refresh from Repo" button in the UI
 * (downloads from the update repo configured in Settings → Updates).
 *
 * Usage: node scripts/startup.cjs --app=hive
 */

const { spawn } = require('child_process');
const { existsSync, readFileSync, chmodSync } = require('fs');
const { join, resolve } = require('path');

const args = process.argv.slice(2);
const appArg = args.find(a => a.startsWith('--app='));
const app = appArg ? appArg.split('=')[1] : 'hive';

if (app !== 'hive') {
  console.error(`[startup] Invalid app: ${app}. Must be 'hive'.`);
  process.exit(1);
}

const repoDir = resolve(join(__dirname, '..'));
const appDir = join(repoDir, 'apps', app);

// When running as a Windows Service (SYSTEM account), os.homedir() returns the
// wrong directory. The installer writes the real user's profile path to user-home.txt.
const userHomeFile = join(repoDir, '..', 'user-home.txt');
if (existsSync(userHomeFile)) {
  const userHome = readFileSync(userHomeFile, 'utf-8').trim();
  if (userHome) {
    process.env.USERPROFILE = userHome;
    process.env.HOME = userHome;
    process.env.HOMEDRIVE = userHome.slice(0, 2);    // e.g. "C:"
    process.env.HOMEPATH = userHome.slice(2);         // e.g. "\Users\alice"
    console.log(`[startup] Set user home from user-home.txt: ${userHome}`);
  }
}

// Configure GIT_ASKPASS so git commands authenticate with the tokens of the
// git-host connections configured in Hive (Settings → Integrations) instead of
// an OS credential manager (which isn't available when running as a service).
const gitAskpass = join(__dirname, 'git-askpass.cjs');
if (existsSync(gitAskpass)) {
  process.env.GIT_ASKPASS = `"${process.execPath}" "${gitAskpass}"`;
}

function log(msg) {
  console.log(`[startup:${app}] ${new Date().toISOString()} ${msg}`);
}

// node-pty's macOS prebuild ships spawn-helper without the execute bit, so every
// terminal fails with "posix_spawnp failed". Re-apply it on each start: an update
// that reinstalls node-pty would otherwise silently break terminals again.
if (process.platform === 'darwin') {
  const prebuilds = join(repoDir, 'node_modules', 'node-pty', 'prebuilds');
  for (const dir of ['darwin-arm64', 'darwin-x64']) {
    const helper = join(prebuilds, dir, 'spawn-helper');
    try {
      if (existsSync(helper)) chmodSync(helper, 0o755);
    } catch (err) {
      log(`Could not chmod ${helper}: ${err.message}`);
    }
  }
}

log(`Starting SI Hive ${app} from ${repoDir}`);

const serverEntry = join(appDir, 'server', 'index.ts');

if (!existsSync(serverEntry)) {
  log(`Server entry not found: ${serverEntry}`);
  process.exit(1);
}

// Resolve tsx path — use the project's local tsx
const tsxCli = join(repoDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const nodeExe = process.execPath;

log(`Node: ${nodeExe}`);
log(`tsx: ${tsxCli}`);
log(`Server: ${serverEntry}`);

// Keep the server running. It exits on purpose to restart (after an in-app
// update or "Restart server"), and when SI Hive runs at login nothing else
// would bring it back. Stopping this script (service stop, Ctrl+C, signal)
// stops the server for good.
const QUICK_EXIT_MS = 60_000;
const MAX_DELAY_MS = 30_000;
let child = null;
let stopping = false;
let quickExits = 0;

function start() {
  const startedAt = Date.now();
  child = spawn(nodeExe, [tsxCli, serverEntry], {
    cwd: appDir,
    stdio: 'inherit',
    env: Object.assign({}, process.env, { HIVE_SERVICE: '1' }),
  });
  child.on('exit', (code, signal) => {
    child = null;
    log(`Server exited with code ${code}${signal ? ` (${signal})` : ''}`);
    if (stopping) process.exit(code ?? 0);
    // Back off if it keeps dying right after starting (port taken, bad config).
    quickExits = Date.now() - startedAt < QUICK_EXIT_MS ? quickExits + 1 : 0;
    const delay = Math.min(1000 * 2 ** Math.max(0, quickExits - 1), MAX_DELAY_MS);
    log(`Restarting in ${delay / 1000}s...`);
    setTimeout(start, delay);
  });
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(sig, () => {
    stopping = true;
    if (child) child.kill();
    else process.exit(0);
  });
}

start();
