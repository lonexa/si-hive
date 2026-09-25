---
name: hive-extend
description: Extend a Hive checkout — add a git host or ticket tracker integration (e.g. Bitbucket, Gitea, Azure Boards variants, YouTrack, ClickUp, Asana, Shortcut), a login provider, or a feature module. Triggers on "add a provider", "add an integration", "connect Hive to <service>", "support <service> in Hive", "add a Hive module", "extend Hive".
---

# Extending Hive

Hive is built to be extended through small typed interfaces. Before changing
anything, confirm the working directory is a Hive checkout (it contains
`apps/hive/server/integrations/types.ts`). If it isn't, ask the user for the
path to their Hive source.

## Adding a git host or ticket tracker

Follow `docs/extending/adding-a-provider.md` exactly. In short:

1. Read `apps/hive/server/integrations/types.ts` (the contracts) and one
   complete reference provider in `apps/hive/server/integrations/providers/`
   (GitHub for REST git+tracker, Jira or Linear for tracker-only, GitLab for
   self-hosted base URLs).
2. Research the target service's API (official docs). Prefer token auth the
   user can create themselves (personal access / API tokens).
3. Copy `apps/hive/server/integrations/_template/` to
   `apps/hive/server/integrations/providers/<id>/` and implement only the
   interfaces the service supports; set `kinds` and `capabilities` honestly.
   - Use `createHttpClient` from `integrations/http.ts` for every request.
   - Map states onto `stateCategory` (`todo` / `in_progress` / `done`).
   - `Issue.key` = what users type; `ticketRefPattern` must match it (global flag).
   - Secrets are `configSchema` fields of type `secret`; never log them.
4. Register it in `apps/hive/server/integrations/providers/index.ts`.
5. Write `apps/hive/server/integrations/__tests__/fixtures/<id>.ts` with
   realistic *fake* responses for every request the provider makes (use
   example.com / acme data), following `fixture-types.ts` and `fixtures/github.ts`.
6. Verify — both must pass before you report success:
   ```bash
   npx vitest run apps/hive/server/integrations
   npx tsc --noEmit -p apps/hive/server/tsconfig.json
   ```
7. If background git push/pull should authenticate through this provider,
   implement `matchesRemote`, `repoFromRemote`, `gitCredential`, and add the
   host's default git username to `PROVIDER_DEFAULTS` in `scripts/git-askpass.cjs`.
8. Tell the user to rebuild (`npm run build:hive`), restart Hive, and add the
   connection in Settings → Integrations (the form is generated from the schema).

## Adding a feature module

Read `docs/extending/modules.md` and copy the module template it references.
Keep the module self-contained: its routes, migrations (via
`registerMigrations` — dialect-portable, see
`packages/shared/src/server/storage/portable.ts`), and UI.

## Ground rules

- Never add organization-specific names, hosts, IDs or credentials to shared
  code. `node scripts/check-generic.mjs` must pass.
- Features must keep working when no integration is connected (`getTracker()`
  / `getGitHost()` return `null`).
- Match the surrounding code style; don't refactor unrelated code.
