/**
 * Linear — tracker only (GraphQL API).
 *
 * Auth: a personal API key, sent as `Authorization: <key>` (OAuth access
 * tokens, prefixed `lin_oauth_`, are sent as `Bearer <token>`).
 *
 * Issue keys are Linear identifiers (`ENG-123`); the API's `issue(id:)`
 * accepts them directly. States map from the workflow state `type`:
 * triage/backlog/unstarted → todo, started → in_progress,
 * completed/canceled → done.
 *
 * Every operation POSTs to `https://api.linear.app/graphql?op=<OperationName>`.
 * The API ignores the query string; it only exists so request logs (and the
 * recorded-HTTP contract fixtures, which match on URL) can tell operations
 * apart without inspecting the body.
 */
import type {
  ConnectionContext,
  IntegrationProviderDefinition,
  Issue,
  IssueComment,
  Iteration,
  Person,
  StateCategory,
  TrackerCapability,
  TrackerProvider,
} from '../../types.js';
import { createHttpClient, IntegrationError, type HttpClient } from '../../http.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const API_URL = 'https://api.linear.app';

const CATEGORY_FROM_TYPE: Record<string, StateCategory> = {
  triage: 'todo', backlog: 'todo', unstarted: 'todo',
  started: 'in_progress',
  completed: 'done', canceled: 'done',
};

/** State types per category, in preference order when moving an issue to that category. */
const TYPES_FOR_CATEGORY: Record<StateCategory, string[]> = {
  todo: ['unstarted', 'backlog', 'triage'],
  in_progress: ['started'],
  done: ['completed', 'canceled'],
};

const USER_FIELDS = 'id name displayName email avatarUrl';

const ISSUE_FIELDS = `
  id identifier title description url priorityLabel createdAt updatedAt
  state { id name type }
  assignee { ${USER_FIELDS} }
  labels { nodes { id name } }
  cycle { id name number }
  team { id key }
`;

const COMMENT_FIELDS = `id body createdAt user { ${USER_FIELDS} }`;

