# Adding a feature module

Core SI Hive is always on: sessions, terminals, projects, AI Studio, chat, schedules
and settings. Everything else is an **optional module** that users can switch on or
off in Settings → Modules. Examples include Delivery, Knowledge, Planning,
Workflows, Search, Team and Google Workspace.

A module is ordinary code in the server and frontend, plus one entry in the module
registry that ties its pieces together.

## 1. Server

Create `apps/hive/server/<module>/`:

- **`routes.ts`** exports `registerXxxRoutes(url, req, res, config): boolean`. It
  returns `true` when it handled the request. Use `sendJson` / `readBody` from
  `packages/shared/src/server/http-utils.ts`. `req.user` is always set: it is the
  signed-in user, or the local user when login is off.
- **`migrations.ts`** (if the module stores data) calls `registerMigrations('<module>', {...})`.
  Use the dialect-portable helpers from `packages/shared/src/server/storage/`:
  `t.string(n)` for columns you filter or index, `t.text` for bodies/JSON,
  `t.timestamp` for ISO strings from `nowIso()`, `t.bool` for 0/1, and `addIdColumn`
  for identity keys. See `personas/` for a small, complete example.
- **Queries** go through `await getSharedDb()` (Kysely). Keep them portable: no
  dialect-only SQL. Use `limitRows`, `insertReturning`, `upsert` and `textContains`.
- **External services** go through `integrations/registry.ts` (`getTracker`,
  `getGitHost`) and **AI completions** through `ai/llm.ts` (`complete`,
  `isLlmConfigured`). Handle "not configured" gracefully.

Then wire it up:

1. Add `import '../<module>/migrations.js';` to `apps/hive/server/storage/migrations-index.ts`.
2. Dispatch its routes in `apps/hive/server/index.ts` next to the others (after the
   module gate).
3. Register it in `apps/hive/server/modules/registry.ts`:
   ```ts
   {
     id: 'my-module',
     name: 'My module',
     description: 'One sentence shown in Settings → Modules.',
     defaultEnabled: true,
     requires: ['llm'],                 // optional: auth | git | tracker | gitOrTracker | llm | googleOAuth
     featureKeys: ['my-module'],         // frontend feature keys it owns
     routePrefixes: ['/api/my-module/'], // answered with 404 while the module is off
   }
   ```

## 2. Frontend

1. Add pages under `apps/hive/src/components/<module>/` and lazy routes in
   `apps/hive/src/router.tsx`.
2. Add nav items to `apps/hive/src/components/layout/nav-config.ts`, each with
   `feature: '<key>'`.
3. Add the feature keys and labels to `packages/shared/src/lib/feature-roles.ts`.

`hasAccess(feature)` returns `false` for features of inactive modules, so nav items
disappear and pages can guard themselves the same way.

## 3. Checks

```bash
npx tsc --noEmit -p apps/hive/server/tsconfig.json
npm -w apps/hive run type-check
npx vitest run            # add apps/hive/server/__tests__/storage-<module>.test.ts for your tables
node scripts/check-generic.mjs
```

Tip: SI Hive installs a `hive-extend` skill. Ask Claude Code in your SI Hive checkout to
*"add a module that …"* and it follows this guide.
