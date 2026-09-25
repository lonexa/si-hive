import type { NotifyDirective, SlackConnectorConfig } from '../types.js';
import type { RunDataPoint } from './formatters.js';
import { formatPlainText } from './formatters.js';

export async function sendSlackNotification(
  workflowName: string,
  data: RunDataPoint[],
  directive: NotifyDirective,
  connectorConfig: SlackConnectorConfig,
): Promise<void> {
  const text = formatPlainText(workflowName, data, directive);

  const res = await fetch(connectorConfig.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slack webhook failed: ${res.status} ${body}`);
  }

  console.log(`[connector:slack] Sent notification for "${workflowName}"`);
}
