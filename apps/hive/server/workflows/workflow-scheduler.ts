import { EventEmitter } from 'node:events';
import { hostname } from 'node:os';
import { CronExpressionParser } from 'cron-parser';
import * as db from './workflow-db.js';
import * as claimDb from './claim-db.js';
import * as runTargetDb from './run-target-db.js';
import { executeWorkflow } from './workflow-engine.js';
import { dispatchNotifications } from './connectors/dispatcher.js';
import { SYSTEM_EMAIL_CONNECTOR_NAME } from './bundled-connectors.js';
import type { Workflow, WorkflowDefinition, NotifyDirective } from './types.js';
import type { LiteConfig } from '../types.js';

/**
 * For an 'action' workflow, compute the per-period claim key and whether this
 * period's trigger time has passed.
 *
 * The anchor is a date-only boundary (Monday-of-week or today, depending on
 * `granularity`), so every Hive instance — regardless of timezone or when it
 * came online — computes the same key. Combined with the unique constraint on
 * WorkflowClaims(workflowId, scheduledAt), this gives exactly-once-per-period
 * execution with catch-up: if no instance was online at the scheduled time, the
 * first one online later in the same period still runs it (once).
 */
function currentPeriodAnchor(
  cronExpression: string,
  granularity: 'weekly' | 'daily',
): { anchor: string; eligible: boolean } | null {
  try {
    const now = new Date();
    const periodStart = new Date(now);

    if (granularity === 'weekly') {
      // Monday 00:00 (local) of the current week.
      const day = periodStart.getDay(); // 0 = Sunday, 1 = Monday, ...
      periodStart.setDate(periodStart.getDate() + (day === 0 ? -6 : 1 - day));
    }
    periodStart.setHours(0, 0, 0, 0);

    // First cron occurrence on/after the start of this period = this period's trigger time.
    const expr = CronExpressionParser.parse(cronExpression, {
      currentDate: new Date(periodStart.getTime() - 1000),
    });
    const trigger = expr.next().toDate();

    const yyyy = periodStart.getFullYear();
    const mm = String(periodStart.getMonth() + 1).padStart(2, '0');
    const dd = String(periodStart.getDate()).padStart(2, '0');

    return {
      anchor: `${yyyy}-${mm}-${dd}T00:00:00`,
      eligible: now.getTime() >= trigger.getTime(),
    };
  } catch (err) {
    console.error(`[workflow-scheduler] Invalid cron expression "${cronExpression}":`, err);
    return null;
  }
}

/** Resolve the claim granularity declared on a built-in action (defaults to 'weekly'). */
async function actionGranularity(definitionJson: string): Promise<'weekly' | 'daily'> {
  try {
    const def = JSON.parse(definitionJson) as { action?: { kind?: string } };
    const kind = def.action?.kind;
    if (!kind) return 'weekly';
    const { BUILTIN_ACTIONS } = await import('./actions/index.js');
    return BUILTIN_ACTIONS[kind]?.anchor ?? 'weekly';
  } catch {
    return 'weekly';
  }
}

export class WorkflowScheduler extends EventEmitter {
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private running = new Set<number>();
  private started = false;
  private config: LiteConfig | null = null;
  private saveConfigFn: ((config: LiteConfig) => void) | null = null;
  private armedUsers = new Set<string>();
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  /** Provide config access for notification dispatch */
  setConfig(config: LiteConfig, saveConfig: (config: LiteConfig) => void): void {
    this.config = config;
    this.saveConfigFn = saveConfig;
  }

  /** Start by loading and arming all enabled team workflows. Call once at server startup. */
  async startTeamWorkflows(): Promise<void> {
    if (this.started) return;
    this.started = true;
    console.log('[workflow-scheduler] Starting team workflows...');

    try {
      const workflows = await db.listTeamWorkflows();
      let armed = 0;
      for (const wf of workflows) {
        if (wf.enabled) {
          this.armWorkflow(wf);
          armed++;
        }
      }
      console.log(`[workflow-scheduler] Armed ${armed}/${workflows.length} team workflows`);
    } catch (err) {
      console.error('[workflow-scheduler] Failed to load team workflows:', err);
    }

    // Periodically re-check for new team workflows (picks up workflows created on other machines)
    this.refreshInterval = setInterval(() => {
      void this.refreshTeamWorkflows();
    }, 5 * 60 * 1000); // every 5 minutes
    if (this.refreshInterval.unref) this.refreshInterval.unref();
  }

