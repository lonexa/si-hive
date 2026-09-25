/**
 * AI assistant usage logger.
 *
 * Producer for the shared ai_usage_log table. Consumed by the team AI usage
 * view, the admin usage dashboard, and the incognito purge.
 *
 * Pipeline:
 *   1. session-watcher detects a JSONL change → calls recordSessionUpdate()
 *   2. We track first-seen / last-seen timestamps per session in-memory
 *   3. A timer flushes every FLUSH_INTERVAL_MS — parses each session's JSONL
 *      for token totals and upserts a row by session_id
 *   4. Sessions idle longer than IDLE_MS are marked ended (end_time set) and
 *      removed from the in-memory map
 *
 * Username is resolved from the local SQLite users table (most recent login
 * on this Hive instance). If no login record exists, the row is skipped —
 * we don't want unattributable rows in the shared analytics table.
 */

import fs from 'node:fs';
import os from 'node:os';
import Database from 'better-sqlite3';
import { getSharedDb, upsert, nowIso } from '../../../../packages/shared/src/server/storage/index.js';
import { isIncognitoSession } from '../privacy/incognito.js';
import type { ProviderId } from '../types.js';
import { hivePath } from '../../../../packages/shared/src/server/paths.js';

const FLUSH_INTERVAL_MS = 60_000;   // Flush every 60s
const IDLE_MS = 5 * 60_000;         // Sessions idle >5 min are considered ended

interface UsageState {
  sessionId: string;
  provider: ProviderId;
  filePath: string;
  projectPath: string | null;
  startTime: number;       // Epoch ms — earliest seen timestamp
  lastActivity: number;    // Epoch ms — latest seen timestamp
  ended: boolean;          // True once we've flagged this session as ended
}

interface ParsedTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  messageCount: number;
  toolUseCount: number;
  model: string | null;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
}

const activeSessions = new Map<string, UsageState>();

let flushTimer: ReturnType<typeof setInterval> | null = null;
let lastUserLookupAt = 0;
let cachedUser: { email: string; displayName: string | null } | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startUsageLogger(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushAll().catch((err) => {
      console.warn('[usage-logger] Flush failed:', err instanceof Error ? err.message : err);
    });
  }, FLUSH_INTERVAL_MS);
  // Don't block process exit on this timer
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
  console.log('[usage-logger] Started — flushing every', FLUSH_INTERVAL_MS / 1000, 'seconds');
}

export async function stopUsageLogger(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  // Final flush to capture in-flight sessions on shutdown
  try {
    await flushAll(true);
  } catch { /* ignore */ }
}

/**
 * Called by the session-watcher whenever a JSONL changes. Lightweight —
 * just bumps the in-memory state; token parsing happens lazily at flush.
 */
export function recordSessionUpdate(
  sessionId: string,
  filePath: string,
  projectPath: string | null,
  provider: ProviderId = 'claude',
): void {
  if (!sessionId) return;

  // Incognito sessions never reach ai_usage_log. Checked on entry so nothing
  // is even held in memory, and re-checked at flush time to catch a session
  // the user marks incognito after it started.
  if (isIncognitoSession(sessionId, projectPath)) {
    activeSessions.delete(sessionId);
    return;
  }

  const now = Date.now();
  const existing = activeSessions.get(sessionId);
  if (existing) {
    existing.lastActivity = now;
    existing.ended = false;
    // ProjectPath / filePath can change as the session migrates between dirs
    if (projectPath) existing.projectPath = projectPath;
    if (filePath) existing.filePath = filePath;
    return;
  }
  activeSessions.set(sessionId, {
    sessionId,
    provider,
    filePath,
    projectPath,
    startTime: now,
    lastActivity: now,
    ended: false,
  });
}

// ---------------------------------------------------------------------------
// Flush loop
// ---------------------------------------------------------------------------

async function flushAll(force: boolean = false): Promise<void> {
  if (activeSessions.size === 0) return;

  const user = getCurrentUser();
  if (!user) {
    // No logged-in user — can't attribute rows, skip silently
    return;
  }

  const now = Date.now();
  const toRemove: string[] = [];

  for (const state of activeSessions.values()) {
    // Re-check: the session may have been marked incognito mid-flight, or its
    // real session id linked to an incognito terminal id after the first
    // recordSessionUpdate. Drop it without writing.
    if (isIncognitoSession(state.sessionId, state.projectPath)) {
      toRemove.push(state.sessionId);
      continue;
    }

    const idleMs = now - state.lastActivity;
    const isEnded = force || idleMs > IDLE_MS;

    // Skip rows that haven't had any new activity since the last flush
    // unless we're ending them — keeps the DB write rate sensible
    if (!isEnded && idleMs > FLUSH_INTERVAL_MS + 5_000) {
      // Last activity was before the last flush — already up-to-date
      continue;
    }

    try {
      await upsertSession(state, user, isEnded);
      if (isEnded) {
        state.ended = true;
        toRemove.push(state.sessionId);
      }
    } catch (err) {
      // Leave the session in memory so the next flush retries it.
      console.warn(`[usage-logger] Failed to upsert ${state.sessionId}:`, err instanceof Error ? err.message : String(err));
    }
  }

  for (const id of toRemove) activeSessions.delete(id);
}

