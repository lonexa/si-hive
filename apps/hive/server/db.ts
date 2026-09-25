import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { HookEvent, TaskQueue, QueueTask, LiveLoop, Schedule, ScheduleRun, ScheduleRunStatus, SessionTemplate, SavedPrompt } from './types.js';
import { hiveHome } from '../../../packages/shared/src/server/paths.js';

const DB_DIR = hiveHome();
const DB_PATH = path.join(DB_DIR, 'hive.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(DB_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      project TEXT,
      metadata_json TEXT
    )
  `);

  // Index for querying by session and time
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
  `);

  // --- Task Queue tables ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_queues (
      session_id TEXT PRIMARY KEY,
      paused INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS queue_tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      error_message TEXT,
      FOREIGN KEY (session_id) REFERENCES task_queues(session_id)
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_queue_tasks_session ON queue_tasks(session_id, position);
  `);

  // --- Live Loops table ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS live_loops (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      interval TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      stopped_at TEXT,
      source TEXT DEFAULT 'hive',
      devops_ticket_id INTEGER,
      metadata_json TEXT
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_live_loops_session ON live_loops(session_id);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_live_loops_status ON live_loops(status);
  `);

  // --- Schedules tables ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cron_expression TEXT,
      interval_ms INTEGER,
      project_path TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_run_at TEXT,
      next_run_at TEXT,
      launch_flags_json TEXT,
      max_runs_kept INTEGER NOT NULL DEFAULT 50
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run_at)`);

  // Add type column if not present (for pr-review-pipeline schedules)
  try {
    db.exec(`ALTER TABLE schedules ADD COLUMN type TEXT DEFAULT 'claude-prompt'`);
  } catch { /* column already exists */ }

  // Add max_active_prs column (limits concurrent open PRs per schedule)
  try {
    db.exec(`ALTER TABLE schedules ADD COLUMN max_active_prs INTEGER DEFAULT 0`);
  } catch { /* column already exists */ }

  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_runs (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      exit_code INTEGER,
      output TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      FOREIGN KEY (schedule_id) REFERENCES schedules(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule ON schedule_runs(schedule_id, started_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_schedule_runs_status ON schedule_runs(status)`);

  // --- Session Templates table ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      project_path TEXT NOT NULL DEFAULT '',
      initial_prompt TEXT NOT NULL DEFAULT '',
      permission_mode TEXT NOT NULL DEFAULT 'default',
      model TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      category TEXT NOT NULL DEFAULT 'General',
      icon TEXT,
      context_paths_json TEXT NOT NULL DEFAULT '[]',
      usage_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Add context_paths_json column if it doesn't exist (migration for existing DBs)
  try {
    db.exec(`ALTER TABLE session_templates ADD COLUMN context_paths_json TEXT NOT NULL DEFAULT '[]'`);
  } catch { /* column already exists */ }
  // Add provider column if it doesn't exist (migration for existing DBs)
  try {
    db.exec(`ALTER TABLE session_templates ADD COLUMN provider TEXT`);
  } catch { /* column already exists */ }

  // --- Saved Prompts table ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_prompts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      category TEXT NOT NULL DEFAULT 'General',
      usage_count INTEGER NOT NULL DEFAULT 0,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // --- SQL Workbench History table ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS sql_workbench_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      database TEXT NOT NULL,
      query TEXT NOT NULL,
      executed_at TEXT NOT NULL DEFAULT (datetime('now')),
      row_count INTEGER,
      duration_ms INTEGER,
      error TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sql_workbench_history_time ON sql_workbench_history(executed_at DESC)`);

  // --- Codebase Scan Results table ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      scan_date TEXT NOT NULL DEFAULT (datetime('now')),
      health_score INTEGER,
      todo_count INTEGER,
      fixme_count INTEGER,
      total_files INTEGER,
      total_size_mb REAL,
      outdated_deps INTEGER,
      results_json TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_results_project ON scan_results(project_path, scan_date DESC)`);

  // --- Chat Conversations table ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Chat',
      project_path TEXT,
      claude_session_id TEXT,
      pty_terminal_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      user_email TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_conversations_user ON chat_conversations(user_email)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated ON chat_conversations(updated_at DESC)`);
  // Migration: add is_starred column
  try { db.exec(`ALTER TABLE chat_conversations ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0`); } catch { /* already exists */ }

  // --- Chat Messages table ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      content TEXT NOT NULL,
      tool_name TEXT,
      tool_id TEXT,
      model TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, timestamp)`);

  console.log(`[db] SQLite database initialized at ${DB_PATH}`);
  return db;
}

export function insertEvent(event: HookEvent): void {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT OR REPLACE INTO events (id, type, session_id, timestamp, message, project, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    event.id,
    event.type,
    event.sessionId,
    event.timestamp,
    event.message,
    event.project ?? null,
    event.metadata ? JSON.stringify(event.metadata) : null
  );
}

