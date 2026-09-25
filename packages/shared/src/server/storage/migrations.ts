/**
 * Shared-database migrations.
 *
 * Each module registers its own ordered migrations under a module id:
 *
 *   registerMigrations('personas', {
 *     '001_init': { async up({ db, dialect, t }) { … } },
 *   });
 *
 * Names are stored as `<module>/<name>` in the `hive_migrations` table.
 * Migrations run at server startup (and when the storage target changes).
 * They must use the schema builder + `t` column types so they work on every
 * dialect; see ./portable.ts.
 */
import type { Kysely } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import type { SharedDb, StorageDialect } from './index.js';
import { columnTypes, type ColumnTypes } from './portable.js';

export interface MigrationContext {
  db: SharedDb;
  dialect: StorageDialect;
  t: ColumnTypes;
}

export interface HiveMigration {
  up(ctx: MigrationContext): Promise<void>;
  down?(ctx: MigrationContext): Promise<void>;
}

const registry = new Map<string, Record<string, HiveMigration>>();

export function registerMigrations(moduleId: string, migrations: Record<string, HiveMigration>): void {
  if (moduleId.includes('/')) throw new Error(`Migration module id must not contain "/": ${moduleId}`);
  registry.set(moduleId, { ...(registry.get(moduleId) ?? {}), ...migrations });
}

/** All registered migrations as `<module>/<name>` → migration (for tests/tools). */
export function listRegisteredMigrations(): Array<[string, HiveMigration]> {
  const out: Array<[string, HiveMigration]> = [];
  for (const [moduleId, migrations] of registry) {
    for (const [name, m] of Object.entries(migrations)) out.push([`${moduleId}/${name}`, m]);
  }
  return out.sort(([a], [b]) => a.localeCompare(b));
}

function provider(dialect: StorageDialect): MigrationProvider {
  const t = columnTypes(dialect);
  return {
    async getMigrations() {
      const out: Record<string, Migration> = {};
      for (const [moduleId, migrations] of registry) {
        for (const [name, m] of Object.entries(migrations)) {
          out[`${moduleId}/${name}`] = {
            up: (db: Kysely<unknown>) => m.up({ db: db as SharedDb, dialect, t }),
            down: m.down ? (db: Kysely<unknown>) => m.down!({ db: db as SharedDb, dialect, t }) : undefined,
          };
        }
      }
      return out;
    },
  };
}

export interface MigrationReport {
  applied: string[];
  error?: string;
}

/** Apply every pending registered migration. Never throws; returns what happened. */
export async function runMigrations(db: SharedDb, dialect: StorageDialect): Promise<MigrationReport> {
  const migrator = new Migrator({
    db,
    provider: provider(dialect),
    migrationTableName: 'hive_migrations',
    migrationLockTableName: 'hive_migrations_lock',
    // Modules are added over time, so a new module's migrations may sort
    // before ones that already ran.
    allowUnorderedMigrations: true,
  });
  const { error, results } = await migrator.migrateToLatest();
  const applied = (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
  return error ? { applied, error: error instanceof Error ? error.message : String(error) } : { applied };
}
