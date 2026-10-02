/**
 * Hook-driven turn time tracker.
 *
 * Records only the time Claude is actively turning — from UserPromptSubmit
 * to Stop. Unlike SessionTimeTracker (which measures any session window
 * marked "working" plus a 15-min idle grace period), this excludes
 * between-turn idle, walk-aways, and the long tail after a session ends.
 *
 * Data flow:
 *   UserPromptSubmit hook → startTurn(sessionId, project, cwd) — record start time
 *   Stop hook              → endTurn(sessionId)       — write turn_blocks row
 *
 * A turn that never receives a Stop (process killed, hook disabled mid-turn)
 * is auto-closed after MAX_TURN_MS so we don't leak in-memory state.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '../db.js';
import { isIncognitoId, isIncognitoPath, isIncognitoProjectLabel, isIncognitoSession, incognitoRoots } from '../privacy/incognito.js';
import { getClaudeProjectsDir } from '../sessions/replay-client.js';
import { decodeClaudeProjectDir } from '../claude-paths.js';

export interface TurnBlock {
  id?: number;
  sessionId: string;
  project: string;
  /** Full working directory — what project-level incognito is keyed on. */
  cwd: string | null;
  username: string;
  startTime: string;   // ISO 8601
  endTime: string;     // ISO 8601
  durationSeconds: number;
}

export interface ActiveTurn {
  sessionId: string;
  project: string;
  startTime: string;
}