export function getRecentEvents(limit = 100): HookEvent[] {
  const database = getDb();
  const rows = database
    .prepare(`SELECT * FROM events ORDER BY timestamp DESC LIMIT ?`)
    .all(limit) as Array<{
    id: string;
    type: string;
    session_id: string;
    timestamp: string;
    message: string;
    project: string | null;
    metadata_json: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    message: row.message,
    project: row.project ?? undefined,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
  }));
}

export function getEventsBySession(sessionId: string, limit = 50): HookEvent[] {
  const database = getDb();
  const rows = database
    .prepare(`SELECT * FROM events WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`)
    .all(sessionId, limit) as Array<{
    id: string;
    type: string;
    session_id: string;
    timestamp: string;
    message: string;
    project: string | null;
    metadata_json: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    message: row.message,
    project: row.project ?? undefined,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
  }));
}

// --- Task Queue helpers ---

type QueueTaskRow = {
  id: string;
  session_id: string;
  position: number;
  prompt: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
};

function rowToQueueTask(row: QueueTaskRow): QueueTask {
  return {
    id: row.id,
    sessionId: row.session_id,
    position: row.position,
    prompt: row.prompt,
    status: row.status as QueueTask['status'],
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    errorMessage: row.error_message ?? undefined,
  };
}

export function upsertTaskQueue(sessionId: string): TaskQueue {
  const database = getDb();
  database.prepare(`
    INSERT INTO task_queues (session_id) VALUES (?)
    ON CONFLICT(session_id) DO UPDATE SET updated_at = datetime('now')
  `).run(sessionId);
  return getTaskQueue(sessionId)!;
}

