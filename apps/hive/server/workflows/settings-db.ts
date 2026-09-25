/**
 * Tiny key/value settings store in the shared DB (`workflow_settings`).
 *
 * Used for cross-instance configuration that every Hive install needs but
 * that shouldn't live in per-machine config files — e.g. the shared secret
 * used to authenticate to the centralized distribution-email endpoint.
 *
 * Values are cached for the process lifetime (settings change rarely); call
 * clearSettingsCache() if a value is updated at runtime.
 */

import { getSharedDb, upsert } from '../../../../packages/shared/src/server/storage/index.js';

const cache = new Map<string, string | null>();

/** Read a setting value by key. Returns null if absent. Cached after first read. */
export async function getSetting(key: string): Promise<string | null> {
  if (cache.has(key)) return cache.get(key) ?? null;
  const db = await getSharedDb();
  const row = await db.selectFrom('workflow_settings').select('value').where('key', '=', key).executeTakeFirst();
  const value = (row?.value ?? null) as string | null;
  cache.set(key, value);
  return value;
}

/** Upsert a setting value. Updates the cache. */
export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getSharedDb();
  await upsert(db, 'workflow_settings', { key }, { value });
  cache.set(key, value);
}

/** Drop cached settings (e.g. after an admin updates one). */
export function clearSettingsCache(): void {
  cache.clear();
}
