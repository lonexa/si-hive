import { registerMigrations, addIdColumn } from '../../../../packages/shared/src/server/storage/index.js';

registerMigrations('kb', {
  '001_init': {
    async up({ db, dialect, t }) {
      await addIdColumn(db.schema.createTable('knowledge_base'), dialect)
        .addColumn('title', t.string(500), (c) => c.notNull())
        .addColumn('content', t.text, (c) => c.notNull())
        .addColumn('category', t.string(200), (c) => c.notNull().defaultTo(''))
        .addColumn('tags', t.string(1000), (c) => c.notNull().defaultTo(''))
        .addColumn('scope', t.string(50), (c) => c.notNull().defaultTo('shared'))
        .addColumn('scope_owner', t.string(200), (c) => c.notNull().defaultTo(''))
        .addColumn('source', t.string(500), (c) => c.notNull().defaultTo(''))
        .addColumn('created_by', t.string(200), (c) => c.notNull().defaultTo(''))
        .addColumn('created_at', t.timestamp, (c) => c.notNull())
        .addColumn('updated_at', t.timestamp, (c) => c.notNull())
        .execute();

      await db.schema.createIndex('ix_knowledge_base_category')
        .on('knowledge_base').column('category').execute();
      await db.schema.createIndex('ix_knowledge_base_scope')
        .on('knowledge_base').columns(['scope', 'scope_owner']).execute();
      await db.schema.createIndex('ix_knowledge_base_updated_at')
        .on('knowledge_base').column('updated_at').execute();
    },
  },
});
