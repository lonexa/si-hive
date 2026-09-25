/**
 * Per-button / per-action event tracking endpoint.
 *
 * Accepts a batch of events from the Hive frontend (see apps/hive/src/lib/
 * track.ts) and writes them to the shared user_events table so admins can see which
 * buttons each user has clicked. Designed for high-frequency, low-value
 * writes — failures are swallowed and ack'd so analytics never break the
 * client.
 */

import http from 'node:http';
import os from 'node:os';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import type { AuthenticatedRequest } from '../auth/types.js';
import { UserManagementClient } from './user-management-client.js';
import { getServerVersion } from '../server-version.js';
import { redactRoute } from '../privacy/incognito.js';

interface TrackEventPayload {
  name: string;
  category?: string;
  route?: string;
  occurredAt?: string;
  props?: Record<string, unknown>;
}

const MAX_BATCH = 50;

export function registerEventTrackRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  if (url.pathname !== '/api/events/track') return false;
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'POST required' });
    return true;
  }

  const authReq = req as AuthenticatedRequest;
  if (!authReq.user) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return true;
  }

  (async () => {
    const client = new UserManagementClient();
    try {
      const bodyStr = await readBody(req);
      const body = JSON.parse(bodyStr || '{}') as { events?: TrackEventPayload[] };
      const events = (body.events || []).slice(0, MAX_BATCH);
      if (events.length === 0) {
        sendJson(res, 200, { ok: true, inserted: 0 });
        return;
      }
      const machine = os.hostname();
      const version = getServerVersion();

      // Events fired while viewing an incognito session are dropped outright,
      // not just route-redacted. user_events feeds /admin/adoption,
      // which aggregates by event name — a redacted route would still let the
      // click itself show up there as activity.
      const publishable = events.filter((e) => {
        if (!e?.name) return false;
        return !e.route || redactRoute(e.route) === e.route;
      });

      await client.insertEvents(publishable.map(e => ({
        userOid: authReq.user!.oid,
        occurredAt: e.occurredAt,
        category: (e.category || 'click').slice(0, 50),
        name: e.name.slice(0, 150),
        route: e.route ? e.route.slice(0, 200) : null,
        props: e.props ?? null,
        version,
        machineName: machine,
      })));
      sendJson(res, 200, { ok: true, inserted: publishable.length, dropped: events.length - publishable.length });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Don't surface telemetry failures to the client.
      console.warn('[events/track] failed:', msg);
      sendJson(res, 200, { ok: true, warning: msg });
    } finally {
      await client.close();
    }
  })();

  return true;
}