  /** Arm a user's enabled personal workflows. Called once per user on first authenticated request. */
  async armPersonalWorkflows(userId: string): Promise<void> {
    if (this.armedUsers.has(userId)) return;
    this.armedUsers.add(userId);

    try {
      const workflows = await db.listPersonalWorkflows(userId);
      let armed = 0;
      for (const wf of workflows) {
        if (!this.timers.has(wf.id)) {
          this.armWorkflow(wf);
          armed++;
        }
      }
      if (armed > 0) {
        console.log(`[workflow-scheduler] Armed ${armed} personal workflows for user ${userId.slice(0, 8)}...`);
      }
    } catch (err) {
      console.error('[workflow-scheduler] Failed to load personal workflows:', err);
    }
  }

  /**
   * Re-check team workflows every few minutes. Arms newly created timer-based
   * workflows from other instances, and re-evaluates action workflows so a
   * missed weekly run gets caught up by whichever instance is online.
   */
  private async refreshTeamWorkflows(): Promise<void> {
    try {
      const workflows = await db.listTeamWorkflows();
      let newArmed = 0;
      for (const wf of workflows) {
        if (!wf.enabled || this.running.has(wf.id)) continue;
        if (wf.type === 'action') {
          // Re-evaluate every tick (catch-up). The per-week claim dedupes, and
          // armWorkflow keeps nextRunAt fresh for the UI.
          this.armWorkflow(wf);
          continue;
        }
        if (!this.timers.has(wf.id)) {
          this.armWorkflow(wf);
          newArmed++;
        }
      }
      if (newArmed > 0) {
        console.log(`[workflow-scheduler] Refresh: armed ${newArmed} new team workflows`);
      }
    } catch (err) {
      console.error('[workflow-scheduler] Failed to refresh team workflows:', err);
    }
  }

  /** @deprecated Use startTeamWorkflows() instead. Loads ALL workflows (wrong for multi-user). */
  async start(): Promise<void> {
    await this.startTeamWorkflows();
  }

