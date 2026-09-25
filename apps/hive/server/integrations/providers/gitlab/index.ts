/**
 * GitLab (gitlab.com or self-managed) — git host + Issues tracker.
 *
 * Auth: a personal, group or project access token with `api` scope (or
 * `read_api` for read-only use). Sent as the `PRIVATE-TOKEN` header.
 *
 * Projects are addressed by their full path (`group/sub/project`), URL-encoded
 * in API paths. Merge requests map to PullRequest with `number` = MR iid.
 *
 * Issue keys are `group/project#123`. A bare `#123` resolves against the first
 * project in the connection's "Issue projects" setting.
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
  PullRequestState,
  Repo,
  StateCategory,
  TrackerProvider,
} from '../../types.js';
import { createHttpClient, normalizeBaseUrl, tail, type HttpClient } from '../../http.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DEFAULT_URL = 'https://gitlab.com';

interface GlContext {
  http: HttpClient;
  webUrl: string;
  /** Raw `/user` payload (numeric `id` is needed for assignee_ids). */
  meRaw: () => Promise<any>;
  me: () => Promise<Person>;
  issueProjects: string[];
}

function makeContext(ctx: ConnectionContext): GlContext {
  const webUrl = normalizeBaseUrl(ctx.settings.baseUrl, DEFAULT_URL);
  const http = createHttpClient('GitLab', `${webUrl}/api/v4`, {
    'PRIVATE-TOKEN': ctx.secrets.token ?? '',
    'User-Agent': 'SI-Hive',
  });
  let meCache: Promise<any> | null = null;
  const meRaw = () => (meCache ??= http<any>('/user'));
  const issueProjects = String(ctx.settings.issueProjects ?? '')
    .split(',').map((s) => s.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean);
  return { http, webUrl, issueProjects, meRaw, me: () => meRaw().then(person) };
}

/** Project id segment for API paths: the URL-encoded full path. */
const enc = (fullPath: string) => encodeURIComponent(fullPath);

function person(u: any): Person {
  return { id: String(u?.username ?? u?.id ?? ''), name: u?.name || u?.username || '', email: u?.email || u?.public_email || undefined, avatarUrl: u?.avatar_url ?? undefined };
}

function nullablePerson(u: any): Person | null {
  return u ? person(u) : null;
}

