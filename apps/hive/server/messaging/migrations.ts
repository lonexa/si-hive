import { registerMigrations, addIdColumn } from '../../../../packages/shared/src/server/storage/index.js';

registerMigrations('messaging', {
  '001_init': {
    async up({ db, dialect, t }) {
      await addIdColumn(db.schema.createTable('message_threads'), dialect)
        .addColumn('kind', t.string(20), (c) => c.notNull().defaultTo('direct')) // direct | group | broadcast
        .addColumn('title', t.string(200))
        .addColumn('created_by', t.string(200), (c) => c.notNull())
        .addColumn('created_by_name', t.string(200), (c) => c.notNull().defaultTo(''))
        .addColumn('created_at', t.timestamp, (c) => c.notNull())
        .addColumn('last_message_at', t.timestamp) // bumped on every message; inbox sort key
        .execute();

      await db.schema.createIndex('ix_message_threads_kind_title')
        .on('message_threads').columns(['kind', 'title']).execute();

      await db.schema.createTable('message_thread_members')
        .addColumn('thread_id', t.integer, (c) => c.notNull().references('message_threads.id').onDelete('cascade'))
        .addColumn('member_oid', t.string(200), (c) => c.notNull())
        .addColumn('member_name', t.string(200), (c) => c.notNull().defaultTo(''))
        .addColumn('member_email', t.string(200), (c) => c.notNull().defaultTo(''))
        .addColumn('added_at', t.timestamp, (c) => c.notNull())
        .addColumn('last_read_message_id', t.integer) // drives unread counts and read receipts
        .addColumn('last_read_at', t.timestamp)
        .addPrimaryKeyConstraint('pk_message_thread_members', ['thread_id', 'member_oid'])
        .execute();

      await db.schema.createIndex('ix_message_thread_members_oid')
        .on('message_thread_members').column('member_oid').execute();

      await addIdColumn(db.schema.createTable('messages'), dialect)
        .addColumn('thread_id', t.integer, (c) => c.notNull().references('message_threads.id').onDelete('cascade'))
        .addColumn('sender_oid', t.string(200), (c) => c.notNull())
        .addColumn('sender_name', t.string(200), (c) => c.notNull().defaultTo(''))
        .addColumn('body', t.text, (c) => c.notNull())
        .addColumn('kind', t.string(20), (c) => c.notNull().defaultTo('text')) // text | ping | announcement
        .addColumn('created_at', t.timestamp, (c) => c.notNull())
        .execute();

      await db.schema.createIndex('ix_messages_thread')
        .on('messages').columns(['thread_id', 'id']).execute();
    },
  },
});
