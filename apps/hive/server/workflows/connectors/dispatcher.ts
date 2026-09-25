import type { NotifyDirective, ConnectorConfig, SlackConnectorConfig, GoogleChatConnectorConfig, WebhookConnectorConfig } from '../types.js';
import type { LiteConfig } from '../../types.js';
import type { RunDataPoint } from './formatters.js';
import * as connectorDb from '../connector-db.js';
import { getWorkflowRunDataRecent } from '../workflow-db.js';
import { tryDecryptJson, undecryptableConfigMessage } from '../workflow-crypto.js';
import { sendEmailNotification, sendSmtpNotification, resolveEmailRecipients } from './email-handler.js';
import { sendSlackNotification } from './slack-handler.js';
import { sendGoogleChatNotification } from './google-chat-handler.js';
import { sendWebhookNotification } from './webhook-handler.js';

/** A notify directive that failed to deliver — surfaced onto the run so it isn't silent. */
export interface NotifyFailure {
  connector: string;
  error: string;
}

/**
 * Process all notify directives for a completed workflow run.
 * Called by the scheduler after a successful run.
 *
 * @param isDistribution - If true, emails go to all subscribers via SMTP instead of owner's Gmail.
 * @returns the list of directives that failed to deliver (empty when all succeeded).
 *          The caller records these on the run so a failed send is visible instead
 *          of being swallowed here.
 */
export async function dispatchNotifications(
  workflowId: number,
  workflowName: string,
  directives: NotifyDirective[],
  config: LiteConfig,
  saveConfig: (config: LiteConfig) => void,
  runOutput?: string,
  changesJson?: string | null,
  isDistribution?: boolean,
): Promise<NotifyFailure[]> {
  const failures: NotifyFailure[] = [];
  if (!directives.length) return failures;

  for (const directive of directives) {
    try {
      // Look up the connector
      const connector = await connectorDb.getConnectorByName(directive.connector);
      if (!connector) {
        const msg = `Connector "${directive.connector}" not found`;
        console.warn(`[dispatcher] ${msg}, skipping`);
        failures.push({ connector: directive.connector, error: msg });
        continue;
      }

      // If we have changesJson (only new/changed items), use that for notifications
      // Otherwise fall back to full dataJson from the most recent run(s)
      let sliced: RunDataPoint[];
      if (changesJson) {
        try {
          const changes = JSON.parse(changesJson);
          sliced = [{ timestamp: new Date().toISOString(), ...changes }];
        } catch {
          sliced = [];
        }
      } else {
        // Fetch most recent N runs' data (newest first, then reverse for chronological order)
        const lookback = directive.lookbackRuns ?? 1;
        const rawData = await getWorkflowRunDataRecent(workflowId, lookback);
        sliced = rawData.map(r => {
          try {
            return { timestamp: r.startedAt, ...JSON.parse(r.dataJson) };
          } catch {
            return { timestamp: r.startedAt };
          }
        }).reverse(); // oldest first for display
      }

      // For monitor workflows with "No changes detected", skip notification
      if (runOutput?.includes('No changes detected since last run')) {
        console.log(`[dispatcher] No changes detected for "${workflowName}", skipping "${directive.connector}"`);
        continue;
      }

      // Decrypt connector config. May legitimately come back null when the
      // connector was created on another teammate's machine — see
      // tryDecryptJson. Only the channels whose destination lives *inside* the
      // config care; email resolves its recipient from the local profile.
      const connectorConfig = tryDecryptJson<ConnectorConfig>(connector.config);
      const requireConfig = <T extends ConnectorConfig>(): T => {
        if (!connectorConfig) throw new Error(undecryptableConfigMessage(connector.name));
        return connectorConfig as T;
      };

      // Dispatch by type
      switch (connector.type) {
        case 'email': {
          // A team workflow can be run by any teammate's scheduler, so its email
          // must not depend on the winning machine. Route through the central
          // SMTP relay whenever the audience is resolvable from shared state
          // (explicit recipients, subscribers, or the workflow owner), and keep
          // the per-user Gmail OAuth path only for a personal workflow running on
          // its owner's own machine.
          const { recipients, source } = await resolveEmailRecipients(workflowId, directive, !!isDistribution);

          if (recipients.length) {
            await sendSmtpNotification(workflowName, sliced, directive, recipients, runOutput);
            console.log(
              `[dispatcher] Email for "${workflowName}" sent via SMTP to ` +
              `${recipients.length} recipient(s) [${source}]`,
            );
            break;
          }

          if (isDistribution) {
            console.log(`[dispatcher] Distribution "${workflowName}" has no subscribers, skipping email`);
            break;
          }

          // Nothing resolvable from shared state — fall back to the local user's
          // Gmail. Only meaningful on a machine that has connected Gmail.
          await sendEmailNotification(workflowName, sliced, directive, config, saveConfig, runOutput);
          break;
        }
        case 'slack':
          await sendSlackNotification(workflowName, sliced, directive, requireConfig<SlackConnectorConfig>());
          break;
        case 'google-chat':
          await sendGoogleChatNotification(workflowName, sliced, directive, requireConfig<GoogleChatConnectorConfig>());
          break;
        case 'webhook':
          await sendWebhookNotification(workflowName, sliced, directive, requireConfig<WebhookConnectorConfig>());
          break;
        default:
          console.warn(`[dispatcher] Unknown connector type: ${connector.type}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[dispatcher] Failed to send via "${directive.connector}": ${msg}`);
      failures.push({ connector: directive.connector, error: msg });
      // Don't throw — continue with other directives
    }
  }

  return failures;
}
