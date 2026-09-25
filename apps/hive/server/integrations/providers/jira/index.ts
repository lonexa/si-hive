/**
 * Jira Cloud — tracker only (REST API v3 + Agile API for sprints).
 *
 * Auth: Atlassian account email + API token (HTTP Basic `email:token`).
 *
 * Issue keys are Jira keys (`ABC-123`). Descriptions and comments are stored
 * by Jira as ADF (Atlassian Document Format); they are flattened to markdown
 * on read and built from plain-text paragraphs on write.
 *
 * States use Jira's native status categories: `new` → todo,
 * `indeterminate` → in_progress, `done` → done. Moving an issue goes through
 * the workflow's transitions (Jira has no "set status" endpoint).
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
import { createHttpClient, normalizeBaseUrl, type HttpClient } from '../../http.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const API = '/rest/api/3';

/** Common Jira Cloud "Sprint" custom field; used for `Issue.iteration` when present. */
const SPRINT_FIELD = 'customfield_10020';

const ISSUE_FIELDS = ['summary', 'description', 'status', 'issuetype', 'assignee', 'labels', 'priority', 'created', 'updated', SPRINT_FIELD];

const CATEGORY_FROM_JIRA: Record<string, StateCategory> = { new: 'todo', indeterminate: 'in_progress', done: 'done' };
const CATEGORY_TO_JIRA: Record<StateCategory, { key: string; name: string }> = {
  todo: { key: 'new', name: 'To Do' },
  in_progress: { key: 'indeterminate', name: 'In Progress' },
  done: { key: 'done', name: 'Done' },
};

function csv(value: string | boolean | undefined): string[] {
  return String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** JQL string literal. */
function jqlString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Jira labels cannot contain spaces. */
function sanitizeLabel(l: string): string {
  return l.trim().replace(/\s+/g, '-');
}

// ---------------------------------------------------------------------------
// ADF <-> text
// ---------------------------------------------------------------------------

function markText(node: any): string {
  const raw = String(node.text ?? '');
  if (!node.marks?.length || !raw.trim()) return raw;
  // Keep surrounding whitespace outside the markers (`** x**` is not bold in markdown).
  const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw)!;
  let text = core;
  for (const m of node.marks) {
    switch (m.type) {
      case 'strong': text = `**${text}**`; break;
      case 'em': text = `_${text}_`; break;
      case 'strike': text = `~~${text}~~`; break;
      case 'code': text = `\`${text}\``; break;
      case 'link': if (m.attrs?.href) text = `[${text}](${m.attrs.href})`; break;
      default: break;
    }
  }
  return `${lead}${text}${trail}`;
}

function inline(nodes: any[] | undefined): string {
  return (nodes ?? []).map((n) => {
    switch (n.type) {
      case 'text': return markText(n);
      case 'hardBreak': return '\n';
      case 'mention': return String(n.attrs?.text ?? '@user');
      case 'emoji': return String(n.attrs?.text ?? n.attrs?.shortName ?? '');
      case 'inlineCard': return String(n.attrs?.url ?? '');
      case 'date': return n.attrs?.timestamp ? new Date(Number(n.attrs.timestamp)).toISOString().slice(0, 10) : '';
      case 'status': return String(n.attrs?.text ?? '');
      default: return n.content ? inline(n.content) : '';
    }
  }).join('');
}