function csv(value: string | boolean | undefined): string[] {
  return String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function person(u: any): Person {
  return { id: String(u?.id ?? ''), name: u?.displayName || u?.name || '', email: u?.email ?? undefined, avatarUrl: u?.avatarUrl ?? undefined };
}

function nullablePerson(u: any): Person | null {
  return u ? person(u) : null;
}

function mapIssue(i: any): Issue {
  return {
    id: String(i.id),
    key: i.identifier,
    title: i.title ?? '',
    description: i.description ?? undefined,
    state: i.state?.name ?? '',
    stateCategory: CATEGORY_FROM_TYPE[i.state?.type] ?? 'todo',
    assignee: nullablePerson(i.assignee),
    labels: (i.labels?.nodes ?? []).map((l: any) => l.name),
    priority: i.priorityLabel ?? undefined,
    iteration: i.cycle ? (i.cycle.name || `Cycle ${i.cycle.number}`) : undefined,
    url: i.url,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    raw: i,
  };
}

function mapComment(c: any): IssueComment {
  return { id: String(c.id), author: nullablePerson(c.user), body: c.body ?? '', createdAt: c.createdAt };
}

function isNotFound(err: unknown): boolean {
  return err instanceof IntegrationError && /not found/i.test(err.message);
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

function createTracker(ctx: ConnectionContext): TrackerProvider {
  const token = ctx.secrets.token ?? '';
  const http: HttpClient = createHttpClient('Linear', API_URL, {
    Authorization: token.startsWith('lin_oauth_') ? `Bearer ${token}` : token,
  });
  const teamKeys = csv(ctx.settings.teamKeys).map((k) => k.toUpperCase());

  /** Run a named GraphQL operation; GraphQL-level `errors` become IntegrationErrors. */
  async function gql<T = any>(op: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await http<any>(`/graphql?op=${op}`, { method: 'POST', body: { query, variables } });
    if (res?.errors?.length) {
      const first = res.errors[0];
      const status = Number(first?.extensions?.statusCode) || 400;
      const msg = res.errors.map((e: any) => e?.extensions?.userPresentableMessage || e?.message).join('; ');
      throw new IntegrationError(`Linear: ${op}: ${msg}`, status, 'Linear');
    }
    return res?.data as T;
  }

  let meCache: Promise<Person> | null = null;
  const me = () => (meCache ??= gql('Viewer', `query Viewer { viewer { ${USER_FIELDS} } }`).then((d) => person(d.viewer)));

  /** Web URL prefix (`https://linear.app/<workspace>`) learned from any issue we have seen. */
  let workspaceUrl: string | null = null;
  function remember(issue: Issue): Issue {
    const m = /^(https:\/\/linear\.app\/[^/]+)\/issue\//.exec(issue.url ?? '');
    if (m) workspaceUrl = m[1];
    return issue;
  }

  const teamCache = new Map<string, Promise<any>>();
  function team(key: string): Promise<any> {
    let p = teamCache.get(key);
    if (!p) {
      p = gql('Team', `query Team($key: String!) {
        teams(filter: { key: { eq: $key } }, first: 1) { nodes { id key name states { nodes { id name type position } } } }
      }`, { key }).then((d) => {
        const t = d.teams?.nodes?.[0];
        if (!t) throw new Error(`Linear: team "${key}" not found`);
        return t;
      });
      p.catch(() => teamCache.delete(key));
      teamCache.set(key, p);
    }
    return p;
  }

  function defaultTeamKey(): string {
    if (!teamKeys[0]) throw new Error('Linear: set "Team keys" on the connection to create issues');
    return teamKeys[0];
  }

  /** `'me'` → viewer id, an email → looked-up user id, anything else is taken as a user id. */
  async function resolveUserId(a: string): Promise<string> {
    if (a === 'me') return (await me()).id;
    if (!a.includes('@')) return a;
    const d = await gql('UserByEmail', `query UserByEmail($email: String!) { users(filter: { email: { eq: $email } }, first: 1) { nodes { id } } }`, { email: a });
    const id = d.users?.nodes?.[0]?.id;
    if (!id) throw new Error(`Linear: no user found for "${a}"`);
    return id;
  }

  /** Label names → ids, preferring the team's own label over a same-named workspace label. */
  async function resolveLabelIds(names: string[], teamId: string): Promise<string[]> {
    if (!names.length) return [];
    const d = await gql('LabelsByName', `query LabelsByName($names: [String!]) {
      issueLabels(filter: { name: { in: $names } }, first: 250) { nodes { id name team { id } } }
    }`, { names });
    const nodes: any[] = (d.issueLabels?.nodes ?? []).filter((l: any) => !l.team || l.team.id === teamId);
    const ids: string[] = [];
    const missing: string[] = [];
    for (const name of names) {
      const match = nodes.find((l) => l.name === name && l.team?.id === teamId) ?? nodes.find((l) => l.name === name);
      if (match) ids.push(match.id);
      else missing.push(name);
    }
    if (missing.length) throw new Error(`Linear: unknown label(s) ${missing.map((m) => `"${m}"`).join(', ')}`);
    return ids;
  }

  async function fetchIssue(key: string): Promise<any | null> {
    try {
      const d = await gql('GetIssue', `query GetIssue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`, { id: key.trim().toUpperCase() });
      return d.issue ?? null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async function loadIssue(key: string): Promise<any> {
    const i = await fetchIssue(key);
    if (!i) throw new Error(`Linear: issue ${key} not found`);
    return i;
  }

  const capabilities = new Set<TrackerCapability>(['create', 'comment', 'assign', 'transition', 'labels']);
  if (teamKeys.length) capabilities.add('iterations');

  return {
    capabilities,
    ticketRefPattern: teamKeys.length
      ? new RegExp(`\\b(?:${teamKeys.map(escapeRegex).join('|')})-\\d+\\b`, 'g')
      : /\b[A-Z][A-Z0-9]+-\d+\b/g,
    /**
     * Uses the workspace URL learned from previously loaded issues; before any
     * issue was seen it falls back to `https://linear.app/issue/<key>`, which
     * Linear resolves for signed-in users. `Issue.url` is always the API's own.
     */
    issueUrl: (key) => `${workspaceUrl ?? 'https://linear.app'}/issue/${key.trim().toUpperCase()}`,
    whoAmI: me,

    async searchIssues(q) {
      const filter: Record<string, unknown> = {};
      if (teamKeys.length) filter.team = { key: { in: teamKeys } };
      if (q.assignee) {
        filter.assignee = q.assignee === 'me' ? { isMe: { eq: true } }
          : q.assignee.includes('@') ? { email: { eq: q.assignee } } : { id: { eq: q.assignee } };
      }
      // Many-to-many filters match when at least one label matches (OR semantics).
      if (q.labels?.length) filter.labels = { name: { in: q.labels } };
      if (q.stateCategory?.length) filter.state = { type: { in: q.stateCategory.flatMap((c) => TYPES_FOR_CATEGORY[c]) } };
      if (q.iterationId) filter.cycle = { id: { eq: q.iterationId } };
      // Title/description substring match. `searchableContent` also exists but
      // is case-sensitive `contains` only; `containsIgnoreCase` is friendlier.
      // Linear has no issue types, so `q.type` is ignored.
      if (q.text) filter.or = [{ title: { containsIgnoreCase: q.text } }, { description: { containsIgnoreCase: q.text } }];
      const d = await gql('SearchIssues', `query SearchIssues($filter: IssueFilter, $first: Int) {
        issues(filter: $filter, first: $first, orderBy: updatedAt) { nodes { ${ISSUE_FIELDS} } }
      }`, { filter, first: Math.min(q.limit ?? 30, 100) });
      return (d.issues?.nodes ?? []).map((i: any) => remember(mapIssue(i)));
    },

    async getIssue(key) {
      const i = await fetchIssue(key);
      return i ? remember(mapIssue(i)) : null;
    },

    async createIssue(input) {
      const t = await team(defaultTeamKey());
      const vars: Record<string, unknown> = { teamId: t.id, title: input.title };
      if (input.description) vars.description = input.description;
      if (input.labels?.length) vars.labelIds = await resolveLabelIds(input.labels, t.id);
      if (input.assignee) vars.assigneeId = await resolveUserId(input.assignee);
      const d = await gql('CreateIssue', `mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) { success issue { ${ISSUE_FIELDS} } }
      }`, { input: vars });
      if (!d.issueCreate?.success || !d.issueCreate.issue) throw new Error('Linear: issue creation failed');
      return remember(mapIssue(d.issueCreate.issue));
    },

    async updateIssue(key, patch) {
      const current = await loadIssue(key);
      const input: Record<string, unknown> = {};
      if (patch.title !== undefined) input.title = patch.title;
      if (patch.description !== undefined) input.description = patch.description;
      if (patch.labels !== undefined) input.labelIds = await resolveLabelIds(patch.labels, current.team.id);
      if (patch.assignee !== undefined) input.assigneeId = patch.assignee === null ? null : await resolveUserId(patch.assignee);

      if (patch.state !== undefined || patch.stateCategory !== undefined) {
        const t = await team(current.team.key);
        const states: any[] = [...(t.states?.nodes ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        let target: any;
        if (patch.state !== undefined) {
          const want = patch.state.trim().toLowerCase();
          target = states.find((s) => String(s.name).toLowerCase() === want);
          if (!target) throw new Error(`Linear: team ${t.key} has no state "${patch.state}" (available: ${states.map((s) => `"${s.name}"`).join(', ')})`);
        } else if (CATEGORY_FROM_TYPE[current.state?.type] !== patch.stateCategory) {
          for (const type of TYPES_FOR_CATEGORY[patch.stateCategory!]) {
            target = states.find((s) => s.type === type);
            if (target) break;
          }
          if (!target) throw new Error(`Linear: team ${t.key} has no ${patch.stateCategory} state`);
        }
        if (target && target.id !== current.state?.id) input.stateId = target.id;
      }

      if (!Object.keys(input).length) return remember(mapIssue(current));
      const d = await gql('UpdateIssue', `mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } }
      }`, { id: current.id, input });
      if (!d.issueUpdate?.success || !d.issueUpdate.issue) throw new Error(`Linear: update of ${key} failed`);
      return remember(mapIssue(d.issueUpdate.issue));
    },

    async addComment(key, body) {
      const current = await loadIssue(key);
      const d = await gql('CreateComment', `mutation CreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) { success comment { ${COMMENT_FIELDS} } }
      }`, { input: { issueId: current.id, body } });
      if (!d.commentCreate?.success || !d.commentCreate.comment) throw new Error(`Linear: comment on ${key} failed`);
      return mapComment(d.commentCreate.comment);
    },

    async listComments(key) {
      const d = await gql('ListComments', `query ListComments($id: String!) {
        issue(id: $id) { comments(first: 100) { nodes { ${COMMENT_FIELDS} } } }
      }`, { id: key.trim().toUpperCase() });
      const out: IssueComment[] = (d.issue?.comments?.nodes ?? []).map(mapComment);
      return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    /** Cycles of the first team (ended within the last 90 days, current or upcoming). */
    async listIterations() {
      if (!teamKeys[0]) return [];
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const d = await gql('ListCycles', `query ListCycles($key: String!, $since: DateTimeOrDuration) {
        teams(filter: { key: { eq: $key } }, first: 1) {
          nodes { cycles(first: 50, filter: { endsAt: { gt: $since } }) { nodes { id name number startsAt endsAt isActive } } }
        }
      }`, { key: teamKeys[0], since });
      const cycles: any[] = d.teams?.nodes?.[0]?.cycles?.nodes ?? [];
      const now = Date.now();
      return cycles
        .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))
        .map((c): Iteration => ({
          id: String(c.id),
          name: c.name || `Cycle ${c.number}`,
          startDate: c.startsAt ?? undefined,
          endDate: c.endsAt ?? undefined,
          current: !!c.isActive || (Date.parse(c.startsAt) <= now && now <= Date.parse(c.endsAt)),
        }));
    },
  };
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const linearProvider: IntegrationProviderDefinition = {
  id: 'linear',
  displayName: 'Linear',
  icon: 'Layers',
  kinds: ['tracker'],
  configSchema: [
    {
      key: 'token', label: 'Personal API key', type: 'secret', required: true,
      help: 'Create one under Settings → Security & access → Personal API keys.',
      helpUrl: 'https://linear.app/settings/account/security',
    },
    { key: 'teamKeys', label: 'Team keys', type: 'text', placeholder: 'ENG, OPS', help: 'Teams SI Hive tracks (comma-separated). The first one receives new issues and provides cycles.' },
  ],
  createTracker,
};
