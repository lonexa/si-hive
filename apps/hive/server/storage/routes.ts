/**
 * Settings → Storage: choose where the shared database lives.
 *
 *   GET  /api/storage        current target (password masked) + last migration report
 *   PUT  /api/storage        { shared: SharedStorageConfig, password? } — save, reconnect, migrate
 *   POST /api/storage/test   { shared, password? } — try a connection without saving
 */
import type http from 'node:http';
import type { HiveConfig } from '../types.js';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import {
  closeSharedDb,
  readSharedStorageConfig,
  testStorageConnection,
  SHARED_DB_PASSWORD_REF,
  type SharedStorageConfig,
} from '../../../../packages/shared/src/server/storage/index.js';
import { getSecret, setSecret, deleteSecret, maskSecret } from '../../../../packages/shared/src/server/credentials.js';
import { initSharedStorage, getLastMigrationReport } from './init.js';

function sanitize(input: unknown): SharedStorageConfig | null {
  if (!input || typeof input !== 'object') return null;
  const c = input as Record<string, unknown>;
  if (c.type !== 'sqlite' && c.type !== 'postgres' && c.type !== 'mssql') return null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const out: SharedStorageConfig = { type: c.type };
  if (c.type === 'sqlite') {
    out.file = str(c.file);
  } else {
    out.host = str(c.host);
    out.port = Number(c.port) || undefined;
    out.database = str(c.database);
    out.user = str(c.user);
    out.ssl = c.ssl === true;
    out.trustServerCertificate = c.trustServerCertificate === true;
    if (!out.host || !out.database) return null;
  }
  return out;
}

export function registerStorageRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: HiveConfig,
  saveConfig: (c: HiveConfig) => void,
): boolean {
  if (url.pathname === '/api/storage' && req.method === 'GET') {
    sendJson(res, 200, {
      shared: readSharedStorageConfig(),
      password: maskSecret(getSecret(SHARED_DB_PASSWORD_REF)),
      migrations: getLastMigrationReport(),
    });
    return true;
  }

  if (url.pathname === '/api/storage/test' && req.method === 'POST') {
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { shared?: unknown; password?: string };
        const cfg = sanitize(body.shared);
        if (!cfg) return sendJson(res, 400, { ok: false, error: 'Invalid storage settings' });
        sendJson(res, 200, await testStorageConnection(cfg, body.password || undefined));
      } catch (err) {
        sendJson(res, 400, { ok: false, error: (err as Error).message });
      }
    })();
    return true;
  }

  if (url.pathname === '/api/storage' && req.method === 'PUT') {
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { shared?: unknown; password?: string };
        const cfg = sanitize(body.shared);
        if (!cfg) return sendJson(res, 400, { error: 'Invalid storage settings' });
        if (cfg.type !== 'sqlite') {
          const test = await testStorageConnection(cfg, body.password || undefined);
          if (!test.ok) return sendJson(res, 400, { error: `Connection failed: ${test.error}` });
        }
        if (body.password) setSecret(SHARED_DB_PASSWORD_REF, body.password);
        if (cfg.type === 'sqlite') deleteSecret(SHARED_DB_PASSWORD_REF);
        config.storage = { ...(config.storage as object | undefined), shared: cfg };
        saveConfig(config);
        await closeSharedDb();
        const migrations = await initSharedStorage();
        sendJson(res, migrations.error ? 500 : 200, { ok: !migrations.error, shared: cfg, migrations });
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      }
    })();
    return true;
  }

  return false;
}
