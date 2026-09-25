import os from 'node:os';
import type { KBConnectionConfig } from './client.js';
import { readSharedStorageConfig } from '../../../../packages/shared/src/server/storage/index.js';
import { hivePath } from '../../../../packages/shared/src/server/paths.js';

/**
 * The KB lives in the shared database (Settings → Storage), so there is no
 * separate connection to configure.
 *
 * KB_SCOPE_OWNER (optional env var) sets the username for user-scoped
 * entries; defaults to the OS username.
 */
export function getKBScopeOwner(): string {
  const fromEnv = process.env['KB_SCOPE_OWNER'];
  if (fromEnv) return fromEnv;
  try {
    return os.userInfo().username;
  } catch {
    return '';
  }
}

/** Describes the shared database the KB is stored in. Never null. */
export function loadKBConfig(): KBConnectionConfig {
  const cfg = readSharedStorageConfig();
  if (cfg.type === 'sqlite') {
    return { dialect: 'sqlite', server: '', database: cfg.file || hivePath('shared.db'), schema: '' };
  }
  return { dialect: cfg.type, server: cfg.host ?? 'localhost', database: cfg.database ?? '', schema: '' };
}
