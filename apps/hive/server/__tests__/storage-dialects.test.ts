/**
 * Compile-only checks for the Postgres and SQL Server dialects (no server
 * needed): the portable helpers must produce valid dialect-specific SQL.
 */
import { describe, it, expect } from 'vitest';
import {
  Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler,
  MssqlAdapter, MssqlIntrospector, MssqlQueryCompiler, DummyDriver,
} from 'kysely';
import { limitRows, textContains, columnTypes, addIdColumn } from '../../../../packages/shared/src/server/storage/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
function cold(kind: 'postgres' | 'mssql'): Kysely<any> {
  return new Kysely<any>({
    dialect: {
      createAdapter: () => (kind === 'postgres' ? new PostgresAdapter() : new MssqlAdapter()),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => (kind === 'postgres' ? new PostgresIntrospector(db) : new MssqlIntrospector(db)),
      createQueryCompiler: () => (kind === 'postgres' ? new PostgresQueryCompiler() : new MssqlQueryCompiler()),
    },
  });
}

describe('portable SQL', () => {
  it('limits with LIMIT on postgres and TOP on mssql', () => {
    const pg = limitRows(cold('postgres').selectFrom('t').selectAll(), 'postgres', 5).compile();
    expect(pg.sql).toMatch(/limit \$1/i);
    const ms = limitRows(cold('mssql').selectFrom('t').selectAll(), 'mssql', 5).compile();
    expect(ms.sql).toMatch(/select top\(5\)/i);
  });

  it('textContains uses ILIKE on postgres and LIKE ESCAPE on mssql', () => {
    const pg = cold('postgres').selectFrom('t').selectAll().where(textContains('name', 'a%b', 'postgres')).compile();
    expect(pg.sql).toMatch(/"name" ilike \$1 escape/i);
    expect(pg.parameters[0]).toBe(String.raw`%a\%b%`);
    const ms = cold('mssql').selectFrom('t').selectAll().where(textContains('name', 'x', 'mssql')).compile();
    expect(ms.sql).toMatch(/"name" like @1 escape/i);
  });

  it('builds identity/serial id columns and nvarchar text on mssql', () => {
    const t = columnTypes('mssql');
    const ms = addIdColumn(cold('mssql').schema.createTable('x'), 'mssql').addColumn('body', t.text).compile();
    expect(ms.sql).toMatch(/identity/i);
    expect(ms.sql).toMatch(/nvarchar\(max\)/i);
    const pg = addIdColumn(cold('postgres').schema.createTable('x'), 'postgres').compile();
    expect(pg.sql).toMatch(/serial primary key/i);
  });
});
