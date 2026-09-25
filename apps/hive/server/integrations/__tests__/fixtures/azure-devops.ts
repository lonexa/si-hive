import type { ProviderFixture } from '../fixture-types.js';

const ORG = 'dev\\.azure\\.com\\/acme';
const GIT = `${ORG}\\/Widgets\\/_apis\\/git\\/repositories`;
const WIT = `${ORG}\\/Widgets\\/_apis\\/wit`;

const me = { id: '6f1d2c3b-0000-4000-8000-000000000001', displayName: 'Dana Dev', uniqueName: 'dana@example.com', imageUrl: 'https://dev.azure.com/acme/_apis/GraphProfile/MemberAvatars/dana' };
const project = { id: 'a1b2c3d4-0000-4000-8000-000000000010', name: 'Widgets', visibility: 'private' };
const repo = {
  id: 'r0000000-0000-4000-8000-000000000020', name: 'widgets-api', defaultBranch: 'refs/heads/main', project,
  webUrl: 'https://dev.azure.com/acme/Widgets/_git/widgets-api', remoteUrl: 'https://acme@dev.azure.com/acme/Widgets/_git/widgets-api',
};
const pr = {
  pullRequestId: 7, title: 'Add sprockets', description: 'Implements sprockets', status: 'active', isDraft: false,
  createdBy: me, creationDate: '2026-09-01T10:00:00Z', sourceRefName: 'refs/heads/feature/sprockets', targetRefName: 'refs/heads/main',
  reviewers: [{ ...me, vote: 0 }], labels: [{ name: 'enhancement', active: true }],
  lastMergeSourceCommit: { commitId: 'abc123def456' }, repository: { id: repo.id, name: repo.name, project },
};
const abandonedPr = { ...pr, pullRequestId: 6, title: 'Old approach', status: 'abandoned', closedDate: '2026-08-20T10:00:00Z' };

const workItem = {
  id: 42, rev: 5,
  fields: {
    'System.WorkItemType': 'Task', 'System.State': 'Doing', 'System.Title': 'Sprockets squeak',
    'System.Description': '<div>They squeak when turned.</div><ul><li>Step one</li></ul><p>See <a href="https://example.com/spec">spec</a> &amp; notes</p>',
    'System.AssignedTo': me, 'System.Tags': 'bug; hardware', 'Microsoft.VSTS.Common.Priority': 2,
    'System.IterationPath': 'Widgets\\Sprint 12', 'System.CreatedDate': '2026-09-01T09:00:00Z', 'System.ChangedDate': '2026-09-03T09:00:00Z',
  },
  _links: { html: { href: 'https://dev.azure.com/acme/Widgets/_workitems/edit/42' } },
};

