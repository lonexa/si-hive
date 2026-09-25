# SI Hive (generic framework)

Generic, installable SI Hive (Superintelligence Hive), forked from the original Hive. **No organization-specific code** — no company names, internal hosts, tenant/client IDs, customer products, or business pipelines. `node scripts/check-generic.mjs` enforces this; keep it passing.

## Monorepo

```
apps/hive/server/        Node server (HTTP + WS, PTY, watchers, routes)
  integrations/          Git-host + tracker provider contracts, registry, providers/
  providers/             AI CLI providers (claude / codex / gemini)
  auth/                  Login (optional)
apps/hive/src/           React frontend
packages/shared/src/     UI kit, brand.ts, server/{paths,credentials,…}
installer/               NSIS (Windows) + mac bundle
scripts/                 service install, startup, git-askpass, check-generic
```

## Dev commands

```bash
npm run build:hive                                   # bumps patch version + vite build (port serves built files)
npx tsc --noEmit -p apps/hive/server/tsconfig.json   # server typecheck
npm -w apps/hive run type-check                      # frontend typecheck
node scripts/check-generic.mjs                       # no org-specific identifiers
```

Run a dev server **isolated from any installed SI Hive** on this machine:

```bash
HIVE_HOME=<scratch dir> HIVE_PORT=4545 HIVE_SKIP_BUNDLED_SKILLS=1 npx tsx apps/hive/server/index.ts
```

- `HIVE_HOME` keeps config/DB/credentials out of `~/.hive`.
- Port **4545** = dev. Installed default = **4747**. Never touch other ports — another SI Hive may be installed on this machine.
- The frontend is served from the last build; run `npm run build:hive` after frontend changes.

## Conventions

- **Data paths**: always `hiveHome()` / `hivePath()` from `packages/shared/src/server/paths.ts` — never `os.homedir() + '.hive'`.
- **Secrets**: `packages/shared/src/server/credentials.ts` (`setSecret` / `getSecret`), never config.json. Refs look like `integration:<connectionId>:<field>`.
- **External services**: features talk to git hosts / trackers only via `integrations/registry.ts` (`getTracker`, `getGitHost`, `getAllGitHosts`) and must handle `null` (nothing connected is a normal state).
- **Config**: `config.ts` preserves unknown top-level keys; module settings get their own top-level key.
- **Security**: the server checks Host/Origin on HTTP and WebSocket upgrades; with login off it binds to loopback. Don't add endpoints that bypass `handleRequest`.
- **Routes**: domain route files export `registerXxxRoutes(url, req, res, …): boolean`, dispatched from `server/index.ts`.
- **Commits**: write multi-line messages to a file and `git commit -F <file>`.
