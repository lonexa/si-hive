/**
 * TEMPLATE — copy this folder to `providers/<your-id>/`, rename the export,
 * implement the TODOs, add it to `providers/index.ts`, and add a fixture at
 * `__tests__/fixtures/<your-id>.ts`. `npx vitest run apps/hive/server/integrations`
 * then runs the shared contract suite against it.
 *
 * Delete whichever half you don't need: a tracker-only provider (Jira-like)
 * keeps `createTracker` and `kinds: ['tracker']`; a git-host-only provider
 * keeps `createGitHost` and `kinds: ['git']`.
 *
 * Full walkthrough: docs/extending/adding-a-provider.md
 * This file is excluded from the registry — it is never loaded at runtime.
 */
import type {
  ConnectionContext,
  GitHostProvider,
  IntegrationProviderDefinition,
  Issue,
  Person,
  StateCategory,
  TrackerProvider,
} from '../types.js';
import { createHttpClient, normalizeBaseUrl } from '../http.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function client(ctx: ConnectionContext) {
  // TODO: base URL + auth header for the service's API.
  const baseUrl = normalizeBaseUrl(ctx.settings.baseUrl, 'https://api.example.com');
  return createHttpClient('Example', baseUrl, { Authorization: `Bearer ${ctx.secrets.token ?? ''}` });
}

function toPerson(u: any): Person {
  return { id: String(u.id), name: u.name ?? u.username ?? '', email: u.email };
}

/** TODO: map the service's workflow states onto todo / in_progress / done. */
function stateCategory(state: string): StateCategory {
  if (/done|closed|resolved|complete/i.test(state)) return 'done';
  if (/progress|doing|review|started/i.test(state)) return 'in_progress';
  return 'todo';
}

function toIssue(raw: any): Issue {
  return {
    id: String(raw.id),
    key: String(raw.key ?? raw.id), // TODO: the human-facing reference users type
    title: raw.title,
    description: raw.description ?? undefined,
    state: raw.state,
    stateCategory: stateCategory(raw.state),
    assignee: raw.assignee ? toPerson(raw.assignee) : null,
    labels: raw.labels ?? [],
    url: raw.url,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    raw,
  };
}

function createTracker(ctx: ConnectionContext): TrackerProvider {
  const http = client(ctx);
  return {
    capabilities: new Set(['create', 'comment', 'assign', 'transition', 'labels']),
    ticketRefPattern: /\bEX-\d+\b/g, // TODO
    issueUrl: (key) => `https://example.com/issues/${encodeURIComponent(key)}`, // TODO
    whoAmI: async () => toPerson(await http<any>('/me')),
    async searchIssues(q) {
      // TODO: translate IssueQuery (text, labels, assignee 'me', stateCategory, limit) to the API.
      const res = await http<any>(`/issues?limit=${q.limit ?? 30}`);
      return (res.items ?? []).map(toIssue);
    },
    async getIssue(key) {
      const raw = await http<any>(`/issues/${encodeURIComponent(key)}`, { allow404: true });
      return raw ? toIssue(raw) : null;
    },
    async createIssue(input) {
      return toIssue(await http<any>('/issues', { method: 'POST', body: input }));
    },
    async updateIssue(key, patch) {
      return toIssue(await http<any>(`/issues/${encodeURIComponent(key)}`, { method: 'PATCH', body: patch }));
    },
    async addComment(key, body) {
      const c = await http<any>(`/issues/${encodeURIComponent(key)}/comments`, { method: 'POST', body: { body } });
      return { id: String(c.id), author: c.author ? toPerson(c.author) : null, body: c.body, createdAt: c.created_at };
    },
    async listComments(key) {
      const cs = await http<any[]>(`/issues/${encodeURIComponent(key)}/comments`);
      return cs.map((c) => ({ id: String(c.id), author: c.author ? toPerson(c.author) : null, body: c.body, createdAt: c.created_at }));
    },
  };
}

function createGitHost(ctx: ConnectionContext): GitHostProvider {
  const http = client(ctx);
  void http;
  // TODO: implement against the service's REST API — see providers/github for a complete example.
  throw new Error('Example git host is not implemented');
}

export const exampleProvider: IntegrationProviderDefinition = {
  id: 'example', // TODO: stable, lowercase, used in config and secret refs
  displayName: 'Example',
  icon: 'Plug', // any icon name listed in src/components/settings/IntegrationsTab.tsx ICONS
  kinds: ['tracker', 'git'],
  configSchema: [
    { key: 'baseUrl', label: 'Server URL', type: 'url', placeholder: 'https://example.com' },
    { key: 'token', label: 'API token', type: 'secret', required: true, helpUrl: 'https://example.com/docs/tokens' },
  ],
  createTracker,
  createGitHost,
  // Optional — lets Hive pick this connection for a local checkout and answer git credential prompts:
  // matchesRemote(remoteUrl, settings) { return remoteUrl.includes('example.com'); },
  // repoFromRemote(remoteUrl) { return /example\.com[:/](.+?)(\.git)?$/.exec(remoteUrl)?.[1] ?? null; },
  // gitCredential(ctx) { return ctx.secrets.token ? { host: 'example.com', username: 'token', password: ctx.secrets.token } : null; },
};
