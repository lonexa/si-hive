import fs from 'node:fs';
import path from 'node:path';

let cached: string | null = null;

/**
 * The currently running Hive server's version, read from the monorepo root
 * package.json. Cached for the process lifetime — `npm run build:hive` always
 * restarts the server, so a process never observes a stale version.
 */
export function getServerVersion(): string {
  if (cached) return cached;
  try {
    // server-version.ts lives at apps/hive/server/. Root is three levels up.
    const pkgPath = path.join(import.meta.dirname, '..', '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
    cached = pkg.version || '0.0.0';
  } catch {
    cached = '0.0.0';
  }
  return cached;
}
