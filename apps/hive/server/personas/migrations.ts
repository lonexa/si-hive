import { registerMigrations, addIdColumn } from '../../../../packages/shared/src/server/storage/index.js';

registerMigrations('personas', {
  '001_init': {
    async up({ db, dialect, t }) {
      await addIdColumn(db.schema.createTable('personas'), dialect)
        .addColumn('name', t.string(200), (c) => c.notNull())
        .addColumn('description', t.text, (c) => c.notNull().defaultTo(''))
        .addColumn('content', t.text, (c) => c.notNull())
        .addColumn('tags', t.string(1000), (c) => c.notNull().defaultTo(''))
        .addColumn('scope', t.string(20), (c) => c.notNull().defaultTo('shared'))
        .addColumn('scope_owner', t.string(200), (c) => c.notNull().defaultTo(''))
        .addColumn('created_by', t.string(200), (c) => c.notNull().defaultTo(''))
        .addColumn('created_at', t.timestamp, (c) => c.notNull())
        .addColumn('updated_at', t.timestamp, (c) => c.notNull())
        .execute();

      await addIdColumn(db.schema.createTable('persona_assignments'), dialect)
        .addColumn('persona_id', t.integer, (c) => c.notNull().references('personas.id').onDelete('cascade'))
        .addColumn('project_path', t.string(500), (c) => c.notNull())
        .addColumn('user_id', t.string(200), (c) => c.notNull())
        .addColumn('assigned_at', t.timestamp, (c) => c.notNull())
        .execute();

      await db.schema.createIndex('ix_persona_assignments_project_user')
        .on('persona_assignments').columns(['project_path', 'user_id']).execute();
    },
  },
});
