/**
 * Incognito — opt out of ALL shared logging for a project or a single session.
 *
 * An incognito session is never written to any shared destination: no
 * [Hive].[claude_usage_log] row, no [Hive].[user_now] presence entry, no
 * auto-captured Knowledge Base entries, no session handoff, and its id is
 * stripped out of [Hive].[user_events] / telemetry.ErrorEvents routes. It also
 * drops out of federated search (which feeds Ask Hive's LLM calls).
 *
 * What incognito deliberately does NOT touch: anything that stays on this
 * machine. The Claude Code transcript still lands in ~/.claude/projects, the
 * local SQLite at ~/.hive/hive.db still records hook events and time blocks,
 * and the session still shows up in this user's own dashboard. "Nothing
 * logged anywhere except the user's machine" is the contract.
 *
 * Two levels, both stored locally in ~/.hive/incognito.json:
 *
 *   projects — a normalized absolute path. Every session whose cwd is at or
 *              below that path is incognito, with no per-session marking
 *              needed. This is what covers sessions started outside Hive
 *              (a plain terminal), since the gate is purely cwd-based.
 *
 *   sessions — an explicit id. Covers "one incognito session inside an
 *              otherwise normal project". Temp terminal ids (`new-*`) are
 *              marked at spawn and re-keyed to the real Claude session id by
 *              linkSession() once the JSONL appears (see
 *              broadcastDiscoveredSessionId in index.ts).
 *
 * Marking gates *writes* forward-looking only — rows already in shared SQL
 * stay there. So the analytics read paths filter as well: turning a project
 * incognito has to make its history disappear from the Analytics tabs, not
 * just stop adding to it. See sqlPathExclusion / isIncognitoProjectLabel and
 * their callers in server/analytics.
 */

import fs from 'node:fs';
import path from 'node:path';
import { isWindows } from '../platform.js';
import { decodeWindowsProjectDir } from '../parsers/process-discovery-windows.js';
import { getSessionInfo } from '../sessions/replay-client.js';
import { hivePath } from '../../../../packages/shared/src/server/paths.js';

const STORE_PATH = hivePath('incognito.json');

/** Marked session ids expire so the store doesn't grow without bound. */
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

interface IncognitoFile {
  projects?: string[];
  /** id → epoch ms when it was marked */
  sessions?: Record<string, number>;
  /** Roots whose already-logged shared rows still need deleting. */
  pendingPurge?: string[];
}

const incognitoProjects = new Set<string>();
const incognitoSessions = new Map<string, number>();
/**
 * Marking a project deletes what it already logged to shared SQL, but that
 * needs a working connection — and it is routinely done off-VPN. A root stays
 * queued here until a purge actually succeeds, so an outage delays the
 * deletion instead of dropping it.
 */
const pendingPurge = new Set<string>();
let loaded = false;

/** Normalize for comparison: forward slashes, no trailing slash, lowercased. */
function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(STORE_PATH)) return;
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) as IncognitoFile;
    for (const p of parsed.projects ?? []) {
      if (typeof p === 'string' && p.trim()) incognitoProjects.add(norm(p));
    }
    const now = Date.now();
    for (const [id, ts] of Object.entries(parsed.sessions ?? {})) {
      if (typeof ts === 'number' && now - ts < SESSION_TTL_MS) incognitoSessions.set(id, ts);
    }
    for (const p of parsed.pendingPurge ?? []) {
      if (typeof p === 'string' && p.trim()) pendingPurge.add(norm(p));
    }
    console.log(`[incognito] Loaded ${incognitoProjects.size} project(s), ${incognitoSessions.size} session(s)`);
  } catch (err) {
    console.warn(`[incognito] Failed to read ${STORE_PATH}: ${err instanceof Error ? err.message : err}`);
  }
}

