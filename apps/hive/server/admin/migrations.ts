import { registerMigrations, addIdColumn } from '../../../../packages/shared/src/server/storage/index.js';

// Central user directory + per-user telemetry. Users are keyed by `oid`, an
// opaque string id from whichever sign-in the install uses. Child tables carry
// no foreign keys: telemetry for a user the directory hasn't seen yet should
// still land, and deleteUser() removes children explicitly.
registerMigrations('users', {
  '001_init': {
    async up({ db, dialect, t }) {
      await db.schema.createTable('users')
        .addColumn('oid', t.string(200), (c) => c.primaryKey())
        .addColumn('email', t.string(320), (c) => c.notNull().defaultTo(''))
        .addColumn('display_name', t.string(200), (c) => c.notNull().defaultTo(''))
        // Effective role (admin | full)
        .addColumn('role', t.string(20), (c) => c.notNull())
        // When set by an admin, wins over the role the sign-in reports
        .addColumn('admin_role_override', t.string(20))
        .addColumn('first_login', t.timestamp, (c) => c.notNull())
        .addColumn('last_login', t.timestamp, (c) => c.notNull())
        .addColumn('login_count', t.integer, (c) => c.notNull().defaultTo(1))
        .addColumn('last_version', t.string(50))
        .addColumn('last_version_at', t.timestamp)
        .addColumn('last_heartbeat_at', t.timestamp)
        // Git commit each instance reports on heartbeat (staleness is judged on this)
        .addColumn('last_commit', t.string(100))
        // Set by an admin's "Force Update"; read-and-cleared by the user's next heartbeat
        .addColumn('force_update_pending', t.bool, (c) => c.notNull().defaultTo(0))
        .addColumn('force_update_requested_at', t.timestamp)
        .addColumn('force_update_requested_by', t.string(200))
        .execute();

      await addIdColumn(db.schema.createTable('user_feature_overrides'), dialect)
        .addColumn('user_oid', t.string(200), (c) => c.notNull())
        .addColumn('feature', t.string(100), (c) => c.notNull())
        .addColumn('granted_by', t.string(200), (c) => c.notNull())
        .addColumn('granted_at', t.timestamp, (c) => c.notNull())
        .execute();
      await db.schema.createIndex('ux_user_feature_overrides_user_feature').unique()
        .on('user_feature_overrides').columns(['user_oid', 'feature']).execute();

      await addIdColumn(db.schema.createTable('user_logins'), dialect)
        .addColumn('user_oid', t.string(200), (c) => c.notNull())
        .addColumn('login_at', t.timestamp, (c) => c.notNull())
        .addColumn('machine_name', t.string(100), (c) => c.notNull().defaultTo(''))
        .addColumn('version', t.string(50))
        .execute();
      await db.schema.createIndex('ix_user_logins_user_date')
        .on('user_logins').columns(['user_oid', 'login_at']).execute();

      await addIdColumn(db.schema.createTable('user_activity'), dialect)
        .addColumn('user_oid', t.string(200), (c) => c.notNull())
        .addColumn('feature', t.string(100), (c) => c.notNull())
        .addColumn('visited_at', t.timestamp, (c) => c.notNull())
        .addColumn('machine_name', t.string(100), (c) => c.notNull().defaultTo(''))
        .execute();
      await db.schema.createIndex('ix_user_activity_user_feature_date')
        .on('user_activity').columns(['user_oid', 'feature', 'visited_at']).execute();

      // Granular per-button / per-action click stream
      await addIdColumn(db.schema.createTable('user_events'), dialect)
        .addColumn('user_oid', t.string(200), (c) => c.notNull())
        .addColumn('occurred_at', t.timestamp, (c) => c.notNull())
        .addColumn('version', t.string(50))
        .addColumn('machine_name', t.string(100))
        // nav | click | action | modal | feature | error
        .addColumn('category', t.string(50), (c) => c.notNull())
        .addColumn('name', t.string(150), (c) => c.notNull())
        .addColumn('route', t.string(200))
        .addColumn('props_json', t.text)
        .execute();
      await db.schema.createIndex('ix_user_events_user_time')
        .on('user_events').columns(['user_oid', 'occurred_at']).execute();
      await db.schema.createIndex('ix_user_events_name_time')
        .on('user_events').columns(['name', 'occurred_at']).execute();
      await db.schema.createIndex('ix_user_events_time')
        .on('user_events').column('occurred_at').execute();
    },
  },
});
