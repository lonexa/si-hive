/**
 * Deleting sessions and removing projects.
 *
 *   DELETE /api/sessions/:id      — delete a session's transcript and Hive's records of it
 *   POST   /api/projects/remove   — { path, deleteHistory?, deleteFolder? }
 *
 * Sessions live in the agent CLI's own history (~/.claude/projects/…), so
 * deleting one removes it from `claude --resume` too. Hive's terminals on the
 * session are killed first; a process running it outside Hive blocks the
 * delete, since it would just write the transcript back.
 *
 * Removing a project always takes it off Hive's lists (see hiddenProjects in
 * project-scope.ts). Its session history and the folder itself are only
 * deleted when asked for.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import { hiveHome } from '../../../../packages/shared/src/server/paths.js';
import type { HiveConfig } from '../types.js';
import type { Aggregator } from '../state/aggregator.js';
import { destroyPtysForSession, destroyPtysUnder } from '../terminal-pty.js';
import { getSessionInfo, listLiveSessionHolders } from './replay-client.js';
import { removeFileState } from '../parsers/session-state.js';
import { getDb } from '../db.js';
import { hideProject, isPathInScope } from '../project-scope.js';
import { isWindows } from '../platform.js';

export interface DeleteRouteDeps {
  config: HiveConfig;
  saveConfig: (config: HiveConfig) => void;
  aggregator: Aggregator;
  /** Whether the caller may remove projects (admin when login is on). */
  canRemoveProjects: (req: http.IncomingMessage) => boolean;
  /** Terminal IDs Hive has linked to a session (e.g. a `new-*` terminal that became it). */
  terminalIdsFor: (sessionId: string) => string[];
  /** Drop Hive's terminal → session links for a deleted session. */
  forgetSession: (sessionId: string) => void;
}

class DeleteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function norm(p: string): string {
  const r = path.resolve(p).replace(/[\\/]+$/, '');
  return isWindows ? r.toLowerCase() : r;
}

function isInside(p: string, root: string): boolean {
  const a = norm(p);
  const r = norm(root);
  return a === r || a.startsWith(r + path.sep);
}

/** Claude Code's history-folder name for a path: every non-alphanumeric char → '-'. */
function encodeProjectDir(p: string): string {
  return path.resolve(p).replace(/[^a-zA-Z0-9]/g, '-');
}

function rm(target: string): void {
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
}

/**
 * Wait for live `claude` processes matching `holds` to go away (Hive's own
 * terminals were just killed and take a moment to exit). Throws 409 if one
 * is still running afterwards: it belongs to something outside Hive.
 */
