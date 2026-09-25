/**
 * Delivery module API — tickets, pull requests and delivery feeds, all
 * through the integration registry (whatever tracker / git hosts are
 * connected). Every route degrades to `{ connected: false }` or an empty
 * list when nothing is connected.
 *
 * Tickets
 *   GET    /api/work/status                       tracker + git host summary
 *   GET    /api/work/issues?q=&mine=1&state=open|done|all&labels=a,b&iteration=&project=&limit=
 *   GET    /api/work/issues/:key                  { issue, comments }
 *   POST   /api/work/issues                       create { title, description?, labels?, assignToMe?, project? }
 *   PATCH  /api/work/issues/:key                  { stateCategory?, state?, assignee?, title?, labels? }
 *   POST   /api/work/issues/:key/comments         { body }
 *   POST   /api/work/issues/:key/prepare          { projectPath } → writes ticket context, returns starter prompt
 *   GET    /api/work/issue-card?key=              compact card for terminal hover previews
 *   GET    /api/work/iterations?project=
 * Pull requests
 *   GET    /api/pulls/repos                       locally checked-out repos on connected hosts
 *   GET    /api/pulls?connectionId=&repo=&state=
 *   GET    /api/pulls/detail?connectionId=&repo=&number=
 *   POST   /api/pulls/comment | /approve | /merge                { connectionId, repo, number, body? }
 *   POST   /api/pulls/ai-review   { connectionId, repo, number, post?, body? }
 *          — without body: generate a review (and post it if post=true);
 *            with body + post=true: post that already-generated review.
 * Feeds
 *   GET    /api/delivery/landed?days=&ai=1
 *   GET    /api/delivery/build-failures?days=&ai=1
 */
import type http from 'node:http';
import type { HiveConfig } from '../types.js';
import type { Issue, StateCategory } from '../integrations/types.js';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import {
  getTracker,
  getTrackerConnection,
  getConnection,
  gitHostForConnection,
  getProviderDefinition,
  listConnections,
} from '../integrations/registry.js';
import { writeTicketContext } from './ticket-context.js';
import { listLocalRepos, findLocalCheckout } from './local-repos.js';
import { reviewPullRequest, formatReviewComment, recordPostedReview } from './pr-review.js';
import { landedCommits, buildFailures } from './feeds.js';
import { isLlmConfigured } from '../ai/llm.js';

const CATEGORIES: StateCategory[] = ['todo', 'in_progress', 'done'];

function fail(res: http.ServerResponse, err: unknown, status = 502) {
  sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
}

async function body<T>(req: http.IncomingMessage): Promise<T> {
  const raw = await readBody(req);
  return (raw ? JSON.parse(raw) : {}) as T;
}

function issueCard(issue: Issue) {
  return {
    id: issue.key,
    title: issue.title,
    type: issue.type ?? 'Ticket',
    state: issue.state,
    stateCategory: issue.stateCategory,
    assignedTo: issue.assignee ? { displayName: issue.assignee.name, uniqueName: issue.assignee.email ?? issue.assignee.id } : undefined,
    priority: issue.priority,
    tags: issue.labels,
    iterationPath: issue.iteration ?? '',
    url: issue.url,
    changedDate: issue.updatedAt ?? '',
  };
}

/** Short-lived cache for hover cards (terminals re-request the same keys a lot). */
const cardCache = new Map<string, { at: number; card: ReturnType<typeof issueCard> | null }>();

