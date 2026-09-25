/**
 * Every registered migration must compile for Postgres and SQL Server, not
 * just run on SQLite. Runs each `up()` against a Kysely with a no-op driver
 * and inspects the generated DDL.
 */
import { describe, it, expect } from 'vitest';
import {
  Kysely, DummyDriver,
  PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler,
  MssqlAdapter, MssqlIntrospector, MssqlQueryCompiler,
} from 'kysely';
import '../storage/migrations-index.js';
import { listRegisteredMigrations, columnTypes, type StorageDialect } from '../../../../packages/shared/src/server/storage/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
function cold(kind: 'postgres' | 'mssql', sink: string[]): Kysely<any> {
  return new Kysely<any>({
    dialect: {
      createAdapter: () => (kind === 'postgres' ? new PostgresAdapter() : new MssqlAdapter()),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => (kind === 'postgres' ? new PostgresIntrospector(db) : new MssqlIntrospector(db)),
      createQueryCompiler: () => (kind === 'postgres' ? new PostgresQueryCompiler() : new MssqlQueryCompiler()),
    },
    log: (e) => { if (e.level === 'query') sink.push(e.query.sql); },
  });
}

const migrations = listRegisteredMigrations();

describe('migrations compile for every dialect', () => {
  it('registers migrations for all modules', () => {
    const modules = new Set(migrations.map(([n]) => n.split('/')[0]));
    for (const m of ['users', 'analytics', 'security', 'personas', 'kb', 'todo', 'workflows', 'messaging', 'delivery']) {
      expect(modules, m).toContain(m);
    }
  });

  for (const dialect of ['postgres', 'mssql'] as const) {
    it(`${dialect}: DDL is valid for the dialect`, async () => {
      const sql: string[] = [];
      const db = cold(dialect, sql);
      for (const [, m] of migrations) {
        await m.up({ db, dialect: dialect as StorageDialect, t: columnTypes(dialect) });
      }
      expect(sql.length).toBeGreaterThan(20);
      for (const statement of sql) {
        if (dialect === 'mssql') {
          expect(statement, statement).not.toMatch(/if not exists/i);
          expect(statement, statement).not.toMatch(/\bautoincrement\b|\bserial\b/i);
          // nvarchar(max) columns cannot be indexed on SQL Server
          if (/^create (unique )?index/i.test(statement)) expect(statement).not.toMatch(/max/i);
        } else {
          expect(statement, statement).not.toMatch(/\bnvarchar\b|\bidentity\b|\bautoincrement\b/i);
        }
      }
    });
  }
});
