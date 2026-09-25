/**
 * Update mechanism for Hive.
 * Delegates to shared updater with Hive-specific config.
 */

import { join, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { getGitHost } from './integrations/registry.js';
import {
  checkForUpdates as sharedCheck,
  applyUpdates as sharedApply,
  getChangelog as sharedChangelog,
  getLocalCommit as sharedLocalCommit,
} from '../../../packages/shared/src/server/updater.js';
import type { UpdateStatus, UpdateResult, UpdaterConfig, UpdateSource, ChangelogEntry, ProgressCallback } from '../../../packages/shared/src/server/updater.js';

export type { UpdateStatus, UpdateResult, ChangelogEntry, ProgressCallback };

/**
 * `config.updates`: which repo/branch this install updates from. Off unless
 * the user points it at a repo on one of their connected git hosts.
 */
export interface UpdatesConfig {
  /** Integration connection id of the git host serving the repo. */
  connectionId?: string;
  /** Repo full name on that host, e.g. `owner/hive`. */
  repo?: string;
  branch?: string;
}

const repoDir = resolve(join(import.meta.dirname, '..', '..', '..'));

function getUpdateSource(): UpdateSource | null {
  const config = loadConfig();
  const updates = config.updates as UpdatesConfig | undefined;
  if (!updates?.repo) return null;
  const host = getGitHost(config, { connectionId: updates.connectionId });
  if (!host?.downloadArchive) return null;
  const repo = updates.repo;
  const branch = updates.branch || 'main';
  return {
    async getLatestCommit() {
      const [latest] = await host.listCommits(repo, { branch, limit: 1 });
      return latest?.sha ?? null;
    },
    async listCommits(limit) {
      const commits = await host.listCommits(repo, { branch, limit });
      return commits.map((c) => ({ commitId: c.sha, message: c.message, author: c.author?.name ?? '', date: c.date }));
    },
    downloadArchive: () => host.downloadArchive!(repo, branch),
  };
}

function getUpdaterConfig(): UpdaterConfig {
  return {
    repoDir,
    serverEntry: join(import.meta.dirname, 'index.ts'),
    getSource: getUpdateSource,
  };
}

export function checkForUpdates(): Promise<UpdateStatus> {
  return sharedCheck(getUpdaterConfig());
}

export function applyUpdates(onProgress?: ProgressCallback): Promise<UpdateResult> {
  return sharedApply(getUpdaterConfig(), onProgress);
}

export function getChangelog(): Promise<ChangelogEntry[]> {
  return sharedChangelog(getUpdaterConfig());
}

/** This install's local commit hash (reliable cross-machine version identity). */
export function getLocalCommit(): string {
  return sharedLocalCommit(repoDir);
}

// The latest update-branch commit, cached so the admin user-list poll (every
// 30s) doesn't hit the git host API on every request. A commit hash looks like a 40-char
// hex string; checkForUpdates returns 'unknown'/'error' when auth is missing or
// the API call fails — we cache those briefly but never treat them as a real
// "latest" (callers must guard), so staleness can't be falsely reported.
let latestCommitCache: { value: string; at: number } | null = null;
const LATEST_COMMIT_TTL_MS = 5 * 60_000;

export async function getLatestCommit(): Promise<string> {
  const now = Date.now();
  if (latestCommitCache && now - latestCommitCache.at < LATEST_COMMIT_TTL_MS) {
    return latestCommitCache.value;
  }
  try {
    const status = await checkForUpdates();
    latestCommitCache = { value: status.latestVersion, at: now };
    return status.latestVersion;
  } catch {
    return latestCommitCache?.value ?? 'unknown';
  }
}