function labelNames(labels: any[] | undefined): string[] {
  return (labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
}

/** Notes include system events ("added 1 commit", "changed the description"); keep human ones. */
function mapNote(n: any): PrComment {
  const pos = n.position;
  return {
    id: String(n.id),
    author: nullablePerson(n.author),
    body: n.body ?? '',
    createdAt: n.created_at,
    path: pos ? pos.new_path ?? pos.old_path ?? undefined : undefined,
    line: pos ? pos.new_line ?? pos.old_line ?? undefined : undefined,
  };
}

// ---------------------------------------------------------------------------
// Git host
// ---------------------------------------------------------------------------

function mapRepo(r: any): Repo {
  return {
    id: String(r.id),
    fullName: r.path_with_namespace,
    name: r.path ?? r.name,
    // Empty projects have no default branch yet.
    defaultBranch: r.default_branch || 'main',
    webUrl: r.web_url,
    cloneUrl: r.http_url_to_repo,
    private: r.visibility ? r.visibility !== 'public' : undefined,
  };
}

function mrState(m: any): PullRequestState {
  if (m.state === 'merged') return 'merged';
  if (m.state === 'closed' || m.state === 'locked') return 'closed';
  return m.draft || m.work_in_progress ? 'draft' : 'open';
}

function mapMr(repo: string, m: any): PullRequest {
  return {
    id: String(m.id),
    number: m.iid,
    repo,
    title: m.title,
    description: m.description ?? undefined,
    state: mrState(m),
    author: nullablePerson(m.author),
    sourceBranch: m.source_branch ?? '',
    targetBranch: m.target_branch ?? '',
    headSha: m.sha ?? undefined,
    url: m.web_url,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
    reviewers: (m.reviewers ?? []).map(person),
    labels: labelNames(m.labels),
    raw: m,
  };
}

function mapPipelineStatus(status: string): BuildStatus {
  switch (status) {
    case 'running': return 'running';
    case 'success':
    case 'skipped': return 'succeeded';
    case 'failed': return 'failed';
    case 'canceled':
    case 'canceling': return 'cancelled';
    // created, waiting_for_resource, preparing, pending, scheduled, manual
    default: return 'queued';
  }
}

const FINISHED_PIPELINE = new Set(['success', 'failed', 'canceled', 'skipped']);

/** Rebuild `git diff` text from GitLab's per-file diff entries (`/diffs` or `/changes`). */
function unifiedDiff(changes: any[]): string {
  const files = changes.map((c) => {
    const a = c.old_path;
    const b = c.new_path;
    const lines = [`diff --git a/${a} b/${b}`];
    if (c.new_file) lines.push(`new file mode ${c.b_mode ?? '100644'}`);
    else if (c.deleted_file) lines.push(`deleted file mode ${c.a_mode ?? '100644'}`);
    else {
      if (c.a_mode && c.b_mode && c.a_mode !== c.b_mode) lines.push(`old mode ${c.a_mode}`, `new mode ${c.b_mode}`);
      if (c.renamed_file) lines.push(`rename from ${a}`, `rename to ${b}`);
    }
    if (c.diff) {
      lines.push(`--- ${c.new_file ? '/dev/null' : `a/${a}`}`, `+++ ${c.deleted_file ? '/dev/null' : `b/${b}`}`, String(c.diff).replace(/\n$/, ''));
    }
    return lines.join('\n');
  });
  return files.length ? `${files.join('\n')}\n` : '';
}

function createGitHost(ctx: ConnectionContext): GitHostProvider {
  const gl = makeContext(ctx);
  const { http } = gl;
  const mrPath = (repo: string, iid: number) => `/projects/${enc(repo)}/merge_requests/${iid}`;

  return {
    capabilities: new Set(['pullRequests', 'reviews', 'merge', 'builds', 'archive']),
    whoAmI: gl.me,

    async listRepos() {
      const repos: Repo[] = [];
      for (let page = 1; page <= 3; page++) {
        const batch = await http<any[]>(`/projects?membership=true&archived=false&simple=true&per_page=100&order_by=last_activity_at&page=${page}`);
        repos.push(...batch.map(mapRepo));
        if (batch.length < 100) break;
      }
      return repos;
    },

    async getRepo(fullName) {
      const r = await http<any>(`/projects/${enc(fullName)}`, { allow404: true });
      return r ? mapRepo(r) : null;
    },

    async listPullRequests(repo, opts = {}) {
      const limit = Math.min(opts.limit ?? 30, 100);
      const list = (state: string) => http<any[]>(`/projects/${enc(repo)}/merge_requests?state=${state}&per_page=${limit}&order_by=updated_at&sort=desc`);
      const state = opts.state ?? 'open';
      let mrs: any[];
      if (state === 'open') mrs = await list('opened');
      else if (state === 'all') mrs = await list('all');
      else {
        // "closed" in the contract includes merged; GitLab keeps them apart.
        const [closed, merged] = await Promise.all([list('closed'), list('merged')]);
        mrs = [...closed, ...merged].sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at))).slice(0, limit);
      }
      return mrs.map((m) => mapMr(repo, m));
    },

    async getPullRequest(repo, number) {
      const m = await http<any>(mrPath(repo, number), { allow404: true });
      return m ? mapMr(repo, m) : null;
    },

    async getPullRequestDiff(repo, number) {
      // GitLab 17.x+ serves the unified diff directly.
      const raw = await http<string | null>(`${mrPath(repo, number)}/raw_diffs`, { as: 'text', allow404: true });
      if (raw != null) return raw;
      // Older versions: page through /diffs (15.7+), else the deprecated /changes.
      const entries: any[] = [];
      for (let page = 1; page <= 10; page++) {
        const batch = await http<any[] | null>(`${mrPath(repo, number)}/diffs?per_page=100&page=${page}`, { allow404: true });
        if (!batch) break;
        entries.push(...batch);
        if (batch.length < 100) return unifiedDiff(entries);
      }
      if (entries.length) return unifiedDiff(entries);
      const mr = await http<any>(`${mrPath(repo, number)}/changes`);
      return unifiedDiff(mr.changes ?? []);
    },

    async listPrComments(repo, number) {
      const notes = await http<any[]>(`${mrPath(repo, number)}/notes?per_page=100&sort=asc&order_by=created_at`);
      return notes.filter((n) => !n.system).map(mapNote);
    },

    async commentOnPr(repo, number, body) {
      return mapNote(await http<any>(`${mrPath(repo, number)}/notes`, { method: 'POST', body: { body } }));
    },

    async approvePr(repo, number, body) {
      await http(`${mrPath(repo, number)}/approve`, { method: 'POST', body: {} });
      if (body) await http(`${mrPath(repo, number)}/notes`, { method: 'POST', body: { body } });
    },

    async mergePr(repo, number) {
      await http(`${mrPath(repo, number)}/merge`, { method: 'PUT', body: {} });
    },

    async listCommits(repo, opts = {}) {
      const params = new URLSearchParams({ per_page: String(Math.min(opts.limit ?? 30, 100)) });
      if (opts.branch) params.set('ref_name', opts.branch);
      if (opts.since) params.set('since', opts.since);
      const commits = await http<any[]>(`/projects/${enc(repo)}/repository/commits?${params}`);
      return commits.map((c): Commit => ({
        sha: c.id,
        message: c.message ?? c.title ?? '',
        author: { id: c.author_email ?? '', name: c.author_name ?? '', email: c.author_email ?? undefined },
        date: c.authored_date ?? c.created_at ?? c.committed_date ?? '',
        url: c.web_url ?? `${gl.webUrl}/${repo}/-/commit/${c.id}`,
      }));
    },

    async listBuilds(repo, opts = {}) {
      const params = new URLSearchParams({ per_page: String(Math.min(opts.limit ?? 20, 100)), order_by: 'id', sort: 'desc' });
      if (opts.branch) params.set('ref', opts.branch);
      const pipelines = await http<any[]>(`/projects/${enc(repo)}/pipelines?${params}`);
      return pipelines.map((p): Build => ({
        id: String(p.id),
        name: p.name || `Pipeline #${p.iid ?? p.id}`,
        status: mapPipelineStatus(p.status),
        branch: p.ref ?? undefined,
        commitSha: p.sha ?? undefined,
        url: p.web_url,
        startedAt: p.started_at ?? p.created_at,
        finishedAt: p.finished_at ?? (FINISHED_PIPELINE.has(p.status) ? p.updated_at : undefined),
      }));
    },

    async getBuildLog(repo, buildId) {
      const jobs = await http<any[]>(`/projects/${enc(repo)}/pipelines/${encodeURIComponent(buildId)}/jobs?per_page=100`);
      const failed = jobs.filter((j) => j.status === 'failed');
      const chosen = (failed.length ? failed : jobs).slice(0, 3);
      const parts: string[] = [];
      for (const job of chosen) {
        const log = await http<string>(`/projects/${enc(repo)}/jobs/${job.id}/trace`, { as: 'text', headers: { Accept: 'text/plain' } })
          .catch((e) => `(log unavailable: ${(e as Error).message})`);
        parts.push(`=== ${job.stage ? `${job.stage} / ` : ''}${job.name} (${job.status}) ===\n${tail(log, 15_000)}`);
      }
      return parts.join('\n\n');
    },

    downloadArchive(repo, ref) {
      return http<Buffer>(`/projects/${enc(repo)}/repository/archive.zip?sha=${encodeURIComponent(ref)}`, { as: 'buffer', headers: { Accept: '*/*' }, timeoutMs: 300_000 });
    },
  };
}

