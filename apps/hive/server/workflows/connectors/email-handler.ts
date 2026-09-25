import type { NotifyDirective } from '../types.js';
import type { RunDataPoint } from './formatters.js';
import { formatHtmlTable, interpolate } from './formatters.js';
import { sendEmail } from '../../gmail/gmail-client.js';
import { getValidAccessToken } from '../../gmail/google-auth.js';
import type { LiteConfig } from '../../types.js';
import { loadConfig } from '../../config.js';
import { sendSmtpEmail } from '../../notifications/smtp.js';

/**
 * Build the HTML body for an email. For most templates this delegates to
 * formatHtmlTable, which renders dataJson fields into a styled HTML table.
 *
 * For template === 'raw_html', the workflow has already produced a complete
 * HTML document (e.g. the claude-daily action's generated briefing) and stored
 * it under data[0].html. We send that verbatim so the email body is the report
 * itself, not a table summary of it.
 *
 * `runOutput` is the second chance: an action that returns its HTML as the run
 * output rather than under dataJson.html used to degrade silently into a
 * key/value dump of whatever else was in dataJson, which reads like a bug report
 * rather than a report. If the output itself is HTML, mail that instead.
 */
function renderEmailBody(
  workflowName: string,
  data: RunDataPoint[],
  directive: NotifyDirective,
  runOutput?: string,
): string {
  if (directive.template === 'raw_html') {
    const html = data[0]?.html;
    if (typeof html === 'string' && html.length > 0) return html;
    if (runOutput && /<(div|table|html|body|h1|h2|p)\b/i.test(runOutput)) {
      console.warn(`[connector:email] raw_html for "${workflowName}": data[0].html missing — using the run output, which is HTML`);
      return runOutput;
    }
    // Fall through to the table view if the workflow didn't produce an html field
    // — better to send something than nothing.
    console.warn(`[connector:email] raw_html requested for "${workflowName}" but data[0].html is missing — falling back to summary_table`);
  }
  return formatHtmlTable(workflowName, data, directive);
}

export async function sendEmailNotification(
  workflowName: string,
  data: RunDataPoint[],
  directive: NotifyDirective,
  config: LiteConfig,
  saveConfig: (config: LiteConfig) => void,
  runOutput?: string,
): Promise<void> {
  const recipientEmail = config.user?.email;
  if (!recipientEmail) {
    throw new Error('No recipient email configured. Set your email in Settings > User Profile.');
  }

  const accessToken = await getValidAccessToken(config, saveConfig);

  const subject = directive.subject
    ? interpolate(directive.subject, {
        workflowName,
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      })
    : `${workflowName} - ${new Date().toLocaleDateString()}`;

  const htmlBody = renderEmailBody(workflowName, data, directive, runOutput);

  await sendEmail(accessToken, recipientEmail, subject, htmlBody);
  console.log(`[connector:email] Sent to ${recipientEmail} for "${workflowName}"`);
}

/**
 * Send to an explicit recipient list over the configured SMTP server.
 *
 * This is the machine-independent path: it needs no per-user Gmail OAuth, so
 * any instance's scheduler can run the workflow and the same people get the
 * same mail. Used for distribution fan-out and for workflows with explicit
 * `recipients`.
 */
export async function sendSmtpNotification(
  workflowName: string,
  data: RunDataPoint[],
  directive: NotifyDirective,
  recipientEmails: string[],
  runOutput?: string,
): Promise<void> {
  if (recipientEmails.length === 0) return;

  const subject = directive.subject
    ? interpolate(directive.subject, {
        workflowName,
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      })
    : `${workflowName} - ${new Date().toLocaleDateString()}`;

  const html = renderEmailBody(workflowName, data, directive, runOutput);
  await sendSmtpEmail(loadConfig(), { to: recipientEmails, subject, html });
  console.log(`[connector:email] SMTP sent to ${recipientEmails.length} recipient(s) for "${workflowName}"`);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Work out who a workflow's email should go to, in priority order:
 *
 *  1. `directive.recipients` — explicit addresses named on the workflow.
 *  2. Distribution workflows — everyone subscribed.
 *  3. The workflow owner — so a team workflow mails the person who created it
 *     rather than whoever's machine happened to win the scheduled run.
 *
 * All three are delivered over SMTP, so a team workflow does not depend on
 * the running machine having Gmail connected.
 * Returns [] when nothing resolves, letting the caller decide how to report it.
 */
export async function resolveEmailRecipients(
  workflowId: number,
  directive: NotifyDirective,
  isDistribution: boolean,
): Promise<{ recipients: string[]; source: 'explicit' | 'subscribers' | 'owner' | 'none' }> {
  const explicit = (directive.recipients ?? [])
    .map(e => (e || '').trim())
    .filter(e => EMAIL_RE.test(e));
  if (explicit.length) {
    return { recipients: [...new Set(explicit)], source: 'explicit' };
  }

  if (isDistribution) {
    const { getSubscriberEmails } = await import('../subscription-db.js');
    const subs = await getSubscriberEmails(workflowId);
    if (subs.length) return { recipients: subs, source: 'subscribers' };
    return { recipients: [], source: 'none' };
  }

  const { getWorkflowOwnerEmail } = await import('../workflow-db.js');
  const owner = await getWorkflowOwnerEmail(workflowId);
  if (owner && EMAIL_RE.test(owner)) return { recipients: [owner], source: 'owner' };

  return { recipients: [], source: 'none' };
}
