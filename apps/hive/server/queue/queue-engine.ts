import { EventEmitter } from 'node:events';
import {
  getTaskQueue,
  getNextPendingTask,
  updateQueueTask,
  getQueueTasks,
  getAllActiveQueues,
} from '../db.js';
import { sendInput } from '../actions/send-input.js';
import { getPtySession } from '../terminal-pty.js';
import type { Aggregator } from '../state/aggregator.js';
import type { StopHookPayload, QueueTask } from '../types.js';

const DISPATCH_DELAY_MS = 2000;

export class QueueEngine extends EventEmitter {
  private aggregator: Aggregator;
  private dispatching = new Set<string>();
  private dispatchTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(aggregator: Aggregator) {
    super();
    this.aggregator = aggregator;
  }

  /**
   * Called when the Stop hook fires (Claude finished responding).
   * Marks the current in_progress task as completed, then dispatches next.
   */
  handleStopHook(payload: StopHookPayload): void {
    const sessionId = payload.session_id;
    if (!sessionId) return;

    const state = this.aggregator.getState();
    const session = state.sessions.find((s) => s.id === sessionId);
    if (!session) {
      console.log(`[queue-engine] Stop hook for unknown session ${sessionId}`);
      return;
    }

    const queue = getTaskQueue(sessionId);
    if (!queue || queue.paused) return;

    // Don't dispatch if session needs approval (tool permission dialog)
    if (session.status === 'waiting-approval') {
      console.log(`[queue-engine] Session ${sessionId} is waiting-approval, skipping dispatch`);
      return;
    }

    // Mark current in_progress task as completed (Claude just finished it)
    const tasks = getQueueTasks(sessionId);
    const currentTask = tasks.find((t) => t.status === 'in_progress');
    if (currentTask) {
      updateQueueTask(currentTask.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
      console.log(`[queue-engine] Task ${currentTask.id} completed (stop hook)`);
      this.emit('queue_changed', sessionId);
    }

    const paneId = session.paneId ?? '';

    // Need either a PTY session or a paneId to dispatch
    const hasPty = !!getPtySession(sessionId);
    if (!hasPty && !paneId) {
      console.log(`[queue-engine] Session ${sessionId} has no PTY or paneId, cannot dispatch`);
      return;
    }

    // Schedule dispatch with delay to let terminal settle
    this.scheduleDispatch(sessionId, paneId);
  }

  /**
   * Called when a queue is created/unpaused or first task is added.
   * Only dispatches if the session is idle AND there's no active task.
   */
  tryDispatchIfIdle(sessionId: string): void {
    const state = this.aggregator.getState();
    const session = state.sessions.find((s) => s.id === sessionId);
    if (!session) return;

    const queue = getTaskQueue(sessionId);
    if (!queue || queue.paused) return;

    // Only auto-dispatch if session is idle/done/paused (not actively working)
    const idleStatuses = ['done', 'idle', 'paused'];
    if (!idleStatuses.includes(session.status)) return;

    // Don't dispatch if there's already an active task
    const tasks = getQueueTasks(sessionId);
    const hasActive = tasks.some((t) => t.status === 'in_progress' || t.status === 'sending');
    if (hasActive) return;

    const paneId = session.paneId ?? '';
    const hasPty = !!getPtySession(sessionId);
    if (!hasPty && !paneId) return;

    // Check there's actually a pending task
    const next = getNextPendingTask(sessionId);
    if (!next) return;

    console.log(`[queue-engine] Session ${sessionId} is idle with no active task, priming pump`);
    this.scheduleDispatch(sessionId, paneId);
  }

  private scheduleDispatch(sessionId: string, paneId: string): void {
    // Clear any existing timer for this session
    const existing = this.dispatchTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.dispatchTimers.delete(sessionId);
      void this.dispatchNext(sessionId, paneId);
    }, DISPATCH_DELAY_MS);

