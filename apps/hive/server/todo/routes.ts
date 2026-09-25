import type http from 'node:http';
import type { LiteConfig } from '../types.js';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import { generateTodos } from './ai-todo-client.js';
import { getValidAccessToken } from '../gmail/google-auth.js';
import { getTodayEvents } from '../gmail/calendar-client.js';
import { getTracker } from '../integrations/registry.js';
import {
  insertTodo,
  loadOpenTodos,
  updateTodo,
  deleteTodo,
  loadTrackerCompletions,
  setTrackerCompletion,
  type StoredTodo,
} from './todo-db.js';

/** Preview ids for generated (not yet saved) to-dos — negative so they never collide with stored ids. */
let previewIdCounter = 0;

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export function handleTodoRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: LiteConfig,
  saveConfig: (config: LiteConfig) => void,
): boolean {
  const userEmail = config.user?.email || 'local';

  // GET /api/todo/generate — trigger AI analysis (preview only, not saved)
  if (url.pathname === '/api/todo/generate' && req.method === 'GET') {
    (async () => {
      try {
        const items = await generateTodos(config, saveConfig);
        const today = getTodayStr();
        // Return items for preview — do NOT save to DB yet.
        // The frontend will call POST /api/todo/items for approved items.
        const preview: StoredTodo[] = items.map((item) => ({
          id: --previewIdCounter, // temporary id for UI keying only
          userEmail,
          todoDate: today,
          title: item.title,
          description: item.description,
          priority: item.priority,
          status: 'todo',
          source: item.source,
          sourceRef: item.sourceRef,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));
        sendJson(res, 200, { todos: preview });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // GET /api/todo/today — get today's todos
  if (url.pathname === '/api/todo/today' && req.method === 'GET') {
    const today = getTodayStr();
    (async () => {
      try {
        sendJson(res, 200, { todos: await loadOpenTodos(userEmail, today) });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // POST /api/todo/tracker-toggle — persist tracker issue completion
  if (url.pathname === '/api/todo/tracker-toggle' && req.method === 'POST') {
    (async () => {
      try {
        const body = await readBody(req);
        const { ticketId, title, status, priority } = JSON.parse(body) as {
          ticketId: string | number; title: string; status: string; priority?: string;
        };
        await setTrackerCompletion({
          userEmail,
          date: getTodayStr(),
          ticketId: String(ticketId),
          done: status === 'done',
          title,
          priority,
        });

        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // PATCH /api/todo/:id — toggle status, update priority (manual/AI todos)
  const patchMatch = /^\/api\/todo\/(\d+)$/.exec(url.pathname);
  if (patchMatch && req.method === 'PATCH') {
    const id = parseInt(patchMatch[1]);
    (async () => {
      try {
        const body = await readBody(req);
        const patch = JSON.parse(body) as Partial<{ status: string; priority: string }>;

        if (!(await updateTodo(id, patch))) {
          sendJson(res, 404, { error: 'todo not found' });
          return;
        }
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // POST /api/todo/items — manually add a todo
  if (url.pathname === '/api/todo/items' && req.method === 'POST') {
    (async () => {
      try {
        const body = await readBody(req);
        const { title, description, priority } = JSON.parse(body) as {
          title: string; description?: string; priority?: string;
        };

        if (!title) {
          sendJson(res, 400, { error: 'title required' });
          return;
        }

        const todo = await insertTodo({
          userEmail,
          todoDate: getTodayStr(),
          title,
          description: description || null,
          priority: priority || 'medium',
          status: 'todo',
          source: 'manual',
          sourceRef: null,
        });
        sendJson(res, 200, todo);
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // DELETE /api/todo/:id
  const deleteMatch = /^\/api\/todo\/(\d+)$/.exec(url.pathname);
  if (deleteMatch && req.method === 'DELETE') {
    const id = parseInt(deleteMatch[1]);
    (async () => {
      try {
        await deleteTodo(id);
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // GET /api/todo/combined — unified view: todos + tracker issues + calendar events
  if (url.pathname === '/api/todo/combined' && req.method === 'GET') {
    const today = getTodayStr();
    (async () => {
      try {
        // 1. Load manual/AI todos
        const todos: StoredTodo[] = await loadOpenTodos(userEmail, today);

        // 2. Load the user's open tracker issues + merge today's completions
        let trackerItems: Array<{
          id: string; title: string; type: string; state: string;
          priority: string; source: string; assignedTo?: string; status?: string; url?: string;
        }> = [];
        try {
          const tracker = getTracker(config);
          if (tracker) {
            const issues = await tracker.searchIssues({ assignee: 'me', stateCategory: ['todo', 'in_progress'], limit: 50 });
            const completedIds = await loadTrackerCompletions(userEmail, today);
            trackerItems = issues.map((i) => ({
              id: i.key,
              title: i.title,
              type: i.type ?? '',
              state: i.state,
              priority: normalizePriority(i.priority),
              source: 'tracker',
              assignedTo: i.assignee?.name,
              status: completedIds.has(i.key) ? 'done' : 'todo',
              url: i.url,
            }));
          }
        } catch (err) {
          console.warn('[todo] Tracker fetch failed:', err);
        }

        // 3. Load calendar events
        let calendarItems: Array<{
          id: string; title: string; description: string;
          time: string; source: string; htmlLink?: string; meetLink?: string; isAllDay: boolean;
        }> = [];
        try {
          const token = await getValidAccessToken(config, saveConfig);
          if (token) {
            const events = await getTodayEvents(token);
            calendarItems = events.map((e) => {
              let time = '';
              if (e.isAllDay) {
                time = 'All day';
              } else if (e.start) {
                const d = new Date(e.start);
                time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                if (e.end) {
                  const end = new Date(e.end);
                  time += ` - ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
                }
              }
              return {
                id: e.id,
                title: e.summary,
                description: time,
                time: e.start,
                source: 'calendar',
                htmlLink: e.htmlLink,
                meetLink: e.meetLink,
                isAllDay: e.isAllDay,
              };
            });
          }
        } catch (err) {
          console.warn('[todo] Calendar fetch failed:', err);
        }

        sendJson(res, 200, { todos, trackerItems, calendarItems });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  return false;
}

/** Map a provider priority label/number onto the todo list's high/medium/low. */
function normalizePriority(p: string | undefined): string {
  if (!p) return 'low';
  const n = Number(p);
  if (Number.isFinite(n)) return n <= 1 ? 'high' : n === 2 ? 'medium' : 'low';
  const lower = p.toLowerCase();
  if (/(urgent|highest|critical|high|p0|p1)/.test(lower)) return 'high';
  if (/(medium|normal|p2)/.test(lower)) return 'medium';
  return 'low';
}
