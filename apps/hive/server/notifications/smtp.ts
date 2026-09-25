/**
 * Outbound email over the user's own SMTP server (Settings → Email).
 *
 * Non-secret settings live in config.json under `smtp`; the password lives in
 * the credential store under `smtp:password`.
 */
import nodemailer from 'nodemailer';
import type { HiveConfig } from '../types.js';
import { getSecret } from '../../../../packages/shared/src/server/credentials.js';

export interface SmtpConfig {
  host: string;
  port: number;
  /** true = implicit TLS (465); false = STARTTLS when offered (587/25). */
  secure: boolean;
  username?: string;
  /** From header, e.g. `Hive <hive@example.com>`. */
  from: string;
}

export const SMTP_PASSWORD_REF = 'smtp:password';

export function getSmtpConfig(config: HiveConfig): SmtpConfig | null {
  const smtp = config.smtp as Partial<SmtpConfig> | undefined;
  if (!smtp?.host || !smtp.from) return null;
  return {
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: !!smtp.secure,
    username: smtp.username || undefined,
    from: smtp.from,
  };
}

export async function sendSmtpEmail(
  config: HiveConfig,
  message: { to: string[]; subject: string; html: string },
): Promise<void> {
  const smtp = getSmtpConfig(config);
  if (!smtp) throw new Error('SMTP is not configured. Set it up in Settings → Email.');
  const password = getSecret(SMTP_PASSWORD_REF);
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.username ? { user: smtp.username, pass: password ?? '' } : undefined,
  });
  await transport.sendMail({ from: smtp.from, to: message.to, subject: message.subject, html: message.html });
}
