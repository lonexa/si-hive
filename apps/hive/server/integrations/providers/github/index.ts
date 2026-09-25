/**
 * GitHub (github.com or GitHub Enterprise Server) — git host + Issues tracker.
 *
 * Auth: a personal access token (classic or fine-grained) with repo / issues
 * / pull request / actions read (and write, for commenting/merging).
 *
 * Issue keys are `owner/repo#123`. A bare `#123` resolves against the first
 * repository in the connection's "Issue repositories" setting.
 */
import type {
  Build,
  BuildStatus,
  Commit,
  ConnectionContext,
  GitHostProvider,
  IntegrationProviderDefinition,
  Issue,
  IssueComment,
  Iteration,
  Person,
  PrComment,
  PullRequest,
  Repo,
  StateCategory,
  TrackerProvider,
} from '../../types.js';
import { createHttpClient, normalizeBaseUrl, tail, type HttpClient } from '../../http.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface GhContext {
  http: HttpClient;
  webUrl: string;
  me: () => Promise<Person>;
  issueRepos: string[];
}

function makeContext(ctx: ConnectionContext): GhContext {
  const webUrl = normalizeBaseUrl(ctx.settings.baseUrl, 'https://github.com');
  const apiUrl = /^https:\/\/github\.com$/i.test(webUrl) ? 'https://api.github.com' : `${webUrl}/api/v3`;
  const http = createHttpClient('GitHub', apiUrl, {
    Authorization: `Bearer ${ctx.secrets.token ?? ''}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SI-Hive',
  });
  let meCache: Promise<Person> | null = null;
  const issueRepos = String(ctx.settings.issueRepos ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return {
    http,
    webUrl,
    issueRepos,
    me: () => (meCache ??= http<any>('/user').then(person)),
  };
}

function person(u: any): Person {
  return { id: String(u?.login ?? u?.id ?? ''), name: u?.name || u?.login || '', email: u?.email ?? undefined, avatarUrl: u?.avatar_url };
}

function nullablePerson(u: any): Person | null {
  return u ? person(u) : null;
}

// ---------------------------------------------------------------------------
// Git host
// ---------------------------------------------------------------------------

function mapRepo(r: any): Repo {
  return {
    id: String(r.id),
    fullName: r.full_name,
    name: r.name,
    defaultBranch: r.default_branch,
    webUrl: r.html_url,
    cloneUrl: r.clone_url,
    private: !!r.private,
  };
}

function mapPr(repo: string, p: any): PullRequest {
  const state = p.merged_at ? 'merged' : p.state === 'closed' ? 'closed' : p.draft ? 'draft' : 'open';
  return {
    id: String(p.id),
    number: p.number,
    repo,
    title: p.title,
    description: p.body ?? undefined,
    state,
    author: nullablePerson(p.user),
    sourceBranch: p.head?.ref ?? '',
    targetBranch: p.base?.ref ?? '',
    headSha: p.head?.sha ?? undefined,
    url: p.html_url,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    reviewers: (p.requested_reviewers ?? []).map(person),
    labels: (p.labels ?? []).map((l: any) => l.name),
    raw: p,
  };
}

function mapRunStatus(run: any): BuildStatus {
  if (run.status !== 'completed') return run.status === 'queued' || run.status === 'waiting' || run.status === 'pending' ? 'queued' : 'running';
  if (run.conclusion === 'success' || run.conclusion === 'skipped' || run.conclusion === 'neutral') return 'succeeded';
  if (run.conclusion === 'cancelled') return 'cancelled';
  return 'failed';
}

function createGitHost(ctx: ConnectionContext): GitHostProvider {
  const gh = makeContext(ctx);
  const { http } = gh;
  return {
    capabilities: new Set(['pullRequests', 'reviews', 'merge', 'builds', 'archive']),
    whoAmI: gh.me,

    async listRepos() {
      const repos: Repo[] = [];
      for (let page = 1; page <= 3; page++) {
        const batch = await http<any[]>(`/user/repos?per_page=100&sort=updated&page=${page}`);
        repos.push(...batch.map(mapRepo));
        if (batch.length < 100) break;
      }
      return repos;
    },

    async getRepo(fullName) {
      const r = await http<any>(`/repos/${fullName}`, { allow404: true });
      return r ? mapRepo(r) : null;
    },

    async listPullRequests(repo, opts = {}) {
      const state = opts.state ?? 'open';
      const prs = await http<any[]>(`/repos/${repo}/pulls?state=${state}&per_page=${Math.min(opts.limit ?? 30, 100)}&sort=updated&direction=desc`);
      return prs.map((p) => mapPr(repo, p));
    },

    async getPullRequest(repo, number) {
      const p = await http<any>(`/repos/${repo}/pulls/${number}`, { allow404: true });
      return p ? mapPr(repo, p) : null;
    },

    getPullRequestDiff(repo, number) {
      return http<string>(`/repos/${repo}/pulls/${number}`, { headers: { Accept: 'application/vnd.github.v3.diff' }, as: 'text' });
    },

    async listPrComments(repo, number) {
      const [general, inline] = await Promise.all([
        http<any[]>(`/repos/${repo}/issues/${number}/comments?per_page=100`),
        http<any[]>(`/repos/${repo}/pulls/${number}/comments?per_page=100`),
      ]);
      const out: PrComment[] = [
        ...general.map((c) => ({ id: String(c.id), author: nullablePerson(c.user), body: c.body ?? '', createdAt: c.created_at })),
        ...inline.map((c) => ({ id: String(c.id), author: nullablePerson(c.user), body: c.body ?? '', createdAt: c.created_at, path: c.path, line: c.line ?? c.original_line ?? undefined })),
      ];
      return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async commentOnPr(repo, number, body) {
      const c = await http<any>(`/repos/${repo}/issues/${number}/comments`, { method: 'POST', body: { body } });
      return { id: String(c.id), author: nullablePerson(c.user), body: c.body, createdAt: c.created_at };
    },

    async approvePr(repo, number, body) {
      await http(`/repos/${repo}/pulls/${number}/reviews`, { method: 'POST', body: { event: 'APPROVE', body: body ?? '' } });
    },

    async mergePr(repo, number) {
      await http(`/repos/${repo}/pulls/${number}/merge`, { method: 'PUT', body: {} });
    },

    async listCommits(repo, opts = {}) {
      const params = new URLSearchParams({ per_page: String(Math.min(opts.limit ?? 30, 100)) });
      if (opts.branch) params.set('sha', opts.branch);
      if (opts.since) params.set('since', opts.since);
      const commits = await http<any[]>(`/repos/${repo}/commits?${params}`);
      return commits.map((c): Commit => ({
        sha: c.sha,
        message: c.commit?.message ?? '',
        author: c.author ? person(c.author) : { id: c.commit?.author?.email ?? '', name: c.commit?.author?.name ?? '', email: c.commit?.author?.email },
        date: c.commit?.author?.date ?? c.commit?.committer?.date ?? '',
        url: c.html_url,
      }));
    },

    async listBuilds(repo, opts = {}) {
      const params = new URLSearchParams({ per_page: String(Math.min(opts.limit ?? 20, 100)) });
      if (opts.branch) params.set('branch', opts.branch);
      const res = await http<any>(`/repos/${repo}/actions/runs?${params}`);
      return (res.workflow_runs ?? []).map((r: any): Build => ({
        id: String(r.id),
        name: r.name ?? r.display_title ?? 'workflow',
        status: mapRunStatus(r),
        branch: r.head_branch ?? undefined,
        commitSha: r.head_sha ?? undefined,
        url: r.html_url,
        startedAt: r.run_started_at ?? r.created_at,
        finishedAt: r.status === 'completed' ? r.updated_at : undefined,
      }));
    },

    async getBuildLog(repo, buildId) {
      // Run logs are a zip; per-job logs are plain text. Prefer failed jobs.
      const jobs = await http<any>(`/repos/${repo}/actions/runs/${buildId}/jobs?per_page=50`);
      const all = (jobs.jobs ?? []) as any[];
      const failed = all.filter((j) => j.conclusion === 'failure');
      const chosen = (failed.length ? failed : all).slice(0, 3);
      const parts: string[] = [];
      for (const job of chosen) {
        const log = await http<string>(`/repos/${repo}/actions/jobs/${job.id}/logs`, { as: 'text' }).catch((e) => `(log unavailable: ${(e as Error).message})`);
        parts.push(`=== ${job.name} (${job.conclusion ?? job.status}) ===\n${tail(log, 15_000)}`);
      }
      return parts.join('\n\n');
    },

    downloadArchive(repo, ref) {
      return http<Buffer>(`/repos/${repo}/zipball/${encodeURIComponent(ref)}`, { as: 'buffer', timeoutMs: 300_000 });
    },
  };
}

// ---------------------------------------------------------------------------
// Tracker (GitHub Issues)
// ---------------------------------------------------------------------------

const IN_PROGRESS_LABEL = /\b(in[\s-]?progress|doing|wip|started)\b/i;

function stateCategoryOf(i: any): StateCategory {
  if (i.state === 'closed') return 'done';
  return (i.labels ?? []).some((l: any) => IN_PROGRESS_LABEL.test(typeof l === 'string' ? l : l.name)) ? 'in_progress' : 'todo';
}

function repoFromIssueUrl(url: string): string {
  const m = /\/repos\/([^/]+\/[^/]+)\/issues\//.exec(url);
  return m ? m[1] : '';
}

function mapIssue(i: any, repo = repoFromIssueUrl(i.url ?? '')): Issue {
  return {
    id: String(i.id),
    key: `${repo}#${i.number}`,
    title: i.title,
    description: i.body ?? undefined,
    state: i.state,
    stateCategory: stateCategoryOf(i),
    type: (i.labels ?? []).some((l: any) => /bug/i.test(l.name)) ? 'Bug' : 'Issue',
    assignee: nullablePerson(i.assignee),
    labels: (i.labels ?? []).map((l: any) => l.name),
    iteration: i.milestone?.title ?? undefined,
    url: i.html_url,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    raw: i,
  };
}

function createTracker(ctx: ConnectionContext): TrackerProvider {
  const gh = makeContext(ctx);
  const { http } = gh;

  function parseKey(key: string): { repo: string; number: number } {
    const m = /^(?:([\w.-]+\/[\w.-]+))?#?(\d+)$/.exec(key.trim());
    const repo = m?.[1] ?? gh.issueRepos[0];
    if (!m || !repo) throw new Error(`GitHub: cannot resolve issue "${key}" — use owner/repo#number or set Issue repositories`);
    return { repo, number: Number(m[2]) };
  }

  function defaultRepo(): string {
    if (!gh.issueRepos[0]) throw new Error('GitHub: set "Issue repositories" on the connection to create issues');
    return gh.issueRepos[0];
  }

  async function resolveAssignee(a: string | null | undefined): Promise<string[] | undefined> {
    if (a === undefined) return undefined;
    if (a === null) return [];
    return [a === 'me' ? (await gh.me()).id : a];
  }

  return {
    capabilities: new Set(['create', 'comment', 'assign', 'transition', 'labels', 'iterations']),
    ticketRefPattern: /(?:\b[\w.-]+\/[\w.-]+)?#\d{1,7}\b/g,
    issueUrl(key) {
      const { repo, number } = parseKey(key);
      return `${gh.webUrl}/${repo}/issues/${number}`;
    },
    whoAmI: gh.me,

    async searchIssues(q) {
      const terms: string[] = ['is:issue'];
      const repos = gh.issueRepos;
      if (repos.length) terms.push(...repos.map((r) => `repo:${r}`));
      else terms.push(`involves:${(await gh.me()).id}`);
      if (q.text) terms.push(q.text.replace(/[:"]/g, ' '));
      if (q.labels?.length) terms.push(`label:${q.labels.map((l) => JSON.stringify(l)).join(',')}`);
      if (q.assignee) terms.push(`assignee:${q.assignee === 'me' ? (await gh.me()).id : q.assignee}`);
      if (q.iterationId) terms.push(`milestone:${JSON.stringify(q.iterationId)}`);
      const cats = q.stateCategory ?? [];
      if (cats.length && !cats.includes('done')) terms.push('is:open');
      else if (cats.length === 1 && cats[0] === 'done') terms.push('is:closed');
      const res = await http<any>(`/search/issues?q=${encodeURIComponent(terms.join(' '))}&per_page=${Math.min(q.limit ?? 30, 100)}&sort=updated`);
      let issues = (res.items ?? []).map((i: any) => mapIssue(i));
      if (cats.length) issues = issues.filter((i: Issue) => cats.includes(i.stateCategory));
      return issues;
    },

    async getIssue(key) {
      const { repo, number } = parseKey(key);
      const i = await http<any>(`/repos/${repo}/issues/${number}`, { allow404: true });
      return i && !i.pull_request ? mapIssue(i, repo) : null;
    },

    async createIssue(input) {
      const repo = defaultRepo();
      const i = await http<any>(`/repos/${repo}/issues`, {
        method: 'POST',
        body: { title: input.title, body: input.description ?? '', labels: input.labels, assignees: await resolveAssignee(input.assignee) },
      });
      return mapIssue(i, repo);
    },

    async updateIssue(key, patch) {
      const { repo, number } = parseKey(key);
      const body: Record<string, unknown> = {};
      if (patch.title !== undefined) body.title = patch.title;
      if (patch.description !== undefined) body.body = patch.description;
      if (patch.labels !== undefined) body.labels = patch.labels;
      if (patch.assignee !== undefined) body.assignees = await resolveAssignee(patch.assignee);
      const cat = patch.stateCategory ?? (patch.state === 'closed' ? 'done' : patch.state === 'open' ? 'todo' : undefined);
      if (cat) body.state = cat === 'done' ? 'closed' : 'open';
      const i = await http<any>(`/repos/${repo}/issues/${number}`, { method: 'PATCH', body });
      return mapIssue(i, repo);
    },

    async addComment(key, text) {
      const { repo, number } = parseKey(key);
      const c = await http<any>(`/repos/${repo}/issues/${number}/comments`, { method: 'POST', body: { body: text } });
      return { id: String(c.id), author: nullablePerson(c.user), body: c.body, createdAt: c.created_at };
    },

    async listComments(key) {
      const { repo, number } = parseKey(key);
      const cs = await http<any[]>(`/repos/${repo}/issues/${number}/comments?per_page=100`);
      return cs.map((c): IssueComment => ({ id: String(c.id), author: nullablePerson(c.user), body: c.body ?? '', createdAt: c.created_at }));
    },

    /** Milestones of the first issue repository act as iterations. */
    async listIterations() {
      if (!gh.issueRepos[0]) return [];
      const ms = await http<any[]>(`/repos/${gh.issueRepos[0]}/milestones?state=all&per_page=50&sort=due_on`);
      const now = Date.now();
      const open = ms.filter((m) => m.state === 'open' && m.due_on).sort((a, b) => a.due_on.localeCompare(b.due_on));
      const currentId = open.find((m) => Date.parse(m.due_on) >= now)?.id;
      // Milestone title is the id: it's what issues carry and what search filters on.
      return ms.map((m): Iteration => ({
        id: m.title,
        name: m.title,
        startDate: m.created_at,
        endDate: m.due_on ?? undefined,
        current: m.id === currentId,
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const githubProvider: IntegrationProviderDefinition = {
  id: 'github',
  displayName: 'GitHub',
  icon: 'Github',
  kinds: ['git', 'tracker'],
  configSchema: [
    { key: 'baseUrl', label: 'GitHub URL', type: 'url', placeholder: 'https://github.com', default: 'https://github.com', help: 'Change only for GitHub Enterprise Server.' },
    {
      key: 'token', label: 'Personal access token', type: 'secret', required: true,
      help: 'Needs repository contents, pull requests, issues and actions access.',
      helpUrl: 'https://github.com/settings/personal-access-tokens',
    },
    { key: 'issueRepos', label: 'Issue repositories', type: 'text', placeholder: 'owner/repo, owner/other', help: 'Repositories whose issues SI Hive tracks. The first one receives new issues.' },
  ],
  matchesRemote(remoteUrl, settings) {
    const host = new URL(normalizeBaseUrl(settings.baseUrl, 'https://github.com')).hostname.toLowerCase();
    return remoteUrl.toLowerCase().includes(host);
  },
  repoFromRemote(remoteUrl) {
    const m = /[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
    return m ? m[1] : null;
  },
  createGitHost,
  createTracker,
  gitCredential(ctx) {
    const token = ctx.secrets.token;
    if (!token) return null;
    return { host: new URL(normalizeBaseUrl(ctx.settings.baseUrl, 'https://github.com')).hostname, username: 'x-access-token', password: token };
  },
};
