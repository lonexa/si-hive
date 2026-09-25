import './migrations-index.js';
import {
  getSharedDb,
  getSharedDialect,
  runMigrations,
  type MigrationReport,
} from '../../../../packages/shared/src/server/storage/index.js';

let lastReport: MigrationReport & { at?: string; dialect?: string } = { applied: [] };

/** Connect to the shared DB and apply pending migrations. Never throws. */
export async function initSharedStorage(): Promise<MigrationReport> {
  try {
    const db = await getSharedDb();
    const report = await runMigrations(db, getSharedDialect());
    lastReport = { ...report, at: new Date().toISOString(), dialect: getSharedDialect() };
    if (report.error) console.error(`[storage] Migration failed (${getSharedDialect()}): ${report.error}`);
    else if (report.applied.length) console.log(`[storage] Applied ${report.applied.length} migration(s): ${report.applied.join(', ')}`);
    return report;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[storage] Shared database unavailable (${getSharedDialect()}): ${error}`);
    lastReport = { applied: [], error, at: new Date().toISOString(), dialect: getSharedDialect() };
    return lastReport;
  }
}

export function getLastMigrationReport() {
  return lastReport;
}