export function getTaskQueue(sessionId: string): TaskQueue | null {
  const database = getDb();
  const row = database.prepare(`SELECT * FROM task_queues WHERE session_id = ?`).get(sessionId) as {
    session_id: string; paused: number; created_at: string; updated_at: string;
  } | undefined;
  if (!row) return null;
  return { sessionId: row.session_id, paused: row.paused === 1, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function getAllActiveQueues(): Array<{ queue: TaskQueue; tasks: QueueTask[] }> {
  const database = getDb();
  const rows = database.prepare(`SELECT * FROM task_queues`).all() as Array<{
    session_id: string; paused: number; created_at: string; updated_at: string;
  }>;
  return rows.map((row) => {
    const queue: TaskQueue = { sessionId: row.session_id, paused: row.paused === 1, createdAt: row.created_at, updatedAt: row.updated_at };
    const tasks = getQueueTasks(row.session_id);
    return { queue, tasks };
  });
}

export function insertQueueTask(sessionId: string, prompt: string): QueueTask {
  const database = getDb();
  upsertTaskQueue(sessionId);
  const maxPos = database.prepare(`SELECT MAX(position) as max_pos FROM queue_tasks WHERE session_id = ?`).get(sessionId) as { max_pos: number | null };
  const position = (maxPos.max_pos ?? -1) + 1;
  const id = randomUUID();
  database.prepare(`
    INSERT INTO queue_tasks (id, session_id, position, prompt) VALUES (?, ?, ?, ?)
  `).run(id, sessionId, position, prompt);
  database.prepare(`UPDATE task_queues SET updated_at = datetime('now') WHERE session_id = ?`).run(sessionId);
  return { id, sessionId, position, prompt, status: 'pending', createdAt: new Date().toISOString() };
}

export function getQueueTasks(sessionId: string): QueueTask[] {
  const database = getDb();
  const rows = database.prepare(`SELECT * FROM queue_tasks WHERE session_id = ? ORDER BY position`).all(sessionId) as QueueTaskRow[];
  return rows.map(rowToQueueTask);
}

export function getNextPendingTask(sessionId: string): QueueTask | null {
  const database = getDb();
  const row = database.prepare(`SELECT * FROM queue_tasks WHERE session_id = ? AND status = 'pending' ORDER BY position LIMIT 1`).get(sessionId) as QueueTaskRow | undefined;
  return row ? rowToQueueTask(row) : null;
}

export function updateQueueTask(id: string, updates: Partial<Pick<QueueTask, 'prompt' | 'status' | 'startedAt' | 'completedAt' | 'errorMessage'>>): void {
  const database = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.prompt !== undefined) { sets.push('prompt = ?'); values.push(updates.prompt); }
  if (updates.status !== undefined) { sets.push('status = ?'); values.push(updates.status); }
  if (updates.startedAt !== undefined) { sets.push('started_at = ?'); values.push(updates.startedAt); }
  if (updates.completedAt !== undefined) { sets.push('completed_at = ?'); values.push(updates.completedAt); }
  if (updates.errorMessage !== undefined) { sets.push('error_message = ?'); values.push(updates.errorMessage); }
  if (sets.length === 0) return;
  values.push(id);
  database.prepare(`UPDATE queue_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  // Update parent queue timestamp
  const task = database.prepare(`SELECT session_id FROM queue_tasks WHERE id = ?`).get(id) as { session_id: string } | undefined;
  if (task) database.prepare(`UPDATE task_queues SET updated_at = datetime('now') WHERE session_id = ?`).run(task.session_id);
}

export function reorderQueueTasks(sessionId: string, taskIds: string[]): void {
  const database = getDb();
  const update = database.prepare(`UPDATE queue_tasks SET position = ? WHERE id = ? AND session_id = ?`);
  const txn = database.transaction(() => {
    for (let i = 0; i < taskIds.length; i++) {
      update.run(i, taskIds[i], sessionId);
    }
  });
  txn();
  database.prepare(`UPDATE task_queues SET updated_at = datetime('now') WHERE session_id = ?`).run(sessionId);
}

export function deleteQueueTask(id: string): string | null {
  const database = getDb();
  const task = database.prepare(`SELECT session_id FROM queue_tasks WHERE id = ?`).get(id) as { session_id: string } | undefined;
  if (!task) return null;
  database.prepare(`DELETE FROM queue_tasks WHERE id = ?`).run(id);
  database.prepare(`UPDATE task_queues SET updated_at = datetime('now') WHERE session_id = ?`).run(task.session_id);
  return task.session_id;
}

export function clearCompletedTasks(sessionId: string): void {
  const database = getDb();
  database.prepare(`DELETE FROM queue_tasks WHERE session_id = ? AND status IN ('completed', 'failed', 'skipped')`).run(sessionId);
  database.prepare(`UPDATE task_queues SET updated_at = datetime('now') WHERE session_id = ?`).run(sessionId);
}

export function updateTaskQueuePaused(sessionId: string, paused: boolean): void {
  const database = getDb();
  upsertTaskQueue(sessionId);
  database.prepare(`UPDATE task_queues SET paused = ?, updated_at = datetime('now') WHERE session_id = ?`).run(paused ? 1 : 0, sessionId);
}

// --- Live Loop helpers ---

type LiveLoopRow = {
  id: string;
  session_id: string;
  interval: string;
  prompt: string;
  status: string;
  created_at: string;
  stopped_at: string | null;
  source: string;
  devops_ticket_id: number | null;
  metadata_json: string | null;
};

function rowToLiveLoop(row: LiveLoopRow): LiveLoop {
  return {
    id: row.id,
    sessionId: row.session_id,
    interval: row.interval,
    prompt: row.prompt,
    status: row.status as LiveLoop['status'],
    createdAt: row.created_at,
    stoppedAt: row.stopped_at ?? undefined,
    source: row.source as LiveLoop['source'],
    ticketId: row.devops_ticket_id != null ? String(row.devops_ticket_id) : undefined,
  };
}

export function insertLiveLoop(sessionId: string, interval: string, prompt: string, source: 'hive' | 'tracker' = 'hive', ticketId?: string): LiveLoop {
  const database = getDb();
  const id = randomUUID();
  database.prepare(`
    INSERT INTO live_loops (id, session_id, interval, prompt, source, devops_ticket_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, sessionId, interval, prompt, source, ticketId ?? null);
  return {
    id,
    sessionId,
    interval,
    prompt,
    status: 'active',
    createdAt: new Date().toISOString(),
    source,
    ticketId,
  };
}

export function getLiveLoops(sessionId?: string): LiveLoop[] {
  const database = getDb();
  let rows: LiveLoopRow[];
  if (sessionId) {
    rows = database.prepare(`SELECT * FROM live_loops WHERE session_id = ? ORDER BY created_at DESC`).all(sessionId) as LiveLoopRow[];
  } else {
    rows = database.prepare(`SELECT * FROM live_loops ORDER BY created_at DESC`).all() as LiveLoopRow[];
  }
  return rows.map(rowToLiveLoop);
}

export function getActiveLiveLoops(sessionId?: string): LiveLoop[] {
  const database = getDb();
  let rows: LiveLoopRow[];
  if (sessionId) {
    rows = database.prepare(`SELECT * FROM live_loops WHERE session_id = ? AND status = 'active' ORDER BY created_at DESC`).all(sessionId) as LiveLoopRow[];
  } else {
    rows = database.prepare(`SELECT * FROM live_loops WHERE status = 'active' ORDER BY created_at DESC`).all() as LiveLoopRow[];
  }
  return rows.map(rowToLiveLoop);
}

export function stopLiveLoop(loopId: string): LiveLoop | null {
  const database = getDb();
  const row = database.prepare(`SELECT * FROM live_loops WHERE id = ?`).get(loopId) as LiveLoopRow | undefined;
  if (!row) return null;
  database.prepare(`UPDATE live_loops SET status = 'stopped', stopped_at = datetime('now') WHERE id = ?`).run(loopId);
  return { ...rowToLiveLoop(row), status: 'stopped', stoppedAt: new Date().toISOString() };
}

export function markSessionLoopsStopped(sessionId: string): number {
  const database = getDb();
  const result = database.prepare(`UPDATE live_loops SET status = 'session_ended', stopped_at = datetime('now') WHERE session_id = ? AND status = 'active'`).run(sessionId);
  return result.changes;
}

// --- Schedule helpers ---

type ScheduleRow = {
  id: string;
  name: string;
  prompt: string;
  cron_expression: string | null;
  interval_ms: number | null;
  project_path: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  next_run_at: string | null;
  launch_flags_json: string | null;
  max_runs_kept: number;
  type: string | null;
  max_active_prs: number | null;
};

function rowToSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    cronExpression: row.cron_expression ?? undefined,
    intervalMs: row.interval_ms ?? undefined,
    projectPath: row.project_path ?? undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
    launchFlags: row.launch_flags_json ? JSON.parse(row.launch_flags_json) : undefined,
    maxRunsKept: row.max_runs_kept,
    type: (row.type as Schedule['type']) ?? 'claude-prompt',
    maxActivePrs: row.max_active_prs ?? undefined,
  };
}

