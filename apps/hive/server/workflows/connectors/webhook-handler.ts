import type { NotifyDirective, WebhookConnectorConfig } from '../types.js';
import type { RunDataPoint } from './formatters.js';
import { formatRawData, interpolate } from './formatters.js';

export async function sendWebhookNotification(
  workflowName: string,
  data: RunDataPoint[],
  _directive: NotifyDirective,
  connectorConfig: WebhookConnectorConfig,
): Promise<void> {
  const vars = {
    workflowName,
    date: new Date().toISOString(),
    data: JSON.stringify(data),
    summary: formatRawData(workflowName, data),
  };

  let body: string;
  if (connectorConfig.bodyTemplate) {
    body = interpolate(connectorConfig.bodyTemplate, vars);
  } else {
    body = JSON.stringify({ workflow: workflowName, data, timestamp: new Date().toISOString() });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...connectorConfig.headers,
  };

  const res = await fetch(connectorConfig.url, {
    method: connectorConfig.method || 'POST',
    headers,
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webhook failed: ${res.status} ${text}`);
  }

  console.log(`[connector:webhook] Sent to ${connectorConfig.url} for "${workflowName}"`);
}
