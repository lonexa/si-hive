import { registerMigrations, addIdColumn } from '../../../../packages/shared/src/server/storage/index.js';

registerMigrations('sharing', {
  '001_init': {
    async up({ db, dialect, t }) {
      await addIdColumn(db.schema.createTable('shared_items'), dialect)
        .addColumn('name', t.string(200), (c) => c.notNull())
        .addColumn('item_type', t.string(50), (c) => c.notNull())
        .addColumn('description', t.string(2000), (c) => c.notNull().defaultTo(''))
        .addColumn('tags', t.string(1000), (c) => c.notNull().defaultTo(''))
        .addColumn('version', t.integer, (c) => c.notNull().defaultTo(1))
        .addColumn('scope', t.string(50), (c) => c.notNull().defaultTo('shared'))
        .addColumn('scope_owner', t.string(200), (c) => c.notNull().defaultTo(''))
        .addColumn('created_by', t.string(200), (c) => c.notNull().defaultTo(''))
        .addColumn('created_at', t.timestamp, (c) => c.notNull())
        .addColumn('updated_at', t.timestamp, (c) => c.notNull())
        .addUniqueConstraint('uq_shared_items', ['name', 'item_type', 'scope', 'scope_owner'])
        .execute();

      await addIdColumn(db.schema.createTable('shared_item_files'), dialect)
        .addColumn('item_id', t.integer, (c) => c.notNull().references('shared_items.id').onDelete('cascade'))
        .addColumn('file_path', t.string(500), (c) => c.notNull())
        .addColumn('content', t.text, (c) => c.notNull())
        .addColumn('is_primary', t.bool, (c) => c.notNull().defaultTo(0))
        .addColumn('created_at', t.timestamp, (c) => c.notNull())
        .addColumn('updated_at', t.timestamp, (c) => c.notNull())
        .addUniqueConstraint('uq_shared_item_files', ['item_id', 'file_path'])
        .execute();

      await db.schema.createIndex('ix_shared_items_type')
        .on('shared_items').column('item_type').execute();
    },
  },
});