const MAX_TURN_MS = 60 * 60 * 1000;          // 1 hour — anything longer is stale
const STALE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const MIN_TURN_SECONDS = 1;

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS turn_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    project TEXT NOT NULL,
    cwd TEXT,
    username TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`;

const CREATE_SESSION_IDX = `CREATE INDEX IF NOT EXISTS idx_turn_blocks_session ON turn_blocks(session_id)`;
const CREATE_DATE_IDX = `CREATE INDEX IF NOT EXISTS idx_turn_blocks_date ON turn_blocks(start_time)`;

export class TurnTimeTracker {
  private active = new Map<string, { startTime: Date; project: string; cwd: string | null }>();
  private staleTimer: ReturnType<typeof setInterval> | null = null;
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
      db.exec(CREATE_SESSION_IDX);
      db.exec(CREATE_DATE_IDX);
      // `cwd` was added after the table shipped — older installs need it
      // backfilled (see backfillCwds) before project-level incognito can be
      // applied to their history.
      const cols = db.prepare(`PRAGMA table_info(turn_blocks)`).all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'cwd')) {
        db.exec(`ALTER TABLE turn_blocks ADD COLUMN cwd TEXT`);
      }
    } catch (err) {
      console.warn('[turn-tracker] Failed to create turn_blocks table:', (err as Error).message);
    }
  }

  start(): void {
    if (this.staleTimer) return;
    this.staleTimer = setInterval(() => this.sweepStale(), STALE_SWEEP_INTERVAL_MS);
    // One-off: rows written before the cwd column existed can't be matched
    // against an incognito project root. Resolve them from the transcripts.
    setTimeout(() => this.backfillCwds(), 2_000).unref?.();
  }

  stop(): void {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    for (const sessionId of [...this.active.keys()]) {
      this.endTurn(sessionId);
    }
  }

  /**
   * Called from the UserPromptSubmit hook. `cwd` is the hook's own cwd — pass
   * it through rather than letting isIncognitoSession fall back to a transcript
   * lookup, and store it so the read side can filter by project root later.
   */
  startTurn(sessionId: string, project: string, cwd: string | null = null): void {
    if (!sessionId) return;
    // No turn_blocks rows for incognito sessions — that's what keeps them out
    // of the Analytics turn tabs.
    if (isIncognitoSession(sessionId, cwd)) return;
    // If a prior turn never closed, write it out with whatever we have so far
    // before opening a fresh one — otherwise the new turn would overwrite it.
    if (this.active.has(sessionId)) {
      this.endTurn(sessionId);
    }
    this.active.set(sessionId, { startTime: new Date(), project: project || 'unknown', cwd });
  }

  /** Called from the Stop hook. */
  endTurn(sessionId: string): void {
    if (!sessionId) return;
    const open = this.active.get(sessionId);
    if (!open) return;
    this.active.delete(sessionId);

    const endTime = new Date();
    const durationSeconds = Math.round((endTime.getTime() - open.startTime.getTime()) / 1000);
    if (durationSeconds < MIN_TURN_SECONDS) return;

    this.insertTurn({
      sessionId,
      project: open.project,
      cwd: open.cwd,
      username: this.username,
      startTime: open.startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationSeconds,
    });
  }

  getActiveTurns(): ActiveTurn[] {
    const result: ActiveTurn[] = [];
    for (const [sessionId, info] of this.active) {
      if (isIncognitoSession(sessionId, info.cwd)) continue;
      result.push({ sessionId, project: info.project, startTime: info.startTime.toISOString() });
    }
    return result;
  }

  /**
   * Every turn in the window that is NOT incognito.
   *
   * Filtering happens here in JS rather than in SQL because a row is incognito
   * for three different reasons and only the first is expressible as a session
   * id list:
   *
   *   - its session id was marked explicitly;
   *   - its cwd sits under an incognito project root (project-level marking,
   *     which also covers rows written *before* the project was marked — the
   *     write gate only stops new ones);
   *   - it predates the cwd column and backfill couldn't resolve a transcript,
   *     so all we can compare is the project label.
   *
   * Volumes are small (a few thousand rows a month), so pulling rows and
   * aggregating in memory costs nothing worth optimizing.
   */
  private visibleTurns(days: number): Array<{ date: string; project: string; durationSeconds: number }> {
    const db = getDb();
    const rows = db.prepare(`
      SELECT DATE(start_time) as date,
             project,
             cwd,
             session_id,
             duration_seconds
      FROM turn_blocks
      WHERE start_time >= datetime('now', ?)
    `).all(`-${days} days`) as Array<{
      date: string;
      project: string;
      cwd: string | null;
      session_id: string;
      duration_seconds: number;
    }>;

    const anyProjects = incognitoRoots().length > 0;
    return rows
      .filter((r) => {
        if (isIncognitoId(r.session_id)) return false;
        if (!anyProjects) return true;
        if (r.cwd) return !isIncognitoPath(r.cwd);
        return !isIncognitoProjectLabel(r.project);
      })
      .map((r) => ({ date: r.date, project: r.project, durationSeconds: r.duration_seconds }));
  }

  getDailySummary(days: number = 30): Array<{ date: string; totalSeconds: number; turnCount: number }> {
    try {
      const byDate = new Map<string, { totalSeconds: number; turnCount: number }>();
      for (const turn of this.visibleTurns(days)) {
        const bucket = byDate.get(turn.date) ?? { totalSeconds: 0, turnCount: 0 };
        bucket.totalSeconds += turn.durationSeconds;
        bucket.turnCount += 1;
        byDate.set(turn.date, bucket);
      }
      return Array.from(byDate, ([date, v]) => ({ date, ...v }))
        .sort((a, b) => b.date.localeCompare(a.date));
    } catch {
      return [];
    }
  }

  getProjectDailySummary(days: number = 30): Array<{ date: string; project: string; totalSeconds: number; turnCount: number }> {
    try {
      const byKey = new Map<string, { date: string; project: string; totalSeconds: number; turnCount: number }>();
      for (const turn of this.visibleTurns(days)) {
        const key = `${turn.date}\u0000${turn.project}`;
        const bucket = byKey.get(key)
          ?? { date: turn.date, project: turn.project, totalSeconds: 0, turnCount: 0 };
        bucket.totalSeconds += turn.durationSeconds;
        bucket.turnCount += 1;
        byKey.set(key, bucket);
      }
      return Array.from(byKey.values())
        .sort((a, b) => (b.date.localeCompare(a.date) || a.project.localeCompare(b.project)));
    } catch {
      return [];
    }
  }

  /**
   * Fill in `cwd` for rows written before the column existed, by locating each
   * session's transcript under ~/.claude/projects and decoding the directory
   * name. One indexed pass over the projects tree, then one UPDATE per session
   * id — after which this finds nothing and does nothing.
   *
   * Rows whose transcript is gone stay NULL and fall back to label matching.
   */
  private backfillCwds(): void {
    try {
      const db = getDb();
      const pending = db.prepare(`
        SELECT DISTINCT session_id FROM turn_blocks WHERE cwd IS NULL
      `).all() as Array<{ session_id: string }>;
      if (pending.length === 0) return;

      // session id → encoded project dir, from a single readdir per project dir
      const root = getClaudeProjectsDir();
      const index = new Map<string, string>();
      let dirs: string[] = [];
      try {
        dirs = fs.readdirSync(root, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {
        return;
      }
      for (const dir of dirs) {
        try {
          for (const file of fs.readdirSync(path.join(root, dir))) {
            if (file.endsWith('.jsonl')) index.set(file.slice(0, -6), dir);
          }
        } catch { /* unreadable project dir */ }
      }

      // Decode each *directory* once, not each session.
      const decoded = new Map<string, string>();
      const decode = (dir: string): string => {
        const hit = decoded.get(dir);
        if (hit !== undefined) return hit;
        let out = dir;
        try {
          out = decodeClaudeProjectDir(dir, root);
        } catch { /* keep the raw name */ }
        decoded.set(dir, out);
        return out;
      };

      const update = db.prepare(`UPDATE turn_blocks SET cwd = ? WHERE session_id = ? AND cwd IS NULL`);
      let filled = 0;
      const run = db.transaction(() => {
        for (const { session_id } of pending) {
          const dir = index.get(session_id);
          if (!dir) continue;
          update.run(decode(dir), session_id);
          filled++;
        }
      });
      run();
      // Sessions whose transcript is already gone can never be filled, so this
      // stays quiet unless it actually did something.
      if (filled > 0) {
        console.log(`[turn-tracker] Backfilled cwd for ${filled}/${pending.length} session(s)`);
      }
    } catch (err) {
      console.warn('[turn-tracker] cwd backfill failed:', (err as Error).message);
    }
  }

  private sweepStale(): void {
    const now = Date.now();
    for (const [sessionId, info] of this.active) {
      if (now - info.startTime.getTime() > MAX_TURN_MS) {
        console.log(`[turn-tracker] Turn ${sessionId} exceeded ${MAX_TURN_MS / 60000}min, auto-closing`);
        this.endTurn(sessionId);
      }
    }
  }

  private insertTurn(block: TurnBlock): void {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO turn_blocks (session_id, project, cwd, username, start_time, end_time, duration_seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        block.sessionId,
        block.project,
        block.cwd,
        block.username,
        block.startTime,
        block.endTime,
        block.durationSeconds,
      );
    } catch (err) {
      console.warn('[turn-tracker] Failed to insert turn block:', (err as Error).message);
    }
  }
}
