import { registerMigrations, addIdColumn } from '../../../../packages/shared/src/server/storage/index.js';

registerMigrations('delivery', {
  '001_pr_reviews': {
    async up({ db, dialect, t }) {
      // One row per AI review posted, keyed to the PR head it reviewed so the
      // pipeline doesn't review the same commit twice (across instances too).
      await addIdColumn(db.schema.createTable('pr_reviews'), dialect)
        .addColumn('connection_id', t.string(100), (c) => c.notNull())
        .addColumn('repo', t.string(300), (c) => c.notNull())
        .addColumn('pr_number', t.integer, (c) => c.notNull())
        .addColumn('head_ref', t.string(100), (c) => c.notNull())
        .addColumn('status', t.string(20), (c) => c.notNull())
        .addColumn('summary', t.text)
        .addColumn('error', t.text)
        .addColumn('reviewed_at', t.timestamp, (c) => c.notNull())
        .execute();
      await db.schema.createIndex('ux_pr_reviews_head').unique()
        .on('pr_reviews').columns(['connection_id', 'repo', 'pr_number', 'head_ref']).execute();
    },
  },
});
