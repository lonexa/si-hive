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

/*
 * Projects removed from Hive. `config.hiddenProjects` maps a project path to
 * when it was removed. Anything in it that was last active before then stays
 * out of the lists; new work there brings it back, so starting a session in a
 * removed folder isn't silently invisible.
 */

function hiddenEntries(config: HiveConfig): Array<[string, number]> {
  return Object.entries(config.hiddenProjects ?? {})
    .map(([p, at]): [string, number] => [p, Date.parse(at)])
    .filter(([, at]) => Number.isFinite(at));
}

/** When the project containing `p` was removed from Hive, or null if it wasn't. */
export function hiddenSince(config: HiveConfig, p: string | null | undefined): number | null {
  if (!p) return null;
  const target = norm(p);
  let since: number | null = null;
  for (const [root, at] of hiddenEntries(config)) {
    const r = norm(root);
    if (target !== r && !target.startsWith(r + path.sep)) continue;
    since = since === null ? at : Math.max(since, at);
  }
  return since;
}

/** True when a session belongs to a removed project and hasn't been active since. */
export function isSessionHidden(
  config: HiveConfig,
  cwd: string | null | undefined,
  encodedDir: string | null | undefined,
  lastActivityMs: number,
): boolean {
  let since = hiddenSince(config, cwd);
  if (!cwd && encodedDir) {
    const dir = isWindows ? encodedDir.toLowerCase() : encodedDir;
    for (const [root, at] of hiddenEntries(config)) {
      const enc = isWindows ? encode(root).toLowerCase() : encode(root);
      if (dir === enc || dir.startsWith(enc + '-')) since = since === null ? at : Math.max(since, at);
    }
  }
  return since !== null && lastActivityMs <= since;
}

export function hideProject(config: HiveConfig, p: string): void {
  config.hiddenProjects = { ...unhidden(config, p), [path.resolve(p)]: new Date().toISOString() };
}

export function unhideProject(config: HiveConfig, p: string): void {
  if (!config.hiddenProjects) return;
  config.hiddenProjects = unhidden(config, p);
}

function unhidden(config: HiveConfig, p: string): Record<string, string> {
  const target = norm(p);
  return Object.fromEntries(Object.entries(config.hiddenProjects ?? {}).filter(([k]) => norm(k) !== target));
}
