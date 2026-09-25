/**
 * Cross-repo delivery feeds over the locally checked-out repos:
 *   - landedCommits:  what landed on each repo's default branch recently
 *   - buildFailures:  failed CI runs, optionally with an AI triage note
 */
import type { HiveConfig } from '../types.js';
import type { Build, Commit, GitHostProvider } from '../integrations/types.js';
import { getConnection, gitHostForConnection } from '../integrations/registry.js';
import { complete, isLlmConfigured } from '../ai/llm.js';
import { listLocalRepos, type LocalRepo } from './local-repos.js';

interface RepoHost { local: LocalRepo; host: GitHostProvider }

function reposWithHosts(config: HiveConfig): RepoHost[] {
  const out: RepoHost[] = [];
  for (const local of listLocalRepos(config)) {
    const conn = getConnection(config, local.connectionId);
    const host = conn ? gitHostForConnection(conn) : null;
    if (host) out.push({ local, host });
  }
  return out;
}

const NOISE = /^(merge (pull request|branch|remote-tracking)|bump version|chore\(release\))/i;

export interface LandedCommit extends Commit {
  repo: string;
  connectionId: string;
}

export interface LandedFeed {
  days: { date: string; commits: LandedCommit[] }[];
  highlights?: string;
  warnings: string[];
}

export async function landedCommits(config: HiveConfig, days: number, withAi: boolean): Promise<LandedFeed> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const warnings: string[] = [];
  const all: LandedCommit[] = [];

  await Promise.all(reposWithHosts(config).map(async ({ local, host }) => {
    try {
      const repo = await host.getRepo(local.repo);
      const commits = await host.listCommits(local.repo, { branch: repo?.defaultBranch, since, limit: 100 });
      for (const c of commits) {
        if (!NOISE.test(c.message)) all.push({ ...c, repo: local.repo, connectionId: local.connectionId });
      }
    } catch (err) {
      warnings.push(`${local.repo}: ${(err as Error).message}`);
    }
  }));

  all.sort((a, b) => b.date.localeCompare(a.date));
  const byDay = new Map<string, LandedCommit[]>();
  for (const c of all) {
    const day = c.date.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), c]);
  }
  const feed: LandedFeed = { days: [...byDay].map(([date, commits]) => ({ date, commits })), warnings };

  if (withAi && all.length && isLlmConfigured(config)) {
    const list = all.slice(0, 150).map((c) => `- [${c.repo}] ${c.message.split(/\r?\n/)[0]} (${c.author?.name ?? 'unknown'})`).join('\n');
    try {
      feed.highlights = await complete(
        'Summarize what shipped for an engineering team. Group related commits into 3-8 themed bullets, most important first. Name repos. No preamble.',
        `Commits from the last ${days} day(s):\n${list}`,
        { maxTokens: 800 },
      );
    } catch (err) {
      warnings.push(`AI highlights unavailable: ${(err as Error).message}`);
    }
  }
  return feed;
}

export interface BuildFailure {
  /** Stable id for notifications (connection:repo:build). */
  id: string;
  buildId: string;
  /** Pipeline / workflow name. */
  definition: string;
  /** Human label for the run. */
  buildNumber: string;
  repo: string;
  connectionId: string;
  branch?: string;
  finishTime: string;
  url: string;
  triage?: string;
}

export async function buildFailures(config: HiveConfig, days: number, withAi: boolean): Promise<{ failures: BuildFailure[]; warnings: string[] }> {
  const cutoff = Date.now() - days * 86_400_000;
  const warnings: string[] = [];
  const failures: BuildFailure[] = [];

  await Promise.all(reposWithHosts(config).map(async ({ local, host }) => {
    if (!host.capabilities.has('builds') || !host.listBuilds) return;
    try {
      const builds: Build[] = await host.listBuilds(local.repo, { limit: 30 });
      for (const b of builds) {
        const finished = b.finishedAt ?? b.startedAt ?? '';
        if (b.status !== 'failed' || !finished || Date.parse(finished) < cutoff) continue;
        failures.push({
          id: `${local.connectionId}:${local.repo}:${b.id}`,
          buildId: b.id,
          definition: `${local.repo} · ${b.name}`,
          buildNumber: b.branch ? `${b.branch}${b.commitSha ? ` @ ${b.commitSha.slice(0, 7)}` : ''}` : b.id,
          repo: local.repo,
          connectionId: local.connectionId,
          branch: b.branch,
          finishTime: finished,
          url: b.url,
        });
      }
    } catch (err) {
      warnings.push(`${local.repo}: ${(err as Error).message}`);
    }
  }));

  failures.sort((a, b) => b.finishTime.localeCompare(a.finishTime));

  if (withAi && isLlmConfigured(config)) {
    for (const f of failures.slice(0, 5)) {
      const conn = getConnection(config, f.connectionId);
      const host = conn ? gitHostForConnection(conn) : null;
      if (!host?.getBuildLog) continue;
      try {
        const log = await host.getBuildLog(f.repo, f.buildId);
        f.triage = await complete(
          'You triage CI failures. From the log tail, state in 2-4 sentences the most likely root cause and the concrete fix. Quote the key error line.',
          `Build: ${f.definition} (${f.buildNumber})\n\nLog tail:\n${log.slice(-12_000)}`,
          { maxTokens: 500 },
        );
      } catch (err) {
        f.triage = `Triage unavailable: ${(err as Error).message}`;
      }
    }
  }
  return { failures, warnings };
}
