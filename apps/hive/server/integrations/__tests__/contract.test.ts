/**
 * Contract suite: every registered integration provider must satisfy the
 * GitHostProvider / TrackerProvider contracts against its recorded fixtures.
 *
 * Adding a provider? Add `fixtures/<id>.ts` (see fixture-types.ts) and this
 * suite picks it up. Providers without a fixture fail the "has fixture" check.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { INTEGRATION_PROVIDERS } from '../providers/index.js';
import type { ProviderFixture, FixtureRoute } from './fixture-types.js';
import type { GitHostProvider, TrackerProvider, StateCategory } from '../types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, 'fixtures');

async function loadFixture(id: string): Promise<ProviderFixture | null> {
  const file = path.join(fixtureDir, `${id}.ts`);
  if (!fs.existsSync(file)) return null;
  return ((await import(pathToFileURL(file).href)) as { fixture: ProviderFixture }).fixture;
}

function mockFetch(routes: FixtureRoute[], calls: string[]) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${url}`);
    const route = routes.find((r) => (r.method ?? 'GET').toUpperCase() === method && r.url.test(url));
    if (!route) return new Response(JSON.stringify({ message: `no fixture for ${method} ${url}` }), { status: 404 });
    const body = route.body === undefined ? ''
      : Buffer.isBuffer(route.body) ? route.body
        : typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
    return new Response(body as ConstructorParameters<typeof Response>[0], { status: route.status ?? 200, headers: route.headers });
  });
}

const STATE_CATEGORIES: StateCategory[] = ['todo', 'in_progress', 'done'];

for (const def of INTEGRATION_PROVIDERS) {
  describe(`integration provider: ${def.id}`, () => {
    let fixture: ProviderFixture | null = null;
    const calls: string[] = [];
    const realFetch = globalThis.fetch;

    beforeAll(async () => {
      fixture = await loadFixture(def.id);
      if (fixture) globalThis.fetch = mockFetch(fixture.routes, calls) as typeof fetch;
    });
    afterAll(() => { globalThis.fetch = realFetch; });

    it('has a fixture and a well-formed definition', () => {
      expect(fixture, `add apps/hive/server/integrations/__tests__/fixtures/${def.id}.ts`).not.toBeNull();
      expect(def.displayName).toBeTruthy();
      expect(def.kinds.length).toBeGreaterThan(0);
      for (const f of def.configSchema) expect(f.key && f.label && f.type).toBeTruthy();
      if (def.kinds.includes('git')) expect(def.createGitHost).toBeTypeOf('function');
      if (def.kinds.includes('tracker')) expect(def.createTracker).toBeTypeOf('function');
    });

    if (def.kinds.includes('git')) {
      describe('git host', () => {
        let host: GitHostProvider;
        beforeAll(() => { host = def.createGitHost!({ settings: fixture!.settings, secrets: fixture!.secrets }); });

        it('whoAmI returns a person', async () => {
          const me = await host.whoAmI();
          expect(me.id).toBeTruthy();
        });

        it('lists repos with normalized fields', async () => {
          const repos = await host.listRepos();
          expect(repos.length).toBeGreaterThan(0);
          for (const r of repos) {
            expect(r.fullName).toBeTruthy();
            expect(r.defaultBranch).toBeTruthy();
            expect(r.webUrl).toMatch(/^https?:\/\//);
          }
        });

        it('lists commits', async () => {
          const commits = await host.listCommits(fixture!.sample.repo!, { limit: 5 });
          expect(commits.length).toBeGreaterThan(0);
          for (const c of commits) {
            expect(c.sha).toBeTruthy();
            expect(Number.isFinite(Date.parse(c.date))).toBe(true);
          }
        });

        it('lists and loads pull requests', async () => {
          if (!host.capabilities.has('pullRequests')) return;
          const prs = await host.listPullRequests(fixture!.sample.repo!, { state: 'all', limit: 5 });
          expect(prs.length).toBeGreaterThan(0);
          for (const p of prs) {
            expect(['open', 'closed', 'merged', 'draft']).toContain(p.state);
            expect(p.number).toBeTypeOf('number');
            expect(p.url).toMatch(/^https?:\/\//);
          }
          const pr = await host.getPullRequest(fixture!.sample.repo!, fixture!.sample.prNumber!);
          expect(pr?.number).toBe(fixture!.sample.prNumber);
          const diff = await host.getPullRequestDiff(fixture!.sample.repo!, fixture!.sample.prNumber!);
          expect(typeof diff).toBe('string');
          const comments = await host.listPrComments(fixture!.sample.repo!, fixture!.sample.prNumber!);
          expect(Array.isArray(comments)).toBe(true);
        });

        it('lists builds with normalized status', async () => {
          if (!host.capabilities.has('builds') || !host.listBuilds) return;
          const builds = await host.listBuilds(fixture!.sample.repo!, { limit: 5 });
          for (const b of builds) expect(['queued', 'running', 'succeeded', 'failed', 'cancelled']).toContain(b.status);
        });
      });
    }

    if (def.kinds.includes('tracker')) {
      describe('tracker', () => {
        let tracker: TrackerProvider;
        beforeAll(() => { tracker = def.createTracker!({ settings: fixture!.settings, secrets: fixture!.secrets }); });

        it('whoAmI returns a person', async () => {
          expect((await tracker.whoAmI()).id).toBeTruthy();
        });

        it('searches issues with normalized fields', async () => {
          const issues = await tracker.searchIssues({ assignee: 'me', stateCategory: ['todo', 'in_progress'], limit: 10 });
          expect(issues.length).toBeGreaterThan(0);
          for (const i of issues) {
            expect(i.key).toBeTruthy();
            expect(i.title).toBeTypeOf('string');
            expect(STATE_CATEGORIES).toContain(i.stateCategory);
            expect(Array.isArray(i.labels)).toBe(true);
            expect(i.url).toMatch(/^https?:\/\//);
          }
        });

        it('loads an issue by key and builds its URL', async () => {
          const issue = await tracker.getIssue(fixture!.sample.issueKey!);
          expect(issue?.key).toBe(fixture!.sample.issueKey);
          expect(tracker.issueUrl(fixture!.sample.issueKey!)).toMatch(/^https?:\/\//);
        });

        it('lists comments', async () => {
          const comments = await tracker.listComments(fixture!.sample.issueKey!);
          expect(Array.isArray(comments)).toBe(true);
        });

        it('detects ticket references in text', () => {
          if (!fixture!.sample.textWithRef) return;
          const re = new RegExp(tracker.ticketRefPattern.source, tracker.ticketRefPattern.flags);
          expect(fixture!.sample.textWithRef.match(re)?.length ?? 0).toBeGreaterThan(0);
        });

        it('lists iterations when supported', async () => {
          if (!tracker.capabilities.has('iterations') || !tracker.listIterations) return;
          const its = await tracker.listIterations();
          for (const it of its) expect(it.id && it.name).toBeTruthy();
        });
      });
    }

    it('never sends requests to unexpected hosts', () => {
      const hosts = new Set(calls.map((c) => new URL(c.split(' ')[1]).hostname));
      expect(hosts.size).toBeLessThanOrEqual(2);
    });
  });
}
