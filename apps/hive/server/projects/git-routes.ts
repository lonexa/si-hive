import http from 'node:http';
import { gitClient } from './git-client.js';
import { sendJson } from '../../../../packages/shared/src/server/http-utils.js';

/**
 * Register git-related project routes.
 * Returns true if the route was handled.
 *
 * Routes:
 *   GET /api/projects/:path/git-status
 *   GET /api/projects/:path/git-diff
 *   GET /api/projects/:path/git-branches
 */
export function registerGitRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse
): boolean {
  const pathname = url.pathname;

  // --- GET /api/projects/:path/git-status ---
  const gitStatusMatch = pathname.match(/^\/api\/projects\/(.+)\/git-status$/);
  if (gitStatusMatch && req.method === 'GET') {
    const projectPath = decodeURIComponent(gitStatusMatch[1]);
    const compareBranch = url.searchParams.get('branch') || undefined;
    try {
      if (!gitClient.isGitRepo(projectPath)) {
        sendJson(res, 400, { error: 'Not a git repository', path: projectPath });
        return true;
      }
      const result = gitClient.getStatus(projectPath, compareBranch);
      sendJson(res, 200, result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: 'Failed to get git status', detail: message });
    }
    return true;
  }

  // --- GET /api/projects/:path/git-diff?branch=... ---
  const gitDiffMatch = pathname.match(/^\/api\/projects\/(.+)\/git-diff$/);
  if (gitDiffMatch && req.method === 'GET') {
    const projectPath = decodeURIComponent(gitDiffMatch[1]);
    const compareBranch = url.searchParams.get('branch') || undefined;
    try {
      if (!gitClient.isGitRepo(projectPath)) {
        sendJson(res, 400, { error: 'Not a git repository', path: projectPath });
        return true;
      }
      const result = gitClient.getDiff(projectPath, compareBranch);
      sendJson(res, 200, result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: 'Failed to get git diff', detail: message });
    }
    return true;
  }

  // --- GET /api/projects/:path/git-branches ---
  const gitBranchesMatch = pathname.match(/^\/api\/projects\/(.+)\/git-branches$/);
  if (gitBranchesMatch && req.method === 'GET') {
    const projectPath = decodeURIComponent(gitBranchesMatch[1]);
    try {
      if (!gitClient.isGitRepo(projectPath)) {
        sendJson(res, 400, { error: 'Not a git repository', path: projectPath });
        return true;
      }
      const result = gitClient.getBranches(projectPath);
      sendJson(res, 200, result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: 'Failed to get git branches', detail: message });
    }
    return true;
  }

  return false;
}
