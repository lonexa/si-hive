/**
 * Dialect-portable conventions for the shared database.
 *
 * The same queries run on SQLite, Postgres and SQL Server, so modules follow
 * a few rules:
 *
 *  - **Timestamps are ISO-8601 strings** (`nowIso()`), stored in `t.timestamp`
 *    (varchar) columns. They sort and compare correctly as text everywhere.
 *  - **Booleans are integers** 0/1 (`t.bool`); convert at the edges.
 *  - **JSON is text** (`t.text`); parse/stringify in the module.
 *  - Columns you filter, join or index on use `t.string(n)`, not `t.text`
 *    (SQL Server cannot index nvarchar(max)).
 *  - Auto-increment ids via `addIdColumn`; read them back with
 *    `insertReturning` (RETURNING / OUTPUT INSERTED).
 *  - Row limits via `limitRows` (LIMIT vs TOP), upserts via `upsert`,
 *    case-insensitive search via `textContains`.
 */
import { sql, type Kysely, type CreateTableBuilder, type ColumnDataType, type Expression, type RawBuilder, type SqlBool } from 'kysely';

type DataTypeExpression = ColumnDataType | Expression<unknown>;
import type { StorageDialect } from './index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function nowIso(): string {
  return new Date().toISOString();
}

/** Column types for migrations, resolved per dialect. */
export interface ColumnTypes {
  /** Unbounded text (not indexable on SQL Server). */
  text: DataTypeExpression;
  /** Bounded string — use for anything filtered, joined or indexed. */
  string(length?: number): DataTypeExpression;
  integer: DataTypeExpression;
  bigint: DataTypeExpression;
  /** 0/1 integer. */
  bool: DataTypeExpression;
  /** ISO-8601 timestamp string (see nowIso). */
  timestamp: DataTypeExpression;
  real: DataTypeExpression;
}

export function columnTypes(dialect: StorageDialect): ColumnTypes {
  const mssql = dialect === 'mssql';
  return {
    text: mssql ? sql`nvarchar(max)` : 'text',
    string: (length = 255) => (mssql ? sql`nvarchar(${sql.raw(String(length))})` : sql`varchar(${sql.raw(String(length))})`),
    integer: 'integer',
    bigint: 'bigint',
    bool: 'integer',
    timestamp: mssql ? sql`nvarchar(40)` : sql`varchar(40)`,
    real: mssql ? sql`float` : 'real',
  };
}

/** Adds an auto-incrementing integer primary key named `id` (or `name`). */
export function addIdColumn<TB extends string, C extends string>(
  tb: CreateTableBuilder<TB, C>,
  dialect: StorageDialect,
  name = 'id',
): CreateTableBuilder<TB, C | string> {
  if (dialect === 'postgres') return tb.addColumn(name, 'serial', (c) => c.primaryKey());
  if (dialect === 'mssql') return tb.addColumn(name, 'integer', (c) => c.primaryKey().identity());
  return tb.addColumn(name, 'integer', (c) => c.primaryKey().autoIncrement());
}

/** INSERT … and return the inserted row (RETURNING * / OUTPUT INSERTED.*). */
export async function insertReturning<T = any>(
  db: Kysely<any>,
  dialect: StorageDialect,
  table: string,
  values: Record<string, unknown>,
): Promise<T> {
  const q = db.insertInto(table).values(values as any);
  const row = dialect === 'mssql'
    ? await (q as any).outputAll('inserted').executeTakeFirstOrThrow()
    : await q.returningAll().executeTakeFirstOrThrow();
  return row as T;
}

/** UPDATE … WHERE <where> and return the first updated row, or null. */
export async function updateReturning<T = any>(
  db: Kysely<any>,
  dialect: StorageDialect,
  table: string,
  set: Record<string, unknown>,
  where: Record<string, unknown>,
): Promise<T | null> {
  let q: any = db.updateTable(table).set(set as any);
  for (const [k, v] of Object.entries(where)) q = q.where(k, '=', v);
  const row = dialect === 'mssql'
    ? await q.outputAll('inserted').executeTakeFirst()
    : await q.returningAll().executeTakeFirst();
  return (row as T) ?? null;
}

/** Apply a row limit: LIMIT n (sqlite/postgres) or TOP n (SQL Server). */
export function limitRows<QB>(qb: QB, dialect: StorageDialect, n: number): QB {
  const q = qb as any;
  return (dialect === 'mssql' ? q.top(n) : q.limit(n)) as QB;
}

/**
 * Apply limit + offset. SQL Server requires an ORDER BY on the query for
 * OFFSET/FETCH — callers must add one.
 */
export function pageRows<QB>(qb: QB, dialect: StorageDialect, limit: number, offset: number): QB {
  const q = qb as any;
  if (dialect === 'mssql') return q.offset(offset).fetch(limit) as QB;
  return q.limit(limit).offset(offset) as QB;
}

/**
 * Update-then-insert upsert keyed on `key` columns. Portable (no ON CONFLICT
 * / MERGE); fine for Hive's low write concurrency. Returns 'inserted' or
 * 'updated'.
 */
export async function upsert(
  db: Kysely<any>,
  table: string,
  key: Record<string, unknown>,
  values: Record<string, unknown>,
  insertOnly: Record<string, unknown> = {},
): Promise<'inserted' | 'updated'> {
  return db.transaction().execute(async (trx) => {
    let q: any = trx.updateTable(table).set(values as any);
    for (const [k, v] of Object.entries(key)) q = q.where(k, '=', v);
    const res = await q.executeTakeFirst();
    if (Number(res?.numUpdatedRows ?? 0) > 0) return 'updated';
    await trx.insertInto(table).values({ ...key, ...values, ...insertOnly } as any).execute();
    return 'inserted';
  });
}

/** `%term%` with LIKE wildcards in `term` escaped with a backslash (pair with ESCAPE). */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_[]/g, (c) => `\\${c}`)}%`;
}

/**
 * Case-insensitive "column contains term" condition, wildcard-safe on every
 * dialect (ILIKE on Postgres; LIKE … ESCAPE elsewhere — SQLite and SQL Server
 * default collations are case-insensitive).
 */
export function textContains(column: string, term: string, dialect: StorageDialect): RawBuilder<SqlBool> {
  const op = dialect === 'postgres' ? sql`ilike` : sql`like`;
  return sql<SqlBool>`${sql.ref(column)} ${op} ${likePattern(term)} escape '\\'`;
}

/** Number of rows affected by an update/delete result. */
export function affectedRows(result: { numUpdatedRows?: bigint; numDeletedRows?: bigint } | undefined): number {
  return Number(result?.numUpdatedRows ?? result?.numDeletedRows ?? 0);
}
