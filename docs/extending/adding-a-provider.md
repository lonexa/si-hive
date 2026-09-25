# Adding a git host or ticket tracker

SI Hive talks to external services only through two interfaces in
`apps/hive/server/integrations/types.ts`:

| Interface | Used for |
|-----------|----------|
| `GitHostProvider` | repos, pull/merge requests, reviews, commits, CI builds, source archives (updater) |
| `TrackerProvider` | issues/tickets: search, detail, create, update/transition, comments, iterations/sprints |

A **provider** is a folder in `apps/hive/server/integrations/providers/<id>/` whose
`index.ts` exports an `IntegrationProviderDefinition`. It can implement either
interface or both (GitHub and GitLab do both; Jira and Linear are trackers only).

Features never import a provider directly. They ask the registry
(`integrations/registry.ts`: `getTracker`, `getGitHost`, `getAllGitHosts`) and handle
`null`, so adding a provider needs **no feature or UI changes**. Settings →
Integrations builds its form from your `configSchema`.

## Steps

1. **Copy the template**: `apps/hive/server/integrations/_template/` →
   `providers/<id>/`. Pick a stable lowercase `id` — it's stored in users' config and
   in credential refs (`integration:<connectionId>:<field>`).
2. **Declare settings** in `configSchema`. Fields of type `secret` go to the encrypted
   credential store and reach your code as `ctx.secrets.<key>`. Everything else
   arrives as `ctx.settings.<key>`.
3. **Implement the interface(s).** Use `createHttpClient` from `integrations/http.ts`
   for every request. It handles JSON, timeouts and readable errors, and it goes through
   the global `fetch` that the tests mock. Map the service's data onto the normalized
   models:
   - `Issue.key` is what humans type (`ABC-123`, `owner/repo#7`, `123`), and
     `ticketRefPattern` must match it in free text (terminal output, commits).
   - `Issue.stateCategory` must be `todo`, `in_progress` or `done`. Map workflow states
     here so features never hardcode state names.
   - Advertise only what you implement in `capabilities`. The UI hides the rest (for
     example, sprint views need `iterations`).
4. **Register it** in `providers/index.ts`.
5. **Add a fixture** at `integrations/__tests__/fixtures/<id>.ts`. Supply canned
   responses for the requests your provider makes, plus sample ids (see
   `fixture-types.ts` and `fixtures/github.ts`).
6. **Run the contract suite:**
   ```bash
   npx vitest run apps/hive/server/integrations
   npx tsc --noEmit -p apps/hive/server/tsconfig.json
   ```
7. *(Optional)* To let background git operations authenticate, implement
   `matchesRemote`, `repoFromRemote` and `gitCredential`, and add your host's default
   username to `PROVIDER_DEFAULTS` in `scripts/git-askpass.cjs`.

## Asking an AI to do it

SI Hive installs a `hive-extend` skill into Claude Code. In a session opened on your
SI Hive checkout, ask something like *"Add a Bitbucket Cloud provider for code hosting"*,
and it follows these steps, including the fixture and the contract test run.

## Reference implementations

- `providers/github`: git host and tracker (REST)
- `providers/gitlab`: git host and tracker, self-hosted base URL
- `providers/azure-devops`: git host and tracker, work-item state categories
- `providers/jira`: tracker, ADF descriptions, transitions
- `providers/linear`: tracker, GraphQL
