import { EventEmitter } from 'node:events';
import { isWindows, isMac } from '../platform.js';
import { sendMacNotification } from './macos.js';
import { sendWindowsNotification } from './windows.js';
import type { Aggregator } from '../state/aggregator.js';
import type { NotificationConfig, Session, WsMessageType } from '../types.js';

const DEDUP_WINDOW_MS = 30_000;
const CLEANUP_INTERVAL_MS = 60_000;

// How long to wait before sending a "done" notification.
// If the session goes back to "working" within this window, the notification is cancelled.
// This prevents false "done" notifications when Claude is between tool calls.
const DONE_SETTLE_MS = 10_000;

const NOTIFIABLE_STATUSES = new Set<Session['status']>([
  'done',
  'waiting-input',
  'waiting-approval',
  'error',
]);

interface NotificationFiredPayload {
  sessionId: string;
  suppressBrowser: boolean;
}

export class Notifier extends EventEmitter {
  private dedup: Map<string, number>;
  private config: NotificationConfig;
  private aggregator: Aggregator;
  private prevSessions: Session[];
  private cleanupInterval: ReturnType<typeof setInterval> | null;

  /** Pending "done" notifications waiting to settle before firing */
  private pendingDone: Map<string, ReturnType<typeof setTimeout>>;

  constructor(aggregator: Aggregator, config: NotificationConfig) {
    super();
    this.aggregator = aggregator;
    this.config = config;
    this.dedup = new Map();
    this.prevSessions = [];
    this.cleanupInterval = null;
    this.pendingDone = new Map();
  }

  start(): void {
    // Snapshot current sessions so we only notify on NEW transitions, not existing state
    this.prevSessions = [...this.aggregator.getState().sessions];
    this.aggregator.on('change', this.handleChange);

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [sessionId, lastNotifiedMs] of this.dedup) {
        if (now - lastNotifiedMs > DEDUP_WINDOW_MS) {
          this.dedup.delete(sessionId);
        }
      }
    }, CLEANUP_INTERVAL_MS);
  }

  private handleChange = (type: WsMessageType): void => {
    if (type !== 'sessions_updated' && type !== 'event_added') return;

    const currentSessions = this.aggregator.getState().sessions;
    const staleTeamSessionIds = this.getStaleTeamSessionIds();

    for (const session of currentSessions) {
      // Cancel pending "done" notification if session went back to a non-done status
      if (this.pendingDone.has(session.id) && session.status !== 'done') {
        console.log(`[notifier] Cancelled pending done: ${session.id.slice(0, 8)}… (now ${session.status})`);
        clearTimeout(this.pendingDone.get(session.id)!);
        this.pendingDone.delete(session.id);
      }

      if (!NOTIFIABLE_STATUSES.has(session.status)) continue;

      // Skip sessions belonging to stale teams
      if (staleTeamSessionIds.has(session.id)) continue;

      // Only notify on transitions INTO the notifiable status
      const prev = this.prevSessions.find((s) => s.id === session.id);
      if (prev?.status === session.status) continue;

      console.log(`[notifier] Transition: ${session.id.slice(0, 8)}… ${prev?.status ?? 'new'} → ${session.status}`);

      if (session.status === 'done') {
        // Don't fire immediately — wait for the status to settle.
        // If it flips back to working within DONE_SETTLE_MS, we cancel.
        if (!this.pendingDone.has(session.id)) {
          const timer = setTimeout(() => {
            this.pendingDone.delete(session.id);
            // Re-check: is the session STILL done?
            const current = this.aggregator.getState().sessions.find(s => s.id === session.id);
            if (current && current.status === 'done') {
              console.log(`[notifier] Done settled: ${session.id.slice(0, 8)}…`);
              this.notify(current);
            } else {
              console.log(`[notifier] Done expired (no longer done): ${session.id.slice(0, 8)}…`);
            }
          }, DONE_SETTLE_MS);
          this.pendingDone.set(session.id, timer);
        }
      } else {
        // waiting-input, waiting-approval, error — notify immediately
        this.notify(session);
      }
    }

    this.prevSessions = [...currentSessions];
  };

  private getStaleTeamSessionIds(): Set<string> {
    const staleIds = new Set<string>();
    const { teams } = this.aggregator.getState();

    for (const team of teams) {
      if (!team.stale) continue;

      if (team.leadSessionId) staleIds.add(team.leadSessionId);
      for (const member of team.members) {
        if (member.agentId) staleIds.add(member.agentId);
      }
    }

    return staleIds;
  }

  private notify(session: Session): void {
    const now = Date.now();

    // Dedup: skip if notified within the window
    const lastNotified = this.dedup.get(session.id);
    if (lastNotified !== undefined && now - lastNotified < DEDUP_WINDOW_MS) {
      console.log(`[notifier] Dedup skip: ${session.id.slice(0, 8)}… (${session.status})`);
      return;
    }

    this.dedup.set(session.id, now);

    const statusLabel =
      session.status === 'done'
        ? 'Done'
        : session.status === 'waiting-input'
          ? 'Needs input'
          : session.status === 'waiting-approval'
            ? 'Needs approval'
            : 'Error';

    const nativeEnabled = this.config.macOS; // config key is "macOS" but means "native OS notifications"
    console.log(`[notifier] Sending: ${statusLabel} for ${session.id.slice(0, 8)}… (native: ${nativeEnabled}, browser: ${this.config.browser})`);

    if (nativeEnabled) {
      const title = `SI Hive: ${statusLabel}`;
      const body = `Session ${session.id.slice(0, 8)}… in ${session.project}`;
      if (isMac) {
        sendMacNotification(title, body);
      } else if (isWindows) {
        sendWindowsNotification(title, body);
      }
    }

    const payload: NotificationFiredPayload = {
      sessionId: session.id,
      suppressBrowser: nativeEnabled,
    };
    this.emit('notification_fired', payload);
  }

  updateConfig(config: NotificationConfig): void {
    this.config = config;
  }

  stop(): void {
    this.aggregator.removeListener('change', this.handleChange);

    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Clear all pending done timers
    for (const timer of this.pendingDone.values()) {
      clearTimeout(timer);
    }
    this.pendingDone.clear();

    this.dedup.clear();
  }
}