  stop(): void {
    this.started = false;
    console.log('[workflow-scheduler] Stopping...');
    for (const [, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.running.clear();
    this.armedUsers.clear();
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  armWorkflow(workflow: Workflow): void {
    this.disarm(workflow.id);

    // Action workflows are not timer-driven. They are evaluated on every
    // team-refresh tick and use a per-week claim (see currentWeekAnchor) so
    // exactly one Hive instance runs them per week, with catch-up. We still
    // persist nextRunAt so the UI can show the next scheduled Monday.
    if (workflow.type === 'action') {
      const next = this.computeNextRun(workflow.cronExpression);
      if (next) db.updateWorkflow(workflow.id, { nextRunAt: next.toISOString() }).catch(() => {});
      void this.executeRun(workflow.id);
      return;
    }

    const nextDate = this.computeNextRun(workflow.cronExpression);
    if (!nextDate) {
      console.log(`[workflow-scheduler] Cannot compute next run for "${workflow.name}" (${workflow.id})`);
      return;
    }

    // Persist next_run_at
    db.updateWorkflow(workflow.id, { nextRunAt: nextDate.toISOString() }).catch(() => {});

    const delayMs = Math.max(0, nextDate.getTime() - Date.now());
    console.log(`[workflow-scheduler] Armed "${workflow.name}" — next run in ${Math.round(delayMs / 1000)}s at ${nextDate.toISOString()}`);

    const timer = setTimeout(() => {
      this.timers.delete(workflow.id);
      void this.executeRun(workflow.id);
    }, delayMs);

    timer.unref();
    this.timers.set(workflow.id, timer);
  }

  disarm(id: number): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  async triggerRun(id: number): Promise<void> {
    this.disarm(id);
    await this.executeRun(id, { force: true });
  }

  async executeRun(workflowId: number, opts: { force?: boolean } = {}): Promise<void> {
    const { force = false } = opts;
    const workflow = await db.getWorkflow(workflowId);
    if (!workflow) {
      console.log(`[workflow-scheduler] Workflow ${workflowId} not found, skipping`);
      return;
    }

    const isTeam = workflow.scope === 'team';
    const isAction = workflow.type === 'action';

    // For action workflows the claim key is a period anchor (not nextRunAt), so
    // every instance agrees on "this period's run". Granularity (weekly Monday
    // vs daily today) is declared on the BuiltinAction. Skip quietly until this
    // period's trigger time has passed — the next refresh tick re-evaluates.
    let scheduledAt = workflow.nextRunAt;
    if (isAction) {
      // Pre-claim check: if this machine's build doesn't have the action
      // registered, don't even attempt to claim — otherwise the run fails
      // with "Unknown action" and (historically) released the claim, which
      // let the next out-of-date machine retry on the next 5-minute tick.
      // Skipping silently lets up-to-date machines win the claim cleanly.
      try {
        const def = JSON.parse(workflow.definition) as { action?: { kind?: string } };
        const kind = def.action?.kind;
        const { BUILTIN_ACTIONS } = await import('./actions/index.js');
        if (!kind || !BUILTIN_ACTIONS[kind]) {
          if (force) {
            console.warn(`[workflow-scheduler] Action "${kind}" not registered on this build; cannot run "${workflow.name}" here`);
          }
          return;
        }
      } catch (err) {
        console.error(`[workflow-scheduler] Failed to validate action for "${workflow.name}":`, err);
        return;
      }

      const granularity = await actionGranularity(workflow.definition);
      const period = currentPeriodAnchor(workflow.cronExpression, granularity);
      if (!period) {
        console.error(`[workflow-scheduler] Cannot compute ${granularity} anchor for "${workflow.name}" (${workflowId})`);
        return;
      }
      if (!period.eligible && !force) return;
      scheduledAt = period.anchor;
    }

    // Run-target allow-list: if the owner restricted this workflow to specific
    // members, an instance whose logged-in user isn't on the list must not claim
    // it — skip silently so a selected member's machine wins instead. A manual
    // "Run now" (force) bypasses this so the owner can always trigger it locally.
    if (isTeam && !force) {
      try {
        const allowed = await runTargetDb.isInstanceAllowed(workflowId, this.config?.user?.email);
        if (!allowed) {
          console.log(`[workflow-scheduler] "${workflow.name}" is restricted to selected members; ${this.config?.user?.email ?? 'this instance'} is not one — skipping`);
          if (workflow.enabled && this.started && !isAction) this.armWorkflow(workflow);
          return;
        }
      } catch (err) {
        // Don't let a target-check failure block execution — fall through and let
        // the claim race proceed (fail-open, preserving prior behavior).
        console.error(`[workflow-scheduler] Run-target check failed for "${workflow.name}":`, err);
      }
    }

    // Team workflow claim-based coordination: only one instance runs per period.
    let ownsClaim = false;
    if (isTeam && scheduledAt) {
      try {
        const { claimed } = await claimDb.tryClaim(workflowId, scheduledAt, hostname());
        if (claimed) {
          ownsClaim = true;
          console.log(`[workflow-scheduler] Claimed team workflow "${workflow.name}" for ${scheduledAt} on ${hostname()}`);
        } else if (force) {
          // Manual "Run now" — proceed even though this period is already claimed.
          // Built-in actions are idempotent (see create-sprint), so this is safe.
          console.log(`[workflow-scheduler] "${workflow.name}" already claimed for ${scheduledAt}, force-running anyway`);
        } else {
          console.log(`[workflow-scheduler] Team workflow "${workflow.name}" already claimed for ${scheduledAt}, skipping`);
          if (workflow.enabled && this.started && !isAction) this.armWorkflow(workflow);
          return;
        }
      } catch (err) {
        console.error(`[workflow-scheduler] Claim check failed for "${workflow.name}":`, err);
        if (workflow.enabled && this.started && !isAction) this.armWorkflow(workflow);
        return;
      }
    }

    if (this.running.has(workflowId)) {
      console.log(`[workflow-scheduler] Workflow "${workflow.name}" already running, skipping`);
      if (workflow.enabled && this.started && !isAction) this.armWorkflow(workflow);
      return;
    }

    this.running.add(workflowId);
    const startTime = Date.now();

    // Insert run record
    const run = await db.insertWorkflowRun({ workflowId, status: 'running' });
    console.log(`[workflow-scheduler] Starting run ${run.id} for "${workflow.name}"`);

    // Update last_run_at
    await db.updateWorkflow(workflowId, { lastRunAt: new Date().toISOString() });

    this.emit('run_started', { workflowId, runId: run.id });

    let runFailed = false;
    let lastErrorMessage: string | null = null;
    try {
      const definition: WorkflowDefinition = JSON.parse(workflow.definition);
      const result = await executeWorkflow(definition, workflowId);
      const durationMs = Date.now() - startTime;
      runFailed = !!result.errorMessage;
      lastErrorMessage = result.errorMessage ?? null;

      await db.updateWorkflowRun(run.id, {
        status: result.errorMessage ? 'failed' : 'completed',
        finishedAt: new Date().toISOString(),
        durationMs,
        output: result.output,
        errorMessage: result.errorMessage || undefined,
        screenshotPath: result.screenshotPath || undefined,
        dataJson: result.dataJson || undefined,
      });

      await db.pruneWorkflowRuns(workflowId, workflow.maxRunsKept);
      console.log(`[workflow-scheduler] Run ${run.id} for "${workflow.name}" finished: ${result.errorMessage ? 'failed' : 'completed'} (${durationMs}ms)`);

      // Dispatch notifications for successful runs.
      //
      // For distribution action workflows that have no explicit notify directive
      // (e.g. created before the wizard knew about the system email connector,
      // or saved without the user clicking a notify connector), synthesize one:
      // distribution emails go via SMTP fan-out which doesn't need a config
      // payload, so naming the system "Team Email" connector and using the
      // action's declared default template is enough to get the report into
      // subscribers' inboxes.
      let directives: NotifyDirective[] = definition.notify ?? [];
      if (directives.length === 0 && !result.errorMessage && isAction && workflow.isDistribution) {
        try {
          const { BUILTIN_ACTIONS } = await import('./actions/index.js');
          const kind = definition.action?.kind ?? '';
          const action = BUILTIN_ACTIONS[kind];
          if (action?.defaultEmailTemplate) {
            directives = [{
              connector: SYSTEM_EMAIL_CONNECTOR_NAME,
              template: action.defaultEmailTemplate,
              lookbackRuns: 1,
              subject: `${workflow.name} — {{date}}`,
            }];
            console.log(`[workflow-scheduler] Synthesized default email notify for distribution action "${workflow.name}"`);
          }
        } catch (err) {
          console.error('[workflow-scheduler] Failed to synthesize notify directive:', err);
        }
      }

      if (!result.errorMessage && directives.length && this.config && this.saveConfigFn) {
        try {
          const failures = await dispatchNotifications(
            workflowId, workflow.name, directives,
            this.config, this.saveConfigFn,
            result.output, result.changesJson,
            workflow.isDistribution,
          );
          // The run produced output, so it stays 'completed' — but if a notification
          // (e.g. the distribution email) failed to deliver, record it on the run so
          // the failure is visible instead of being swallowed in the service log.
          if (failures.length) {
            const summary = failures
              .map(f => `${f.connector}: ${f.error}`)
              .join('\n');
            console.error(`[workflow-scheduler] ${failures.length} notification(s) failed for "${workflow.name}" on ${hostname()}:\n${summary}`);
            await db.recordRunNotifyError(run.id, `Ran on ${hostname()}. Notification delivery failed:\n${summary}`);
          }
        } catch (notifyErr) {
          console.error(`[workflow-scheduler] Notification dispatch failed:`, notifyErr);
          await db.recordRunNotifyError(
            run.id,
            `Ran on ${hostname()}. Notification dispatch threw: ${notifyErr instanceof Error ? notifyErr.message : String(notifyErr)}`,
          ).catch(() => { /* best-effort */ });
        }
      }
    } catch (err) {
      runFailed = true;
      const msg = err instanceof Error ? err.message : String(err);
      lastErrorMessage = msg;
      await db.updateWorkflowRun(run.id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        output: msg,
        errorMessage: msg,
      });
      console.error(`[workflow-scheduler] Run ${run.id} error:`, msg);
    }

    // Update team workflow claim status.
    //
    // Action workflows release the claim ONLY for likely-transient failures
    // (e.g. no auth token yet, Claude CLI not installed on this machine) so
    // another instance can retry within the same period. Structural failures
    // — "Unknown action: X" (this build doesn't have the action registered),
    // "No action kind defined" — are permanent for this period: releasing
    // would just hand the claim to another out-of-date instance and create
    // a 5-minute-tick failure loop. Keeping the claim means today's run is
    // lost if a bad instance won, but the loop stops.
    if (isTeam && scheduledAt && ownsClaim) {
      try {
        const errMsg = lastErrorMessage ?? '';
        const structural = /^Unknown action:|^No action kind defined/i.test(errMsg);
        if (runFailed && isAction && !structural) {
          await claimDb.releaseClaim(workflowId, scheduledAt);
        } else {
          if (structural) {
            console.warn(`[workflow-scheduler] Keeping claim for "${workflow.name}" despite failure — structural error, retrying would loop: ${errMsg}`);
          }
          await claimDb.updateClaim(workflowId, scheduledAt, runFailed ? 'failed' : 'completed', run.id);
        }
        await claimDb.pruneOldClaims(workflowId);
      } catch (err) {
        console.error(`[workflow-scheduler] Failed to update claim:`, err);
      }
    }

    this.running.delete(workflowId);
    this.emit('run_completed', { workflowId, runId: run.id });

    // Re-arm for next execution. Action workflows are re-evaluated by the
    // periodic team-refresh tick, not self-re-armed (which would loop).
    const fresh = await db.getWorkflow(workflowId);
    if (fresh && fresh.enabled && this.started && fresh.type !== 'action') {
      this.armWorkflow(fresh);
    }
  }

  private computeNextRun(cronExpression: string): Date | null {
    try {
      const expr = CronExpressionParser.parse(cronExpression);
      return expr.next().toDate();
    } catch (err) {
      console.error(`[workflow-scheduler] Invalid cron expression "${cronExpression}":`, err);
      return null;
    }
  }
}