    this.dispatchTimers.set(sessionId, timer);
  }

  private async dispatchNext(sessionId: string, paneId: string): Promise<void> {
    // Dedup guard
    if (this.dispatching.has(sessionId)) return;
    this.dispatching.add(sessionId);

    try {
      // Re-check session status (may have changed during delay)
      const state = this.aggregator.getState();
      const session = state.sessions.find((s) => s.id === sessionId);
      if (!session) return;
      if (session.status === 'waiting-approval') {
        console.log(`[queue-engine] Session ${sessionId} is waiting-approval, aborting dispatch`);
        return;
      }

      const queue = getTaskQueue(sessionId);
      if (!queue || queue.paused) return;

      // Don't dispatch if there's already an active task
      const tasks = getQueueTasks(sessionId);
      const hasActive = tasks.some((t) => t.status === 'in_progress' || t.status === 'sending');
      if (hasActive) {
        console.log(`[queue-engine] Session ${sessionId} already has an active task, skipping`);
        return;
      }

      // Get next pending task
      const next = getNextPendingTask(sessionId);
      if (!next) {
        console.log(`[queue-engine] Queue empty for session ${sessionId}`);
        this.emit('queue_empty', sessionId);
        this.emit('queue_changed', sessionId);
        return;
      }

      // Mark as sending
      updateQueueTask(next.id, { status: 'sending', startedAt: new Date().toISOString() });
      this.emit('queue_changed', sessionId);

      // Prefer PTY (browser terminal) — write directly to the session's stdin
      const ptySession = getPtySession(sessionId);
      if (ptySession) {
        try {
          // Write text first, then send Enter after a delay so Claude's
          // input handler sees it as a separate keystroke (not part of a paste).
          // Claude Code's TUI detects pastes by timing — chars arriving within
          // ~200ms are grouped as pasted text where \r = newline, not submit.
          ptySession.pty.write(next.prompt);
          await new Promise((r) => setTimeout(r, 500));
          ptySession.pty.write('\r');
          updateQueueTask(next.id, { status: 'in_progress' });
          console.log(`[queue-engine] Dispatched task ${next.id} via PTY to session ${sessionId}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          updateQueueTask(next.id, {
            status: 'failed',
            errorMessage: `PTY write failed: ${msg}`,
            completedAt: new Date().toISOString(),
          });
          console.error(`[queue-engine] PTY write failed for task ${next.id}: ${msg}`);
        }
      } else {
        // Fallback: sendInput for sessions running in external terminals
        const result = await sendInput(
          { paneId, input: next.prompt, type: 'text' },
          this.aggregator,
          true, // bypassLengthCheck flag
        );

        if (result.ok) {
          updateQueueTask(next.id, { status: 'in_progress' });
          console.log(`[queue-engine] Dispatched task ${next.id} via sendInput to session ${sessionId}`);
        } else {
          updateQueueTask(next.id, {
            status: 'failed',
            errorMessage: result.error ?? 'Send failed',
            completedAt: new Date().toISOString(),
          });
          console.error(`[queue-engine] Failed to dispatch task ${next.id}: ${result.error}`);
        }
      }

      this.emit('queue_changed', sessionId);
    } finally {
      this.dispatching.delete(sessionId);
    }
  }

  /**
   * Get all active queues for state broadcasting.
   */
  getQueuesState(): Record<string, { queue: import('../types.js').TaskQueue; tasks: QueueTask[] }> {
    const result: Record<string, { queue: import('../types.js').TaskQueue; tasks: QueueTask[] }> = {};
    const allQueues = getAllActiveQueues();
    for (const { queue, tasks } of allQueues) {
      result[queue.sessionId] = { queue, tasks };
    }
    return result;
  }

  destroy(): void {
    for (const timer of this.dispatchTimers.values()) {
      clearTimeout(timer);
    }
    this.dispatchTimers.clear();
    this.dispatching.clear();
  }
}
