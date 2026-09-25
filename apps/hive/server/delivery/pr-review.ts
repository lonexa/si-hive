/**
 * AI pull-request review via the configured LLM (ai/llm.ts).
 *
 * `reviewPullRequest` produces a markdown review for one PR (used by the
 * "AI review" button). `runPrReviewCycle` is the scheduled pipeline
 * (schedule type `pr-review-pipeline`): it reviews open PRs in locally
 * checked-out repos that haven't been reviewed at their current head and
 * posts the review as a PR comment.
 */
import type { HiveConfig } from '../types.js';
import type { GitHostProvider, PullRequest } from '../integrations/types.js';
import { gitHostForConnection, getConnection } from '../integrations/registry.js';
import { complete, isLlmConfigured } from '../ai/llm.js';
import { listLocalRepos } from './local-repos.js';
import { getSharedDb, nowIso } from '../../../../packages/shared/src/server/storage/index.js';

const MAX_DIFF_CHARS = 60_000;
export const REVIEW_MARKER = '<!-- hive-ai-review -->';

const SYSTEM_PROMPT = [
  'You are a senior engineer reviewing a pull request. Review ONLY the diff provided.',
  'Report, in order of severity: bugs and correctness problems, security issues, missing error handling, then maintainability concerns.',
  'For each finding give the file (and line if visible), what is wrong, and a concrete fix.',
  'Do not nitpick formatting. If the change looks good, say so briefly.',
  'Respond in GitHub-flavored markdown with a one-line verdict first: "Looks good", "Minor issues", or "Needs changes".',
].join('\n');

export async function reviewPullRequest(host: GitHostProvider, repo: string, pr: PullRequest): Promise<string> {
  let diff = await host.getPullRequestDiff(repo, pr.number);
  let truncated = false;
  if (diff.length > MAX_DIFF_CHARS) {
    diff = diff.slice(0, MAX_DIFF_CHARS);
    truncated = true;
  }
  const user = [
    `Repository: ${repo}`,
    `Pull request #${pr.number}: ${pr.title}`,
    `Branches: ${pr.sourceBranch} → ${pr.targetBranch}`,
    pr.description ? `Description:\n${pr.description.slice(0, 4000)}` : '',
    `Diff${truncated ? ' (truncated)' : ''}:`,
    '```diff',
    diff,
    '```',
  ].filter(Boolean).join('\n\n');
  return complete(SYSTEM_PROMPT, user, { maxTokens: 3000, timeoutMs: 300_000 });
}

export function formatReviewComment(review: string): string {
  return `${REVIEW_MARKER}\n**SI Hive AI review**\n\n${review}`;
}

async function alreadyReviewed(connectionId: string, repo: string, pr: PullRequest, headRef: string): Promise<boolean> {
  const db = await getSharedDb();
  const row = await db.selectFrom('pr_reviews').select('id')
    .where('connection_id', '=', connectionId).where('repo', '=', repo)
    .where('pr_number', '=', pr.number).where('head_ref', '=', headRef)
    .executeTakeFirst();
  return !!row;
}

/** Claim a (PR, head) pair; returns false if another instance already did. */
async function claim(connectionId: string, repo: string, pr: PullRequest, headRef: string): Promise<number | null> {
  const db = await getSharedDb();
  try {
    const res = await db.insertInto('pr_reviews').values({
      connection_id: connectionId, repo, pr_number: pr.number, head_ref: headRef, status: 'running', reviewed_at: nowIso(),
    }).executeTakeFirst();
    return Number(res.insertId ?? 0) || -1;
  } catch {
    return null; // unique violation → someone else has it
  }
}

async function finish(connectionId: string, repo: string, pr: PullRequest, headRef: string, status: 'posted' | 'failed', summary?: string, error?: string) {
  const db = await getSharedDb();
  await db.updateTable('pr_reviews').set({ status, summary: summary?.slice(0, 4000) ?? null, error: error ?? null, reviewed_at: nowIso() })
    .where('connection_id', '=', connectionId).where('repo', '=', repo)
    .where('pr_number', '=', pr.number).where('head_ref', '=', headRef)
    .execute();
}

/** Record a manually posted review so the scheduled pipeline skips this head. */
export async function recordPostedReview(connectionId: string, repo: string, pr: PullRequest, review: string): Promise<void> {
  const headRef = pr.headSha ?? pr.updatedAt ?? pr.createdAt;
  await claim(connectionId, repo, pr, headRef); // no-op if a row already exists
  await finish(connectionId, repo, pr, headRef, 'posted', review);
}

/**
 * One pass of the scheduled review pipeline. Returns a summary for the
 * schedule run log.
 */
export async function runPrReviewCycle(config: HiveConfig, maxReviews: number): Promise<string> {
  if (!isLlmConfigured(config)) return 'Skipped: no AI backend configured (Settings → AI).';
  const repos = listLocalRepos(config, { fresh: true });
  if (repos.length === 0) return 'No locally checked-out repositories on a connected git host.';

  const log: string[] = [];
  let reviewed = 0;
  for (const local of repos) {
    if (reviewed >= maxReviews) break;
    const conn = getConnection(config, local.connectionId);
    const host = conn ? gitHostForConnection(conn) : null;
    if (!host?.capabilities.has('pullRequests')) continue;
    let prs: PullRequest[];
    try {
      prs = await host.listPullRequests(local.repo, { state: 'open', limit: 20 });
    } catch (err) {
      log.push(`${local.repo}: could not list PRs (${(err as Error).message})`);
      continue;
    }
    for (const pr of prs) {
      if (reviewed >= maxReviews) break;
      if (pr.state === 'draft') continue;
      const headRef = pr.headSha ?? pr.updatedAt ?? pr.createdAt;
      if (await alreadyReviewed(local.connectionId, local.repo, pr, headRef)) continue;
      if ((await claim(local.connectionId, local.repo, pr, headRef)) === null) continue;
      try {
        const review = await reviewPullRequest(host, local.repo, pr);
        await host.commentOnPr(local.repo, pr.number, formatReviewComment(review));
        await finish(local.connectionId, local.repo, pr, headRef, 'posted', review);
        log.push(`${local.repo}#${pr.number}: reviewed`);
        reviewed++;
      } catch (err) {
        await finish(local.connectionId, local.repo, pr, headRef, 'failed', undefined, (err as Error).message);
        log.push(`${local.repo}#${pr.number}: failed (${(err as Error).message})`);
      }
    }
  }
  return log.length ? log.join('\n') : 'No PRs needed review.';
}
