import { isMac, isWindows } from '../platform.js';
import * as winImpl from './autostart-windows.js';
import * as macImpl from './autostart-mac.js';

type Result = { ok: boolean; message?: string; error?: string };

const notSupported: Result = { ok: false, error: 'Autostart is not supported on this platform' };

export function enableAutostart(): Result {
  if (isWindows) return winImpl.enableAutostart();
  if (isMac) return macImpl.enableAutostart();
  return notSupported;
}

export function disableAutostart(): Result {
  if (isWindows) return winImpl.disableAutostart();
  if (isMac) return macImpl.disableAutostart();
  return notSupported;
}

export function isAutostartEnabled(): boolean {
  if (isWindows) return winImpl.isAutostartEnabled();
  if (isMac) return macImpl.isAutostartEnabled();
  return false;
}

export function isAutostartSupported(): boolean {
  return isWindows || isMac;
}
