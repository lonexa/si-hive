import path from 'node:path';
import { execSync } from 'node:child_process';
import { isWindows } from '../platform.js';

/**
 * Resolve the full path to a CLI executable by name.
 *
 * 1. Try `where <name>` (Windows) or `which <name>` (Unix) via execSync
 * 2. Fallback to npm global bin directory + name
 * 3. Return the fallback path even if not found
 */
export function resolveExe(name: string): string {
  try {
    if (isWindows) {
      const result = execSync(`where ${name}`, { encoding: 'utf-8', timeout: 5000 }).trim();
      const candidates = result.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      // On Windows, prefer .cmd/.exe over bare scripts (which cause error 193)
      const cmdOrExe = candidates.find(c => /\.(cmd|exe|bat|ps1)$/i.test(c));
      return cmdOrExe ?? candidates[0];
    } else {
      return execSync(`which ${name}`, { encoding: 'utf-8', timeout: 5000 }).trim();
    }
  } catch {
    // Fallback: try npm global bin
    return npmGlobalBinPath(name);
  }
}

function npmGlobalBinPath(name: string): string {
  try {
    const prefix = execSync('npm config get prefix', { encoding: 'utf-8', timeout: 5000 }).trim();
    if (isWindows) {
      // On Windows, npm puts .cmd shims directly in the prefix directory
      return path.join(prefix, `${name}.cmd`);
    } else {
      return path.join(prefix, 'bin', name);
    }
  } catch {
    // Last resort fallback
    if (isWindows) {
      return `${name}.cmd`;
    }
    return path.join('/usr/local/bin', name);
  }
}
