import type { ProviderFixture } from '../fixture-types.js';

const user = { login: 'octo', id: 1, name: 'Octo Cat', avatar_url: 'https://avatars.example/octo' };
const repo = {
  id: 10, name: 'widgets', full_name: 'acme/widgets', default_branch: 'main', private: false,
  html_url: 'https://github.com/acme/widgets', clone_url: 'https://github.com/acme/widgets.git',
};
const pr = {
  id: 100, number: 7, title: 'Add sprockets', body: 'Implements sprockets', state: 'open', draft: false, merged_at: null,
  user, head: { ref: 'feature/sprockets' }, base: { ref: 'main' }, html_url: 'https://github.com/acme/widgets/pull/7',
  created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-02T10:00:00Z', requested_reviewers: [], labels: [{ name: 'enhancement' }],
};
const issue = {
  id: 200, number: 42, title: 'Sprockets squeak', body: 'They squeak when turned.', state: 'open',
  url: 'https://api.github.com/repos/acme/widgets/issues/42', html_url: 'https://github.com/acme/widgets/issues/42',
  assignee: user, labels: [{ name: 'bug' }, { name: 'in progress' }], milestone: { title: 'v1.2' },
  created_at: '2026-09-01T09:00:00Z', updated_at: '2026-09-03T09:00:00Z',
};

export const fixture: ProviderFixture = {
  providerId: 'github',
  settings: { baseUrl: 'https://github.com', issueRepos: 'acme/widgets' },
  secrets: { token: 'ghp_test' },
  sample: { repo: 'acme/widgets', prNumber: 7, buildId: '900', issueKey: 'acme/widgets#42', textWithRef: 'fixed in acme/widgets#42 and #43' },
  routes: [
    { url: /api\.github\.com\/user$/, body: user },
    { url: /\/user\/repos\?/, body: [repo] },
    { url: /\/repos\/acme\/widgets$/, body: repo },
    { url: /\/repos\/acme\/widgets\/pulls\?/, body: [pr] },
    { url: /\/repos\/acme\/widgets\/pulls\/7$/, body: pr },
    { url: /\/repos\/acme\/widgets\/pulls\/7\/comments/, body: [{ id: 2, user, body: 'nit', created_at: '2026-09-02T11:00:00Z', path: 'a.ts', line: 3 }] },
    { url: /\/repos\/acme\/widgets\/issues\/7\/comments/, body: [{ id: 1, user, body: 'LGTM', created_at: '2026-09-02T12:00:00Z' }] },
    { url: /\/repos\/acme\/widgets\/commits\?/, body: [{ sha: 'abc123', html_url: 'https://github.com/acme/widgets/commit/abc123', author: user, commit: { message: 'Fix #42', author: { name: 'Octo', email: 'o@example.com', date: '2026-09-03T08:00:00Z' } } }] },
    { url: /\/repos\/acme\/widgets\/actions\/runs\?/, body: { workflow_runs: [{ id: 900, name: 'CI', status: 'completed', conclusion: 'failure', head_branch: 'main', head_sha: 'abc123', html_url: 'https://github.com/acme/widgets/actions/runs/900', created_at: '2026-09-03T08:01:00Z', updated_at: '2026-09-03T08:05:00Z' }] } },
    { url: /\/search\/issues\?/, body: { items: [issue] } },
    { url: /\/repos\/acme\/widgets\/issues\/42$/, body: issue },
    { url: /\/repos\/acme\/widgets\/issues\/42\/comments/, body: [{ id: 3, user, body: 'Repro attached', created_at: '2026-09-03T10:00:00Z' }] },
    { url: /\/repos\/acme\/widgets\/milestones\?/, body: [{ id: 5, number: 1, title: 'v1.2', state: 'open', due_on: '2099-01-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z' }] },
  ],
};