function block(node: any, indent = ''): string {
  switch (node.type) {
    case 'paragraph': return indent + inline(node.content).replace(/\n/g, `\n${indent}`);
    case 'heading': return `${'#'.repeat(Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6))} ${inline(node.content)}`;
    case 'bulletList':
    case 'orderedList': {
      const start = Number(node.attrs?.order) || 1;
      return (node.content ?? []).map((item: any, i: number) => {
        const marker = node.type === 'orderedList' ? `${start + i}. ` : '- ';
        // Children render indented under the marker; the first one continues the marker's line.
        const parts = (item.content ?? []).map((c: any, j: number) => {
          const text = block(c, `${indent}  `);
          return j === 0 && text.startsWith(`${indent}  `) ? text.slice(indent.length + 2) : text;
        });
        return `${indent}${marker}${parts.join('\n')}`;
      }).join('\n');
    }
    case 'codeBlock': return `\`\`\`${node.attrs?.language ?? ''}\n${inline(node.content)}\n\`\`\``;
    case 'blockquote': return blocks(node.content).split('\n').map((l) => `> ${l}`).join('\n');
    case 'rule': return '---';
    case 'panel': return blocks(node.content);
    case 'table': return (node.content ?? []).map((row: any) => `| ${(row.content ?? []).map((cell: any) => blocks(cell.content).replace(/\n+/g, ' ')).join(' | ')} |`).join('\n');
    case 'mediaSingle':
    case 'mediaGroup': return '';
    default: return node.content ? blocks(node.content) : inline([node]);
  }
}

function blocks(nodes: any[] | undefined): string {
  return (nodes ?? []).map((n) => block(n)).filter((s) => s !== '').join('\n\n');
}

/** ADF document → markdown-ish text. Strings (API v2 / wiki markup) pass through. */
export function adfToText(doc: any): string {
  if (doc == null) return '';
  if (typeof doc === 'string') return doc;
  return blocks(doc.content).trim();
}

/** Plain text → ADF: blank lines separate paragraphs, single newlines become hard breaks. */
export function textToAdf(text: string): any {
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/).filter((p) => p.trim() !== '');
  return {
    type: 'doc',
    version: 1,
    content: paragraphs.map((p) => ({
      type: 'paragraph',
      content: p.split('\n').flatMap((line, i) => [
        ...(i > 0 ? [{ type: 'hardBreak' }] : []),
        ...(line ? [{ type: 'text', text: line }] : []),
      ]),
    })),
  };
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function person(u: any): Person {
  return {
    id: String(u?.accountId ?? ''),
    name: u?.displayName ?? '',
    email: u?.emailAddress || undefined,
    avatarUrl: u?.avatarUrls?.['48x48'],
  };
}

function nullablePerson(u: any): Person | null {
  return u ? person(u) : null;
}

function stateCategoryOf(status: any): StateCategory {
  return CATEGORY_FROM_JIRA[status?.statusCategory?.key] ?? 'todo';
}

/** Name of the active (else most recent) sprint in the sprint field, if any. */
function sprintName(fields: any): string | undefined {
  const sprints = fields?.[SPRINT_FIELD];
  if (!Array.isArray(sprints) || !sprints.length) return undefined;
  const active = sprints.find((s: any) => s?.state === 'active');
  return (active ?? sprints[sprints.length - 1])?.name ?? undefined;
}