export const fixture: ProviderFixture = {
  providerId: 'azure-devops',
  settings: { organizationUrl: 'https://dev.azure.com/acme', project: 'Widgets', team: 'Widgets Team' },
  secrets: { token: 'ado-pat-test' },
  sample: { repo: 'widgets-api', prNumber: 7, buildId: '3001', issueKey: '42', textWithRef: 'Fixes AB#42 (see also #43)' },
  routes: [
    { url: new RegExp(`${ORG}\\/_apis\\/connectionData`), body: { authenticatedUser: { id: me.id, providerDisplayName: me.displayName, properties: { Account: { $type: 'System.String', $value: me.uniqueName } } } } },

    // Git
    { url: new RegExp(`${GIT}\\?`), body: { value: [repo, { ...repo, id: 'r-disabled', name: 'legacy', isDisabled: true }], count: 2 } },
    { url: new RegExp(`${GIT}\\/widgets-api\\?`), body: repo },
    { url: new RegExp(`${GIT}\\/widgets-api\\/pullrequests\\?`), body: { value: [pr, abandonedPr], count: 2 } },
    { url: new RegExp(`${GIT}\\/widgets-api\\/pullrequests\\/7\\?`), body: pr },
    { url: new RegExp(`${GIT}\\/widgets-api\\/pullrequests\\/7\\/iterations\\?`), body: { value: [{ id: 1 }, { id: 2 }], count: 2 } },
    {
      url: new RegExp(`${GIT}\\/widgets-api\\/pullrequests\\/7\\/iterations\\/2\\/changes\\?`),
      body: {
        changeEntries: [
          { changeTrackingId: 1, changeType: 'edit', item: { path: '/src/sprocket.ts' } },
          { changeTrackingId: 2, changeType: 'add', item: { path: '/src/new.ts' } },
          { changeTrackingId: 3, changeType: 'rename', item: { path: '/src/gear.ts' }, originalPath: '/src/cog.ts' },
          { changeTrackingId: 4, changeType: 'add', item: { path: '/src', isFolder: true } },
        ],
      },
    },
    {
      url: new RegExp(`${GIT}\\/widgets-api\\/pullrequests\\/7\\/threads\\?`),
      body: {
        value: [
          { id: 100, isDeleted: false, comments: [{ id: 1, content: 'Dana Dev voted 10', commentType: 'system', author: me, publishedDate: '2026-09-02T09:00:00Z' }] },
          { id: 101, isDeleted: false, threadContext: { filePath: '/src/sprocket.ts', rightFileStart: { line: 2, offset: 1 } }, comments: [{ id: 1, content: 'nit: rename this', commentType: 'text', author: me, publishedDate: '2026-09-02T11:00:00Z' }] },
          { id: 102, isDeleted: false, comments: [{ id: 1, content: 'LGTM', commentType: 'text', author: me, publishedDate: '2026-09-02T12:00:00Z' }] },
        ],
      },
    },
    {
      url: new RegExp(`${GIT}\\/widgets-api\\/commits\\?`),
      body: {
        value: [{
          commitId: 'abc123def456', comment: 'Fix AB#42', author: { name: 'Dana Dev', email: 'dana@example.com', date: '2026-09-03T08:00:00Z' },
          committer: { name: 'Dana Dev', email: 'dana@example.com', date: '2026-09-03T08:00:00Z' }, remoteUrl: 'https://dev.azure.com/acme/Widgets/_git/widgets-api/commit/abc123def456',
        }],
      },
    },

    // Builds
    {
      url: new RegExp(`${ORG}\\/Widgets\\/_apis\\/build\\/builds\\?`),
      body: {
        value: [
          { id: 3001, buildNumber: '20260903.1', status: 'completed', result: 'failed', definition: { id: 5, name: 'widgets-ci' }, sourceBranch: 'refs/heads/main', sourceVersion: 'abc123def456', queueTime: '2026-09-03T08:00:30Z', startTime: '2026-09-03T08:01:00Z', finishTime: '2026-09-03T08:05:00Z', _links: { web: { href: 'https://dev.azure.com/acme/Widgets/_build/results?buildId=3001' } } },
          { id: 3002, buildNumber: '20260903.2', status: 'inProgress', definition: { id: 5, name: 'widgets-ci' }, sourceBranch: 'refs/heads/main', sourceVersion: 'abc123def456', queueTime: '2026-09-03T09:00:00Z', startTime: '2026-09-03T09:00:10Z' },
        ],
      },
    },
    {
      url: new RegExp(`${ORG}\\/Widgets\\/_apis\\/build\\/builds\\/3001\\/timeline`),
      body: { records: [{ id: 't1', name: 'Run tests', type: 'Task', order: 3, state: 'completed', result: 'failed', log: { id: 9 } }] },
    },
    { url: new RegExp(`${ORG}\\/Widgets\\/_apis\\/build\\/builds\\/3001\\/logs\\/9`), body: '##[error]1 test failed\n' },

    // Boards
    { method: 'POST', url: new RegExp(`${WIT}\\/wiql\\?`), body: { queryType: 'flat', workItems: [{ id: 42, url: 'https://dev.azure.com/acme/_apis/wit/workItems/42' }] } },
    {
      url: new RegExp(`${WIT}\\/workitemtypes\\?`),
      body: {
        value: [
          { name: 'Task', isDisabled: false, states: [{ name: 'To Do', category: 'Proposed' }, { name: 'Doing', category: 'InProgress' }, { name: 'Done', category: 'Completed' }, { name: 'Removed', category: 'Removed' }] },
          { name: 'Bug', isDisabled: false, states: [{ name: 'New', category: 'Proposed' }, { name: 'Active', category: 'InProgress' }, { name: 'Resolved', category: 'Resolved' }, { name: 'Closed', category: 'Completed' }] },
        ],
      },
    },
    { url: new RegExp(`${WIT}\\/workitems\\?ids=`), body: { count: 1, value: [workItem] } },
    { url: new RegExp(`${WIT}\\/workitems\\/42\\?`), body: workItem },
    {
      url: new RegExp(`${WIT}\\/workItems\\/42\\/comments\\?`),
      body: { totalCount: 1, count: 1, comments: [{ id: 301, workItemId: 42, text: '<p>Repro attached</p>', createdBy: me, createdDate: '2026-09-03T10:00:00Z' }] },
    },
    {
      url: new RegExp(`${ORG}\\/Widgets\\/Widgets%20Team\\/_apis\\/work\\/teamsettings\\/iterations\\?`),
      body: {
        value: [
          { id: 'i0000000-0000-4000-8000-000000000011', name: 'Sprint 11', path: 'Widgets\\Sprint 11', attributes: { startDate: '2026-08-17T00:00:00Z', finishDate: '2026-08-28T00:00:00Z', timeFrame: 'past' } },
          { id: 'i0000000-0000-4000-8000-000000000012', name: 'Sprint 12', path: 'Widgets\\Sprint 12', attributes: { startDate: '2026-08-31T00:00:00Z', finishDate: '2026-09-11T00:00:00Z', timeFrame: 'current' } },
        ],
      },
    },
  ],
};