function save(): void {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    const out: IncognitoFile = {
      projects: Array.from(incognitoProjects),
      sessions: Object.fromEntries(incognitoSessions),
      pendingPurge: Array.from(pendingPurge),
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify(out, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[incognito] Failed to write ${STORE_PATH}: ${err instanceof Error ? err.message : err}`);
  }
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/**
 * True when any supplied path sits at or below an incognito project root.
 * Callers pass every path they happen to know (cwd, project path, decoded
 * project dir) — a match on any one of them is enough. Boundary-checked so
 * `/repo-public` never matches an incognito `/repo`.
 */
export function isIncognitoPath(...candidates: Array<string | null | undefined>): boolean {
  load();
  if (incognitoProjects.size === 0) return false;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const c = norm(candidate);
    if (!c) continue;
    for (const root of incognitoProjects) {
      if (c === root || c.startsWith(`${root}/`)) return true;
    }
  }
  return false;
}

/**
 * Same as isIncognitoPath but for an *encoded* ~/.claude/projects directory
 * name (`C--Users-me-repo`). The aggregator only ever has the encoded form for
 * sessions whose transcript hasn't yielded a cwd yet.
 */
export function isIncognitoProjectDir(encodedDir: string | null | undefined): boolean {
  load();
  if (!encodedDir || incognitoProjects.size === 0) return false;
  try {
    const decoded = isWindows
      ? decodeWindowsProjectDir(encodedDir)
      : `/${encodedDir.replace(/-/g, '/')}`;
    return isIncognitoPath(decoded);
  } catch {
    return false;
  }
}

/**
 * True when this id was marked incognito (session id or temp terminal id).
 *
 * Subagent ids are `<parentSessionId>:<agentId>` — a subagent of an incognito
 * session is incognito too, so the parent half is checked as well.
 */
export function isIncognitoId(id: string | null | undefined): boolean {
  load();
  if (!id) return false;
  if (incognitoSessions.has(id)) return true;
  const colon = id.indexOf(':');
  return colon > 0 && incognitoSessions.has(id.slice(0, colon));
}

/**
 * The main gate. A session is incognito when its id was marked explicitly, or
 * when any path we know for it is inside an incognito project.
 *
 * `pathHints` should carry whatever the caller already has (cwd, projectPath).
 * When none resolve, we fall back to a filesystem lookup of the session's own
 * transcript — cached, and only reached on the rare call site that knows
 * nothing but the id.
 */
export function isIncognitoSession(
  sessionId: string | null | undefined,
  ...pathHints: Array<string | null | undefined>
): boolean {
  load();
  if (isIncognitoId(sessionId)) return true;
  if (isIncognitoPath(...pathHints)) return true;
  if (!sessionId || incognitoProjects.size === 0) return false;
  // Always fall through to the transcript lookup, even when hints were
  // supplied. Some callers only know a project *label* ("my-app"),
  // not a path — treating a non-matching hint as authoritative would let a
  // project-level mark slip past them. The lookup is cached per session id.
  return isIncognitoPath(resolveSessionCwd(sessionId));
}

const cwdCache = new Map<string, string | null>();

/** Look up a session's cwd from its transcript. Cached — the answer can't change. */
function resolveSessionCwd(sessionId: string): string | null {
  const cached = cwdCache.get(sessionId);
  if (cached !== undefined) return cached;
  let cwd: string | null = null;
  try {
    const info = getSessionInfo(sessionId);
    cwd = info.exists ? (info.cwd ?? null) : null;
  } catch { /* unreadable — treat as unknown */ }
  // Only memoize a real answer; a miss can become a hit once Claude writes
  // the transcript.
  if (cwd) cwdCache.set(sessionId, cwd);
  return cwd;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function setProjectIncognito(projectPath: string, enabled: boolean): void {
  load();
  const key = norm(projectPath);
  if (!key) return;
  if (enabled) {
    incognitoProjects.add(key);
    // Queue the retroactive cleanup; purge.ts clears it once SQL confirms.
    pendingPurge.add(key);
  } else {
    incognitoProjects.delete(key);
    // No longer incognito — don't go deleting its history later.
    pendingPurge.delete(key);
  }
  save();
  console.log(`[incognito] Project ${enabled ? 'ON' : 'OFF'}: ${projectPath}`);
}

export function setSessionIncognito(id: string, enabled: boolean): void {
  load();
  if (!id) return;
  if (enabled) incognitoSessions.set(id, Date.now());
  else incognitoSessions.delete(id);
  save();
  console.log(`[incognito] Session ${enabled ? 'ON' : 'OFF'}: ${id}`);
}

/**
 * Carry a temp terminal id's incognito mark over to the real Claude session id
 * once it's discovered. Called from the terminal→session discovery path so the
 * flag is in place before the first shared write can happen.
 */
export function linkSession(termId: string, sessionId: string): void {
  load();
  if (termId === sessionId || !incognitoSessions.has(termId)) return;
  incognitoSessions.set(sessionId, incognitoSessions.get(termId) ?? Date.now());
  save();
  console.log(`[incognito] Linked ${termId} → ${sessionId}`);
}

// ---------------------------------------------------------------------------
// Reads / helpers
// ---------------------------------------------------------------------------

/**
 * The normalized incognito project roots (forward slashes, lowercase, no
 * trailing slash). Read-side filters need the roots themselves, not just the
 * predicates, because a query has to be narrowed before it aggregates.
 */
export function incognitoRoots(): string[] {
  load();
  return Array.from(incognitoProjects);
}

/**
 * True when a bare project *label* — a directory basename, which is all the
 * older turn_blocks / time_blocks rows carry — matches the last segment of an
 * incognito project root.
 *
 * A last resort, used only for rows written before the trackers started
 * recording a cwd. Two unrelated directories can share a basename, so this can
 * hide an innocent same-named project; for a privacy switch that is the safer
 * direction to be wrong in.
 */
export function isIncognitoProjectLabel(label: string | null | undefined): boolean {
  load();
  if (!label || incognitoProjects.size === 0) return false;
  const l = norm(label);
  if (!l) return false;
  for (const root of incognitoProjects) {
    if (root.slice(root.lastIndexOf('/') + 1) === l) return true;
  }
  return false;
}

/**
 * T-SQL predicate + bind parameters that drop rows whose project-path column
 * sits at or below an incognito root. Empty strings when nothing is marked, so
 * callers can always splice `clause` into their WHERE.
 *
 * Shared SQL keeps rows written before a project was marked (marking is
 * forward-looking), so the read side has to filter them out too — otherwise
 * turning incognito on has no effect on the analytics tabs at all.
 *
 * LEFT()/LEN() rather than LIKE: a Windows path can contain `_`, `%` or `[`,
 * every one of which is a LIKE metacharacter.
 */
export function sqlPathExclusion(
  column: string,
  prefix = 'incog',
): { clause: string; params: Record<string, string> } {
  load();
  const roots = Array.from(incognitoProjects);
  if (roots.length === 0) return { clause: '', params: {} };
  const normExpr = `LOWER(REPLACE(ISNULL(${column}, ''), '\\', '/'))`;
  const params: Record<string, string> = {};
  const parts = roots.map((root, i) => {
    const name = `${prefix}${i}`;
    params[name] = root;
    return `(${normExpr} = @${name} OR LEFT(${normExpr}, LEN(@${name}) + 1) = @${name} + '/')`;
  });
  return { clause: ` AND NOT (${parts.join(' OR ')})`, params };
}

/** Roots still waiting on a successful shared-SQL purge. */
export function listPendingPurges(): string[] {
  load();
  return Array.from(pendingPurge);
}

/** Called by purge.ts once the DELETE has actually committed. */
export function clearPendingPurge(root: string): void {
  load();
  if (pendingPurge.delete(norm(root))) save();
}

export function listIncognito(): { projects: string[]; sessions: string[] } {
  load();
  return {
    projects: Array.from(incognitoProjects),
    sessions: Array.from(incognitoSessions.keys()),
  };
}

/** Loose UUID / session-id shape — avoids a filesystem probe per route word. */
const ID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}/i;

/**
 * Strip incognito session ids out of a route before it's logged to
 * [Hive].[user_events] or telemetry.ErrorEvents. `/sessions/<id>` would
 * otherwise publish the id of a session that isn't supposed to exist upstream.
 *
 * Explicitly marked ids are a map hit. Sessions that are incognito only by
 * virtue of their project (typically started outside Hive, so never marked)
 * need the cwd lookup — hence the ID_LIKE guard and the cwd cache.
 */
export function redactRoute(route: string | null | undefined): string | null {
  if (!route) return route ?? null;
  load();
  if (incognitoSessions.size === 0 && incognitoProjects.size === 0) return route;
  return route
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      if (isIncognitoId(segment)) return 'incognito';
      if (incognitoProjects.size > 0 && ID_LIKE.test(segment) && isIncognitoSession(segment)) return 'incognito';
      return segment;
    })
    .join('/');
}
