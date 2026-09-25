import http from 'node:http';
import { TimeClient } from './time-client.js';
import type { ManualTimeEntry } from './time-client.js';
import type { SessionTimeTracker } from './session-time-tracker.js';
import type { TurnTimeTracker } from './turn-time-tracker.js';
import type { AuthenticatedRequest } from '../auth/types.js';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';

export function registerAnalyticsRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  timeTracker?: SessionTimeTracker,
  turnTracker?: TurnTimeTracker,
): boolean {
  const pathname = url.pathname;

  // --- Manual time entries (shared DB) ---

  // GET /api/analytics/time?days=30
  if (pathname === '/api/analytics/time' && req.method === 'GET') {
    const days = parseInt(url.searchParams.get('days') || '30', 10);
    const client = new TimeClient();
    (async () => {
      try {
        sendJson(res, 200, await client.getTimeData(isNaN(days) ? 30 : days));
      } catch (err: unknown) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }

  // POST /api/analytics/time — manual time entry
  if (pathname === '/api/analytics/time' && req.method === 'POST') {
    const client = new TimeClient();
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as Partial<ManualTimeEntry>;
        const username = body.username || (req as AuthenticatedRequest).user?.email;
        const hours = Number(body.hours);
        if (!username || !body.projectPath || !body.entryDate || !Number.isFinite(hours) || hours <= 0) {
          sendJson(res, 400, { error: 'Missing required fields: username, projectPath, hours, entryDate' });
          return;
        }
        if (!/^\d{4}-\d{2}-\d{2}/.test(body.entryDate)) {
          sendJson(res, 400, { error: 'entryDate must be YYYY-MM-DD' });
          return;
        }
        const workItemId = body.workItemId == null ? null : Number(body.workItemId);
        const entry = await client.insertManualTime({
          username,
          projectPath: body.projectPath,
          workItemId: Number.isInteger(workItemId) ? workItemId : null,
          hours,
          description: body.description || '',
          entryDate: body.entryDate.slice(0, 10),
        });
        sendJson(res, 201, { success: true, entry });
      } catch (err: unknown) {
        if (err instanceof SyntaxError) {
          sendJson(res, 400, { error: 'Invalid body' });
          return;
        }
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }

  // --- Session time tracking (local SQLite) ---

  // GET /api/analytics/time/active — currently clocked-in sessions
  if (pathname === '/api/analytics/time/active' && req.method === 'GET') {
    if (!timeTracker) {
      sendJson(res, 503, { error: 'Time tracker not available' });
      return true;
    }
    sendJson(res, 200, { active: timeTracker.getActiveSessions() });
    return true;
  }

  // GET /api/analytics/time/blocks?days=30 — historical time blocks
  if (pathname === '/api/analytics/time/blocks' && req.method === 'GET') {
    if (!timeTracker) {
      sendJson(res, 503, { error: 'Time tracker not available' });
      return true;
    }
    const days = parseInt(url.searchParams.get('days') || '30', 10);
    sendJson(res, 200, { blocks: timeTracker.getTimeBlocks(isNaN(days) ? 30 : days) });
    return true;
  }

  // GET /api/analytics/time/daily?days=30 — daily summary
  if (pathname === '/api/analytics/time/daily' && req.method === 'GET') {
    if (!timeTracker) {
      sendJson(res, 503, { error: 'Time tracker not available' });
      return true;
    }
    const days = parseInt(url.searchParams.get('days') || '30', 10);
    sendJson(res, 200, { daily: timeTracker.getDailySummary(isNaN(days) ? 30 : days) });
    return true;
  }

  // POST /api/analytics/time/clock-in — manually clock in
  if (pathname === '/api/analytics/time/clock-in' && req.method === 'POST') {
    if (!timeTracker) {
      sendJson(res, 503, { error: 'Time tracker not available' });
      return true;
    }
    readBody(req).then((raw) => {
      try {
        const { sessionId, project, workItemId } = JSON.parse(raw) as { sessionId: string; project: string; workItemId?: number };
        if (!sessionId || !project) {
          sendJson(res, 400, { error: 'Missing sessionId or project' });
          return;
        }
        timeTracker.clockIn(sessionId, project, workItemId ?? null);
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 400, { error: 'Invalid body' });
      }
    }).catch(() => sendJson(res, 500, { error: 'Failed to read body' }));
    return true;
  }

  // --- Hook-driven turn tracking (UserPromptSubmit → Stop) ---

  // GET /api/analytics/time/turns/daily?days=30
  if (pathname === '/api/analytics/time/turns/daily' && req.method === 'GET') {
    if (!turnTracker) {
      sendJson(res, 503, { error: 'Turn tracker not available' });
      return true;
    }
    const days = parseInt(url.searchParams.get('days') || '30', 10);
    sendJson(res, 200, { daily: turnTracker.getDailySummary(isNaN(days) ? 30 : days) });
    return true;
  }

  // GET /api/analytics/time/turns/by-project?days=30
  if (pathname === '/api/analytics/time/turns/by-project' && req.method === 'GET') {
    if (!turnTracker) {
      sendJson(res, 503, { error: 'Turn tracker not available' });
      return true;
    }
    const days = parseInt(url.searchParams.get('days') || '30', 10);
    sendJson(res, 200, { rows: turnTracker.getProjectDailySummary(isNaN(days) ? 30 : days) });
    return true;
  }

  // GET /api/analytics/time/turns/active — turns currently open
  if (pathname === '/api/analytics/time/turns/active' && req.method === 'GET') {
    if (!turnTracker) {
      sendJson(res, 503, { error: 'Turn tracker not available' });
      return true;
    }
    sendJson(res, 200, { active: turnTracker.getActiveTurns() });
    return true;
  }

  // POST /api/analytics/time/clock-out — manually clock out
  if (pathname === '/api/analytics/time/clock-out' && req.method === 'POST') {
    if (!timeTracker) {
      sendJson(res, 503, { error: 'Time tracker not available' });
      return true;
    }
    readBody(req).then((raw) => {
      try {
        const { sessionId } = JSON.parse(raw) as { sessionId: string };
        if (!sessionId) {
          sendJson(res, 400, { error: 'Missing sessionId' });
          return;
        }
        timeTracker.clockOut(sessionId, false);
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 400, { error: 'Invalid body' });
      }
    }).catch(() => sendJson(res, 500, { error: 'Failed to read body' }));
    return true;
  }

  return false;
}