async function upsertSession(
  state: UsageState,
  user: { email: string; displayName: string | null },
  isEnded: boolean,
): Promise<void> {
  const totals = parseJsonlTotals(state.filePath);
  const startMs = totals.firstTimestamp ?? state.startTime;
  const endMs = totals.lastTimestamp ?? state.lastActivity;
  const durationSec = Math.max(0, Math.round((endMs - startMs) / 1000));

  const db = await getSharedDb();
  const now = nowIso();
  const values = {
    provider: state.provider,
    username: user.email,
    display_name: user.displayName,
    machine_name: os.hostname(),
    project_path: state.projectPath,
    model: totals.model,
    end_time: isEnded ? new Date(endMs).toISOString() : null,
    duration_seconds: durationSec,
    input_tokens: totals.inputTokens,
    output_tokens: totals.outputTokens,
    cache_creation_tokens: totals.cacheCreationTokens,
    cache_read_tokens: totals.cacheReadTokens,
    message_count: totals.messageCount,
    tool_use_count: totals.toolUseCount,
    updated_at: now,
  };
  // start_time is fixed at first insert, like created_at.
  const insertOnly = { start_time: new Date(startMs).toISOString(), created_at: now };
  const key = { session_id: state.sessionId };
  try {
    await upsert(db, 'ai_usage_log', key, values, insertOnly);
  } catch {
    // A concurrent flush may have inserted the row between our update and
    // insert (unique session_id); a second pass lands on the update branch.
    await upsert(db, 'ai_usage_log', key, values, insertOnly);
  }
}

// ---------------------------------------------------------------------------
// JSONL parsing
// ---------------------------------------------------------------------------

function parseJsonlTotals(filePath: string): ParsedTotals {
  const totals: ParsedTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    messageCount: 0,
    toolUseCount: 0,
    model: null,
    firstTimestamp: null,
    lastTimestamp: null,
  };

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return totals;
  }

  for (const line of raw.split('\n')) {
    if (!line) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const ts = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      if (totals.firstTimestamp === null || ts < totals.firstTimestamp) totals.firstTimestamp = ts;
      if (totals.lastTimestamp === null || ts > totals.lastTimestamp) totals.lastTimestamp = ts;
    }

    if (entry.type === 'user' || entry.type === 'assistant') {
      totals.messageCount++;
    }

    const message = entry.message as Record<string, unknown> | undefined;
    if (!message) continue;

    if (typeof message.model === 'string' && !totals.model) {
      totals.model = message.model;
    }

    const usage = message.usage as Record<string, unknown> | undefined;
    if (usage) {
      totals.inputTokens += toInt(usage.input_tokens);
      totals.outputTokens += toInt(usage.output_tokens);
      totals.cacheCreationTokens += toInt(usage.cache_creation_input_tokens);
      totals.cacheReadTokens += toInt(usage.cache_read_input_tokens);
    }

    const content = message.content as Array<{ type?: string }> | undefined;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'tool_use') totals.toolUseCount++;
      }
    }
  }

  return totals;
}

function toInt(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  return 0;
}

// ---------------------------------------------------------------------------
// User identity (from local Hive SQLite)
// ---------------------------------------------------------------------------

/**
 * The email this logger writes as `Username`. Exported so the incognito purge
 * deletes rows under exactly the identity that wrote them — if the two ever
 * disagreed, a purge would quietly delete nothing.
 */
export function getUsageLogUsername(): string | null {
  return getCurrentUser()?.email ?? null;
}

function getCurrentUser(): { email: string; displayName: string | null } | null {
  // Cache for 60s — login state rarely changes mid-session
  if (cachedUser && Date.now() - lastUserLookupAt < 60_000) return cachedUser;

  try {
    const dbPath = hivePath('hive.db');
    if (!fs.existsSync(dbPath)) return null;
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      // Prefer the user with the most recent unexpired session; fall back to
      // the user with the most recent lastLogin if no live session exists.
      const liveRow = db.prepare(`
        SELECT u.email, u.displayName
        FROM auth_sessions s
        JOIN users u ON s.userOid = u.oid
        WHERE datetime(s.expiresAt) > datetime('now')
        ORDER BY datetime(s.createdAt) DESC
        LIMIT 1
      `).get() as { email?: string; displayName?: string } | undefined;

      const row = liveRow ?? (db.prepare(`
        SELECT email, displayName FROM users ORDER BY datetime(lastLogin) DESC LIMIT 1
      `).get() as { email?: string; displayName?: string } | undefined);

      if (row?.email) {
        cachedUser = { email: row.email, displayName: row.displayName ?? null };
        lastUserLookupAt = Date.now();
        return cachedUser;
      }
    } finally {
      db.close();
    }
  } catch {
    // SQLite missing / schema mismatch — running outside an installed Hive
  }
  return null;
}

