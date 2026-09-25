import type { NotifyDirective, GoogleChatConnectorConfig } from '../types.js';
import type { RunDataPoint } from './formatters.js';
import { formatPlainText } from './formatters.js';

export async function sendGoogleChatNotification(
  workflowName: string,
  data: RunDataPoint[],
  directive: NotifyDirective,
  connectorConfig: GoogleChatConnectorConfig,
): Promise<void> {
  const text = formatPlainText(workflowName, data, directive);

  const res = await fetch(connectorConfig.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Chat webhook failed: ${res.status} ${body}`);
  }

  console.log(`[connector:google-chat] Sent notification for "${workflowName}"`);
}
