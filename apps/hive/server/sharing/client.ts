import { sql } from 'kysely';
import {
  getSharedDb,
  getSharedDialect,
  insertReturning,
  updateReturning,
  textContains,
  nowIso,
  affectedRows,
  type SharedDb,
} from '../../../../packages/shared/src/server/storage/index.js';
import type { KBConnectionConfig } from '../kb/client.js';
import type { SharedItem, SharedItemFile, SharedItemWithFiles, PublishItemInput, UpdateItemInput, SharedItemType } from './types.js';

const ITEMS = 'shared_items';
const FILES = 'shared_item_files';

type FileInput = PublishItemInput['files'][number];

function toItem(row: Record<string, unknown>): SharedItem {
  return { ...(row as unknown as SharedItem), id: Number(row.id), version: Number(row.version) };
}

function toFile(row: Record<string, unknown>): SharedItemFile {
  return { ...(row as unknown as SharedItemFile), id: Number(row.id), item_id: Number(row.item_id), is_primary: !!row.is_primary };
}

async function insertFiles(db: SharedDb, itemId: number, files: FileInput[]): Promise<SharedItemFile[]> {
  const dialect = getSharedDialect();
  const out: SharedItemFile[] = [];
  for (const f of files) {
    const now = nowIso();
    out.push(toFile(await insertReturning(db, dialect, FILES, {
      item_id: itemId,
      file_path: f.file_path,
      content: f.content,
      is_primary: f.is_primary ? 1 : 0,
      created_at: now,
      updated_at: now,
    })));
  }
  return out;
}

/**
 * Team-shared skills, agents, plugin configs, … Stored in the shared database
 * (`shared_items` + `shared_item_files`, see ./migrations.ts).
 */
export class SharingClient {
  /** The config argument is ignored — kept for API compatibility. */
  constructor(_config?: KBConnectionConfig | null) {
    /* shared DB connection is process-wide */
  }

  async testConnection(): Promise<{ ok: boolean; message?: string; error?: string }> {
    try {
      const db = await getSharedDb();
      await db.selectFrom(ITEMS).select(sql<number>`count(*)`.as('n')).where(sql<boolean>`1 = 0`).execute();
      return { ok: true, message: `Connected to shared ${getSharedDialect()} database — table ${ITEMS} found` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  async listItems(type?: SharedItemType, query?: string, tag?: string, scopeOwner?: string): Promise<SharedItem[]> {
    const db = await getSharedDb();
    const dialect = getSharedDialect();
    let q = db.selectFrom(ITEMS).selectAll();

    if (type) q = q.where('item_type', '=', type);
    if (query) {
      q = q.where((eb) => eb.or([
        textContains('name', query, dialect),
        textContains('description', query, dialect),
        textContains('tags', query, dialect),
      ]));
    }
    if (tag) q = q.where(textContains('tags', tag, dialect));

    // Show shared items + this user's items
    if (scopeOwner) {
      q = q.where((eb) => eb.or([
        eb('scope', '=', 'shared'),
        eb.and([eb('scope', '=', 'user'), eb('scope_owner', '=', scopeOwner)]),
      ]));
    }

    return (await q.orderBy('updated_at', 'desc').execute()).map(toItem);
  }

  async getItemWithFiles(id: number): Promise<SharedItemWithFiles | null> {
    const db = await getSharedDb();
    const item = await db.selectFrom(ITEMS).selectAll().where('id', '=', id).executeTakeFirst();
    if (!item) return null;

    const files = await db.selectFrom(FILES).selectAll().where('item_id', '=', id)
      .orderBy('is_primary', 'desc').orderBy('file_path').execute();

    return { ...toItem(item), files: files.map(toFile) };
  }

  async publishItem(input: PublishItemInput): Promise<SharedItemWithFiles> {
    const db = await getSharedDb();
    const dialect = getSharedDialect();
    return db.transaction().execute(async (trx) => {
      const now = nowIso();
      const item = toItem(await insertReturning(trx, dialect, ITEMS, {
        name: input.name,
        item_type: input.item_type,
        description: input.description ?? '',
        tags: input.tags ?? '',
        version: 1,
        scope: input.scope ?? 'shared',
        scope_owner: input.scope_owner ?? '',
        created_by: input.created_by ?? '',
        created_at: now,
        updated_at: now,
      }));
      const files = await insertFiles(trx, item.id, input.files);
      return { ...item, files };
    });
  }

  async publishOrUpdateItem(input: PublishItemInput): Promise<SharedItemWithFiles> {
    const db = await getSharedDb();

    // Check if item already exists
    const existing = await db.selectFrom(ITEMS).select('id')
      .where('name', '=', input.name)
      .where('item_type', '=', input.item_type)
      .where('scope', '=', input.scope ?? 'shared')
      .where('scope_owner', '=', input.scope_owner ?? '')
      .executeTakeFirst();

    if (existing) {
      // Update existing item
      const updated = await this.updateItem(Number(existing.id), {
        description: input.description,
        tags: input.tags,
        files: input.files,
      });
      if (!updated) throw new Error('Failed to update existing item');
      return updated;
    }

    // Insert new
    return this.publishItem(input);
  }

  async updateItem(id: number, input: UpdateItemInput): Promise<SharedItemWithFiles | null> {
    const db = await getSharedDb();
    const dialect = getSharedDialect();

    const found = await db.transaction().execute(async (trx) => {
      const set: Record<string, unknown> = { updated_at: nowIso(), version: sql`${sql.ref('version')} + 1` };
      for (const key of ['name', 'description', 'tags', 'scope', 'scope_owner'] as const) {
        if (input[key] !== undefined) set[key] = input[key];
      }
      const item = await updateReturning(trx, dialect, ITEMS, set, { id });
      if (!item) return false;

      // If files provided, replace all files
      if (input.files) {
        await trx.deleteFrom(FILES).where('item_id', '=', id).execute();
        await insertFiles(trx, id, input.files);
      }
      return true;
    });

    // Re-fetch with files
    return found ? this.getItemWithFiles(id) : null;
  }

  async deleteItem(id: number): Promise<boolean> {
    const db = await getSharedDb();
    return db.transaction().execute(async (trx) => {
      await trx.deleteFrom(FILES).where('item_id', '=', id).execute();
      return affectedRows(await trx.deleteFrom(ITEMS).where('id', '=', id).executeTakeFirst()) > 0;
    });
  }

  async getTags(type?: SharedItemType): Promise<string[]> {
    const db = await getSharedDb();
    let q = db.selectFrom(ITEMS).select('tags').distinct().where('tags', '!=', '');
    if (type) q = q.where('item_type', '=', type);
    const rows = await q.orderBy('tags').execute();
    const tagSet = new Set<string>();
    for (const row of rows) {
      for (const t of String(row.tags).split(',')) {
        const trimmed = t.trim();
        if (trimmed) tagSet.add(trimmed);
      }
    }
    return [...tagSet].sort();
  }

  /** Kept for API compatibility — the shared DB connection is process-wide. */
  async close(): Promise<void> {
    /* no-op */
  }
}
