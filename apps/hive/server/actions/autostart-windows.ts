import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { isWindowsService } from '../platform.js';

// Same login entry as scripts/install-autostart-windows.cjs (and the installer's
// "start at login" mode), so the Settings toggle and the installer manage one
// entry rather than two competing ones.
const REPO_DIR = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const INSTALL_SCRIPT = path.join(REPO_DIR, 'scripts', 'install-autostart-windows.cjs');
const UNINSTALL_SCRIPT = path.join(REPO_DIR, 'scripts', 'uninstall-autostart-windows.cjs');
const VBS_PATH = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'SIHive.vbs',
);

function runScript(script: string, args: string[]): void {
  execFileSync(process.execPath, [script, ...args], { stdio: 'pipe', timeout: 30_000 });
}

export function enableAutostart(): { ok: boolean; message?: string; error?: string } {
  // As the Windows service SI Hive runs as SYSTEM, whose login entries would
  // never run; the switch has to be made by the user, from an elevated shell.
  if (isWindowsService()) {
    return {
      ok: false,
      error: 'SI Hive is running as a Windows service. To run it at login as your user instead, run '
        + `"${process.execPath}" "${INSTALL_SCRIPT}" --replace-service from an administrator PowerShell.`,
    };
  }
  try {
    // Register for future logins only: starting now would launch a second
    // server on the port this one already holds.
    runScript(INSTALL_SCRIPT, ['--no-start']);
    return { ok: true, message: 'Auto-start enabled — SI Hive will start at your next login' };
  } catch (err) {
    return { ok: false, error: String((err as { stderr?: Buffer }).stderr ?? err) };
  }
}

export function disableAutostart(): { ok: boolean; message?: string; error?: string } {
  try {
    // Remove the login entry only; this server keeps running until logout.
    runScript(UNINSTALL_SCRIPT, []);
    return { ok: true, message: 'Auto-start disabled — SI Hive keeps running until you log out' };
  } catch (err) {
    return { ok: false, error: String((err as { stderr?: Buffer }).stderr ?? err) };
  }
}

export function isAutostartEnabled(): boolean {
  return fs.existsSync(VBS_PATH);
}
