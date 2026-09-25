import { registerMigrations, addIdColumn } from '../../../../packages/shared/src/server/storage/index.js';

registerMigrations('workflows', {
  '001_init': {
    async up({ db, dialect, t }) {
      // SQL Server has no CREATE TABLE/INDEX … IF NOT EXISTS; the migrator
      // already guarantees this runs once.
      const createTable = (name: string) => db.schema.createTable(name);
      const createIndex = (name: string) => db.schema.createIndex(name);

      await addIdColumn(createTable('workflows'), dialect)
        .addColumn('userId', t.string(100))
        .addColumn('name', t.string(200), (c) => c.notNull())
        .addColumn('description', t.text, (c) => c.notNull())
        .addColumn('type', t.string(50), (c) => c.notNull())
        .addColumn('templateId', t.string(50))
        .addColumn('definition', t.text, (c) => c.notNull())
        .addColumn('cronExpression', t.string(100), (c) => c.notNull())
        .addColumn('enabled', t.bool, (c) => c.notNull().defaultTo(1))
        .addColumn('lastRunAt', t.timestamp)
        .addColumn('nextRunAt', t.timestamp)
        .addColumn('maxRunsKept', t.integer, (c) => c.notNull().defaultTo(50))
        .addColumn('scope', t.string(20), (c) => c.notNull().defaultTo('personal'))
        .addColumn('isDistribution', t.bool, (c) => c.notNull().defaultTo(0))
        .addColumn('stateJson', t.text)
        .addColumn('createdAt', t.timestamp, (c) => c.notNull())
        .addColumn('updatedAt', t.timestamp, (c) => c.notNull())
        .execute();
      await createIndex('ix_workflows_user').on('workflows').column('userId').execute();
      await createIndex('ix_workflows_scope').on('workflows').column('scope').execute();

      await addIdColumn(createTable('workflow_runs'), dialect)
        .addColumn('workflowId', t.integer, (c) => c.notNull().references('workflows.id').onDelete('cascade'))
        .addColumn('status', t.string(20), (c) => c.notNull().defaultTo('pending'))
        .addColumn('startedAt', t.timestamp, (c) => c.notNull())
        .addColumn('finishedAt', t.timestamp)
        .addColumn('durationMs', t.integer)
        .addColumn('output', t.text)
        .addColumn('errorMessage', t.text)
        .addColumn('screenshotPath', t.string(500))
        .addColumn('dataJson', t.text)
        // Non-fatal: the run succeeded but notification delivery failed.
        .addColumn('notifyError', t.text)
        .execute();
      await createIndex('ix_workflow_runs_workflow')
        .on('workflow_runs').columns(['workflowId', 'startedAt']).execute();

      await addIdColumn(createTable('workflow_credentials'), dialect)
        .addColumn('label', t.string(200), (c) => c.notNull())
        .addColumn('siteUrl', t.string(500))
        .addColumn('username', t.string(200), (c) => c.notNull())
        .addColumn('passwordEnc', t.text, (c) => c.notNull())
        .addColumn('createdAt', t.timestamp, (c) => c.notNull())
        .execute();

      // Notification connectors (email, Slack, Google Chat, webhook).
      await addIdColumn(createTable('workflow_connectors'), dialect)
        .addColumn('type', t.string(50), (c) => c.notNull())
        .addColumn('name', t.string(200), (c) => c.notNull())
        .addColumn('config', t.text, (c) => c.notNull()) // encrypted JSON
        .addColumn('isSystem', t.bool, (c) => c.notNull().defaultTo(0)) // bundled, not deletable
        .addColumn('isDefault', t.bool, (c) => c.notNull().defaultTo(0))
        .addColumn('createdAt', t.timestamp, (c) => c.notNull())
        .addColumn('updatedAt', t.timestamp, (c) => c.notNull())
        .execute();
      await createIndex('ix_workflow_connectors_name')
        .on('workflow_connectors').column('name').execute();

      // Shared team repository of proven workflow definitions.
      await addIdColumn(createTable('workflow_recipes'), dialect)
        .addColumn('name', t.string(200), (c) => c.notNull())
        .addColumn('description', t.text, (c) => c.notNull())
        .addColumn('type', t.string(50), (c) => c.notNull())
        .addColumn('definition', t.text, (c) => c.notNull())
        .addColumn('tags', t.string(500))
        .addColumn('author', t.string(200))
        .addColumn('version', t.integer, (c) => c.notNull().defaultTo(1))
        .addColumn('requiresCredential', t.bool, (c) => c.notNull().defaultTo(0))
        .addColumn('credentialHint', t.string(500))
        .addColumn('createdAt', t.timestamp, (c) => c.notNull())
        .addColumn('updatedAt', t.timestamp, (c) => c.notNull())
        .execute();

      // Team workflow coordination: the unique (workflowId, scheduledAt) key is
      // what makes a scheduled period run at most once across instances.
      await addIdColumn(createTable('workflow_claims'), dialect)
        .addColumn('workflowId', t.integer, (c) => c.notNull().references('workflows.id').onDelete('cascade'))
        .addColumn('scheduledAt', t.timestamp, (c) => c.notNull())
        .addColumn('claimedBy', t.string(200), (c) => c.notNull())
        .addColumn('claimedAt', t.timestamp, (c) => c.notNull())
        .addColumn('status', t.string(20), (c) => c.notNull().defaultTo('claimed'))
        .addColumn('runId', t.integer)
        .addUniqueConstraint('uq_workflow_claims_slot', ['workflowId', 'scheduledAt'])
        .execute();

      // Distribution sign-ups by Hive users.
      await addIdColumn(createTable('workflow_subscriptions'), dialect)
        .addColumn('workflowId', t.integer, (c) => c.notNull().references('workflows.id').onDelete('cascade'))
        .addColumn('userOid', t.string(100), (c) => c.notNull())
        .addColumn('subscribedAt', t.timestamp, (c) => c.notNull())
        .addUniqueConstraint('uq_workflow_subscriptions', ['workflowId', 'userOid'])
        .execute();

      // Distribution recipients without a Hive account.
      await addIdColumn(createTable('workflow_external_subscribers'), dialect)
        .addColumn('workflowId', t.integer, (c) => c.notNull().references('workflows.id').onDelete('cascade'))
        .addColumn('email', t.string(320), (c) => c.notNull())
        .addColumn('addedByOid', t.string(100))
        .addColumn('addedAt', t.timestamp, (c) => c.notNull())
        .addUniqueConstraint('uq_workflow_external_email', ['workflowId', 'email'])
        .execute();

      // Per-workflow allow-list of members whose instances may run a team
      // workflow. No rows = every member is eligible.
      await addIdColumn(createTable('workflow_run_targets'), dialect)
        .addColumn('workflowId', t.integer, (c) => c.notNull().references('workflows.id').onDelete('cascade'))
        .addColumn('userOid', t.string(100), (c) => c.notNull())
        .addColumn('addedAt', t.timestamp, (c) => c.notNull())
        .addUniqueConstraint('uq_workflow_run_target', ['workflowId', 'userOid'])
        .execute();

      // Small key/value store for cross-instance workflow settings.
      await createTable('workflow_settings')
        .addColumn('key', t.string(100), (c) => c.primaryKey())
        .addColumn('value', t.text)
        .execute();
    },
  },
});
