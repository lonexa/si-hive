import os from 'node:os';

export const isWindows = os.platform() === 'win32';
export const isMac = os.platform() === 'darwin';
export const isLinux = os.platform() === 'linux';

/**
 * True when SI Hive runs as a Windows service (session 0, as SYSTEM).
 * Detected by account: HIVE_SERVICE is set by scripts/startup.cjs for every
 * managed launch (service, login entry, macOS LaunchAgent), and SESSIONNAME
 * is missing for processes started from the login entry via Explorer too.
 */
export function isWindowsService(): boolean {
  if (!isWindows) return false;
  const user = os.userInfo().username.toUpperCase();
  return user === 'SYSTEM' || user.endsWith('$');
}
