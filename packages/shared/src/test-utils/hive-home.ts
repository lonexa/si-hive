import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Point HIVE_HOME at a fresh temp dir for the current test file. Call before
 * importing anything that reads config/DB paths. Returns the directory.
 */
export function useTempHiveHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-test-'));
  process.env.HIVE_HOME = dir;
  process.env.HIVE_SECRET_KEY = 'test-secret-key';
  return dir;
}
