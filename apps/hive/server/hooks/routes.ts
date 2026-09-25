import http from 'node:http';
import {
  resolveSettingsPath,
  listHooks,
  upsertHook,
  deleteHook,
  type HookScope,
  type HookObject,
} from './settings-hooks.js';
import type { HiveConfig } from '../types.js';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';

function getScope(url: URL): HookScope {
  return url.searchParams.get('scope') === 'project' ? 'project' : 'user';
}

/**
 * Routes for managing Claude Code hooks stored in a settings.json.
 * All routes accept ?scope=user|project&projectDir=... ; project scope writes
 * <projectDir>/.claude/settings.json, user scope writes ~/.claude/settings.json.
 */
export function registerHooksRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: HiveConfig,
): boolean {
  const pathname = url.pathname;

  // GET /api/hooks — list flattened hooks for the chosen settings.json
  if (pathname === '/api/hooks' && req.method === 'GET') {
    try {
      const scope = getScope(url);
      const projectDir = url.searchParams.get('projectDir') || undefined;
      const settingsPath = resolveSettingsPath(scope, projectDir, config.claudeHome);
      sendJson(res, 200, listHooks(settingsPath));
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  // PUT /api/hooks — create or edit a hook (read-merge-write)
  if (pathname === '/api/hooks' && req.method === 'PUT') {
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as {
          scope?: HookScope;
          projectDir?: string;
          event: string;
          matcher?: string;
          hookObj: HookObject;
          originalId?: string;
        };
        if (!body.event || !body.hookObj || !body.hookObj.type) {
          sendJson(res, 400, { error: 'event and hookObj.type are required' });
          return;
        }
        const settingsPath = resolveSettingsPath(body.scope ?? 'user', body.projectDir, config.claudeHome);
        const entry = upsertHook(settingsPath, {
          event: body.event,
          matcher: body.matcher,
          hookObj: body.hookObj,
          originalId: body.originalId,
        });
        sendJson(res, 200, entry);
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }

  // POST /api/hooks/install — merge a hook from Community/Team into settings.json
  if (pathname === '/api/hooks/install' && req.method === 'POST') {
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as {
          scope?: HookScope;
          projectDir?: string;
          event: string;
          matcher?: string;
          hookObj: HookObject;
        };
        if (!body.event || !body.hookObj || !body.hookObj.type) {
          sendJson(res, 400, { error: 'event and hookObj.type are required' });
          return;
        }
        const settingsPath = resolveSettingsPath(body.scope ?? 'user', body.projectDir, config.claudeHome);
        const entry = upsertHook(settingsPath, {
          event: body.event,
          matcher: body.matcher,
          hookObj: body.hookObj,
        });
        sendJson(res, 200, { ok: true, entry });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }

  // DELETE /api/hooks/:id
  const delMatch = pathname.match(/^\/api\/hooks\/([a-f0-9]+)$/);
  if (delMatch && req.method === 'DELETE') {
    try {
      const scope = getScope(url);
      const projectDir = url.searchParams.get('projectDir') || undefined;
      const settingsPath = resolveSettingsPath(scope, projectDir, config.claudeHome);
      const removed = deleteHook(settingsPath, delMatch[1]);
      if (!removed) {
        sendJson(res, 404, { error: 'Hook not found' });
      } else {
        sendJson(res, 200, { ok: true });
      }
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  return false;
}
