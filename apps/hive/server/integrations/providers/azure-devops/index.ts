/**
 * Azure DevOps (Services or Server) — Azure Repos git host + Azure Boards tracker.
 *
 * Auth: a personal access token with Code (read & write), Build (read) and
 * Work Items (read & write) scopes, sent as Basic auth (`:<PAT>`).
 *
 * Repos are addressed by name within the connection's repo project, so a repo
 * `fullName` is just the repository name. Pull requests use `pullRequestId`.
 *
 * Work item keys are the numeric id (`123`); `AB#123` and `#123` are accepted.
 * Workflow states are mapped to categories through each work item type's state
 * definitions (Proposed / InProgress / Resolved / Completed / Removed), so
 * custom processes work without configuration.
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
  IssueQuery,
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

const API_VERSION = '7.1';
const COMMENTS_API_VERSION = '7.1-preview.4';

interface AdoContext {
  http: HttpClient;
  orgUrl: string;
  project: string;
  /** Project hosting repos and pipelines (defaults to `project`). */
  repoProject: string;
  team?: string;
  meRaw: () => Promise<any>;
  me: () => Promise<Person>;
  settings: ConnectionContext['settings'];
}

function str(v: string | boolean | undefined): string {
  return typeof v === 'string' ? v.trim() : '';
}

function makeContext(ctx: ConnectionContext): AdoContext {
  const rawOrg = str(ctx.settings.organizationUrl);
  const project = str(ctx.settings.project);
  if (!rawOrg || !project) throw new Error('Azure DevOps: set "Organization URL" and "Project" on the connection');
  const orgUrl = normalizeBaseUrl(rawOrg, rawOrg);
  const http = createHttpClient('Azure DevOps', orgUrl, {
    Authorization: `Basic ${Buffer.from(`:${ctx.secrets.token ?? ''}`).toString('base64')}`,
    // Without this, a bad PAT yields a 203/302 to the sign-in page instead of a 401.
    'X-TFS-FedAuthRedirect': 'Suppress',
  });
  let meCache: Promise<any> | null = null;
  const meRaw = () => (meCache ??= http<any>('/_apis/connectionData').then((d) => d.authenticatedUser));
  return {
    http,
    orgUrl,
    project,
    repoProject: str(ctx.settings.repoProject) || project,
    team: str(ctx.settings.team) || undefined,
    meRaw,
    me: () => meRaw().then((u) => ({
      id: String(u.id),
      name: u.providerDisplayName || u.customDisplayName || '',
      email: u.properties?.Account?.$value || undefined,
    })),
    settings: ctx.settings,
  };
}

const enc = encodeURIComponent;

/** Relative API URL with query params (undefined values dropped) and api-version. */
function api(path: string, params: Record<string, string | number | undefined> = {}, version = API_VERSION): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  q.set('api-version', version);
  return `${path}?${q}`;
}

function identity(r: any): Person | null {
  if (!r) return null;
  if (typeof r === 'string') {
    // Older payloads: "Display Name <user@example.com>"
    const m = /^(.*?)\s*<([^>]+)>$/.exec(r);
    return m ? { id: m[2], name: m[1], email: m[2] } : { id: r, name: r };
  }
  const unique = r.uniqueName as string | undefined;
  return {
    id: String(r.id ?? unique ?? r.displayName ?? ''),
    name: r.displayName ?? unique ?? '',
    email: unique && unique.includes('@') ? unique : undefined,
    avatarUrl: r.imageUrl ?? r._links?.avatar?.href ?? undefined,
  };
}

