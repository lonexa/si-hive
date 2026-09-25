import type { ProviderFixture } from '../fixture-types.js';

// Linear is GraphQL: every call hits the same endpoint, so the provider tags
// each request with `?op=<OperationName>` and routes match on that.
const op = (name: string) => new RegExp(`^https://api\\.linear\\.app/graphql\\?op=${name}$`);

const viewer = { id: 'user-0001', name: 'Ada Admin', displayName: 'ada', email: 'ada@example.com', avatarUrl: 'https://avatars.example/ada.png' };
const team = { id: 'team-0001', key: 'ENG' };
const issue = {
  id: 'issue-0042', identifier: 'ENG-42', title: 'Sprockets squeak', description: 'They squeak when **turned**.',
  url: 'https://linear.app/acme/issue/ENG-42/sprockets-squeak', priorityLabel: 'High',
  createdAt: '2026-09-01T09:00:00.000Z', updatedAt: '2026-09-03T09:00:00.000Z',
  state: { id: 'state-started', name: 'In Progress', type: 'started' },
  assignee: viewer, labels: { nodes: [{ id: 'label-bug', name: 'Bug' }] },
  cycle: { id: 'cycle-12', name: null, number: 12 }, team,
};
const todo = {
  ...issue, id: 'issue-0043', identifier: 'ENG-43', title: 'Document sprocket sizes', description: null,
  url: 'https://linear.app/acme/issue/ENG-43/document-sprocket-sizes',
  state: { id: 'state-todo', name: 'Todo', type: 'unstarted' }, labels: { nodes: [] }, cycle: null,
};

export const fixture: ProviderFixture = {
  providerId: 'linear',
  settings: { teamKeys: 'ENG, OPS' },
  secrets: { token: 'lin_api_test' },
  sample: { issueKey: 'ENG-42', textWithRef: 'Merged the fix for ENG-42 into main' },
  routes: [
    { method: 'POST', url: op('Viewer'), body: { data: { viewer } } },
    { method: 'POST', url: op('SearchIssues'), body: { data: { issues: { nodes: [issue, todo] } } } },
    { method: 'POST', url: op('GetIssue'), body: { data: { issue } } },
    {
      method: 'POST', url: op('ListComments'),
      body: { data: { issue: { comments: { nodes: [{ id: 'comment-1', body: 'Repro attached', createdAt: '2026-09-03T10:00:00.000Z', user: viewer }] } } } },
    },
    {
      method: 'POST', url: op('ListCycles'),
      body: {
        data: {
          teams: {
            nodes: [{
              cycles: {
                nodes: [
                  { id: 'cycle-12', name: null, number: 12, startsAt: '2026-09-14T00:00:00.000Z', endsAt: '2026-09-28T00:00:00.000Z', isActive: true },
                  { id: 'cycle-13', name: 'Polish', number: 13, startsAt: '2026-09-28T00:00:00.000Z', endsAt: '2026-10-12T00:00:00.000Z', isActive: false },
                ],
              },
            }],
          },
        },
      },
    },
  ],
};
