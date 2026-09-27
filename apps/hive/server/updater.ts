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
 * the user points it at a repo — on one of their connected git hosts, or a
 * public GitHub repo read without signing in.
 */
export interface UpdatesConfig {
  /**
   * Integration connection id of the git host serving the repo, or
   * PUBLIC_GITHUB to read a public GitHub repo without an integration.
   */
  connectionId?: string;
  /** Repo full name on that host, e.g. `owner/hive`. */
  repo?: string;
  branch?: string;
}

/** `connectionId` value for a public GitHub repo (no integration, no token). */
export const PUBLIC_GITHUB = 'github-public';

/** `owner/name` from `owner/name` or a github.com URL; null if it isn't one. */
export function parseGitHubRepo(input: string): string | null {
  const m = input.trim().match(/^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

// Unauthenticated GitHub API calls are limited to 60 an hour per IP, and every
// open SI Hive tab polls for updates, so answers are shared for a while.
const PUBLIC_CACHE_MS = 2 * 60_000;
const publicCache = new Map<string, { at: number; value: Promise<ChangelogEntry[]> }>();
const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'SI-Hive-Updater',
};

async function githubFetch(url: string, timeoutMs: number): Promise<Response> {
  const res = await fetch(url, { headers: GITHUB_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (res.ok) return res;
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
    throw new Error(`GitHub rate limit reached — try again ${reset ? `after ${new Date(reset).toLocaleTimeString()}` : 'later'}`);
  }
  if (res.status === 404) throw new Error('Repository or branch not found on GitHub (is it public?)');
  throw new Error(`GitHub returned ${res.status} ${res.statusText}`);
}

function publicGitHubSource(repo: string, branch: string): UpdateSource {
  const listCommits = (limit: number): Promise<ChangelogEntry[]> => {
    const key = `${repo}@${branch}#${limit}`;
    const hit = publicCache.get(key);
    if (hit && Date.now() - hit.at < PUBLIC_CACHE_MS) return hit.value;
    const value = githubFetch(`https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${limit}`, 30_000)
      .then((r) => r.json() as Promise<Array<{ sha: string; commit?: { message?: string; author?: { name?: string; date?: string } } }>>)
      .then((list) => list.map((c) => ({
        commitId: c.sha,
        message: c.commit?.message ?? '',
        author: c.commit?.author?.name ?? '',
        date: c.commit?.author?.date ?? '',
      })));
    publicCache.set(key, { at: Date.now(), value });
    value.catch(() => publicCache.delete(key));
    return value;
  };
  return {
    async getLatestCommit() {
      const [latest] = await listCommits(1);
      return latest?.commitId ?? null;
    },
    listCommits,
    async downloadArchive() {
      const res = await githubFetch(`https://codeload.github.com/${repo}/zip/refs/heads/${encodeURIComponent(branch)}`, 600_000);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

const repoDir = resolve(join(import.meta.dirname, '..', '..', '..'));

function getUpdateSource(): UpdateSource | null {
  const config = loadConfig();
  const updates = config.updates as UpdatesConfig | undefined;
  if (!updates?.repo) return null;
  if (updates.connectionId === PUBLIC_GITHUB) {
    const repo = parseGitHubRepo(updates.repo);
    return repo ? publicGitHubSource(repo, updates.branch || 'main') : null;
  }
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