const stripRef = (ref: string | undefined) => (ref ?? '').replace(/^refs\/heads\//, '');

// ---------------------------------------------------------------------------
// HTML <-> text (descriptions and comments are HTML in Azure DevOps)
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Light HTML → markdown-ish text: keeps line structure, links, list bullets and headings. */
function htmlToText(html: unknown): string | undefined {
  if (typeof html !== 'string' || !html) return undefined;
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h([1-6])[^>]*>/gi, (_m, n: string) => `\n${'#'.repeat(Number(n))} `)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|li|tr|pre|blockquote|ul|ol|table)>/gi, '\n')
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => `[${label.replace(/<[^>]+>/g, '')}](${href})`)
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Plain text / markdown → minimal HTML so line breaks survive. HTML input passes through. */
function textToHtml(text: string): string {
  if (/<\/?(p|div|br|ul|ol|li|h[1-6]|table|pre|span|a|b|i|strong|em|code)\b[^>]*>/i.test(text)) return text;
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

// ---------------------------------------------------------------------------
// Git host
// ---------------------------------------------------------------------------

function mapRepo(r: any): Repo {
  return {
    id: String(r.id),
    fullName: r.name,
    name: r.name,
    // Empty repositories have no default branch yet.
    defaultBranch: stripRef(r.defaultBranch) || 'main',
    webUrl: r.webUrl,
    cloneUrl: r.remoteUrl,
    private: r.project?.visibility ? r.project.visibility !== 'public' : undefined,
  };
}

function prState(p: any): PullRequestState {
  if (p.status === 'completed') return 'merged';
  if (p.status === 'abandoned') return 'closed';
  return p.isDraft ? 'draft' : 'open';
}

function mapBuildStatus(b: any): BuildStatus {
  if (b.status === 'notStarted' || b.status === 'postponed' || b.status === 'none') return 'queued';
  if (b.status !== 'completed') return 'running';
  if (b.result === 'succeeded' || b.result === 'partiallySucceeded') return 'succeeded';
  if (b.result === 'canceled') return 'cancelled';
  return 'failed';
}

/** Change types arrive as strings ("edit", "add", "edit, rename") or flag numbers. */
function changeKinds(ct: unknown): Set<string> {
  if (typeof ct === 'number') {
    const kinds = new Set<string>();
    if (ct & 1) kinds.add('add');
    if (ct & 2) kinds.add('edit');
    if (ct & 8) kinds.add('rename');
    if (ct & 16) kinds.add('delete');
    return kinds;
  }
  return new Set(String(ct ?? 'edit').toLowerCase().split(/[,\s]+/).filter(Boolean));
}

function createGitHost(ctx: ConnectionContext): GitHostProvider {
  const ado = makeContext(ctx);
  const { http, orgUrl } = ado;
  const gitBase = `/${enc(ado.repoProject)}/_apis/git/repositories`;
  const repoPath = (repo: string) => `${gitBase}/${enc(repo)}`;
  const prPath = (repo: string, n: number) => `${repoPath(repo)}/pullrequests/${n}`;
  const buildBase = `/${enc(ado.repoProject)}/_apis/build/builds`;

  const repoIds = new Map<string, Promise<string>>();
  function repoId(repo: string): Promise<string> {
    let id = repoIds.get(repo);
    if (!id) {
      id = http<any>(api(repoPath(repo))).then((r) => String(r.id));
      id.catch(() => repoIds.delete(repo));
      repoIds.set(repo, id);
    }
    return id;
  }

  function mapPr(repo: string, p: any): PullRequest {
    const projectName = p.repository?.project?.name ?? ado.repoProject;
    return {
      id: String(p.pullRequestId),
      number: p.pullRequestId,
      repo,
      title: p.title,
      description: p.description ?? undefined,
      state: prState(p),
      author: identity(p.createdBy),
      sourceBranch: stripRef(p.sourceRefName),
      targetBranch: stripRef(p.targetRefName),
      headSha: p.lastMergeSourceCommit?.commitId ?? undefined,
      url: `${orgUrl}/${enc(projectName)}/_git/${enc(p.repository?.name ?? repo)}/pullrequest/${p.pullRequestId}`,
      createdAt: p.creationDate,
      updatedAt: p.closedDate ?? undefined,
      reviewers: (p.reviewers ?? []).map(identity).filter(Boolean) as Person[],
      labels: (p.labels ?? []).filter((l: any) => l.active !== false).map((l: any) => l.name),
      raw: p,
    };
  }

  function mapComment(thread: any, c: any): PrComment {
    const tc = thread.threadContext;
    return {
      // Comment ids restart at 1 in every thread.
      id: `${thread.id}.${c.id}`,
      author: identity(c.author),
      body: c.content ?? '',
      createdAt: c.publishedDate,
      path: tc?.filePath ? String(tc.filePath).replace(/^\/+/, '') : undefined,
      line: tc?.rightFileStart?.line ?? tc?.leftFileStart?.line ?? undefined,
    };
  }

  /** A PR comment is a new active thread holding one comment. */
  async function comment(repo: string, number: number, body: string): Promise<PrComment> {
    const t = await http<any>(api(`${prPath(repo, number)}/threads`), {
      method: 'POST',
      body: { comments: [{ parentCommentId: 0, content: body, commentType: 1 }], status: 1 },
    });
    return mapComment(t, t.comments?.[0] ?? { id: 1, content: body, publishedDate: t.publishedDate });
  }

  return {
    capabilities: new Set(['pullRequests', 'reviews', 'merge', 'builds', 'archive']),
    whoAmI: ado.me,

    async listRepos() {
      const res = await http<any>(api(gitBase));
      return (res.value ?? []).filter((r: any) => !r.isDisabled).map(mapRepo);
    },

    async getRepo(fullName) {
      const r = await http<any>(api(repoPath(fullName)), { allow404: true });
      return r ? mapRepo(r) : null;
    },

    async listPullRequests(repo, opts = {}) {
      const top = Math.min(opts.limit ?? 30, 100);
      const list = (status: string) => http<any>(api(`${repoPath(repo)}/pullrequests`, { 'searchCriteria.status': status, $top: top }))
        .then((r) => (r.value ?? []) as any[]);
      const state = opts.state ?? 'open';
      let prs: any[];
      if (state === 'open') prs = await list('active');
      else if (state === 'all') prs = await list('all');
      else {
        const [completed, abandoned] = await Promise.all([list('completed'), list('abandoned')]);
        prs = [...completed, ...abandoned]
          .sort((a, b) => String(b.closedDate ?? '').localeCompare(String(a.closedDate ?? '')))
          .slice(0, top);
      }
      return prs.map((p) => mapPr(repo, p));
    },

    async getPullRequest(repo, number) {
      const p = await http<any>(api(prPath(repo, number)), { allow404: true });
      return p ? mapPr(repo, p) : null;
    },

    /**
     * LIMITATION: Azure Repos has no unified-diff REST endpoint; producing one
     * means fetching both versions of every changed file and diffing locally.
     * Instead this returns git-style file headers (no hunks) for the latest PR
     * iteration, preceded by the `git diff` command that yields the full patch
     * from a clone.
     */
    async getPullRequestDiff(repo, number) {
      const [pr, iterations] = await Promise.all([
        http<any>(api(prPath(repo, number))),
        http<any>(api(`${prPath(repo, number)}/iterations`)),
      ]);
      const its = (iterations.value ?? []) as any[];
      const src = stripRef(pr.sourceRefName);
      const tgt = stripRef(pr.targetRefName);
      const header = [
        `# Pull request ${number}: ${pr.title ?? ''}`.trimEnd(),
        '# Azure DevOps does not provide a unified diff over REST; changed files are listed below.',
        '# For line-level changes run:',
        `#   git fetch origin ${src} ${tgt} && git diff origin/${tgt}...origin/${src}`,
      ];
      if (!its.length) return `${header.join('\n')}\n`;
      const latest = its[its.length - 1].id;
      const changes = await http<any>(api(`${prPath(repo, number)}/iterations/${latest}/changes`, { $top: 2000 }));
      const files = ((changes.changeEntries ?? []) as any[])
        .filter((c) => !c.item?.isFolder && c.item?.path)
        .map((c) => {
          const kinds = changeKinds(c.changeType);
          const b = String(c.item.path).replace(/^\/+/, '');
          const a = String(c.originalPath ?? c.sourceServerItem ?? c.item.path).replace(/^\/+/, '');
          const lines = [`diff --git a/${kinds.has('rename') ? a : b} b/${b}`];
          if (kinds.has('add')) lines.push('new file mode 100644');
          else if (kinds.has('delete')) lines.push('deleted file mode 100644');
          else if (kinds.has('rename')) lines.push(`rename from ${a}`, `rename to ${b}`);
          return lines.join('\n');
        });
      return `${[...header, ...files].join('\n')}\n`;
    },

    async listPrComments(repo, number) {
      const res = await http<any>(api(`${prPath(repo, number)}/threads`));
      const out: PrComment[] = [];
      for (const t of (res.value ?? []) as any[]) {
        if (t.isDeleted) continue;
        for (const c of (t.comments ?? []) as any[]) {
          if (c.isDeleted || c.commentType === 'system' || c.commentType === 3) continue;
          out.push(mapComment(t, c));
        }
      }
      return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    commentOnPr: comment,

    async approvePr(repo, number, body) {
      const meId = String((await ado.meRaw()).id);
      await http(api(`${prPath(repo, number)}/reviewers/${enc(meId)}`), { method: 'PUT', body: { id: meId, vote: 10 } });
      if (body) await comment(repo, number, body);
    },

    async mergePr(repo, number) {
      const pr = await http<any>(api(prPath(repo, number)));
      const commitId = pr.lastMergeSourceCommit?.commitId;
      if (!commitId) throw new Error(`Azure DevOps: pull request ${number} has no source commit to complete`);
      await http(api(prPath(repo, number)), { method: 'PATCH', body: { status: 'completed', lastMergeSourceCommit: { commitId } } });
    },

    async listCommits(repo, opts = {}) {
      const res = await http<any>(api(`${repoPath(repo)}/commits`, {
        'searchCriteria.$top': Math.min(opts.limit ?? 30, 100),
        'searchCriteria.itemVersion.version': opts.branch,
        'searchCriteria.itemVersion.versionType': opts.branch ? 'branch' : undefined,
        'searchCriteria.fromDate': opts.since,
      }));
      return ((res.value ?? []) as any[]).map((c): Commit => ({
        sha: c.commitId,
        message: c.comment ?? '',
        author: c.author ? { id: c.author.email ?? c.author.name ?? '', name: c.author.name ?? '', email: c.author.email ?? undefined } : null,
        date: c.author?.date ?? c.committer?.date ?? '',
        url: c.remoteUrl ?? `${orgUrl}/${enc(ado.repoProject)}/_git/${enc(repo)}/commit/${c.commitId}`,
      }));
    },

    async listBuilds(repo, opts = {}) {
      const res = await http<any>(api(buildBase, {
        repositoryId: await repoId(repo),
        repositoryType: 'TfsGit',
        branchName: opts.branch ? `refs/heads/${stripRef(opts.branch)}` : undefined,
        queryOrder: 'queueTimeDescending',
        $top: Math.min(opts.limit ?? 20, 100),
      }));
      return ((res.value ?? []) as any[]).map((b): Build => ({
        id: String(b.id),
        name: [b.definition?.name, b.buildNumber].filter(Boolean).join(' ') || `Build ${b.id}`,
        status: mapBuildStatus(b),
        branch: b.sourceBranch ? stripRef(b.sourceBranch) : undefined,
        commitSha: b.sourceVersion ?? undefined,
        url: b._links?.web?.href ?? `${orgUrl}/${enc(ado.repoProject)}/_build/results?buildId=${b.id}`,
        startedAt: b.startTime ?? b.queueTime ?? undefined,
        finishedAt: b.finishTime ?? undefined,
      }));
    },

    async getBuildLog(_repo, buildId) {
      // The timeline says which task failed; its log is the useful one.
      const timeline = await http<any>(api(`${buildBase}/${enc(buildId)}/timeline`));
      const records = ((timeline?.records ?? []) as any[]).filter((r) => r.log?.id != null)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const failed = records.filter((r) => r.result === 'failed');
      const failedTasks = failed.filter((r) => r.type === 'Task');
      const chosen = failedTasks.length ? failedTasks.slice(0, 3)
        : failed.length ? failed.slice(0, 3)
          : records.filter((r) => r.type === 'Task').slice(-3);
      const parts: string[] = [];
      for (const rec of chosen) {
        const log = await http<string>(api(`${buildBase}/${enc(buildId)}/logs/${rec.log.id}`), { as: 'text', headers: { Accept: 'text/plain' } })
          .catch((e) => `(log unavailable: ${(e as Error).message})`);
        parts.push(`=== ${rec.name} (${rec.result ?? rec.state}) ===\n${tail(log, 15_000)}`);
      }
      return parts.join('\n\n');
    },

    downloadArchive(repo, ref) {
      const versionType = /^[0-9a-f]{40}$/i.test(ref) ? 'commit' : ref.startsWith('refs/tags/') ? 'tag' : 'branch';
      const version = ref.replace(/^refs\/(heads|tags)\//, '');
      return http<Buffer>(api(`${repoPath(repo)}/items`, {
        path: '/',
        $format: 'zip',
        download: 'true',
        resolveLfs: 'true',
        'versionDescriptor.version': version,
        'versionDescriptor.versionType': versionType,
      }), { as: 'buffer', headers: { Accept: 'application/zip' }, timeoutMs: 300_000 });
    },
  };
}

// ---------------------------------------------------------------------------
// Tracker (Azure Boards)
// ---------------------------------------------------------------------------

const CATEGORY_OF: Record<string, StateCategory> = {
  proposed: 'todo',
  inprogress: 'in_progress',
  resolved: 'in_progress',
  completed: 'done',
  removed: 'done',
};

/** Preferred ADO state categories when moving an item into a Hive category. */
const TARGET_CATEGORIES: Record<StateCategory, string[]> = {
  todo: ['proposed'],
  in_progress: ['inprogress', 'resolved'],
  done: ['completed', 'removed'],
};

/** Used only when a type's state definitions are unavailable. */
function guessCategory(state: string): StateCategory {
  if (/^(new|to ?do|proposed|approved|open|design)$/i.test(state)) return 'todo';
  if (/^(done|closed|completed|removed|cut|inactive)$/i.test(state)) return 'done';
  return 'in_progress';
}

/** Default work item types to try for new items, in order. */
const DEFAULT_TYPES = ['Task', 'Issue', 'User Story', 'Product Backlog Item', 'Requirement'];

const wiqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

interface TypeState { name: string; category: string }

function createTracker(ctx: ConnectionContext): TrackerProvider {
  const ado = makeContext(ctx);
  const { http, orgUrl } = ado;
  const witBase = `/${enc(ado.project)}/_apis/wit`;
  const teamBase = `/${enc(ado.project)}${ado.team ? `/${enc(ado.team)}` : ''}/_apis/work/teamsettings`;

  // Work item types and their states — cached for the tracker's lifetime.
  let typesCache: Promise<any[]> | null = null;
  const types = () => (typesCache ??= http<any>(api(`${witBase}/workitemtypes`))
    .then((r) => (r.value ?? []) as any[])
    .catch((e) => { typesCache = null; throw e; }));
  const typeStates = new Map<string, Promise<TypeState[]>>();

  function statesOf(type: string): Promise<TypeState[]> {
    const k = type.toLowerCase();
    let p = typeStates.get(k);
    if (!p) {
      p = types().then(async (ts) => {
        const t = ts.find((x) => String(x.name).toLowerCase() === k);
        // 7.1 includes states on the type list; older servers need the per-type endpoint.
        if (Array.isArray(t?.states) && t.states.length && t.states[0].category) return t.states as TypeState[];
        const r = await http<any>(api(`${witBase}/workitemtypes/${enc(type)}/states`), { allow404: true });
        return (r?.value ?? []) as TypeState[];
      }).catch(() => {
        // Fall back to name heuristics for now; retry on the next call.
        typeStates.delete(k);
        return [] as TypeState[];
      });
      typeStates.set(k, p);
    }
    return p;
  }

  async function categoryOf(type: string, state: string): Promise<StateCategory> {
    const s = (await statesOf(type)).find((x) => x.name.toLowerCase() === state.toLowerCase());
    return (s && CATEGORY_OF[String(s.category).toLowerCase()]) || guessCategory(state);
  }

  function parseKey(key: string): number {
    const m = /^(?:AB)?#?(\d+)$/i.exec(key.trim());
    if (!m) throw new Error(`Azure DevOps: cannot resolve work item "${key}" — use its numeric id`);
    return Number(m[1]);
  }

  const itemUrl = (id: number | string) => `${orgUrl}/${enc(ado.project)}/_workitems/edit/${id}`;

  async function mapWorkItem(w: any): Promise<Issue> {
    const f = w.fields ?? {};
    const type = String(f['System.WorkItemType'] ?? '');
    const state = String(f['System.State'] ?? '');
    const tags = String(f['System.Tags'] ?? '');
    const priority = f['Microsoft.VSTS.Common.Priority'];
    return {
      id: String(w.id),
      key: String(w.id),
      title: f['System.Title'] ?? '',
      description: htmlToText(f['System.Description'] ?? f['Microsoft.VSTS.TCM.ReproSteps']),
      state,
      stateCategory: await categoryOf(type, state),
      type: type || undefined,
      assignee: identity(f['System.AssignedTo']),
      labels: tags ? tags.split(';').map((t) => t.trim()).filter(Boolean) : [],
      priority: priority != null ? String(priority) : undefined,
      iteration: f['System.IterationPath'] ?? undefined,
      url: w._links?.html?.href ?? itemUrl(w.id),
      createdAt: f['System.CreatedDate'] ?? undefined,
      updatedAt: f['System.ChangedDate'] ?? undefined,
      raw: w,
    };
  }

  async function getItems(ids: number[]): Promise<any[]> {
    const out: any[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const res = await http<any>(api(`${witBase}/workitems`, { ids: ids.slice(i, i + 200).join(','), $expand: 'links', errorPolicy: 'omit' }));
      out.push(...((res.value ?? []) as any[]).filter(Boolean));
    }
    return out;
  }

  /** `[System.State] IN (...)` for the wanted categories across the project's types, or null if unknown. */
  async function stateClause(cats: StateCategory[], type?: string): Promise<string | null> {
    const all = type ? [type] : (await types()).filter((t) => !t.isDisabled).map((t) => String(t.name));
    const names = new Set<string>();
    for (const t of all) {
      for (const s of await statesOf(t)) {
        const cat = CATEGORY_OF[String(s.category).toLowerCase()];
        if (cat && cats.includes(cat)) names.add(s.name);
      }
    }
    return names.size ? `[System.State] IN (${[...names].map(wiqlString).join(', ')})` : null;
  }

  async function iterationPath(id: string): Promise<string> {
    if (id.includes('\\')) return id;
    const it = await http<any>(api(`${teamBase}/iterations/${enc(id)}`));
    return it.path;
  }

  /** Value for System.AssignedTo: 'me' → the PAT owner's sign-in name. */
  async function assigneeValue(a: string | null): Promise<string> {
    if (a === null) return '';
    if (a !== 'me') return a;
    const me = await ado.me();
    return me.email ?? me.name;
  }

  async function pickType(requested?: string): Promise<string> {
    const explicit = requested?.trim() || str(ado.settings.defaultWorkItemType);
    if (explicit) return explicit;
    const available = new Set((await types().catch(() => [])).filter((t) => !t.isDisabled).map((t) => String(t.name).toLowerCase()));
    return DEFAULT_TYPES.find((t) => available.has(t.toLowerCase())) ?? 'Task';
  }

  async function targetState(type: string, cat: StateCategory): Promise<string> {
    const states = await statesOf(type);
    for (const c of TARGET_CATEGORIES[cat]) {
      const s = states.find((x) => String(x.category).toLowerCase() === c);
      if (s) return s.name;
    }
    throw new Error(`Azure DevOps: work item type "${type}" has no state in category "${cat}"`);
  }

  async function search(q: IssueQuery): Promise<Issue[]> {
    const limit = Math.min(q.limit ?? 30, 200);
    const where = ['[System.TeamProject] = @project'];
    if (q.text) {
      const t = q.text.trim();
      where.push(/^\d+$/.test(t) ? `([System.Title] CONTAINS ${wiqlString(t)} OR [System.Id] = ${t})` : `[System.Title] CONTAINS ${wiqlString(t)}`);
    }
    if (q.labels?.length) where.push(`(${q.labels.map((l) => `[System.Tags] CONTAINS ${wiqlString(l)}`).join(' OR ')})`);
    if (q.assignee) where.push(q.assignee === 'me' ? '[System.AssignedTo] = @Me' : `[System.AssignedTo] = ${wiqlString(q.assignee)}`);
    if (q.type) where.push(`[System.WorkItemType] = ${wiqlString(q.type)}`);
    else where.push("[System.WorkItemType] NOT IN GROUP 'Microsoft.HiddenCategory'");
    if (q.iterationId) where.push(`[System.IterationPath] UNDER ${wiqlString(await iterationPath(q.iterationId))}`);
    const cats = q.stateCategory ?? [];
    if (cats.length && cats.length < 3) {
      const clause = await stateClause(cats, q.type);
      if (clause) where.push(clause);
    }
    const wiql = `SELECT [System.Id] FROM WorkItems WHERE ${where.join(' AND ')} ORDER BY [System.ChangedDate] DESC`;
    // State names can mean different categories per type, so over-fetch and filter precisely.
    const top = cats.length ? Math.min(limit * 2, 200) : limit;
    const res = await http<any>(api(`${witBase}/wiql`, { $top: top }), { method: 'POST', body: { query: wiql } });
    const ids = ((res.workItems ?? []) as any[]).map((w) => Number(w.id));
    let issues = await Promise.all((await getItems(ids)).map(mapWorkItem));
    if (cats.length) issues = issues.filter((i) => cats.includes(i.stateCategory));
    return issues.slice(0, limit);
  }

  const jsonPatch = { 'Content-Type': 'application/json-patch+json' };

  return {
    capabilities: new Set(['create', 'comment', 'assign', 'transition', 'labels', 'iterations']),
    // AB#123 is the Boards mention syntax; a bare #123 needs ≥2 digits to avoid noise.
    // The captured digits are the key.
    ticketRefPattern: /\bAB#(\d{1,7})\b|(?<![\w&/])#(\d{2,7})\b/g,
    issueUrl: (key) => itemUrl(parseKey(key)),
    whoAmI: ado.me,

    searchIssues: search,

    async getIssue(key) {
      const w = await http<any>(api(`${witBase}/workitems/${parseKey(key)}`, { $expand: 'all' }), { allow404: true });
      return w ? mapWorkItem(w) : null;
    },

    async createIssue(input) {
      const type = await pickType(input.type);
      const ops: any[] = [{ op: 'add', path: '/fields/System.Title', value: input.title }];
      if (input.description) ops.push({ op: 'add', path: '/fields/System.Description', value: textToHtml(input.description) });
      if (input.labels?.length) ops.push({ op: 'add', path: '/fields/System.Tags', value: input.labels.join('; ') });
      if (input.assignee) ops.push({ op: 'add', path: '/fields/System.AssignedTo', value: await assigneeValue(input.assignee) });
      const w = await http<any>(api(`${witBase}/workitems/$${enc(type)}`), { method: 'POST', headers: jsonPatch, body: ops });
      return mapWorkItem(w);
    },

    async updateIssue(key, patch) {
      const id = parseKey(key);
      const ops: any[] = [];
      if (patch.title !== undefined) ops.push({ op: 'add', path: '/fields/System.Title', value: patch.title });
      if (patch.description !== undefined) ops.push({ op: 'add', path: '/fields/System.Description', value: textToHtml(patch.description) });
      // 'replace' so removed tags are dropped ('add' merges into the existing set).
      if (patch.labels !== undefined) ops.push({ op: 'replace', path: '/fields/System.Tags', value: patch.labels.join('; ') });
      if (patch.assignee !== undefined) ops.push({ op: 'add', path: '/fields/System.AssignedTo', value: await assigneeValue(patch.assignee) });
      if (patch.state) ops.push({ op: 'add', path: '/fields/System.State', value: patch.state });
      else if (patch.stateCategory) {
        const current = await http<any>(api(`${witBase}/workitems/${id}`, { fields: 'System.WorkItemType' }));
        const state = await targetState(String(current.fields?.['System.WorkItemType'] ?? ''), patch.stateCategory);
        ops.push({ op: 'add', path: '/fields/System.State', value: state });
      }
      const w = ops.length
        ? await http<any>(api(`${witBase}/workitems/${id}`), { method: 'PATCH', headers: jsonPatch, body: ops })
        : await http<any>(api(`${witBase}/workitems/${id}`, { $expand: 'all' }));
      return mapWorkItem(w);
    },

    async addComment(key, text) {
      const c = await http<any>(api(`${witBase}/workItems/${parseKey(key)}/comments`, {}, COMMENTS_API_VERSION), {
        method: 'POST',
        body: { text: textToHtml(text) },
      });
      return { id: String(c.id), author: identity(c.createdBy), body: htmlToText(c.text) ?? '', createdAt: c.createdDate };
    },

    async listComments(key) {
      const res = await http<any>(api(`${witBase}/workItems/${parseKey(key)}/comments`, { $top: 200, order: 'asc' }, COMMENTS_API_VERSION));
      return ((res.comments ?? []) as any[])
        .filter((c) => !c.isDeleted)
        .map((c): IssueComment => ({ id: String(c.id), author: identity(c.createdBy), body: htmlToText(c.text) ?? '', createdAt: c.createdDate }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    /** The team's sprints (the project's default team unless "Team" is set). */
    async listIterations() {
      const res = await http<any>(api(`${teamBase}/iterations`));
      return ((res.value ?? []) as any[]).map((it): Iteration => ({
        id: String(it.id),
        name: it.name,
        startDate: it.attributes?.startDate ?? undefined,
        endDate: it.attributes?.finishDate ?? undefined,
        current: it.attributes?.timeFrame === 'current',
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Remotes
// ---------------------------------------------------------------------------

/** Organization name of a cloud URL (dev.azure.com/{org}, {org}.visualstudio.com, SSH v3). */
function cloudOrg(url: string): string | null {
  const m = /dev\.azure\.com[/:](?:v3\/)?([^/@:?#]+)/i.exec(url)
    ?? /vs-ssh\.visualstudio\.com:v3\/([^/?#]+)/i.exec(url)
    ?? /^(?:https?:\/\/)?(?:[^@/]+@)?([\w-]+)\.visualstudio\.com/i.exec(url);
  return m ? decodeURIComponent(m[1]).toLowerCase() : null;
}

/** `{ project, repo }` from an Azure Repos remote (HTTPS `/_git/` or SSH `v3/` form). */
function parseRemote(remoteUrl: string): { project: string; repo: string } | null {
  const s = remoteUrl.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  const ssh = /:v3\/[^/]+\/([^/]+)\/([^/]+)$/.exec(s);
  if (ssh) return { project: decodeURIComponent(ssh[1]), repo: decodeURIComponent(ssh[2]) };
  const m = /\/([^/]+)\/_git\/([^/?#]+)$/.exec(s);
  if (!m) return null;
  const repo = decodeURIComponent(m[2]);
  const before = decodeURIComponent(m[1]);
  // `dev.azure.com/{org}/_git/{repo}`: repo lives in the project of the same name.
  const isOrgSegment = before.toLowerCase() === cloudOrg(s) || /^defaultcollection$/i.test(before) || /(^|\.)(dev\.azure\.com|visualstudio\.com)$/i.test(before);
  return { project: isOrgSegment ? repo : before, repo };
}

function orgUrlOf(settings: ConnectionContext['settings']): string | null {
  const raw = str(settings.organizationUrl);
  return raw ? normalizeBaseUrl(raw, raw) : null;
}

export const azureDevOpsProvider: IntegrationProviderDefinition = {
  id: 'azure-devops',
  displayName: 'Azure DevOps',
  icon: 'Cloud',
  kinds: ['git', 'tracker'],
  configSchema: [
    {
      key: 'organizationUrl', label: 'Organization URL', type: 'url', required: true,
      placeholder: 'https://dev.azure.com/your-org',
      help: 'https://dev.azure.com/{org}, https://{org}.visualstudio.com, or an Azure DevOps Server collection URL.',
    },
    { key: 'project', label: 'Project', type: 'text', required: true, help: 'Project whose work items SI Hive tracks.' },
    { key: 'team', label: 'Team', type: 'text', help: 'Team whose sprints are used for iterations. Defaults to the project\'s default team.' },
    {
      key: 'token', label: 'Personal access token', type: 'secret', required: true,
      help: 'Scopes: Code (read & write), Build (read), Work Items (read & write).',
      helpUrl: 'https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate',
    },
    { key: 'repoProject', label: 'Repository project', type: 'text', help: 'Project hosting the Git repositories and pipelines, if different from Project.' },
    { key: 'defaultWorkItemType', label: 'Default work item type', type: 'text', placeholder: 'Task', help: 'Type used for new work items when none is given. Defaults to the first of Task, Issue, User Story, Product Backlog Item that the project has.' },
  ],
  matchesRemote(remoteUrl, settings) {
    const orgUrl = orgUrlOf(settings);
    if (!orgUrl) return false;
    const org = cloudOrg(orgUrl);
    if (org) {
      if (cloudOrg(remoteUrl) !== org) return false;
    } else {
      // Azure DevOps Server: the remote lives under the collection URL.
      const u = new URL(orgUrl);
      if (!remoteUrl.toLowerCase().includes(`${u.host}${u.pathname}`.replace(/\/+$/, '').toLowerCase())) return false;
    }
    // Repo fullNames are names within the repo project, so only claim that project's remotes.
    const parsed = parseRemote(remoteUrl);
    const repoProject = str(settings.repoProject) || str(settings.project);
    return !parsed || !repoProject || parsed.project.toLowerCase() === repoProject.toLowerCase();
  },
  repoFromRemote(remoteUrl) {
    return parseRemote(remoteUrl)?.repo ?? null;
  },
  createGitHost,
  createTracker,
  gitCredential(ctx) {
    const token = ctx.secrets.token;
    const orgUrl = orgUrlOf(ctx.settings);
    if (!token || !orgUrl) return null;
    return { host: new URL(orgUrl).hostname, username: 'pat', password: token };
  },
};
