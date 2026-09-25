/**
 * Automatic session time tracking.
 *
 * Tracks when Claude Code sessions are actively "working" and logs
 * time blocks to SQLite (always) and optionally to SQL Server.
 *
 * A time block starts when a session enters "working" status and ends
 * when it transitions to any other status or when the idle threshold is reached.
 */

import { getDb } from '../db.js';
import { isIncognitoSession, isIncognitoId, isIncognitoProjectLabel } from '../privacy/incognito.js';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimeBlock {
  id?: number;
  sessionId: string;
  project: string;
  username: string;
  startTime: string;   // ISO 8601
  endTime: string | null;
  durationSeconds: number;
  workItemId: number | null;
  idleDetected: boolean;
}

export interface ActiveSession {
  sessionId: string;
  project: string;
  startTime: string;
  workItemId: number | null;
}

// ---------------------------------------------------------------------------
// Idle threshold (15 min default)
// ---------------------------------------------------------------------------

const IDLE_THRESHOLD_MS = 15 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// SQLite schema
// ---------------------------------------------------------------------------

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS time_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    project TEXT NOT NULL,
    username TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    duration_seconds INTEGER DEFAULT 0,
    work_item_id INTEGER,
    idle_detected INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`;

const CREATE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_time_blocks_session ON time_blocks(session_id)
`;

