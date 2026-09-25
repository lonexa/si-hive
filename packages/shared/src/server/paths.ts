import os from 'node:os';
import path from 'node:path';
import { DATA_DIR_NAME } from '../brand.js';

/**
 * Hive's per-user data directory (config, SQLite DB, credentials, logs).
 * Defaults to ~/.hive; set HIVE_HOME to run an isolated instance (dev
 * servers, tests, or a second install on the same machine).
 */
export function hiveHome(): string {
  const override = process.env.HIVE_HOME;
  return override ? path.resolve(override) : path.join(os.homedir(), DATA_DIR_NAME);
}

/** Absolute path inside the Hive data directory. */
export function hivePath(...parts: string[]): string {
  return path.join(hiveHome(), ...parts);
}
