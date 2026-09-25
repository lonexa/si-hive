import { registerMigrations, addIdColumn } from '../../../../packages/shared/src/server/storage/index.js';

registerMigrations('skills', {
  '001_skill_requirements': {
    async up({ db, dialect, t }) {
      await addIdColumn(db.schema.createTable('skill_requirements'), dialect)
        .addColumn('contextType', t.string(20), (c) => c.notNull())
        .addColumn('contextKey', t.string(400), (c) => c.notNull())
        .addColumn('contextLabel', t.string(200))
        .addColumn('keywords', t.string(1000))
        .addColumn('skillName', t.string(200), (c) => c.notNull())
        .addColumn('required', t.bool, (c) => c.notNull().defaultTo(1))
        .addColumn('createdBy', t.string(200))
        .addColumn('createdAt', t.timestamp, (c) => c.notNull())
        .addUniqueConstraint('UQ_skillreq', ['contextType', 'contextKey', 'skillName'])
        .execute();

      await db.schema.createIndex('ix_skill_requirements_type')
        .on('skill_requirements').column('contextType').execute();
    },
  },
});
