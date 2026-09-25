/**
 * Storage adapter.
 *
 * Hive keeps two logical databases:
 *
 *   - **local**  — always SQLite at `$HIVE_HOME/hive.db`, owned by
 *                  apps/hive/server/db.ts (sessions, queues, schedules, …).
 *   - **shared** — everything that *can* be shared between users (KB,
 *                  personas, todos, workflows, messaging, users, …).
 *                  Defaults to SQLite at `$HIVE_HOME/shared.db`, so a
 *                  single-user install needs nothing. Team installs point it
 *                  at Postgres or SQL Server in Settings → Storage
 *                  (`config.storage.shared`), password in the credential store.
 *
 * Feature code talks to the shared DB only through `getSharedDb()` (a Kysely
 * instance) and must stay dialect-portable — see ./portable.ts for the
 * conventions and helpers (ids, text columns, upsert, limit).
 */
import fs from 'node:fs';
import { Kysely, SqliteDialect, PostgresDialect, MssqlDialect, type Dialect } from 'kysely';
import { hivePath } from '../paths.js';
import { getSecret } from '../credentials.js';

export type StorageDialect = 'sqlite' | 'postgres' | 'mssql';

export interface SharedStorageConfig {
  type: StorageDialect;
  /** sqlite: file path (defaults to $HIVE_HOME/shared.db). */
  file?: string;
  /** postgres / mssql */
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  /** postgres: `require` enables TLS. mssql: encrypt the connection. */
  ssl?: boolean;
  /** mssql: accept self-signed server certificates. */
  trustServerCertificate?: boolean;
}

export const SHARED_DB_PASSWORD_REF = 'storage:shared:password';

// Kysely<any>: tables are defined by module migrations, not a central type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SharedDb = Kysely<any>;

let shared: { db: SharedDb; dialect: StorageDialect; signature: string } | null = null;

/** Read `storage.shared` from the Hive config (default: local SQLite). */
export function readSharedStorageConfig(): SharedStorageConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(hivePath('config.json'), 'utf-8')) as { storage?: { shared?: SharedStorageConfig } };
    const cfg = raw.storage?.shared;
    if (cfg?.type === 'postgres' || cfg?.type === 'mssql' || cfg?.type === 'sqlite') return cfg;
  } catch { /* no config yet */ }
  return { type: 'sqlite' };
}

export async function createDialect(cfg: SharedStorageConfig, password = getSecret(SHARED_DB_PASSWORD_REF)): Promise<Dialect> {
  switch (cfg.type) {
    case 'sqlite': {
      const { default: Database } = await import('better-sqlite3');
      const file = cfg.file || hivePath('shared.db');
      fs.mkdirSync(hivePath(), { recursive: true });
      const database = new Database(file);
      database.pragma('journal_mode = WAL');
      database.pragma('foreign_keys = ON');
      return new SqliteDialect({ database });
    }
    case 'postgres': {
      const { default: pg } = await import('pg');
      return new PostgresDialect({
        pool: new pg.Pool({
          host: cfg.host,
          port: cfg.port ?? 5432,
          database: cfg.database,
          user: cfg.user,
          password,
          ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
          max: 10,
        }),
      });
    }
    case 'mssql': {
      const tedious = await import('tedious');
      const tarn = await import('tarn');
      return new MssqlDialect({
        tarn: { ...tarn, options: { min: 0, max: 10 } },
        tedious: {
          ...tedious,
          connectionFactory: () => new tedious.Connection({
            server: cfg.host ?? 'localhost',
            authentication: { type: 'default', options: { userName: cfg.user, password } },
            options: {
              database: cfg.database,
              port: cfg.port ?? 1433,
              encrypt: cfg.ssl ?? true,
              trustServerCertificate: cfg.trustServerCertificate ?? false,
            },
          }),
        },
      });
    }
  }
}

/**
 * The shared database. Built lazily and rebuilt if the storage settings
 * change. Migrations must have run (see ./migrations.ts) before feature code
 * queries it — the server does that at startup.
 */
export async function getSharedDb(): Promise<SharedDb> {
  const cfg = readSharedStorageConfig();
  const signature = JSON.stringify(cfg);
  if (shared && shared.signature === signature) return shared.db;
  if (shared) await shared.db.destroy().catch(() => {});
  const db: SharedDb = new Kysely({ dialect: await createDialect(cfg) });
  shared = { db, dialect: cfg.type, signature };
  return db;
}

export function getSharedDialect(): StorageDialect {
  return shared?.dialect ?? readSharedStorageConfig().type;
}

export async function closeSharedDb(): Promise<void> {
  if (shared) {
    await shared.db.destroy().catch(() => {});
    shared = null;
  }
}

/** Connect with the given settings and run a trivial query. For Settings → Storage "Test". */
export async function testStorageConnection(cfg: SharedStorageConfig, password?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let db: SharedDb | null = null;
  try {
    db = new Kysely({ dialect: await createDialect(cfg, password ?? getSecret(SHARED_DB_PASSWORD_REF)) });
    const { sql } = await import('kysely');
    await sql`select 1 as ok`.execute(db);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await db?.destroy().catch(() => {});
  }
}

export * from './portable.js';
export * from './migrations.js';
