// --- Workflow Studio types ---

export type WorkflowType = 'scrape' | 'browser' | 'api' | 'monitor' | 'action';

export interface Workflow {
  id: number;
  userId: string | null;
  name: string;
  description: string;
  type: WorkflowType;
  templateId: string | null;
  definition: string; // JSON string of WorkflowDefinition
  cronExpression: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  maxRunsKept: number;
  scope: 'personal' | 'team';
  isDistribution: boolean;
  stateJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowClaim {
  id: number;
  workflowId: number;
  scheduledAt: string;
  claimedBy: string;
  claimedAt: string;
  status: 'claimed' | 'completed' | 'failed';
  runId: number | null;
}

export interface WorkflowSubscription {
  id: number;
  workflowId: number;
  userOid: string;
  subscribedAt: string;
}

export interface WorkflowRun {
  id: number;
  workflowId: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  output: string | null;
  errorMessage: string | null;
  screenshotPath: string | null;
  dataJson: string | null;
  /** Non-fatal: the run produced output but notification delivery (e.g. email) failed. */
  notifyError: string | null;
}

export interface WorkflowCredential {
  id: number;
  label: string;
  siteUrl: string;
  username: string;
  passwordEnc: string;
  createdAt: string;
}

export interface WorkflowDefinition {
  version: 1;
  type: WorkflowType;
  steps?: WorkflowStep[];
  playwrightScript?: string;
  /** For type 'action' — a built-in Hive action invoked instead of a generic HTTP/browser script. */
  action?: {
    kind: string;
    params?: Record<string, unknown>;
  };
  output: {
    format: 'text' | 'data' | 'screenshot' | 'data+screenshot';
    dataSchema?: {
      fields: Array<{ name: string; type: 'number' | 'string' | 'date'; label: string }>;
    };
    chartConfig?: {
      type: 'line' | 'bar' | 'area';
      xField: string;
      yFields: string[];
    };
  };
  credentialId?: number;
  notify?: NotifyDirective[];
}

export interface WorkflowStep {
  action: 'fetch' | 'extract' | 'transform' | 'assert';
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  selector?: string;
  regex?: string;
  field?: string;
  expression?: string;
  expected?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  type: 'scrape' | 'browser' | 'api' | 'monitor';
  icon: string;
  defaultCron: string;
  defaultDefinition: WorkflowDefinition;
  promptHint: string;
}

// --- Connector types ---

export type ConnectorType = 'email' | 'slack' | 'google-chat' | 'webhook';

export interface Connector {
  id: number;
  type: ConnectorType;
  name: string;
  config: string; // encrypted JSON
  isSystem: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmailConnectorConfig {
  useGmail: true; // uses connected Gmail OAuth
}

export interface SlackConnectorConfig {
  webhookUrl: string;
}

export interface GoogleChatConnectorConfig {
  webhookUrl: string;
}

export interface WebhookConnectorConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers: Record<string, string>;
  bodyTemplate?: string; // mustache-style: {{data}}, {{summary}}, {{workflowName}}
}

export type ConnectorConfig =
  | EmailConnectorConfig
  | SlackConnectorConfig
  | GoogleChatConnectorConfig
  | WebhookConnectorConfig;

export interface NotifyDirective {
  connector: string; // connector name
  /**
   * How to render the run data for this connector.
   * - 'summary_table' — HTML table built from dataJson fields (email)
   * - 'summary_text'  — plain text bullets (Slack/Chat)
   * - 'raw_data'      — JSON dump (webhooks)
   * - 'raw_html'      — email body is dataJson.html verbatim (no formatting).
   *                     The workflow must put a complete HTML document under
   *                     the top-level `html` field of its dataJson.
   */
  template: 'summary_table' | 'summary_text' | 'raw_data' | 'raw_html';
  lookbackRuns?: number; // how many past runs to include (default 1)
  subject?: string; // for email — supports {{workflowName}}, {{date}}
  message?: string; // custom message/preamble
  /**
   * Explicit email recipients for this directive.
   *
   * When set, the email goes out over SMTP to exactly these
   * addresses. That matters for team workflows: the relay needs nothing but the
   * shared key from [Hive].[Settings], so delivery works identically on whichever
   * teammate's machine happens to win the scheduled run — unlike the per-user
   * Gmail OAuth path, which only works on a machine that has connected Gmail and
   * would otherwise mail whoever's machine ran it.
   *
   * Empty/absent falls back to the workflow's audience — subscribers for a
   * distribution, otherwise the workflow owner. See resolveEmailRecipients.
   */
  recipients?: string[];
}
