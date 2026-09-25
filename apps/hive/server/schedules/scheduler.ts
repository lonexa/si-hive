import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { CronExpressionParser } from 'cron-parser';
import { getProvider, getPrimaryProvider } from '../providers/registry.js';
import {
  getAllSchedules,
  getSchedule,
  updateSchedule,
  insertScheduleRun,
  updateScheduleRun,
  pruneScheduleRuns,
} from '../db.js';
import type { Schedule, HiveConfig } from '../types.js';
import { getAllGitHosts } from '../integrations/registry.js';
import { runPrReviewCycle } from '../delivery/pr-review.js';

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB cap on output

export class Scheduler extends EventEmitter {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private runningProcesses = new Map<string, ChildProcess>();
  private started = false;
  private config: HiveConfig | null = null;

  setConfig(config: HiveConfig): void {
    this.config = config;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    console.log('[scheduler] Starting scheduler...');

    const schedules = getAllSchedules();
    let armed = 0;
    for (const schedule of schedules) {
      if (schedule.enabled) {
        this.armSchedule(schedule);
        armed++;
      }
    }
    console.log(`[scheduler] Armed ${armed}/${schedules.length} schedules`);
  }

  stop(): void {
    this.started = false;
    console.log('[scheduler] Stopping scheduler...');

    // Clear all timers
    for (const [, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();

    // Kill running processes
    for (const [scheduleId, proc] of this.runningProcesses) {
      console.log(`[scheduler] Killing running process for schedule ${scheduleId}`);
      proc.kill('SIGTERM');
    }
    this.runningProcesses.clear();
  }

  armSchedule(schedule: Schedule): void {
    // Clear existing timer
    this.disarmSchedule(schedule.id);

    const nextDate = this.computeNextRun(schedule);
    if (!nextDate) {
      console.log(`[scheduler] Cannot compute next run for schedule "${schedule.name}" (${schedule.id})`);
      return;
    }

    // Persist next_run_at
    updateSchedule(schedule.id, { nextRunAt: nextDate.toISOString() });

    const delayMs = Math.max(0, nextDate.getTime() - Date.now());
    console.log(`[scheduler] Armed "${schedule.name}" — next run in ${Math.round(delayMs / 1000)}s at ${nextDate.toISOString()}`);

    const timer = setTimeout(() => {
      this.timers.delete(schedule.id);
      void this.executeRun(schedule.id);
    }, delayMs);

    // Don't prevent Node from exiting
    timer.unref();
    this.timers.set(schedule.id, timer);
  }

  disarmSchedule(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  triggerRun(id: string): void {
    // Clear existing timer so it doesn't double-fire
    this.disarmSchedule(id);
    void this.executeRun(id);
  }

  async executeRun(scheduleId: string): Promise<void> {
    const schedule = getSchedule(scheduleId);
    if (!schedule) {
      console.log(`[scheduler] Schedule ${scheduleId} not found, skipping`);
      return;
    }

    // Concurrency guard — skip if already running
    if (this.runningProcesses.has(scheduleId)) {
      console.log(`[scheduler] Schedule "${schedule.name}" already running, skipping`);
      // Re-arm for next run
      if (schedule.enabled && this.started) this.armSchedule(schedule);
      return;
    }

    // Insert run record
    const run = insertScheduleRun({ scheduleId, status: 'running' });
    console.log(`[scheduler] Starting run ${run.id} for "${schedule.name}"`);

    // Update last_run_at
    updateSchedule(scheduleId, { lastRunAt: new Date().toISOString() });

    this.emit('run_started', { scheduleId, runId: run.id });

    // Handle pr-review-pipeline type separately
    if (schedule.type === 'pr-review-pipeline') {
      if (!this.config) {
        updateScheduleRun(run.id, {
          finishedAt: new Date().toISOString(),
          exitCode: 1,
          output: 'No config available for PR review pipeline',
          status: 'failed',
          errorMessage: 'Scheduler config not set',
        });
        this.emit('run_completed', { scheduleId, runId: run.id });
        const fresh = getSchedule(scheduleId);
        if (fresh && fresh.enabled && this.started) this.armSchedule(fresh);
        return;
      }
      try {
        const result = await runPrReviewCycle(this.config, 5);
        updateScheduleRun(run.id, {
          finishedAt: new Date().toISOString(),
          exitCode: 0,
          output: result,
          status: 'completed',
        });
        pruneScheduleRuns(scheduleId, schedule.maxRunsKept);
        console.log(`[scheduler] PR review pipeline run ${run.id} completed`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateScheduleRun(run.id, {
          finishedAt: new Date().toISOString(),
          exitCode: 1,
          output: msg,
          status: 'failed',
          errorMessage: msg,
        });
        console.error(`[scheduler] PR review pipeline run ${run.id} failed:`, msg);
      }
      this.emit('run_completed', { scheduleId, runId: run.id });
      const fresh = getSchedule(scheduleId);
      if (fresh && fresh.enabled && this.started) this.armSchedule(fresh);
      return;
    }

    // Track when this run started so we can label any PRs created during the run
    const runStartTime = new Date();

    // --- PR conflict prevention gates ---
    const skipReason = await this.checkPrGates(schedule);
    if (skipReason) {
      updateScheduleRun(run.id, {
        finishedAt: new Date().toISOString(),
        exitCode: 0,
        output: skipReason,
        status: 'completed',
      });
      console.log(`[scheduler] Skipping "${schedule.name}": ${skipReason}`);
      this.emit('run_completed', { scheduleId, runId: run.id });
      const fresh = getSchedule(scheduleId);
      if (fresh && fresh.enabled && this.started) this.armSchedule(fresh);
      return;
    }

    // Build active-PR file context to inject into the prompt
    const fileWarning = await this.buildActiveFileWarning(schedule);

    // Build command args — use schedule's provider or fall back to primary
    const cwd = schedule.projectPath || process.cwd();
    const provider = schedule.provider
      ? getProvider(schedule.provider)
      : (this.config ? getPrimaryProvider(this.config) : getProvider('claude'));
    const fullPrompt = fileWarning ? `${fileWarning}\n\n${schedule.prompt}` : schedule.prompt;
    const cmd = provider.exePath();
    const args = provider.batchArgs(fullPrompt, {
      skipPermissions: schedule.launchFlags?.dangerouslySkipPermissions,
    });

    console.log(`[scheduler] Spawning ${provider.displayName}: ${cmd} [${args.length} args] (shell: false, cwd: ${cwd})`);

    try {
      // shell: false passes args directly to the process via argv — no cmd.exe interpretation.
      // This requires the full resolved path (not just the binary name).
      const cleanEnv = provider.cleanEnv({ ...process.env }) as Record<string, string>;
      const proc = spawn(cmd, args, {
        cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: cleanEnv,
      });

      this.runningProcesses.set(scheduleId, proc);

      let output = '';
      let outputBytes = 0;

      const appendOutput = (chunk: Buffer) => {
        if (outputBytes >= MAX_OUTPUT_BYTES) return;
        const text = chunk.toString('utf-8');
        const remaining = MAX_OUTPUT_BYTES - outputBytes;
        if (text.length > remaining) {
          output += text.slice(0, remaining) + '\n... [output truncated at 1MB]';
          outputBytes = MAX_OUTPUT_BYTES;
        } else {
          output += text;
          outputBytes += text.length;
        }
      };

      proc.stdout?.on('data', appendOutput);
      proc.stderr?.on('data', appendOutput);

      proc.on('close', (exitCode) => {
        this.runningProcesses.delete(scheduleId);

        const status = exitCode === 0 ? 'completed' : 'failed';
        updateScheduleRun(run.id, {
          finishedAt: new Date().toISOString(),
          exitCode: exitCode ?? 1,
          output,
          status,
        });

        // Prune old runs
        pruneScheduleRuns(scheduleId, schedule.maxRunsKept);

        console.log(`[scheduler] Run ${run.id} for "${schedule.name}" finished: ${status} (exit ${exitCode})`);

        // Label any PRs created during this scheduled run as "automated"
        if (exitCode === 0) {
          void this.labelNewPrs(runStartTime);
        }

        this.emit('run_completed', { scheduleId, runId: run.id });

        // Re-arm for next execution
        const fresh = getSchedule(scheduleId);
        if (fresh && fresh.enabled && this.started) {
          this.armSchedule(fresh);
        }
      });

      proc.on('error', (err) => {
        this.runningProcesses.delete(scheduleId);

        updateScheduleRun(run.id, {
          finishedAt: new Date().toISOString(),
          exitCode: 1,
          output: output + '\n' + err.message,
          status: 'failed',
          errorMessage: err.message,
        });

        console.error(`[scheduler] Run ${run.id} error:`, err.message);
        this.emit('run_completed', { scheduleId, runId: run.id });

        // Re-arm
        const fresh = getSchedule(scheduleId);
        if (fresh && fresh.enabled && this.started) {
          this.armSchedule(fresh);
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateScheduleRun(run.id, {
        finishedAt: new Date().toISOString(),
        exitCode: 1,
        output: msg,
        status: 'failed',
        errorMessage: msg,
      });
      console.error(`[scheduler] Failed to spawn for "${schedule.name}":`, msg);
      this.emit('run_completed', { scheduleId, runId: run.id });
    }
  }

  getRunningScheduleIds(): Set<string> {
    return new Set(this.runningProcesses.keys());
  }

  /**
   * After a scheduled run completes, tag PRs the run opened as automated.
   * Provider-neutral PR labelling is not part of the GitHostProvider contract
   * yet, so this is a no-op until a provider exposes it.
   */
  private async labelNewPrs(_startTime: Date): Promise<void> {
    return;
  }

  /**
   * Check pre-creation gates before spawning a scheduled run.
   * Returns a skip reason string if the run should be skipped, or null to proceed.
   * The `maxActivePrs` gate counts open PRs across connected git hosts.
   */
  private async checkPrGates(schedule: Schedule): Promise<string | null> {
    if (schedule.type === 'pr-review-pipeline' || !this.config) return null;
    const maxPrs = schedule.maxActivePrs ?? 0;
    if (maxPrs <= 0) return null;
    try {
      const hosts = getAllGitHosts(this.config);
      let totalActive = 0;
      for (const { provider } of hosts) {
        if (!provider.capabilities.has('pullRequests')) continue;
        const me = await provider.whoAmI();
        for (const repo of await provider.listRepos()) {
          const prs = await provider.listPullRequests(repo.fullName, { state: 'open', limit: 100 });
          totalActive += prs.filter((pr) => pr.author?.id === me.id && (pr.labels ?? []).some((l) => l.toLowerCase() === 'automated')).length;
        }
      }
      if (totalActive >= maxPrs) {
        return `Skipped: ${totalActive} active automated PRs (limit: ${maxPrs}). Merge or close existing PRs before creating new ones.`;
      }
    } catch (e) {
      console.warn('[scheduler] PR gate check failed, proceeding anyway:', e);
    }
    return null;
  }

  /**
   * Build a warning about files currently modified by open PRs.
   * Injected into the Claude prompt so it avoids touching those files.
   */
  private async buildActiveFileWarning(schedule: Schedule): Promise<string> {
    if (schedule.type === 'pr-review-pipeline' || !this.config) return '';

    try {
      const filesByRepo: Map<string, Set<string>> = new Map();
      for (const { provider } of getAllGitHosts(this.config)) {
        if (!provider.capabilities.has('pullRequests')) continue;
        for (const repo of await provider.listRepos()) {
          const prs = await provider.listPullRequests(repo.fullName, { state: 'open', limit: 50 });
          const files = new Set<string>();
          for (const pr of prs) {
            try {
              const diff = await provider.getPullRequestDiff(repo.fullName, pr.number);
              for (const m of diff.matchAll(/^\+\+\+ b\/(.+)$/gm)) files.add(m[1]);
            } catch {
              // Skip PRs we can't read
            }
          }
          if (files.size > 0) filesByRepo.set(repo.fullName, files);
        }
      }

      if (filesByRepo.size === 0) return '';

      const lines: string[] = [
        'IMPORTANT — EXISTING OPEN PULL REQUESTS:',
        'The following files are currently being modified by open PRs.',
        'Do NOT modify these files to avoid merge conflicts.',
        'If your task requires changing one of these files, skip that file and note it in your output.',
        '',
      ];
      for (const [repoName, files] of filesByRepo) {
        lines.push(`Repository: ${repoName}`);
        const sorted = [...files].sort();
        // Limit to 100 files to avoid prompt bloat
        const shown = sorted.slice(0, 100);
        for (const f of shown) {
          lines.push(`  - ${f}`);
        }
        if (sorted.length > 100) {
          lines.push(`  ... and ${sorted.length - 100} more files`);
        }
      }
      lines.push('');
      return lines.join('\n');
    } catch (e) {
      console.warn('[scheduler] Failed to build active file warning:', e);
      return '';
    }
  }

  private computeNextRun(schedule: Schedule): Date | null {
    if (schedule.cronExpression) {
      try {
        const expr = CronExpressionParser.parse(schedule.cronExpression);
        return expr.next().toDate();
      } catch (err) {
        console.error(`[scheduler] Invalid cron expression "${schedule.cronExpression}":`, err);
        return null;
      }
    }

    if (schedule.intervalMs) {
      const base = schedule.lastRunAt ? new Date(schedule.lastRunAt).getTime() : Date.now();
      const next = base + schedule.intervalMs;
      // If next is in the past (e.g., server was down), run immediately
      return new Date(Math.max(next, Date.now() + 1000));
    }

    return null;
  }
}
