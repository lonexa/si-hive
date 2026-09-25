import { registerMigrations, addIdColumn } from '../../../../packages/shared/src/server/storage/index.js';

registerMigrations('security', {
  '001_init': {
    async up({ db, dialect, t }) {
      await addIdColumn(db.schema.createTable('audit_log'), dialect)
        .addColumn('action', t.string(200), (c) => c.notNull())
        .addColumn('entity_type', t.string(100))
        .addColumn('entity_id', t.string(500))
        .addColumn('details', t.text)
        .addColumn('username', t.string(200), (c) => c.notNull())
        .addColumn('machine_name', t.string(100))
        .addColumn('logged_at', t.timestamp, (c) => c.notNull())
        .execute();
      await db.schema.createIndex('ix_audit_log_time')
        .on('audit_log').column('logged_at').execute();
      await db.schema.createIndex('ix_audit_log_action')
        .on('audit_log').column('action').execute();
      await db.schema.createIndex('ix_audit_log_user')
        .on('audit_log').column('username').execute();
    },
  },
});
