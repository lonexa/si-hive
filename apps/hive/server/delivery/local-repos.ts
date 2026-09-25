/**
 * Map local project checkouts to repositories on connected git hosts.
 *
 * Delivery features (PR list, "what landed", build failures) default to the
 * repos the user actually works in — the ones checked out locally — rather
 * than every repo their token can see.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { HiveConfig } from '../types.js';
import { GitClient } from '../projects/git-client.js';
import { getProviderDefinition, getGitHostConnection } from '../integrations/registry.js';
import { decodeWindowsProjectDir } from '../parsers/process-discovery-windows.js';
import { isWindows } from '../platform.js';
import { isPathInScope } from '../project-scope.js';

export interface LocalRepo {
  /** Absolute path of the local checkout. */
  path: string;
  remoteUrl: string;
  connectionId: string;
  /** Repo fullName on the git host. */
  repo: string;
}

const git = new GitClient();
let cache: { at: number; repos: LocalRepo[] } | null = null;
const TTL_MS = 60_000;

function decodeProjectDirName(encoded: string): string {
  if (isWindows) return decodeWindowsProjectDir(encoded);
  return '/' + encoded.replace(/-/g, '/');
}

/** Local project directories Hive knows about (agent history + configured roots). */
export function listLocalProjectPaths(config: HiveConfig): string[] {
  const paths = new Set<string>();
  const add = (p: string) => { if (p && fs.existsSync(p) && isPathInScope(config, p)) paths.add(path.resolve(p)); };

  for (const p of config.projects ?? []) add(p.path);

  const claudeProjects = path.join(config.claudeHome, 'projects');
  if (fs.existsSync(claudeProjects)) {
    for (const entry of fs.readdirSync(claudeProjects, { withFileTypes: true })) {
      if (entry.isDirectory()) add(decodeProjectDirName(entry.name));
    }
  }

  for (const root of [config.projectsRoot, ...(config.projectRoots ?? [])]) {
    if (!root || !fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) add(path.join(root, entry.name));
    }
  }
  return [...paths];
}

/** Local checkouts whose origin belongs to a connected git host (cached ~1 min). */
export function listLocalRepos(config: HiveConfig, opts: { fresh?: boolean } = {}): LocalRepo[] {
  if (!opts.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.repos;
  const repos: LocalRepo[] = [];
  const seen = new Set<string>();
  for (const p of listLocalProjectPaths(config)) {
    if (!fs.existsSync(path.join(p, '.git'))) continue;
    const remoteUrl = git.getOriginUrl(p);
    if (!remoteUrl) continue;
    const conn = getGitHostConnection(config, { remoteUrl, projectPath: p });
    if (!conn) continue;
    const repo = getProviderDefinition(conn.providerId)?.repoFromRemote?.(remoteUrl);
    if (!repo) continue;
    const key = `${conn.id}:${repo.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    repos.push({ path: p, remoteUrl, connectionId: conn.id, repo });
  }
  cache = { at: Date.now(), repos };
  return repos;
}

/** The local checkout of a repo, if there is one. */
export function findLocalCheckout(config: HiveConfig, connectionId: string, repo: string): string | null {
  return listLocalRepos(config).find((r) => r.connectionId === connectionId && r.repo.toLowerCase() === repo.toLowerCase())?.path ?? null;
}