export function insertSchedule(data: {
  name: string;
  prompt: string;
  cronExpression?: string;
  intervalMs?: number;
  projectPath?: string;
  enabled?: boolean;
  launchFlags?: { dangerouslySkipPermissions?: boolean; autoMode?: boolean };
  maxRunsKept?: number;
  type?: 'claude-prompt' | 'pr-review-pipeline';
  maxActivePrs?: number;
}): Schedule {
  const database = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO schedules (id, name, prompt, cron_expression, interval_ms, project_path, enabled, created_at, updated_at, launch_flags_json, max_runs_kept, type, max_active_prs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.prompt,
    data.cronExpression ?? null,
    data.intervalMs ?? null,
    data.projectPath ?? null,
    data.enabled !== false ? 1 : 0,
    now,
    now,
    data.launchFlags ? JSON.stringify(data.launchFlags) : null,
    data.maxRunsKept ?? 50,
    data.type ?? 'claude-prompt',
    data.maxActivePrs ?? 0,
  );
  return getSchedule(id)!;
}

export function getSchedule(id: string): Schedule | null {
  const database = getDb();
  const row = database.prepare(`SELECT * FROM schedules WHERE id = ?`).get(id) as ScheduleRow | undefined;
  return row ? rowToSchedule(row) : null;
}

export function getAllSchedules(): Schedule[] {
  const database = getDb();
  const rows = database.prepare(`SELECT * FROM schedules ORDER BY created_at DESC`).all() as ScheduleRow[];
  return rows.map(rowToSchedule);
}

export function updateSchedule(id: string, updates: Partial<{
  name: string;
  prompt: string;
  cronExpression: string | null;
  intervalMs: number | null;
  projectPath: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  launchFlags: { dangerouslySkipPermissions?: boolean; autoMode?: boolean } | null;
  maxRunsKept: number;
  type: 'claude-prompt' | 'pr-review-pipeline';
  maxActivePrs: number;
}>): void {
  const database = getDb();
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.prompt !== undefined) { sets.push('prompt = ?'); values.push(updates.prompt); }
  if ('cronExpression' in updates) { sets.push('cron_expression = ?'); values.push(updates.cronExpression ?? null); }
  if ('intervalMs' in updates) { sets.push('interval_ms = ?'); values.push(updates.intervalMs ?? null); }
  if ('projectPath' in updates) { sets.push('project_path = ?'); values.push(updates.projectPath ?? null); }
  if (updates.enabled !== undefined) { sets.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
  if ('lastRunAt' in updates) { sets.push('last_run_at = ?'); values.push(updates.lastRunAt ?? null); }
  if ('nextRunAt' in updates) { sets.push('next_run_at = ?'); values.push(updates.nextRunAt ?? null); }
  if ('launchFlags' in updates) { sets.push('launch_flags_json = ?'); values.push(updates.launchFlags ? JSON.stringify(updates.launchFlags) : null); }
  if (updates.maxRunsKept !== undefined) { sets.push('max_runs_kept = ?'); values.push(updates.maxRunsKept); }
  if (updates.type !== undefined) { sets.push('type = ?'); values.push(updates.type); }
  if (updates.maxActivePrs !== undefined) { sets.push('max_active_prs = ?'); values.push(updates.maxActivePrs); }
  values.push(id);
  database.prepare(`UPDATE schedules SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteSchedule(id: string): void {
  const database = getDb();
  database.prepare(`DELETE FROM schedules WHERE id = ?`).run(id);
}

// --- Schedule Run helpers ---

type ScheduleRunRow = {
  id: string;
  schedule_id: string;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  output: string;
  status: string;
  error_message: string | null;
};

function rowToScheduleRun(row: ScheduleRunRow): ScheduleRun {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    exitCode: row.exit_code ?? undefined,
    output: row.output,
    status: row.status as ScheduleRunStatus,
    errorMessage: row.error_message ?? undefined,
  };
}

export function insertScheduleRun(data: {
  scheduleId: string;
  status?: ScheduleRunStatus;
}): ScheduleRun {
  const database = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO schedule_runs (id, schedule_id, started_at, status)
    VALUES (?, ?, ?, ?)
  `).run(id, data.scheduleId, now, data.status ?? 'running');
  return getScheduleRun(id)!;
}

