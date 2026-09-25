import { registerMigrations, addIdColumn } from '../../../../packages/shared/src/server/storage/index.js';

registerMigrations('reviews', {
  '001_init': {
    async up({ db, dialect, t }) {
      await addIdColumn(db.schema.createTable('peer_reviews'), dialect)
        .addColumn('requester_oid', t.string(200), (c) => c.notNull())
        .addColumn('requester_name', t.string(256), (c) => c.notNull())
        .addColumn('reviewer_oid', t.string(200), (c) => c.notNull())
        .addColumn('reviewer_name', t.string(256), (c) => c.notNull())
        .addColumn('title', t.string(300), (c) => c.notNull())
        .addColumn('kind', t.string(16), (c) => c.notNull().defaultTo('note')) // session | commit | note
        .addColumn('ref_id', t.string(256)) // session id or commit id
        .addColumn('repo', t.string(256))
        .addColumn('context', t.text) // what to review / notes
        .addColumn('status', t.string(16), (c) => c.notNull().defaultTo('requested')) // requested | approved | changes | closed
        .addColumn('created_at', t.timestamp, (c) => c.notNull())
        .addColumn('updated_at', t.timestamp, (c) => c.notNull())
        .addColumn('responded_at', t.timestamp)
        .execute();

      await db.schema.createIndex('ix_peer_reviews_reviewer')
        .on('peer_reviews').columns(['reviewer_oid', 'status', 'updated_at']).execute();
      await db.schema.createIndex('ix_peer_reviews_requester')
        .on('peer_reviews').columns(['requester_oid', 'updated_at']).execute();

      await addIdColumn(db.schema.createTable('peer_review_comments'), dialect)
        .addColumn('review_id', t.integer, (c) => c.notNull().references('peer_reviews.id').onDelete('cascade'))
        .addColumn('author_oid', t.string(200), (c) => c.notNull())
        .addColumn('author_name', t.string(256), (c) => c.notNull())
        .addColumn('body', t.text, (c) => c.notNull())
        .addColumn('created_at', t.timestamp, (c) => c.notNull())
        .execute();

      await db.schema.createIndex('ix_peer_review_comments_review')
        .on('peer_review_comments').columns(['review_id', 'created_at']).execute();
    },
  },
});
