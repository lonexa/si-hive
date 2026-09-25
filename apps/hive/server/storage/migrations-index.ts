/**
 * Every module's shared-DB migrations. Import a module's `migrations.ts`
 * here so it runs at startup (see storage/init.ts).
 */
import '../admin/migrations.js';
import '../analytics/migrations.js';
import '../security/migrations.js';
import '../personas/migrations.js';
import '../kb/migrations.js';
import '../sharing/migrations.js';
import '../skills/migrations.js';
import '../todo/migrations.js';
import '../workflows/migrations.js';
import '../messaging/migrations.js';
import '../now/migrations.js';
import '../handoff/migrations.js';
import '../reviews/migrations.js';
import '../delivery/migrations.js';