function mapComment(c: any): IssueComment {
  return { id: String(c.id), author: nullablePerson(c.author), body: adfToText(c.body), createdAt: c.created };
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

function createTracker(ctx: ConnectionContext): TrackerProvider {
  const siteUrl = normalizeBaseUrl(ctx.settings.siteUrl, 'https://your-domain.atlassian.net');
  const auth = Buffer.from(`${String(ctx.settings.email ?? '')}:${ctx.secrets.token ?? ''}`).toString('base64');
  const http: HttpClient = createHttpClient('Jira', siteUrl, { Authorization: `Basic ${auth}` });
  const projectKeys = csv(ctx.settings.projectKeys).map((k) => k.toUpperCase());
  const defaultIssueType = String(ctx.settings.defaultIssueType || 'Task');
  const boardId = String(ctx.settings.boardId ?? '').trim();

  let meCache: Promise<Person> | null = null;
  const me = () => (meCache ??= http<any>(`${API}/myself`).then(person));

  const capabilities = new Set<TrackerCapability>(['create', 'comment', 'assign', 'transition', 'labels']);
  if (boardId) capabilities.add('iterations');

  function mapIssue(i: any): Issue {
    const f = i.fields ?? {};
    return {
      id: String(i.id),
      key: i.key,
      title: f.summary ?? '',
      description: f.description ? adfToText(f.description) : undefined,
      state: f.status?.name ?? '',
      stateCategory: stateCategoryOf(f.status),
      type: f.issuetype?.name ?? undefined,
      assignee: nullablePerson(f.assignee),
      labels: f.labels ?? [],
      priority: f.priority?.name ?? undefined,
      iteration: sprintName(f),
      url: `${siteUrl}/browse/${i.key}`,
      createdAt: f.created,
      updatedAt: f.updated,
      raw: i,
    };
  }

  function issuePath(key: string): string {
    return `${API}/issue/${encodeURIComponent(key.trim().toUpperCase())}`;
  }

  /** `'me'` → own accountId, an email → looked-up accountId, anything else is taken as an accountId. */
  async function resolveAccountId(a: string): Promise<string> {
    if (a === 'me') return (await me()).id;
    if (!a.includes('@')) return a;
    const users = await http<any[]>(`${API}/user/search?query=${encodeURIComponent(a)}&maxResults=1`);
    if (!users?.[0]?.accountId) throw new Error(`Jira: no user found for "${a}"`);
    return users[0].accountId;
  }

  async function fetchIssue(key: string): Promise<Issue | null> {
    const i = await http<any>(`${issuePath(key)}?fields=${ISSUE_FIELDS.join(',')}`, { allow404: true });
    return i ? mapIssue(i) : null;
  }

  async function loadIssue(key: string): Promise<Issue> {
    const issue = await fetchIssue(key);
    if (!issue) throw new Error(`Jira: issue ${key} not found`);
    return issue;
  }

  return {
    capabilities,
    ticketRefPattern: projectKeys.length
      ? new RegExp(`\\b(?:${projectKeys.map(escapeRegex).join('|')})-\\d+\\b`, 'g')
      : /\b[A-Z][A-Z0-9_]+-\d+\b/g,
    issueUrl: (key) => `${siteUrl}/browse/${key.trim().toUpperCase()}`,
    whoAmI: me,

    async searchIssues(q) {
      const clauses: string[] = [];
      if (projectKeys.length) clauses.push(`project in (${projectKeys.map(jqlString).join(', ')})`);
      if (q.text) clauses.push(`text ~ ${jqlString(q.text)}`);
      if (q.labels?.length) clauses.push(`labels in (${q.labels.map((l) => jqlString(sanitizeLabel(l))).join(', ')})`);
      if (q.assignee) clauses.push(q.assignee === 'me' ? 'assignee = currentUser()' : `assignee = ${jqlString(await resolveAccountId(q.assignee))}`);
      if (q.stateCategory?.length) clauses.push(`statusCategory in (${q.stateCategory.map((c) => jqlString(CATEGORY_TO_JIRA[c].name)).join(', ')})`);
      if (q.type) clauses.push(`issuetype = ${jqlString(q.type)}`);
      if (q.iterationId) clauses.push(`sprint = ${/^\d+$/.test(q.iterationId) ? q.iterationId : jqlString(q.iterationId)}`);
      const jql = `${clauses.join(' AND ')} ORDER BY updated DESC`;
      const res = await http<any>(`${API}/search/jql`, {
        method: 'POST',
        body: { jql, maxResults: Math.min(q.limit ?? 30, 100), fields: ISSUE_FIELDS },
      });
      return (res?.issues ?? []).map(mapIssue);
    },

    getIssue: fetchIssue,

    async createIssue(input) {
      if (!projectKeys[0]) throw new Error('Jira: set "Project keys" on the connection to create issues');
      const fields: Record<string, unknown> = {
        project: { key: projectKeys[0] },
        summary: input.title,
        issuetype: { name: input.type || defaultIssueType },
      };
      if (input.description) fields.description = textToAdf(input.description);
      if (input.labels?.length) fields.labels = input.labels.map(sanitizeLabel);
      if (input.assignee) fields.assignee = { accountId: await resolveAccountId(input.assignee) };
      const created = await http<any>(`${API}/issue`, { method: 'POST', body: { fields } });
      return loadIssue(created.key);
    },

    async updateIssue(key, patch) {
      const fields: Record<string, unknown> = {};
      if (patch.title !== undefined) fields.summary = patch.title;
      if (patch.description !== undefined) fields.description = patch.description ? textToAdf(patch.description) : null;
      if (patch.labels !== undefined) fields.labels = patch.labels.map(sanitizeLabel);
      if (patch.assignee !== undefined) fields.assignee = patch.assignee === null ? null : { accountId: await resolveAccountId(patch.assignee) };
      if (Object.keys(fields).length) await http(issuePath(key), { method: 'PUT', body: { fields }, as: 'none' });

      if (patch.state !== undefined || patch.stateCategory !== undefined) {
        const current = await loadIssue(key);
        const wantName = patch.state?.trim().toLowerCase();
        const already = wantName ? current.state.toLowerCase() === wantName : current.stateCategory === patch.stateCategory;
        if (!already) {
          const res = await http<any>(`${issuePath(key)}/transitions`);
          const transitions: any[] = res?.transitions ?? [];
          const wantKey = patch.stateCategory ? CATEGORY_TO_JIRA[patch.stateCategory].key : undefined;
          const chosen = wantName
            ? transitions.find((t) => String(t.to?.name ?? '').toLowerCase() === wantName) ?? transitions.find((t) => String(t.name ?? '').toLowerCase() === wantName)
            : transitions.find((t) => t.to?.statusCategory?.key === wantKey);
          if (!chosen) {
            const avail = transitions.map((t) => `"${t.to?.name ?? t.name}"`).join(', ') || 'none';
            throw new Error(`Jira: no transition from "${current.state}" to ${patch.state ? `"${patch.state}"` : `a ${patch.stateCategory} status`} (available: ${avail})`);
          }
          await http(`${issuePath(key)}/transitions`, { method: 'POST', body: { transition: { id: chosen.id } }, as: 'none' });
        }
      }
      return loadIssue(key);
    },

    async addComment(key, text) {
      const c = await http<any>(`${issuePath(key)}/comment`, { method: 'POST', body: { body: textToAdf(text) } });
      return mapComment(c);
    },

    async listComments(key) {
      const res = await http<any>(`${issuePath(key)}/comment?orderBy=created&maxResults=100`);
      return (res?.comments ?? []).map(mapComment);
    },

    /** Sprints of the configured board (Agile API); the active sprint is current. */
    async listIterations() {
      if (!boardId) return [];
      const sprints: any[] = [];
      for (let startAt = 0, page = 0; page < 10; page++) {
        const res = await http<any>(`/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint?state=active,future,closed&startAt=${startAt}&maxResults=50`);
        const values: any[] = res?.values ?? [];
        sprints.push(...values);
        if (res?.isLast !== false || !values.length) break;
        startAt += values.length;
      }
      return sprints.map((s): Iteration => ({
        id: String(s.id),
        name: s.name,
        startDate: s.startDate ?? undefined,
        endDate: s.endDate ?? undefined,
        current: s.state === 'active',
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const jiraProvider: IntegrationProviderDefinition = {
  id: 'jira',
  displayName: 'Jira',
  icon: 'SquareKanban',
  kinds: ['tracker'],
  configSchema: [
    { key: 'siteUrl', label: 'Jira site URL', type: 'url', required: true, placeholder: 'https://your-domain.atlassian.net' },
    { key: 'email', label: 'Account email', type: 'text', required: true, placeholder: 'you@example.com', help: 'The Atlassian account the API token belongs to.' },
    {
      key: 'token', label: 'API token', type: 'secret', required: true,
      help: 'An Atlassian API token for the account above.',
      helpUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
    },
    { key: 'projectKeys', label: 'Project keys', type: 'text', placeholder: 'ABC, OPS', help: 'Projects SI Hive tracks (comma-separated). The first one receives new issues.' },
    { key: 'defaultIssueType', label: 'Default issue type', type: 'text', placeholder: 'Task', default: 'Task', help: 'Issue type used when creating issues without an explicit type.' },
    { key: 'boardId', label: 'Board id', type: 'text', placeholder: '12', help: 'Optional. A Scrum board id — enables sprints as iterations.' },
  ],
  createTracker,
};
