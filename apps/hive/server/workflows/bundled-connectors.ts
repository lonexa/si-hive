/**
 * Bundled-connector installer.
 *
 * Distribution emails are sent over the configured SMTP server
 * (see sendSmtpNotification in email-handler.ts), so the per-connector
 * config payload is unused for the distribution path — but the workflow
 * notify directive still needs to *name* a connector for the dispatcher's
 * lookup to succeed.
 *
 * To keep the wizard from showing "No connectors configured" for users who
 * haven't set up Gmail OAuth, we ensure a system "Team Email" connector
 * always exists. It's flagged isSystem=true so users can't delete it.
 *
 * Safe to call on every server startup — inserts only if the named
 * connector doesn't already exist.
 */

import * as connectorDb from './connector-db.js';

export const SYSTEM_EMAIL_CONNECTOR_NAME = 'Team Email';

export async function syncBundledConnectors(): Promise<void> {
  try {
    const existing = await connectorDb.getConnectorByName(SYSTEM_EMAIL_CONNECTOR_NAME);
    if (existing) return;

    await connectorDb.createConnector({
      type: 'email',
      name: SYSTEM_EMAIL_CONNECTOR_NAME,
      // Distribution path ignores config — store a marker so future maintenance
      // can recognise this is the SMTP fan-out connector, not a Gmail OAuth one.
      config: JSON.stringify({ useDistributionSmtp: true }),
      isSystem: true,
      isDefault: false,
    });
    console.log(`[bundled-connectors] Seeded system "${SYSTEM_EMAIL_CONNECTOR_NAME}" connector for distribution workflows`);
  } catch (err) {
    console.error('[bundled-connectors] Seed failed (non-fatal):', err);
  }
}
