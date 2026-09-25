import { sql } from 'kysely';
import {
  getSharedDb,
  getSharedDialect,
  insertReturning,
  updateReturning,
  limitRows,
  textContains,
  nowIso,
  affectedRows,
} from './storage/index.js';
import type { KBEntry, KBEntryInput, KBConnectionConfig } from './kb-types.js';

const TABLE = 'knowledge_base';

function toEntry(row: Record<string, unknown>): KBEntry {
  return { ...(row as unknown as KBEntry), id: Number(row.id) };
}

/**
 * Knowledge Base client. Entries live in the shared database
 * (`knowledge_base` table, created by apps/hive/server/kb/migrations.ts).
 */
export class KBClient {
  /** The config argument is ignored — kept for API compatibility. */
  constructor(_config?: KBConnectionConfig | null) {
    /* shared DB connection is process-wide */
  }

  async testConnection(): Promise<{ ok: boolean; message?: string; error?: string }> {
    try {
      const db = await getSharedDb();
      await db.selectFrom(TABLE).select(sql<number>`count(*)`.as('n')).where(sql<boolean>`1 = 0`).execute();
      return { ok: true, message: `Connected to shared ${getSharedDialect()} database — table ${TABLE} found` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  async search(query?: string, category?: string, tag?: string, scopeOwner?: string): Promise<KBEntry[]> {
    const db = await getSharedDb();
    const dialect = getSharedDialect();
    let q = db.selectFrom(TABLE).selectAll();

    if (query) {
      q = q.where((eb) => eb.or([
        textContains('title', query, dialect),
        textContains('content', query, dialect),
        textContains('tags', query, dialect),
      ]));
    }
    if (category) q = q.where('category', '=', category);
    if (tag) q = q.where(textContains('tags', tag, dialect));

    // Show shared entries + this user's entries
    if (scopeOwner) {
      q = q.where((eb) => eb.or([
        eb('scope', '=', 'shared'),
        eb.and([eb('scope', '=', 'user'), eb('scope_owner', '=', scopeOwner)]),
      ]));
    }

    return (await q.orderBy('updated_at', 'desc').execute()).map(toEntry);
  }

  async getById(id: number): Promise<KBEntry | null> {
    const db = await getSharedDb();
    const row = await db.selectFrom(TABLE).selectAll().where('id', '=', id).executeTakeFirst();
    return row ? toEntry(row) : null;
  }

  async getCategories(): Promise<string[]> {
    const db = await getSharedDb();
    const rows = await db.selectFrom(TABLE).select('category').distinct()
      .where('category', '!=', '').orderBy('category').execute();
    return rows.map((r) => r.category as string);
  }

  async getTags(): Promise<string[]> {
    const db = await getSharedDb();
    const rows = await db.selectFrom(TABLE).select('tags').distinct()
      .where('tags', '!=', '').orderBy('tags').execute();
    const tagSet = new Set<string>();
    for (const row of rows) {
      for (const t of String(row.tags).split(',')) {
        const trimmed = t.trim();
        if (trimmed) tagSet.add(trimmed);
      }
    }
    return [...tagSet].sort();
  }

  async create(entry: KBEntryInput): Promise<KBEntry> {
    const db = await getSharedDb();
    const dialect = getSharedDialect();

    // Check for existing entry with same title + category + scope to prevent duplicates
    const existing = await limitRows(
      db.selectFrom(TABLE).selectAll()
        .where('title', '=', entry.title)
        .where('category', '=', entry.category ?? '')
        .where('scope', '=', entry.scope ?? 'shared')
        .where('scope_owner', '=', entry.scope_owner ?? '')
        .orderBy('id'),
      dialect,
      1,
    ).executeTakeFirst();

    if (existing) {
      // Return the existing entry instead of creating a duplicate
      return toEntry(existing);
    }

    const now = nowIso();
    const row = await insertReturning(db, dialect, TABLE, {
      title: entry.title,
      content: entry.content,
      category: entry.category ?? '',
      tags: entry.tags ?? '',
      scope: entry.scope ?? 'shared',
      scope_owner: entry.scope_owner ?? '',
      source: entry.source ?? '',
      created_by: entry.created_by ?? '',
      created_at: now,
      updated_at: now,
    });
    return toEntry(row);
  }

  async update(id: number, partial: Partial<KBEntryInput>): Promise<KBEntry | null> {
    const db = await getSharedDb();
    const set: Record<string, unknown> = { updated_at: nowIso() };
    for (const key of ['title', 'content', 'category', 'tags', 'scope', 'scope_owner', 'source', 'created_by'] as const) {
      if (partial[key] !== undefined) set[key] = partial[key];
    }
    const row = await updateReturning(db, getSharedDialect(), TABLE, set, { id });
    return row ? toEntry(row) : null;
  }

  async delete(id: number): Promise<boolean> {
    const db = await getSharedDb();
    return affectedRows(await db.deleteFrom(TABLE).where('id', '=', id).executeTakeFirst()) > 0;
  }

  /**
   * Remove duplicate entries, keeping the oldest (lowest id) for each
   * unique (title, category, scope, scope_owner) combination.
   * Returns the number of duplicates removed.
   */
  async removeDuplicates(): Promise<number> {
    const db = await getSharedDb();
    const keep = db.selectFrom(TABLE)
      .select((eb) => eb.fn.min('id').as('id'))
      .groupBy(['title', 'category', 'scope', 'scope_owner']);
    return affectedRows(await db.deleteFrom(TABLE).where('id', 'not in', keep).executeTakeFirst());
  }

  /** Kept for API compatibility — the shared DB connection is process-wide. */
  async close(): Promise<void> {
    /* no-op */
  }
}
