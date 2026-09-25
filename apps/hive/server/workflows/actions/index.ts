/**
 * Built-in workflow actions.
 *
 * Unlike generic scrape/browser/api/monitor workflows (which run user-defined
 * HTTP or Playwright scripts), an "action" workflow invokes a named internal
 * Hive operation. Actions run in the background scheduler with no HTTP request
 * context, so they authenticate via the shared background token mechanism.
 *
 * To add a new action: implement a `run()` and register it below. It then
 * becomes available as a Team Workflow automation in the Workflow Studio.
 */

import type { NotifyDirective } from '../types.js';
import { runClaudeDaily } from './claude-daily.js';

export interface ActionResult {
  /** Human-readable summary stored on the workflow run. */
  output: string;
  /** Structured data stored on the run (optional). */
  dataJson?: string | null;
  /** If set, the run is marked failed. Transient failures are retried on the next tick. */
  errorMessage?: string | null;
}

/** Context passed to action.run(). Lets actions query their own run history for cross-instance dedup. */
export interface ActionContext {
  workflowId: number;
}

export interface BuiltinAction {
  kind: string;
  label: string;
  description: string;
  /** Suggested cron schedule when creating this automation. */
  defaultCron: string;
  /**
   * Claim granularity. The scheduler computes a per-period anchor key and uses
   * the unique constraint on WorkflowClaims(workflowId, scheduledAt) so exactly
   * one Hive instance runs each period. Defaults to 'weekly' (Monday-of-week)
   * to preserve existing behaviour for actions that don't declare one.
   */
  anchor?: 'weekly' | 'daily';
  /**
   * Notify-directive template the AutomationWizard should pre-select when the
   * user picks an email connector. Actions whose output is already a finished
   * HTML document (e.g. claude-daily) should set this to 'raw_html' so the
   * email body is the report itself instead of a tabular summary.
   */
  defaultEmailTemplate?: NotifyDirective['template'];
  /**
   * The scheduler passes an ActionContext (currently just workflowId). Existing
   * actions that don't need it can ignore the arg — TypeScript allows fewer
   * params than the signature declares.
   */
  run: (ctx: ActionContext) => Promise<ActionResult>;
}

export const BUILTIN_ACTIONS: Record<string, BuiltinAction> = {
  'claude-daily': {
    kind: 'claude-daily',
    label: 'Claude Daily Briefing',
    description:
      'Every morning, spawn Claude Code with the claude-daily skill to research the last 24 hours of Anthropic, Claude, and AI news, then email a styled HTML briefing to all subscribers. Runs once per day across the team — the first SI Hive instance online claims it.',
    defaultCron: '0 8 * * *',
    anchor: 'daily',
    defaultEmailTemplate: 'raw_html',
    run: runClaudeDaily,
  },
};

/** Catalog metadata for the frontend (no `run` function). */
export function listBuiltinActions(): Array<Omit<BuiltinAction, 'run'>> {
  return Object.values(BUILTIN_ACTIONS).map(({ kind, label, description, defaultCron, anchor, defaultEmailTemplate }) => ({
    kind,
    label,
    description,
    defaultCron,
    anchor,
    defaultEmailTemplate,
  }));
}