export function updateScheduleRun(id: string, updates: Partial<{
  finishedAt: string;
  exitCode: number;
  output: string;
  status: ScheduleRunStatus;
  errorMessage: string;
}>): void {
  const database = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.finishedAt !== undefined) { sets.push('finished_at = ?'); values.push(updates.finishedAt); }
  if (updates.exitCode !== undefined) { sets.push('exit_code = ?'); values.push(updates.exitCode); }
  if (updates.output !== undefined) { sets.push('output = ?'); values.push(updates.output); }
  if (updates.status !== undefined) { sets.push('status = ?'); values.push(updates.status); }
  if (updates.errorMessage !== undefined) { sets.push('error_message = ?'); values.push(updates.errorMessage); }
  if (sets.length === 0) return;
  values.push(id);
  database.prepare(`UPDATE schedule_runs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function getScheduleRun(id: string): ScheduleRun | null {
  const database = getDb();
  const row = database.prepare(`SELECT * FROM schedule_runs WHERE id = ?`).get(id) as ScheduleRunRow | undefined;
  return row ? rowToScheduleRun(row) : null;
}

export function getScheduleRuns(scheduleId: string, limit = 20, offset = 0): ScheduleRun[] {
  const database = getDb();
  const rows = database.prepare(`SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?`).all(scheduleId, limit, offset) as ScheduleRunRow[];
  return rows.map(rowToScheduleRun);
}

export function pruneScheduleRuns(scheduleId: string, maxKept: number): void {
  const database = getDb();
  database.prepare(`
    DELETE FROM schedule_runs WHERE schedule_id = ? AND id NOT IN (
      SELECT id FROM schedule_runs WHERE schedule_id = ? ORDER BY started_at DESC LIMIT ?
    )
  `).run(scheduleId, scheduleId, maxKept);
}

export function deleteScheduleRuns(scheduleId: string): void {
  const database = getDb();
  database.prepare(`DELETE FROM schedule_runs WHERE schedule_id = ?`).run(scheduleId);
}

// --- Session Template helpers ---

type SessionTemplateRow = {
  id: string;
  name: string;
  description: string;
  project_path: string;
  initial_prompt: string;
  permission_mode: string;
  model: string | null;
  provider: string | null;
  tags_json: string;
  category: string;
  icon: string | null;
  context_paths_json: string;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

function rowToSessionTemplate(row: SessionTemplateRow): SessionTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    projectPath: row.project_path,
    initialPrompt: row.initial_prompt,
    permissionMode: row.permission_mode as SessionTemplate['permissionMode'],
    model: row.model ?? undefined,
    provider: (row.provider as SessionTemplate['provider']) ?? undefined,
    tags: JSON.parse(row.tags_json),
    category: row.category,
    icon: row.icon ?? undefined,
    contextPaths: JSON.parse(row.context_paths_json || '[]'),
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAllSessionTemplates(): SessionTemplate[] {
  const database = getDb();
  const rows = database.prepare(`SELECT * FROM session_templates ORDER BY usage_count DESC, updated_at DESC`).all() as SessionTemplateRow[];
  return rows.map(rowToSessionTemplate);
}

export function getSessionTemplate(id: string): SessionTemplate | null {
  const database = getDb();
  const row = database.prepare(`SELECT * FROM session_templates WHERE id = ?`).get(id) as SessionTemplateRow | undefined;
  return row ? rowToSessionTemplate(row) : null;
}

export function insertSessionTemplate(data: {
  name: string;
  description?: string;
  projectPath?: string;
  initialPrompt?: string;
  permissionMode?: string;
  model?: string;
  provider?: string;
  tags?: string[];
  category?: string;
  icon?: string;
  contextPaths?: string[];
}): SessionTemplate {
  const database = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO session_templates (id, name, description, project_path, initial_prompt, permission_mode, model, provider, tags_json, category, icon, context_paths_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.description ?? '',
    data.projectPath ?? '',
    data.initialPrompt ?? '',
    data.permissionMode ?? 'default',
    data.model ?? null,
    data.provider ?? null,
    JSON.stringify(data.tags ?? []),
    data.category ?? 'General',
    data.icon ?? null,
    JSON.stringify(data.contextPaths ?? []),
    now,
    now,
  );
  return getSessionTemplate(id)!;
}

export function updateSessionTemplate(id: string, updates: Partial<{
  name: string;
  description: string;
  projectPath: string;
  initialPrompt: string;
  permissionMode: string;
  model: string | null;
  provider: string | null;
  tags: string[];
  category: string;
  icon: string | null;
  contextPaths: string[];
}>): void {
  const database = getDb();
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.description !== undefined) { sets.push('description = ?'); values.push(updates.description); }
  if (updates.projectPath !== undefined) { sets.push('project_path = ?'); values.push(updates.projectPath); }
  if (updates.initialPrompt !== undefined) { sets.push('initial_prompt = ?'); values.push(updates.initialPrompt); }
  if (updates.permissionMode !== undefined) { sets.push('permission_mode = ?'); values.push(updates.permissionMode); }
  if ('model' in updates) { sets.push('model = ?'); values.push(updates.model ?? null); }
  if ('provider' in updates) { sets.push('provider = ?'); values.push(updates.provider ?? null); }
  if (updates.tags !== undefined) { sets.push('tags_json = ?'); values.push(JSON.stringify(updates.tags)); }
  if (updates.category !== undefined) { sets.push('category = ?'); values.push(updates.category); }
  if ('icon' in updates) { sets.push('icon = ?'); values.push(updates.icon ?? null); }
  if (updates.contextPaths !== undefined) { sets.push('context_paths_json = ?'); values.push(JSON.stringify(updates.contextPaths)); }
  values.push(id);
  database.prepare(`UPDATE session_templates SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteSessionTemplate(id: string): void {
  const database = getDb();
  database.prepare(`DELETE FROM session_templates WHERE id = ?`).run(id);
}

export function incrementTemplateUsage(id: string): void {
  const database = getDb();
  database.prepare(`UPDATE session_templates SET usage_count = usage_count + 1, last_used_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id);
}

// --- Saved Prompt helpers ---

type SavedPromptRow = {
  id: string;
  title: string;
  content: string;
  description: string;
  tags_json: string;
  category: string;
  usage_count: number;
  is_favorite: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

function rowToSavedPrompt(row: SavedPromptRow): SavedPrompt {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    description: row.description,
    tags: JSON.parse(row.tags_json),
    category: row.category,
    usageCount: row.usage_count,
    isFavorite: row.is_favorite === 1,
    lastUsedAt: row.last_used_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAllSavedPrompts(): SavedPrompt[] {
  const database = getDb();
  const rows = database.prepare(`SELECT * FROM saved_prompts ORDER BY is_favorite DESC, usage_count DESC, updated_at DESC`).all() as SavedPromptRow[];
  return rows.map(rowToSavedPrompt);
}

export function getSavedPrompt(id: string): SavedPrompt | null {
  const database = getDb();
  const row = database.prepare(`SELECT * FROM saved_prompts WHERE id = ?`).get(id) as SavedPromptRow | undefined;
  return row ? rowToSavedPrompt(row) : null;
}

export function insertSavedPrompt(data: {
  title: string;
  content?: string;
  description?: string;
  tags?: string[];
  category?: string;
  isFavorite?: boolean;
}): SavedPrompt {
  const database = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO saved_prompts (id, title, content, description, tags_json, category, is_favorite, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.title,
    data.content ?? '',
    data.description ?? '',
    JSON.stringify(data.tags ?? []),
    data.category ?? 'General',
    data.isFavorite ? 1 : 0,
    now,
    now,
  );
  return getSavedPrompt(id)!;
}

export function updateSavedPrompt(id: string, updates: Partial<{
  title: string;
  content: string;
  description: string;
  tags: string[];
  category: string;
  isFavorite: boolean;
}>): void {
  const database = getDb();
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const values: unknown[] = [];
  if (updates.title !== undefined) { sets.push('title = ?'); values.push(updates.title); }
  if (updates.content !== undefined) { sets.push('content = ?'); values.push(updates.content); }
  if (updates.description !== undefined) { sets.push('description = ?'); values.push(updates.description); }
  if (updates.tags !== undefined) { sets.push('tags_json = ?'); values.push(JSON.stringify(updates.tags)); }
  if (updates.category !== undefined) { sets.push('category = ?'); values.push(updates.category); }
  if (updates.isFavorite !== undefined) { sets.push('is_favorite = ?'); values.push(updates.isFavorite ? 1 : 0); }
  values.push(id);
  database.prepare(`UPDATE saved_prompts SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteSavedPrompt(id: string): void {
  const database = getDb();
  database.prepare(`DELETE FROM saved_prompts WHERE id = ?`).run(id);
}

export function incrementPromptUsage(id: string): void {
  const database = getDb();
  database.prepare(`UPDATE saved_prompts SET usage_count = usage_count + 1, last_used_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id);
}

// --- SQL Workbench History helpers ---

export interface QueryHistoryEntry {
  id: number;
  database: string;
  query: string;
  executedAt: string;
  rowCount: number | null;
  durationMs: number | null;
  error: string | null;
}

type QueryHistoryRow = {
  id: number;
  database: string;
  query: string;
  executed_at: string;
  row_count: number | null;
  duration_ms: number | null;
  error: string | null;
};

export function insertQueryHistory(database: string, query: string, rowCount: number | null, durationMs: number | null, error: string | null): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO sql_workbench_history (database, query, row_count, duration_ms, error)
    VALUES (?, ?, ?, ?, ?)
  `).run(database, query, rowCount, durationMs, error);
}

export function getQueryHistory(limit = 50): QueryHistoryEntry[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM sql_workbench_history ORDER BY executed_at DESC LIMIT ?`).all(limit) as QueryHistoryRow[];
  return rows.map((row) => ({
    id: row.id,
    database: row.database,
    query: row.query,
    executedAt: row.executed_at,
    rowCount: row.row_count,
    durationMs: row.duration_ms,
    error: row.error,
  }));
}

// --- Scan Results functions ---

export interface ScanResultRow {
  id: number;
  projectPath: string;
  scanDate: string;
  healthScore: number | null;
  todoCount: number | null;
  fixmeCount: number | null;
  totalFiles: number | null;
  totalSizeMb: number | null;
  outdatedDeps: number | null;
  resultsJson: string | null;
}

export function insertScanResult(data: {
  projectPath: string;
  healthScore: number;
  todoCount: number;
  fixmeCount: number;
  totalFiles: number;
  totalSizeMb: number;
  outdatedDeps: number;
  resultsJson: string;
}): void {
  const database = getDb();
  database.prepare(`
    INSERT INTO scan_results (project_path, health_score, todo_count, fixme_count, total_files, total_size_mb, outdated_deps, results_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.projectPath,
    data.healthScore,
    data.todoCount,
    data.fixmeCount,
    data.totalFiles,
    data.totalSizeMb,
    data.outdatedDeps,
    data.resultsJson,
  );
}

export function getScanHistory(projectPath: string, limit = 20): ScanResultRow[] {
  const database = getDb();
  const rows = database.prepare(`
    SELECT * FROM scan_results WHERE project_path = ? ORDER BY scan_date DESC LIMIT ?
  `).all(projectPath, limit) as Array<{
    id: number;
    project_path: string;
    scan_date: string;
    health_score: number | null;
    todo_count: number | null;
    fixme_count: number | null;
    total_files: number | null;
    total_size_mb: number | null;
    outdated_deps: number | null;
    results_json: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    projectPath: row.project_path,
    scanDate: row.scan_date,
    healthScore: row.health_score,
    todoCount: row.todo_count,
    fixmeCount: row.fixme_count,
    totalFiles: row.total_files,
    totalSizeMb: row.total_size_mb,
    outdatedDeps: row.outdated_deps,
    resultsJson: row.results_json,
  }));
}

// --- Chat Conversations CRUD ---

export interface ChatConversationRow {
  id: string;
  title: string;
  projectPath: string | null;
  claudeSessionId: string | null;
  ptyTerminalId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  userEmail: string | null;
  isStarred: boolean;
}

export interface ChatMessageRow {
  id: string;
  conversationId: string;
  role: string;
  type: string;
  content: string;
  toolName: string | null;
  toolId: string | null;
  model: string | null;
  timestamp: string;
}

export function insertChatConversation(id: string, title: string, projectPath?: string, userEmail?: string): void {
  const database = getDb();
  database.prepare(`
    INSERT INTO chat_conversations (id, title, project_path, user_email)
    VALUES (?, ?, ?, ?)
  `).run(id, title, projectPath ?? null, userEmail ?? null);
}

export function getChatConversations(userEmail?: string): ChatConversationRow[] {
  const database = getDb();
  const query = userEmail
    ? `SELECT * FROM chat_conversations WHERE user_email = ? ORDER BY is_starred DESC, updated_at DESC`
    : `SELECT * FROM chat_conversations ORDER BY is_starred DESC, updated_at DESC`;
  const rows = (userEmail
    ? database.prepare(query).all(userEmail)
    : database.prepare(query).all()
  ) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    projectPath: row.project_path as string | null,
    claudeSessionId: row.claude_session_id as string | null,
    ptyTerminalId: row.pty_terminal_id as string | null,
    status: row.status as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    userEmail: row.user_email as string | null,
    isStarred: (row.is_starred as number) === 1,
  }));
}

