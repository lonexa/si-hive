import { registerMigrations, addIdColumn } from '../../../../packages/shared/src/server/storage/index.js';

registerMigrations('handoff', {
  '001_init': {
    async up({ db, dialect, t }) {
      // A handoff carries the source session's transcript text (not a file
      // path) so the receiver's machine can rebuild context in a fresh session.
      await addIdColumn(db.schema.createTable('session_handoffs'), dialect)
        .addColumn('from_oid', t.string(200), (c) => c.notNull())
        .addColumn('from_name', t.string(200), (c) => c.notNull().defaultTo(''))
        .addColumn('to_oid', t.string(200), (c) => c.notNull())
        .addColumn('cwd', t.text) // source working dir (hint only)
        .addColumn('provider', t.string(20), (c) => c.notNull().defaultTo('claude'))
        .addColumn('transcript_text', t.text) // markdown transcript of the source session
        .addColumn('note', t.text)
        .addColumn('status', t.string(20), (c) => c.notNull().defaultTo('pending')) // pending | accepted | declined | canceled
        .addColumn('created_at', t.timestamp, (c) => c.notNull())
        .addColumn('responded_at', t.timestamp)
        .execute();

      await db.schema.createIndex('ix_session_handoffs_to')
        .on('session_handoffs').columns(['to_oid', 'status', 'created_at']).execute();
    },
  },
});
