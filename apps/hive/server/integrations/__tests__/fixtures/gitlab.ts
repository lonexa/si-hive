import type { ProviderFixture } from '../fixture-types.js';

const API = 'gitlab\\.com\\/api\\/v4';
const P = 'acme%2Fplatform%2Fwidgets';

const user = { id: 11, username: 'dana', name: 'Dana Dev', email: 'dana@example.com', avatar_url: 'https://gitlab.example/avatar/dana.png', web_url: 'https://gitlab.com/dana' };
const project = {
  id: 501, name: 'Widgets', path: 'widgets', path_with_namespace: 'acme/platform/widgets', default_branch: 'main', visibility: 'private',
  web_url: 'https://gitlab.com/acme/platform/widgets', http_url_to_repo: 'https://gitlab.com/acme/platform/widgets.git',
};
const mr = {
  id: 9001, iid: 7, project_id: 501, title: 'Add sprockets', description: 'Implements sprockets', state: 'opened', draft: false,
  author: user, source_branch: 'feature/sprockets', target_branch: 'main', sha: 'abc123def456', web_url: 'https://gitlab.com/acme/platform/widgets/-/merge_requests/7',
  created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-02T10:00:00Z', reviewers: [user], labels: ['enhancement'],
};
const mergedMr = { ...mr, id: 9000, iid: 6, title: 'Fix gears', state: 'merged', web_url: 'https://gitlab.com/acme/platform/widgets/-/merge_requests/6', updated_at: '2026-08-30T10:00:00Z' };
const issue = {
  id: 7042, iid: 42, project_id: 501, title: 'Sprockets squeak', description: 'They squeak when turned.', state: 'opened',
  web_url: 'https://gitlab.com/acme/platform/widgets/-/issues/42', references: { short: '#42', relative: '#42', full: 'acme/platform/widgets#42' },
  assignee: user, assignees: [user], labels: ['bug', 'workflow::in progress'], milestone: { id: 31, title: 'Sprint 12' }, issue_type: 'issue',
  created_at: '2026-09-01T09:00:00Z', updated_at: '2026-09-03T09:00:00Z',
};

export const fixture: ProviderFixture = {
  providerId: 'gitlab',
  settings: { baseUrl: 'https://gitlab.com', issueProjects: 'acme/platform/widgets' },
  secrets: { token: 'glpat-test' },
  sample: {
    repo: 'acme/platform/widgets', prNumber: 7, buildId: '3001', issueKey: 'acme/platform/widgets#42',
    textWithRef: 'Closes acme/platform/widgets#42, see also #43',
  },
  routes: [
    { url: new RegExp(`${API}\\/user$`), body: user },
    { url: new RegExp(`${API}\\/projects\\?membership=true`), body: [project] },
    { url: new RegExp(`${API}\\/projects\\/${P}$`), body: project },
    { url: new RegExp(`${API}\\/projects\\/${P}\\/merge_requests\\?`), body: [mr, mergedMr] },
    { url: new RegExp(`${API}\\/projects\\/${P}\\/merge_requests\\/7$`), body: mr },
    // No raw_diffs route: exercises the /diffs fallback (older GitLab).
    {
      url: new RegExp(`${API}\\/projects\\/${P}\\/merge_requests\\/7\\/diffs\\?`),
      body: [
        { old_path: 'src/sprocket.ts', new_path: 'src/sprocket.ts', a_mode: '100644', b_mode: '100644', new_file: false, renamed_file: false, deleted_file: false, diff: '@@ -1,3 +1,4 @@\n export const teeth = 12;\n+export const lubricated = true;\n' },
        { old_path: 'src/new.ts', new_path: 'src/new.ts', a_mode: '0', b_mode: '100644', new_file: true, renamed_file: false, deleted_file: false, diff: '@@ -0,0 +1 @@\n+export {};\n' },
      ],
    },
    {
      url: new RegExp(`${API}\\/projects\\/${P}\\/merge_requests\\/7\\/notes`),
      body: [
        { id: 1, body: 'added 1 commit', system: true, author: user, created_at: '2026-09-02T09:00:00Z' },
        { id: 2, body: 'nit: rename this', system: false, author: user, created_at: '2026-09-02T11:00:00Z', position: { new_path: 'src/sprocket.ts', new_line: 2 } },
        { id: 3, body: 'LGTM', system: false, author: user, created_at: '2026-09-02T12:00:00Z' },
      ],
    },
    {
      url: new RegExp(`${API}\\/projects\\/${P}\\/repository\\/commits\\?`),
      body: [{
        id: 'abc123def456', short_id: 'abc123d', title: 'Fix #42', message: 'Fix #42\n\nLubricate sprockets.', author_name: 'Dana Dev', author_email: 'dana@example.com',
        authored_date: '2026-09-03T08:00:00Z', committed_date: '2026-09-03T08:00:00Z', web_url: 'https://gitlab.com/acme/platform/widgets/-/commit/abc123def456',
      }],
    },
    {
      url: new RegExp(`${API}\\/projects\\/${P}\\/pipelines\\?`),
      body: [
        { id: 3001, iid: 88, status: 'failed', ref: 'main', sha: 'abc123def456', web_url: 'https://gitlab.com/acme/platform/widgets/-/pipelines/3001', created_at: '2026-09-03T08:01:00Z', updated_at: '2026-09-03T08:05:00Z' },
        { id: 3000, iid: 87, status: 'manual', ref: 'main', sha: 'fff000', web_url: 'https://gitlab.com/acme/platform/widgets/-/pipelines/3000', created_at: '2026-09-02T08:01:00Z', updated_at: '2026-09-02T08:05:00Z' },
      ],
    },
    { url: new RegExp(`${API}\\/projects\\/${P}\\/pipelines\\/3001\\/jobs`), body: [{ id: 555, name: 'test', stage: 'test', status: 'failed' }, { id: 554, name: 'build', stage: 'build', status: 'success' }] },
    { url: new RegExp(`${API}\\/projects\\/${P}\\/jobs\\/555\\/trace`), body: 'Running tests...\n1 failed\n' },
    { url: new RegExp(`${API}\\/projects\\/${P}\\/issues\\?`), body: [issue] },
    { url: new RegExp(`${API}\\/projects\\/${P}\\/issues\\/42$`), body: issue },
    {
      url: new RegExp(`${API}\\/projects\\/${P}\\/issues\\/42\\/notes`),
      body: [
        { id: 20, body: 'changed milestone to %Sprint 12', system: true, author: user, created_at: '2026-09-03T09:30:00Z' },
        { id: 21, body: 'Repro attached', system: false, author: user, created_at: '2026-09-03T10:00:00Z' },
      ],
    },
    {
      url: new RegExp(`${API}\\/projects\\/${P}\\/milestones\\?`),
      body: [
        { id: 31, iid: 12, title: 'Sprint 12', state: 'active', start_date: '2026-01-01', due_date: '2099-01-01' },
        { id: 30, iid: 11, title: 'Sprint 11', state: 'closed', start_date: '2025-12-01', due_date: '2025-12-31' },
      ],
    },
  ],
};
