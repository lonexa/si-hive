import { registerMigrations, addIdColumn } from '../../../../packages/shared/src/server/storage/index.js';

registerMigrations('todo', {
  '001_init': {
    async up({ db, dialect, t }) {
      await addIdColumn(db.schema.createTable('daily_todos'), dialect)
        .addColumn('user_email', t.string(200), (c) => c.notNull())
        .addColumn('todo_date', t.string(10), (c) => c.notNull()) // YYYY-MM-DD
        .addColumn('title', t.string(500), (c) => c.notNull())
        .addColumn('description', t.text)
        .addColumn('priority', t.string(20), (c) => c.notNull().defaultTo('medium')) // high | medium | low
        .addColumn('status', t.string(20), (c) => c.notNull().defaultTo('todo')) // todo | done
        .addColumn('source', t.string(20), (c) => c.notNull().defaultTo('manual')) // manual | ai | email | calendar | tracker
        .addColumn('source_ref', t.string(200))
        .addColumn('created_at', t.timestamp, (c) => c.notNull())
        .addColumn('updated_at', t.timestamp, (c) => c.notNull())
        .execute();

      await db.schema.createIndex('ix_daily_todos_user_date')
        .on('daily_todos').columns(['user_email', 'todo_date']).execute();
    },
  },
});
