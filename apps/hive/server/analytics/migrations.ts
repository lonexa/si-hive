import { registerMigrations, addIdColumn } from '../../../../packages/shared/src/server/storage/index.js';

registerMigrations('analytics', {
  '001_init': {
    async up({ db, dialect, t }) {
      // One row per AI assistant session, upserted by session_id on each
      // usage-logger flush (see usage-logger.ts).
      await addIdColumn(db.schema.createTable('ai_usage_log'), dialect)
        .addColumn('session_id', t.string(200), (c) => c.notNull())
        .addColumn('provider', t.string(20), (c) => c.notNull())
        .addColumn('username', t.string(200), (c) => c.notNull())
        .addColumn('display_name', t.string(200))
        .addColumn('machine_name', t.string(100))
        .addColumn('project_path', t.string(500))
        .addColumn('model', t.string(100))
        .addColumn('permission_mode', t.string(50))
        .addColumn('start_time', t.timestamp, (c) => c.notNull())
        .addColumn('end_time', t.timestamp)
        .addColumn('duration_seconds', t.integer, (c) => c.notNull().defaultTo(0))
        .addColumn('input_tokens', t.bigint, (c) => c.notNull().defaultTo(0))
        .addColumn('output_tokens', t.bigint, (c) => c.notNull().defaultTo(0))
        .addColumn('cache_creation_tokens', t.bigint, (c) => c.notNull().defaultTo(0))
        .addColumn('cache_read_tokens', t.bigint, (c) => c.notNull().defaultTo(0))
        .addColumn('estimated_cost', t.real)
        .addColumn('message_count', t.integer, (c) => c.notNull().defaultTo(0))
        .addColumn('tool_use_count', t.integer, (c) => c.notNull().defaultTo(0))
        .addColumn('created_at', t.timestamp, (c) => c.notNull())
        .addColumn('updated_at', t.timestamp, (c) => c.notNull())
        .execute();
      await db.schema.createIndex('ux_ai_usage_log_session').unique()
        .on('ai_usage_log').column('session_id').execute();
      await db.schema.createIndex('ix_ai_usage_log_start')
        .on('ai_usage_log').column('start_time').execute();
      await db.schema.createIndex('ix_ai_usage_log_user_start')
        .on('ai_usage_log').columns(['username', 'start_time']).execute();

      // Manually logged time
      await addIdColumn(db.schema.createTable('time_entries'), dialect)
        .addColumn('username', t.string(200), (c) => c.notNull())
        .addColumn('project_path', t.string(500))
        .addColumn('work_item_id', t.integer)
        .addColumn('hours', t.real, (c) => c.notNull())
        .addColumn('description', t.text)
        .addColumn('source', t.string(20), (c) => c.notNull().defaultTo('manual'))
        // YYYY-MM-DD
        .addColumn('entry_date', t.string(10), (c) => c.notNull())
        .addColumn('created_at', t.timestamp, (c) => c.notNull())
        .execute();
      await db.schema.createIndex('ix_time_entries_date')
        .on('time_entries').column('entry_date').execute();
    },
  },
});