const CREATE_DATE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_time_blocks_date ON time_blocks(start_time)
`;

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

export class SessionTimeTracker {
  /** Sessions currently in "working" state: sessionId → tracking info */
  private activeSessions = new Map<string, { startTime: Date; project: string; workItemId: number | null; lastActivity: Date }>();
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private username: string;

  constructor() {
    this.username = process.env.HIVE_SERVICE_USER
      || os.userInfo().username
      || 'unknown';
    this.ensureTable();
  }

  private ensureTable(): void {
    try {
      const db = getDb();
      db.exec(CREATE_TABLE_SQL);
      db.exec(CREATE_INDEX_SQL);
      db.exec(CREATE_DATE_INDEX_SQL);
    } catch (err) {
      console.warn('[time-tracker] Failed to create time_blocks table:', (err as Error).message);
    }
  }

  /** Start the idle check timer */
  start(): void {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => this.checkIdle(), IDLE_CHECK_INTERVAL_MS);
  }

  /** Stop the tracker and close all active blocks */
  stop(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    // Close all active sessions
    for (const [sessionId] of this.activeSessions) {
      this.clockOut(sessionId, true);
    }
  }

  /**
   * Called when a session's status changes.
   * Automatically clocks in when "working" and clocks out otherwise.
   */
  onSessionStatusChange(sessionId: string, status: string, project: string, workItemId?: number | null): void {
    if (status === 'working') {
      this.clockIn(sessionId, project, workItemId ?? null);
    } else {
      this.clockOut(sessionId, false);
    }
  }

  /** Record activity for a session (resets idle timer) */
  recordActivity(sessionId: string): void {
    const active = this.activeSessions.get(sessionId);
    if (active) {
      active.lastActivity = new Date();
    }
  }

  /**
   * Ensure a working session is being tracked.
   * If it's already clocked in, just refresh activity.
   * If it was evicted by the idle checker, clock it back in.
   */
  ensureTracking(sessionId: string, project: string, workItemId?: number | null): void {
    if (this.activeSessions.has(sessionId)) {
      this.recordActivity(sessionId);
    } else {
      // Was idle-evicted but session is still working — re-clock-in
      this.clockIn(sessionId, project, workItemId ?? null);
    }
  }

  /** Manually clock in */
  clockIn(sessionId: string, project: string, workItemId: number | null): void {
    // Incognito sessions produce no time_blocks rows at all, so they never
    // reach the Analytics time/turn tabs. `project` here is a label, not a
    // path, so the id-and-transcript lookup does the work.
    if (isIncognitoSession(sessionId)) return;

    if (this.activeSessions.has(sessionId)) {
      // Already clocked in — just update activity
      this.recordActivity(sessionId);
      return;
    }

    const now = new Date();
    this.activeSessions.set(sessionId, {
      startTime: now,
      project,
      workItemId,
      lastActivity: now,
    });
  }

  /** Manually clock out */
  clockOut(sessionId: string, idleDetected: boolean): void {
    const active = this.activeSessions.get(sessionId);
    if (!active) return;

    this.activeSessions.delete(sessionId);

    const endTime = new Date();
    const durationSeconds = Math.round((endTime.getTime() - active.startTime.getTime()) / 1000);

    // Don't log blocks shorter than 5 seconds
    if (durationSeconds < 5) return;

    this.insertTimeBlock({
      sessionId,
      project: active.project,
      username: this.username,
      startTime: active.startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationSeconds,
      workItemId: active.workItemId,
      idleDetected,
    });
  }

  /** Get currently active (clocked-in) sessions */
  getActiveSessions(): ActiveSession[] {
    const result: ActiveSession[] = [];
    for (const [sessionId, info] of this.activeSessions) {
      if (isIncognitoSession(sessionId)) continue;
      result.push({
        sessionId,
        project: info.project,
        startTime: info.startTime.toISOString(),
        workItemId: info.workItemId,
      });
    }
    return result;
  }

  /** Get time blocks for a date range */
  getTimeBlocks(days: number = 30): TimeBlock[] {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT id, session_id, project, username, start_time, end_time,
               duration_seconds, work_item_id, idle_detected
        FROM time_blocks
        WHERE start_time >= datetime('now', ?)
        ORDER BY start_time DESC
      `).all(`-${days} days`) as Array<{
        id: number;
        session_id: string;
        project: string;
        username: string;
        start_time: string;
        end_time: string | null;
        duration_seconds: number;
        work_item_id: number | null;
        idle_detected: number;
      }>;

      // Drop rows for sessions that are incognito now, even if they were
      // recorded before the mark (marking doesn't delete history, it just
      // stops surfacing it). Cheap: id lookups hit an in-memory set.
      return rows
        .filter(r => !isIncognitoId(r.session_id) && !isIncognitoProjectLabel(r.project))
        .map(r => ({
          id: r.id,
          sessionId: r.session_id,
          project: r.project,
          username: r.username,
          startTime: r.start_time,
          endTime: r.end_time,
          durationSeconds: r.duration_seconds,
          workItemId: r.work_item_id,
          idleDetected: r.idle_detected === 1,
        }));
    } catch (err) {
      console.warn('[time-tracker] Failed to query time_blocks:', (err as Error).message);
      return [];
    }
  }

  /**
   * Get daily summary (total hours per day) for the last N days.
   *
   * Incognito rows are dropped before aggregating, not in the WHERE clause: a
   * row can be incognito because its id was marked *or* because its project
   * was, and time_blocks only stores a project label, so the decision needs
   * both checks per row.
   */
  getDailySummary(days: number = 30): Array<{ date: string; totalSeconds: number; sessionCount: number }> {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT DATE(start_time) as date,
               session_id,
               project,
               duration_seconds
        FROM time_blocks
        WHERE start_time >= datetime('now', ?)
      `).all(`-${days} days`) as Array<{
        date: string;
        session_id: string;
        project: string;
        duration_seconds: number;
      }>;

      const byDate = new Map<string, { totalSeconds: number; sessions: Set<string> }>();
      for (const r of rows) {
        if (isIncognitoId(r.session_id) || isIncognitoProjectLabel(r.project)) continue;
        const bucket = byDate.get(r.date) ?? { totalSeconds: 0, sessions: new Set<string>() };
        bucket.totalSeconds += r.duration_seconds;
        bucket.sessions.add(r.session_id);
        byDate.set(r.date, bucket);
      }

      return Array.from(byDate, ([date, v]) => ({
        date,
        totalSeconds: v.totalSeconds,
        sessionCount: v.sessions.size,
      })).sort((a, b) => b.date.localeCompare(a.date));
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private checkIdle(): void {
    const now = Date.now();
    for (const [sessionId, info] of this.activeSessions) {
      if (now - info.lastActivity.getTime() > IDLE_THRESHOLD_MS) {
        console.log(`[time-tracker] Session ${sessionId} idle for >${IDLE_THRESHOLD_MS / 60000}min, auto clock-out`);
        this.clockOut(sessionId, true);
      }
    }
  }

  private insertTimeBlock(block: TimeBlock): void {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO time_blocks (session_id, project, username, start_time, end_time, duration_seconds, work_item_id, idle_detected)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        block.sessionId,
        block.project,
        block.username,
        block.startTime,
        block.endTime,
        block.durationSeconds,
        block.workItemId,
        block.idleDetected ? 1 : 0,
      );
    } catch (err) {
      console.warn('[time-tracker] Failed to insert time block:', (err as Error).message);
    }
  }
}
