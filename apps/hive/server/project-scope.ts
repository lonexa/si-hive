/**
 * Which folders this Hive install is about.
 *
 * The agent CLIs keep one machine-wide history (e.g. ~/.claude/projects), so
 * without a filter every Hive on the machine would show every session and
 * project ever run. Hive only shows work inside the folders configured in
 * Settings → General: the projects root, extra project roots, and explicitly
 * added projects. With none configured yet (fresh install), nothing is
 * filtered.
 */
import path from 'node:path';
import type { HiveConfig } from './types.js';
import { isWindows } from './platform.js';

function scopeRoots(config: HiveConfig): string[] {
  return [config.projectsRoot, ...(config.projectRoots ?? []), ...(config.projects ?? []).map((p) => p.path)]
    .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
    .map((r) => path.resolve(r));
}

function norm(p: string): string {
  const resolved = path.resolve(p).replace(/[\\/]+$/, '');
  return isWindows ? resolved.toLowerCase() : resolved;
}

/** Claude Code's history-folder name for a path: every non-alphanumeric char → '-'. */
function encode(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, '-');
}

export function hasProjectScope(config: HiveConfig): boolean {
  return scopeRoots(config).length > 0;
}

/** True when `p` is one of the configured folders or inside one. */
export function isPathInScope(config: HiveConfig, p: string | null | undefined): boolean {
  const roots = scopeRoots(config);
  if (roots.length === 0) return true;
  if (!p) return false;
  const target = norm(p);
  return roots.some((r) => {
    const root = norm(r);
    return target === root || target.startsWith(root + path.sep);
  });
}

/**
 * Scope check for a session when only its encoded history folder name is
 * known (no cwd). The encoding is lossy, so this matches on the encoded form.
 */
export function isProjectDirInScope(config: HiveConfig, encodedDir: string | null | undefined): boolean {
  const roots = scopeRoots(config);
  if (roots.length === 0) return true;
  if (!encodedDir) return false;
  const dir = isWindows ? encodedDir.toLowerCase() : encodedDir;
  return roots.some((r) => {
    const enc = isWindows ? encode(r).toLowerCase() : encode(r);
    return dir === enc || dir.startsWith(enc + '-');
  });
}

/** Scope check for a session: prefer its real working directory. */
export function isSessionInScope(config: HiveConfig, cwd: string | null | undefined, encodedDir: string | null | undefined): boolean {
  if (!hasProjectScope(config)) return true;
  return cwd ? isPathInScope(config, cwd) : isProjectDirInScope(config, encodedDir);
}
