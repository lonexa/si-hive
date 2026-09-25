import type http from 'node:http';
import type { KBClient } from './kb-client.js';
import type { KBEntryInput } from './kb-types.js';
import { sendJson, readBody } from './http-utils.js';

export interface KBRouteDeps {
  getClient: () => KBClient | null;
  getKBScopeOwner: () => string;
}

/**
 * Shared KB route handler. Returns true if the route was handled.
 *
 * Handles: config, entries CRUD, categories, tags.
 * App-specific routes (e.g. test-connection, decisions) should be
 * handled by the calling app before or after this function.
 */
export function handleKBRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: KBRouteDeps,
): boolean {
  const pathname = url.pathname;

  // GET /api/kb/config
  if (pathname === '/api/kb/config' && req.method === 'GET') {
    const client = deps.getClient();
    if (!client) {
      sendJson(res, 200, { configured: false });
    } else {
      // Access the config from the client for display
      // We re-call getClient to check configured state; use loadKBConfig in the app layer
      sendJson(res, 200, { configured: true });
    }
    return true;
  }

  // GET /api/kb/entries
  if (pathname === '/api/kb/entries' && req.method === 'GET') {
    const client = deps.getClient();
    if (!client) {
      sendJson(res, 400, { error: 'Knowledge Base not configured' });
      return true;
    }
    const q = url.searchParams.get('q') || undefined;
    const category = url.searchParams.get('category') || undefined;
    const tag = url.searchParams.get('tag') || undefined;
    const scopeOwner = url.searchParams.get('scopeOwner') || deps.getKBScopeOwner() || undefined;
    (async () => {
      try {
        const entries = await client.search(q, category, tag, scopeOwner);
        sendJson(res, 200, entries);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // POST /api/kb/entries
  if (pathname === '/api/kb/entries' && req.method === 'POST') {
    const client = deps.getClient();
    if (!client) {
      sendJson(res, 400, { error: 'Knowledge Base not configured' });
      return true;
    }
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as KBEntryInput;
        if (!body.title || !body.content) {
          sendJson(res, 400, { error: 'title and content are required' });
          return;
        }
        const entry = await client.create(body);
        sendJson(res, 201, entry);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // Routes that match /api/kb/entries/:id
  const entryMatch = pathname.match(/^\/api\/kb\/entries\/(\d+)$/);
  if (entryMatch) {
    const id = parseInt(entryMatch[1], 10);

    // GET /api/kb/entries/:id
    if (req.method === 'GET') {
      const client = deps.getClient();
      if (!client) {
        sendJson(res, 400, { error: 'Knowledge Base not configured' });
        return true;
      }
      (async () => {
        try {
          const entry = await client.getById(id);
          if (!entry) {
            sendJson(res, 404, { error: 'Entry not found' });
          } else {
            sendJson(res, 200, entry);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          sendJson(res, 500, { error: msg });
        } finally {
          await client.close();
        }
      })();
      return true;
    }

    // PUT /api/kb/entries/:id
    if (req.method === 'PUT') {
      const client = deps.getClient();
      if (!client) {
        sendJson(res, 400, { error: 'Knowledge Base not configured' });
        return true;
      }
      (async () => {
        try {
          const body = JSON.parse(await readBody(req)) as Partial<KBEntryInput>;
          const entry = await client.update(id, body);
          if (!entry) {
            sendJson(res, 404, { error: 'Entry not found' });
          } else {
            sendJson(res, 200, entry);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          sendJson(res, 500, { error: msg });
        } finally {
          await client.close();
        }
      })();
      return true;
    }

    // DELETE /api/kb/entries/:id
    if (req.method === 'DELETE') {
      const client = deps.getClient();
      if (!client) {
        sendJson(res, 400, { error: 'Knowledge Base not configured' });
        return true;
      }
      (async () => {
        try {
          const deleted = await client.delete(id);
          if (!deleted) {
            sendJson(res, 404, { error: 'Entry not found' });
          } else {
            sendJson(res, 200, { ok: true });
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          sendJson(res, 500, { error: msg });
        } finally {
          await client.close();
        }
      })();
      return true;
    }
  }

  // POST /api/kb/deduplicate
  if (pathname === '/api/kb/deduplicate' && req.method === 'POST') {
    const client = deps.getClient();
    if (!client) {
      sendJson(res, 400, { error: 'Knowledge Base not configured' });
      return true;
    }
    (async () => {
      try {
        const removed = await client.removeDuplicates();
        sendJson(res, 200, { removed, message: `Removed ${removed} duplicate entries` });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // GET /api/kb/categories
  if (pathname === '/api/kb/categories' && req.method === 'GET') {
    const client = deps.getClient();
    if (!client) {
      sendJson(res, 400, { error: 'Knowledge Base not configured' });
      return true;
    }
    (async () => {
      try {
        const categories = await client.getCategories();
        sendJson(res, 200, categories);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // GET /api/kb/tags
  if (pathname === '/api/kb/tags' && req.method === 'GET') {
    const client = deps.getClient();
    if (!client) {
      sendJson(res, 400, { error: 'Knowledge Base not configured' });
      return true;
    }
    (async () => {
      try {
        const tags = await client.getTags();
        sendJson(res, 200, tags);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  return false;
}
