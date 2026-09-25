import type { ProviderFixture } from '../fixture-types.js';

const site = 'https://acme.atlassian.net';
const user = {
  accountId: '5b10ac8d82e05b22cc7d4ef5', displayName: 'Ada Admin', emailAddress: 'ada@example.com',
  avatarUrls: { '48x48': 'https://avatars.example/ada-48.png' },
};
const status = (name: string, key: string, catName: string) => ({ name, statusCategory: { key, name: catName } });
const adf = (text: string) => ({
  type: 'doc', version: 1,
  content: [
    { type: 'paragraph', content: [{ type: 'text', text }, { type: 'text', text: ' urgently', marks: [{ type: 'strong' }] }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'turn left' }] }] }] },
    { type: 'codeBlock', attrs: { language: 'sh' }, content: [{ type: 'text', text: 'npm test' }] },
  ],
});
const issue = {
  id: '10042', key: 'ACME-42', self: `${site}/rest/api/3/issue/10042`,
  fields: {
    summary: 'Sprockets squeak', description: adf('They squeak when turned'),
    status: status('In Progress', 'indeterminate', 'In Progress'), issuetype: { name: 'Bug' },
    assignee: user, labels: ['backend'], priority: { name: 'High' },
    created: '2026-09-01T09:00:00.000+0000', updated: '2026-09-03T09:00:00.000+0000',
    customfield_10020: [{ id: 31, name: 'Sprint 12', state: 'active', boardId: 7 }],
  },
};
const todo = {
  id: '10043', key: 'ACME-43', self: `${site}/rest/api/3/issue/10043`,
  fields: {
    summary: 'Document sprocket sizes', description: null,
    status: status('To Do', 'new', 'To Do'), issuetype: { name: 'Task' },
    assignee: user, labels: [], priority: { name: 'Medium' },
    created: '2026-09-02T09:00:00.000+0000', updated: '2026-09-02T10:00:00.000+0000',
  },
};

export const fixture: ProviderFixture = {
  providerId: 'jira',
  settings: { siteUrl: site, email: 'ada@example.com', projectKeys: 'ACME, OPS', defaultIssueType: 'Task', boardId: '7' },
  secrets: { token: 'atlassian-test-token' },
  sample: { issueKey: 'ACME-42', textWithRef: 'fix(sprockets): stop squeaking (ACME-42)' },
  routes: [
    { url: /\/rest\/api\/3\/myself$/, body: user },
    { method: 'POST', url: /\/rest\/api\/3\/search\/jql$/, body: { issues: [issue, todo], isLast: true } },
    { url: /\/rest\/api\/3\/issue\/ACME-42\?fields=/, body: issue },
    {
      url: /\/rest\/api\/3\/issue\/ACME-42\/comment\?/,
      body: { startAt: 0, maxResults: 100, total: 1, comments: [{ id: '20001', author: user, body: adf('Repro attached'), created: '2026-09-03T10:00:00.000+0000' }] },
    },
    {
      url: /\/rest\/agile\/1\.0\/board\/7\/sprint\?/,
      body: {
        maxResults: 50, startAt: 0, isLast: true,
        values: [
          { id: 30, name: 'Sprint 11', state: 'closed', startDate: '2026-08-10T00:00:00.000Z', endDate: '2026-08-24T00:00:00.000Z' },
          { id: 31, name: 'Sprint 12', state: 'active', startDate: '2026-09-14T00:00:00.000Z', endDate: '2026-09-28T00:00:00.000Z' },
          { id: 32, name: 'Sprint 13', state: 'future' },
        ],
      },
    },
  ],
};