export function getChatConversation(id: string): ChatConversationRow | undefined {
  const database = getDb();
  const row = database.prepare(`SELECT * FROM chat_conversations WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    id: row.id as string,
    title: row.title as string,
    projectPath: row.project_path as string | null,
    claudeSessionId: row.claude_session_id as string | null,
    ptyTerminalId: row.pty_terminal_id as string | null,
    status: row.status as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    userEmail: row.user_email as string | null,
    isStarred: (row.is_starred as number) === 1,
  };
}

export function updateChatConversation(id: string, updates: Partial<{ title: string; status: string; claudeSessionId: string; ptyTerminalId: string; isStarred: boolean; projectPath: string | null }>): void {
  const database = getDb();
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const values: unknown[] = [];
  if (updates.title !== undefined) { sets.push('title = ?'); values.push(updates.title); }
  if (updates.status !== undefined) { sets.push('status = ?'); values.push(updates.status); }
  if (updates.claudeSessionId !== undefined) { sets.push('claude_session_id = ?'); values.push(updates.claudeSessionId); }
  if (updates.ptyTerminalId !== undefined) { sets.push('pty_terminal_id = ?'); values.push(updates.ptyTerminalId); }
  if (updates.isStarred !== undefined) { sets.push('is_starred = ?'); values.push(updates.isStarred ? 1 : 0); }
  if (updates.projectPath !== undefined) { sets.push('project_path = ?'); values.push(updates.projectPath); }
  values.push(id);
  database.prepare(`UPDATE chat_conversations SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteChatConversation(id: string): void {
  const database = getDb();
  database.prepare(`DELETE FROM chat_messages WHERE conversation_id = ?`).run(id);
  database.prepare(`DELETE FROM chat_conversations WHERE id = ?`).run(id);
}

export function insertChatMessage(msg: { id: string; conversationId: string; role: string; type: string; content: string; toolName?: string; toolId?: string; model?: string }): void {
  const database = getDb();
  database.prepare(`
    INSERT OR IGNORE INTO chat_messages (id, conversation_id, role, type, content, tool_name, tool_id, model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(msg.id, msg.conversationId, msg.role, msg.type, msg.content, msg.toolName ?? null, msg.toolId ?? null, msg.model ?? null);
  // Touch conversation updated_at
  database.prepare(`UPDATE chat_conversations SET updated_at = datetime('now') WHERE id = ?`).run(msg.conversationId);
}

export function getChatMessages(conversationId: string): ChatMessageRow[] {
  const database = getDb();
  const rows = database.prepare(`SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY timestamp`).all(conversationId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: row.id as string,
    conversationId: row.conversation_id as string,
    role: row.role as string,
    type: row.type as string,
    content: row.content as string,
    toolName: row.tool_name as string | null,
    toolId: row.tool_id as string | null,
    model: row.model as string | null,
    timestamp: row.timestamp as string,
  }));
}

export interface ChatSearchResult {
  conversationId: string;
  title: string;
  projectPath: string | null;
  isStarred: boolean;
  updatedAt: string;
  matchSnippet: string;
}

export function searchChatConversations(query: string, userEmail?: string): ChatSearchResult[] {
  const database = getDb();
  const likePattern = `%${query}%`;
  const sql = userEmail
    ? `SELECT DISTINCT c.id, c.title, c.project_path, c.is_starred, c.updated_at,
         (SELECT substr(m2.content, 1, 100) FROM chat_messages m2 WHERE m2.conversation_id = c.id AND m2.content LIKE ? AND m2.type = 'text' LIMIT 1) as snippet
       FROM chat_conversations c
       LEFT JOIN chat_messages m ON m.conversation_id = c.id
       WHERE c.user_email = ? AND (c.title LIKE ? OR (m.content LIKE ? AND m.type = 'text'))
       ORDER BY c.updated_at DESC LIMIT 20`
    : `SELECT DISTINCT c.id, c.title, c.project_path, c.is_starred, c.updated_at,
         (SELECT substr(m2.content, 1, 100) FROM chat_messages m2 WHERE m2.conversation_id = c.id AND m2.content LIKE ? AND m2.type = 'text' LIMIT 1) as snippet
       FROM chat_conversations c
       LEFT JOIN chat_messages m ON m.conversation_id = c.id
       WHERE c.title LIKE ? OR (m.content LIKE ? AND m.type = 'text')
       ORDER BY c.updated_at DESC LIMIT 20`;

  const params = userEmail
    ? [likePattern, userEmail, likePattern, likePattern]
    : [likePattern, likePattern, likePattern];

  const rows = database.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    conversationId: row.id as string,
    title: row.title as string,
    projectPath: row.project_path as string | null,
    isStarred: (row.is_starred as number) === 1,
    updatedAt: row.updated_at as string,
    matchSnippet: (row.snippet as string | null) ?? '',
  }));
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
