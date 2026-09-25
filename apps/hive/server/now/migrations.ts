import { registerMigrations } from '../../../../packages/shared/src/server/storage/index.js';

registerMigrations('now', {
  '001_init': {
    async up({ db, t }) {
      // One row per user: the latest live-session snapshot their machine
      // published, plus user-set presence that snapshots never overwrite.
      await db.schema.createTable('user_now')
        .addColumn('user_oid', t.string(200), (c) => c.primaryKey())
        .addColumn('updated_at', t.timestamp, (c) => c.notNull())
        .addColumn('machine_name', t.string(100), (c) => c.notNull().defaultTo(''))
        .addColumn('working', t.integer, (c) => c.notNull().defaultTo(0))
        .addColumn('waiting', t.integer, (c) => c.notNull().defaultTo(0))
        .addColumn('error_count', t.integer, (c) => c.notNull().defaultTo(0))
        .addColumn('total', t.integer, (c) => c.notNull().defaultTo(0))
        .addColumn('top_project', t.string(300)) // project of the most-recent active session
        .addColumn('top_status', t.string(40)) // that session's status
        .addColumn('sessions_json', t.text) // JSON array of {slug, project, status, model, lastActivity}
        .addColumn('availability', t.string(16)) // available | busy | away | dnd
        .addColumn('manual_status', t.string(120)) // free-text note
        .addColumn('manual_status_at', t.timestamp)
        .execute();
    },
  },
});