async function waitForRelease(holds: (h: { sessionId: string; cwd?: string }) => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const holder = listLiveSessionHolders().find(holds);
    if (!holder) return;
    if (Date.now() > deadline) {
      throw new DeleteError(409,
        `A Claude process outside Hive (pid ${holder.pid}) is still running this session. Close it first.`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Delete Hive's own records keyed by a session ID. */
function deleteSessionRows(sessionId: string): void {
  const db = getDb();
  const tables = ['events', 'queue_tasks', 'task_queues', 'live_loops', 'bookmarks'];
  db.transaction(() => {
    for (const table of tables) {
      try {
        db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId);
      } catch { /* table not created yet */ }
    }
  })();
}

/** Remove a session's transcript and the CLI's per-session side files. */
function deleteSessionFiles(config: HiveConfig, sessionId: string, filePath: string, provider: string): void {
  rm(filePath);
  removeFileState(filePath);
  if (provider !== 'claude') return;
  // Subagent transcripts and tool results sit next to the transcript.
  rm(path.join(path.dirname(filePath), sessionId));
  rm(path.join(config.claudeHome, 'file-history', sessionId));
  rm(path.join(config.claudeHome, 'session-env', sessionId));
}

/** Session files for a top-level session ID: what the aggregator knows, else a disk lookup. */
function findSessionFiles(deps: DeleteRouteDeps, sessionId: string): Array<{ filePath: string; provider: string }> {
  const found = deps.aggregator.getDiscoveredSessions()
    .filter((d) => d.sessionId === sessionId && !d.isSubagent)
    .map((d) => ({ filePath: d.filePath, provider: d.provider ?? 'claude' }));
  if (found.length > 0) return found;
  const info = getSessionInfo(sessionId);
  return info.exists && info.filePath ? [{ filePath: info.filePath, provider: 'claude' }] : [];
}

async function deleteSession(deps: DeleteRouteDeps, sessionId: string): Promise<void> {
  if (!SESSION_ID.test(sessionId)) throw new DeleteError(400, 'Invalid session ID');
  const files = findSessionFiles(deps, sessionId);
  if (files.length === 0) throw new DeleteError(404, 'Session not found');

  destroyPtysForSession(sessionId, deps.terminalIdsFor(sessionId));
  await waitForRelease((h) => h.sessionId === sessionId);

  for (const f of files) deleteSessionFiles(deps.config, sessionId, f.filePath, f.provider);
  deleteSessionRows(sessionId);
  deps.forgetSession(sessionId);
  deps.aggregator.refreshSessions();
}

interface RemoveProjectBody {
  path?: unknown;
  deleteHistory?: unknown;
  deleteFolder?: unknown;
}

/** Folders that must never be deleted as "a project". */
function protectedFolders(config: HiveConfig): string[] {
  return [
    os.homedir(),
    hiveHome(),
    config.claudeHome,
    process.cwd(),
    config.projectsRoot,
    ...(config.projectRoots ?? []),
  ].filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
}

async function removeProject(
  deps: DeleteRouteDeps,
  body: RemoveProjectBody,
): Promise<{ deletedSessions: number; deletedFolder: boolean }> {
  const { config } = deps;
  if (typeof body.path !== 'string' || !path.isAbsolute(body.path.trim())) {
    throw new DeleteError(400, 'path must be an absolute folder path');
  }
  const projectPath = path.resolve(body.path.trim());
  const deleteFolder = body.deleteFolder === true;
  // A deleted folder takes its history with it — there'd be nothing to resume.
  const deleteHistory = deleteFolder || body.deleteHistory === true;

  if (path.dirname(projectPath) === projectPath) {
    throw new DeleteError(400, 'Refusing to remove a drive root');
  }
  const scopeRoots = [config.projectsRoot, ...(config.projectRoots ?? [])].filter(Boolean);
  if (scopeRoots.some((r) => norm(r) === norm(projectPath))) {
    throw new DeleteError(400, 'This is a projects folder from Settings. Change it there instead.');
  }
  const listed = (config.projects ?? []).some((p) => norm(p.path) === norm(projectPath));
  if (!listed && !isPathInScope(config, projectPath)) {
    throw new DeleteError(400, 'Not a project in this Hive');
  }
  if (deleteFolder) {
    // Never a folder that holds Hive, Claude's home, or the user's home.
    const blocker = protectedFolders(config).find((p) => isInside(p, projectPath));
    if (blocker) throw new DeleteError(400, `Refusing to delete a folder that contains ${blocker}`);
  }

  // Sessions that ran in this project (cwd inside it; exact history folder when cwd is unknown).
  const encoded = encodeProjectDir(projectPath);
  const sameDir = (d: string) => (isWindows ? d.toLowerCase() === encoded.toLowerCase() : d === encoded);
  const sessions = deps.aggregator.getDiscoveredSessions().filter((d) =>
    !d.isSubagent && (d.cwd ? isInside(d.cwd, projectPath) : sameDir(d.projectDir)));

  let deletedSessions = 0;
  let deletedFolder = false;
  if (deleteHistory) {
    const ids = new Set(sessions.map((s) => s.sessionId));
    destroyPtysUnder(projectPath);
    for (const id of ids) destroyPtysForSession(id, deps.terminalIdsFor(id));
    await waitForRelease((h) => ids.has(h.sessionId) || (!!h.cwd && isInside(h.cwd, projectPath)));

    for (const s of sessions) {
      deleteSessionFiles(config, s.sessionId, s.filePath, s.provider ?? 'claude');
      deleteSessionRows(s.sessionId);
      deps.forgetSession(s.sessionId);
      deletedSessions++;
    }

    // The history folder itself: all of it with the project, else only if now empty
    // (it can also hold Claude's memory for the project, which stays).
    const historyRoot = path.join(config.claudeHome, 'projects');
    let dirs: string[] = [];
    try { dirs = fs.readdirSync(historyRoot).filter(sameDir); } catch { /* no history */ }
    for (const d of dirs) {
      const full = path.join(historyRoot, d);
      try {
        if (deleteFolder || fs.readdirSync(full).length === 0) rm(full);
      } catch { /* already gone */ }
    }
  }

  // Off the lists (also covers folders under the projects root, which are always discovered).
  hideProject(config, projectPath);
  if (listed) config.projects = config.projects.filter((p) => norm(p.path) !== norm(projectPath));
  deps.saveConfig(config);

  if (deleteFolder && fs.existsSync(projectPath)) {
    try {
      rm(projectPath);
      deletedFolder = true;
    } catch (err) {
      deps.aggregator.refreshSessions();
      throw new DeleteError(500, `Removed from Hive, but deleting the folder failed: ${(err as Error).message}`);
    }
  }

  deps.aggregator.refreshSessions();
  return { deletedSessions, deletedFolder };
}

function fail(res: http.ServerResponse, err: unknown): void {
  if (err instanceof DeleteError) {
    sendJson(res, err.status, { error: err.message });
    return;
  }
  console.error('[delete]', err);
  sendJson(res, 500, { error: err instanceof Error ? err.message : 'Delete failed' });
}

export function registerDeleteRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: DeleteRouteDeps,
): boolean {
  const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
  if (sessionMatch && req.method === 'DELETE') {
    const sessionId = decodeURIComponent(sessionMatch[1]);
    deleteSession(deps, sessionId)
      .then(() => sendJson(res, 200, { ok: true }))
      .catch((err) => fail(res, err));
    return true;
  }

  if (url.pathname === '/api/projects/remove' && req.method === 'POST') {
    if (!deps.canRemoveProjects(req)) {
      sendJson(res, 403, { error: 'Admin access required' });
      return true;
    }
    readBody(req)
      .then((raw) => removeProject(deps, JSON.parse(raw || '{}') as RemoveProjectBody))
      .then((result) => sendJson(res, 200, { ok: true, ...result }))
      .catch((err) => fail(res, err instanceof SyntaxError ? new DeleteError(400, 'Invalid JSON') : err));
    return true;
  }

  return false;
}