export function registerDeliveryRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: HiveConfig,
): boolean {
  const { pathname } = url;
  const q = url.searchParams;
  const project = q.get('project') || undefined;

  // ------------------------------------------------------------------ tickets
  if (pathname === '/api/work/status' && req.method === 'GET') {
    const conn = getTrackerConnection(config, { projectPath: project });
    const tracker = conn ? getTracker(config, { projectPath: project }) : null;
    sendJson(res, 200, {
      tracker: conn && tracker
        ? { connected: true, connectionId: conn.id, label: conn.label, provider: getProviderDefinition(conn.providerId)?.displayName, capabilities: [...tracker.capabilities], ticketRefPattern: tracker.ticketRefPattern.source }
        : { connected: false },
      gitHosts: listConnections(config, 'git').map((c) => ({ connectionId: c.id, label: c.label, provider: getProviderDefinition(c.providerId)?.displayName })),
      ai: isLlmConfigured(config),
    });
    return true;
  }

  if (pathname === '/api/work/issue-card' && req.method === 'GET') {
    const key = q.get('key') ?? '';
    const tracker = getTracker(config);
    if (!key || !tracker) { sendJson(res, 200, { ok: false }); return true; }
    const hit = cardCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) { sendJson(res, 200, hit.card ? { ok: true, card: hit.card } : { ok: false }); return true; }
    void tracker.getIssue(key)
      .then((issue) => {
        const card = issue ? issueCard(issue) : null;
        cardCache.set(key, { at: Date.now(), card });
        sendJson(res, 200, card ? { ok: true, card } : { ok: false });
      })
      .catch(() => sendJson(res, 200, { ok: false }));
    return true;
  }

  if (pathname === '/api/work/iterations' && req.method === 'GET') {
    const tracker = getTracker(config, { projectPath: project });
    if (!tracker?.capabilities.has('iterations') || !tracker.listIterations) { sendJson(res, 200, []); return true; }
    tracker.listIterations().then((its) => sendJson(res, 200, its)).catch((e) => fail(res, e));
    return true;
  }

  if (pathname === '/api/work/issues' && req.method === 'GET') {
    const tracker = getTracker(config, { projectPath: project });
    if (!tracker) { sendJson(res, 200, { connected: false, issues: [] }); return true; }
    const state = q.get('state') ?? 'open';
    const stateCategory: StateCategory[] = state === 'all' ? [] : state === 'done' ? ['done'] : ['todo', 'in_progress'];
    tracker.searchIssues({
      text: q.get('q') || undefined,
      labels: q.get('labels')?.split(',').map((s) => s.trim()).filter(Boolean) || undefined,
      assignee: q.get('mine') === '1' ? 'me' : undefined,
      stateCategory: stateCategory.length ? stateCategory : undefined,
      iterationId: q.get('iteration') || undefined,
      limit: Math.min(Number(q.get('limit')) || 50, 100),
    }).then((issues) => sendJson(res, 200, { connected: true, issues })).catch((e) => fail(res, e));
    return true;
  }

  if (pathname === '/api/work/issues' && req.method === 'POST') {
    void (async () => {
      try {
        const tracker = getTracker(config, { projectPath: project });
        if (!tracker) return sendJson(res, 400, { error: 'No ticket tracker connected' });
        const b = await body<{ title?: string; description?: string; labels?: string[]; assignToMe?: boolean; type?: string }>(req);
        if (!b.title?.trim()) return sendJson(res, 400, { error: 'title is required' });
        sendJson(res, 201, await tracker.createIssue({ title: b.title.trim(), description: b.description, labels: b.labels, type: b.type, assignee: b.assignToMe ? 'me' : undefined }));
      } catch (e) { fail(res, e); }
    })();
    return true;
  }

  const issueMatch = /^\/api\/work\/issues\/(.+?)(\/comments|\/prepare)?$/.exec(pathname);
  if (issueMatch) {
    const key = decodeURIComponent(issueMatch[1]);
    const sub = issueMatch[2];
    const tracker = getTracker(config, { projectPath: project });
    if (!tracker) { sendJson(res, 404, { error: 'No ticket tracker connected' }); return true; }

    if (!sub && req.method === 'GET') {
      Promise.all([tracker.getIssue(key), tracker.listComments(key).catch(() => [])])
        .then(([issue, comments]) => (issue ? sendJson(res, 200, { issue, comments }) : sendJson(res, 404, { error: 'Not found' })))
        .catch((e) => fail(res, e));
      return true;
    }
    if (!sub && req.method === 'PATCH') {
      void (async () => {
        try {
          const b = await body<{ stateCategory?: StateCategory; state?: string; assignee?: string | null; title?: string; labels?: string[] }>(req);
          if (b.stateCategory && !CATEGORIES.includes(b.stateCategory)) return sendJson(res, 400, { error: 'invalid stateCategory' });
          cardCache.delete(key);
          sendJson(res, 200, await tracker.updateIssue(key, b));
        } catch (e) { fail(res, e); }
      })();
      return true;
    }
    if (sub === '/comments' && req.method === 'POST') {
      void (async () => {
        try {
          const b = await body<{ body?: string }>(req);
          if (!b.body?.trim()) return sendJson(res, 400, { error: 'body is required' });
          sendJson(res, 201, await tracker.addComment(key, b.body));
        } catch (e) { fail(res, e); }
      })();
      return true;
    }
    if (sub === '/prepare' && req.method === 'POST') {
      void (async () => {
        try {
          const b = await body<{ projectPath?: string }>(req);
          if (!b.projectPath) return sendJson(res, 400, { error: 'projectPath is required' });
          const t = getTracker(config, { projectPath: b.projectPath }) ?? tracker;
          const ctx = await writeTicketContext(t, key, b.projectPath);
          sendJson(res, 200, { file: ctx.file, prompt: ctx.prompt, issue: ctx.issue });
        } catch (e) { fail(res, e); }
      })();
      return true;
    }
  }

  // ------------------------------------------------------------ pull requests
  if (pathname === '/api/pulls/repos' && req.method === 'GET') {
    sendJson(res, 200, listLocalRepos(config, { fresh: q.get('fresh') === '1' }).map((r) => ({
      ...r, connectionLabel: getConnection(config, r.connectionId)?.label,
    })));
    return true;
  }

  const hostFor = (connectionId: string | null | undefined) => {
    const conn = connectionId ? getConnection(config, connectionId) : undefined;
    return conn ? gitHostForConnection(conn) : null;
  };

  if (pathname === '/api/pulls' && req.method === 'GET') {
    const host = hostFor(q.get('connectionId'));
    const repo = q.get('repo');
    if (!host || !repo) { sendJson(res, 400, { error: 'connectionId and repo are required' }); return true; }
    const state = (q.get('state') as 'open' | 'closed' | 'all' | null) ?? 'open';
    host.listPullRequests(repo, { state, limit: 50 }).then((prs) => sendJson(res, 200, prs)).catch((e) => fail(res, e));
    return true;
  }

  if (pathname === '/api/pulls/detail' && req.method === 'GET') {
    const host = hostFor(q.get('connectionId'));
    const repo = q.get('repo');
    const number = Number(q.get('number'));
    if (!host || !repo || !number) { sendJson(res, 400, { error: 'connectionId, repo and number are required' }); return true; }
    Promise.all([
      host.getPullRequest(repo, number),
      host.listPrComments(repo, number).catch(() => []),
      host.getPullRequestDiff(repo, number).catch((e) => `(diff unavailable: ${(e as Error).message})`),
    ]).then(([pr, comments, diff]) => (pr
      ? sendJson(res, 200, { pr, comments, diff: diff.length > 400_000 ? `${diff.slice(0, 400_000)}\n… (truncated)` : diff, capabilities: [...host.capabilities], localPath: findLocalCheckout(config, q.get('connectionId')!, repo) })
      : sendJson(res, 404, { error: 'Not found' }))).catch((e) => fail(res, e));
    return true;
  }

  const prAction = /^\/api\/pulls\/(comment|approve|merge|ai-review)$/.exec(pathname);
  if (prAction && req.method === 'POST') {
    void (async () => {
      try {
        const b = await body<{ connectionId?: string; repo?: string; number?: number; body?: string; post?: boolean }>(req);
        const host = hostFor(b.connectionId);
        if (!host || !b.repo || !b.number) return sendJson(res, 400, { error: 'connectionId, repo and number are required' });
        switch (prAction[1]) {
          case 'comment':
            if (!b.body?.trim()) return sendJson(res, 400, { error: 'body is required' });
            return sendJson(res, 201, await host.commentOnPr(b.repo, b.number, b.body));
          case 'approve':
            if (!host.approvePr) return sendJson(res, 400, { error: 'This git host does not support approvals' });
            await host.approvePr(b.repo, b.number, b.body);
            return sendJson(res, 200, { ok: true });
          case 'merge':
            if (!host.mergePr) return sendJson(res, 400, { error: 'This git host does not support merging from SI Hive' });
            await host.mergePr(b.repo, b.number);
            return sendJson(res, 200, { ok: true });
          case 'ai-review': {
            const pr = await host.getPullRequest(b.repo, b.number);
            if (!pr) return sendJson(res, 404, { error: 'Pull request not found' });
            let review = b.body?.trim();
            if (!review) {
              if (!isLlmConfigured(config)) return sendJson(res, 400, { error: 'No AI backend configured (Settings → AI)' });
              review = await reviewPullRequest(host, b.repo, pr);
            }
            if (b.post) {
              await host.commentOnPr(b.repo, b.number, formatReviewComment(review));
              await recordPostedReview(b.connectionId!, b.repo, pr, review);
            }
            return sendJson(res, 200, { review, posted: !!b.post });
          }
        }
      } catch (e) { fail(res, e); }
    })();
    return true;
  }

  // -------------------------------------------------------------------- feeds
  if (pathname === '/api/delivery/landed' && req.method === 'GET') {
    const days = Math.min(Math.max(Number(q.get('days')) || 7, 1), 90);
    landedCommits(config, days, q.get('ai') === '1').then((feed) => sendJson(res, 200, feed)).catch((e) => fail(res, e));
    return true;
  }

  if (pathname === '/api/delivery/build-failures' && req.method === 'GET') {
    const days = Math.min(Math.max(Number(q.get('days')) || 3, 1), 30);
    buildFailures(config, days, q.get('ai') === '1').then((r) => sendJson(res, 200, r)).catch((e) => fail(res, e));
    return true;
  }

  return false;
}