// ---------------------------------------------------------------------------
// Tracker (GitLab Issues)
// ---------------------------------------------------------------------------

const IN_PROGRESS_LABEL = /\b(in[\s-]?progress|doing|wip|started)\b/i;
const ISSUE_TYPES = new Set(['issue', 'incident', 'test_case', 'task']);

function stateCategoryOf(i: any): StateCategory {
  if (i.state === 'closed') return 'done';
  return labelNames(i.labels).some((l) => IN_PROGRESS_LABEL.test(l)) ? 'in_progress' : 'todo';
}

/** `group/project` of an issue: from `references.full` (`group/project#12`), else its web URL. */
function projectOfIssue(i: any): string {
  const full = i.references?.full as string | undefined;
  if (full && full.includes('#')) return full.slice(0, full.lastIndexOf('#'));
  const m = /^https?:\/\/[^/]+\/(.+?)\/-\/issues\/\d+/.exec(i.web_url ?? '');
  return m ? m[1] : '';
}

function issueType(i: any): string {
  if (labelNames(i.labels).some((l) => /bug/i.test(l))) return 'Bug';
  const t = String(i.issue_type ?? i.type ?? 'issue').toLowerCase().replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function mapIssue(i: any, project = projectOfIssue(i)): Issue {
  return {
    id: String(i.id),
    key: `${project}#${i.iid}`,
    title: i.title,
    description: i.description ?? undefined,
    state: i.state,
    stateCategory: stateCategoryOf(i),
    type: issueType(i),
    assignee: nullablePerson(i.assignee ?? i.assignees?.[0]),
    labels: labelNames(i.labels),
    iteration: i.iteration?.title ?? i.milestone?.title ?? undefined,
    url: i.web_url,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    raw: i,
  };
}

function createTracker(ctx: ConnectionContext): TrackerProvider {
  const gl = makeContext(ctx);
  const { http } = gl;

  function parseKey(key: string): { project: string; iid: number } {
    const m = /^(?:([\w.-]+(?:\/[\w.-]+)+)#|#)?(\d+)$/.exec(key.trim());
    const project = m?.[1] ?? gl.issueProjects[0];
    if (!m || !project) throw new Error(`GitLab: cannot resolve issue "${key}" — use group/project#number or set Issue projects`);
    return { project, iid: Number(m[2]) };
  }

  function defaultProject(): string {
    if (!gl.issueProjects[0]) throw new Error('GitLab: set "Issue projects" on the connection to create issues');
    return gl.issueProjects[0];
  }

  const issuePath = (project: string, iid: number) => `/projects/${enc(project)}/issues/${iid}`;

  /** GitLab assigns by numeric user id; accepts 'me', a numeric id or a username. */
  async function resolveAssigneeIds(a: string | null | undefined): Promise<number[] | undefined> {
    if (a === undefined) return undefined;
    if (a === null) return [];
    if (a === 'me') return [(await gl.meRaw()).id];
    if (/^\d+$/.test(a)) return [Number(a)];
    const users = await http<any[]>(`/users?username=${encodeURIComponent(a)}`);
    if (!users[0]) throw new Error(`GitLab: no user named "${a}"`);
    return [users[0].id];
  }

  return {
    capabilities: new Set(['create', 'comment', 'assign', 'transition', 'labels', 'iterations']),
    ticketRefPattern: /(?:\b[\w.-]+(?:\/[\w.-]+)+)?#\d{1,7}\b/g,
    issueUrl(key) {
      const { project, iid } = parseKey(key);
      return `${gl.webUrl}/${project}/-/issues/${iid}`;
    },
    whoAmI: gl.me,

    async searchIssues(q) {
      const limit = Math.min(q.limit ?? 30, 100);
      const labels = q.labels ?? [];
      const params = new URLSearchParams({ order_by: 'updated_at', sort: 'desc' });
      if (q.text) params.set('search', q.text);
      // GitLab ANDs comma-separated labels; the contract ORs them, so filter client-side for >1.
      if (labels.length === 1) params.set('labels', labels[0]);
      params.set('per_page', String(labels.length > 1 ? 100 : limit));
      if (q.assignee) params.set('assignee_username', q.assignee === 'me' ? (await gl.me()).id : q.assignee);
      const cats = q.stateCategory ?? [];
      if (cats.length && !cats.includes('done')) params.set('state', 'opened');
      else if (cats.length === 1 && cats[0] === 'done') params.set('state', 'closed');

      let issues: Issue[];
      if (gl.issueProjects.length) {
        const perProject = await Promise.all(gl.issueProjects.map((p) =>
          http<any[]>(`/projects/${enc(p)}/issues?${params}`).then((is) => is.map((i) => mapIssue(i, p)))));
        issues = perProject.flat().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      } else {
        // No projects configured: everything the token can see (or only mine when asked).
        params.set('scope', q.assignee === 'me' ? 'assigned_to_me' : 'all');
        issues = (await http<any[]>(`/issues?${params}`)).map((i) => mapIssue(i));
      }
      if (labels.length > 1) {
        const wanted = new Set(labels.map((l) => l.toLowerCase()));
        issues = issues.filter((i) => i.labels.some((l) => wanted.has(l.toLowerCase())));
      }
      if (cats.length) issues = issues.filter((i) => cats.includes(i.stateCategory));
      return issues.slice(0, limit);
    },

    async getIssue(key) {
      const { project, iid } = parseKey(key);
      const i = await http<any>(issuePath(project, iid), { allow404: true });
      return i ? mapIssue(i, project) : null;
    },

    async createIssue(input) {
      const project = defaultProject();
      const type = input.type?.toLowerCase().replace(/\s+/g, '_');
      const i = await http<any>(`/projects/${enc(project)}/issues`, {
        method: 'POST',
        body: {
          title: input.title,
          description: input.description ?? '',
          labels: input.labels?.join(','),
          assignee_ids: await resolveAssigneeIds(input.assignee),
          issue_type: type && ISSUE_TYPES.has(type) ? type : undefined,
        },
      });
      return mapIssue(i, project);
    },

    async updateIssue(key, patch) {
      const { project, iid } = parseKey(key);
      const body: Record<string, unknown> = {};
      if (patch.title !== undefined) body.title = patch.title;
      if (patch.description !== undefined) body.description = patch.description;
      if (patch.labels !== undefined) body.labels = patch.labels.join(',');
      if (patch.assignee !== undefined) body.assignee_ids = await resolveAssigneeIds(patch.assignee);
      const state = patch.state?.toLowerCase();
      const cat = patch.stateCategory ?? (state === 'closed' || state === 'close' ? 'done' : state === 'opened' || state === 'open' || state === 'reopen' ? 'todo' : undefined);
      if (cat) body.state_event = cat === 'done' ? 'close' : 'reopen';
      const i = await http<any>(issuePath(project, iid), { method: 'PUT', body });
      return mapIssue(i, project);
    },

    async addComment(key, text) {
      const { project, iid } = parseKey(key);
      const n = await http<any>(`${issuePath(project, iid)}/notes`, { method: 'POST', body: { body: text } });
      return { id: String(n.id), author: nullablePerson(n.author), body: n.body ?? '', createdAt: n.created_at };
    },

    async listComments(key) {
      const { project, iid } = parseKey(key);
      const notes = await http<any[]>(`${issuePath(project, iid)}/notes?per_page=100&sort=asc&order_by=created_at`);
      return notes.filter((n) => !n.system)
        .map((n): IssueComment => ({ id: String(n.id), author: nullablePerson(n.author), body: n.body ?? '', createdAt: n.created_at }));
    },

    /** Milestones of the first issue project act as iterations. */
    async listIterations() {
      if (!gl.issueProjects[0]) return [];
      const ms = await http<any[]>(`/projects/${enc(gl.issueProjects[0])}/milestones?per_page=50&include_ancestors=true`);
      const today = new Date().toISOString().slice(0, 10);
      const active = ms.filter((m) => m.state === 'active');
      const current = active.find((m) => (!m.start_date || m.start_date <= today) && m.due_date && m.due_date >= today)
        ?? active.filter((m) => m.due_date && m.due_date >= today).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
      return ms.map((m): Iteration => ({
        id: String(m.id),
        name: m.title,
        startDate: m.start_date ?? undefined,
        endDate: m.due_date ?? undefined,
        current: m.id === current?.id,
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

function hostOf(settings: ConnectionContext['settings']): string {
  return new URL(normalizeBaseUrl(settings.baseUrl, DEFAULT_URL)).hostname.toLowerCase();
}

export const gitlabProvider: IntegrationProviderDefinition = {
  id: 'gitlab',
  displayName: 'GitLab',
  icon: 'Gitlab',
  kinds: ['git', 'tracker'],
  configSchema: [
    { key: 'baseUrl', label: 'GitLab URL', type: 'url', placeholder: DEFAULT_URL, default: DEFAULT_URL, help: 'Change only for a self-managed GitLab instance.' },
    {
      key: 'token', label: 'Access token', type: 'secret', required: true,
      help: 'Personal, group or project access token with the "api" scope ("read_api" for read-only use).',
      helpUrl: 'https://docs.gitlab.com/user/profile/personal_access_tokens/',
    },
    { key: 'issueProjects', label: 'Issue projects', type: 'text', placeholder: 'group/project, group/sub/other', help: 'Projects whose issues SI Hive tracks (full paths). The first one receives new issues.' },
  ],
  matchesRemote(remoteUrl, settings) {
    return remoteUrl.toLowerCase().includes(hostOf(settings));
  },
  repoFromRemote(remoteUrl) {
    const s = remoteUrl.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
    // scp-like SSH: git@host:group/sub/project
    const scp = /^[\w.-]+@[\w.-]+:(?!\/\/)(.+)$/.exec(s);
    let path: string;
    if (scp) path = scp[1];
    else {
      try { path = new URL(s).pathname; } catch { return null; }
    }
    path = decodeURIComponent(path.replace(/^\/+/, ''));
    return /^[\w.-]+(?:\/[\w.-]+)+$/.test(path) ? path : null;
  },
  createGitHost,
  createTracker,
  gitCredential(ctx) {
    const token = ctx.secrets.token;
    if (!token) return null;
    return { host: hostOf(ctx.settings), username: 'oauth2', password: token };
  },
};
