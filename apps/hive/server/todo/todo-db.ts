/**
 * Daily to-do persistence backed by the shared database (see
 * packages/shared/src/server/storage). Rows are per user; `todoDate` is a
 * 'YYYY-MM-DD' string.
 *
 * Schema: ./migrations.ts (table `daily_todos`).
 *
 * Tracker issues are not stored as to-dos; a `source = 'tracker'` row only
 * records that the user ticked that issue off on that day.
 */
import { sql } from 'kysely';
import {
  getSharedDb,
  getSharedDialect,
  insertReturning,
  nowIso,
  affectedRows,
} from '../../../../packages/shared/src/server/storage/index.js';

export interface StoredTodo {
  id: number;
  userEmail: string;
  todoDate: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  source: string;
  sourceRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export type NewTodo = Pick<StoredTodo, 'userEmail' | 'todoDate' | 'title'> &
  Partial<Pick<StoredTodo, 'description' | 'priority' | 'status' | 'source' | 'sourceRef'>>;

type TodoRow = {
  id: number;
  user_email: string;
  todo_date: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  source: string;
  source_ref: string | null;
  created_at: string;
  updated_at: string;
};

function rowToTodo(row: TodoRow): StoredTodo {
  return {
    id: Number(row.id),
    userEmail: row.user_email,
    todoDate: row.todo_date,
    title: row.title,
    description: row.description ?? null,
    priority: row.priority,
    status: row.status,
    source: row.source,
    sourceRef: row.source_ref ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TRACKER_SOURCE = 'tracker';

export async function insertTodo(todo: NewTodo): Promise<StoredTodo> {
  const db = await getSharedDb();
  const now = nowIso();
  const row = await insertReturning<TodoRow>(db, getSharedDialect(), 'daily_todos', {
    user_email: todo.userEmail,
    todo_date: todo.todoDate,
    title: todo.title,
    description: todo.description ?? null,
    priority: todo.priority ?? 'medium',
    status: todo.status ?? 'todo',
    source: todo.source ?? 'manual',
    source_ref: todo.sourceRef ?? null,
    created_at: now,
    updated_at: now,
  });
  return rowToTodo(row);
}

/**
 * The persistent list: every incomplete non-tracker to-do for the user, plus
 * the ones dated `today` that are done (so the user sees what they finished).
 * High priority first, then oldest first.
 */
export async function loadOpenTodos(userEmail: string, today: string): Promise<StoredTodo[]> {
  const db = await getSharedDb();
  const rows = await db.selectFrom('daily_todos').selectAll()
    .where('user_email', '=', userEmail)
    .where('source', '!=', TRACKER_SOURCE)
    .where((eb) => eb.or([eb('status', '!=', 'done'), eb('todo_date', '=', today)]))
    .orderBy(sql`case ${sql.ref('priority')} when 'high' then 1 when 'medium' then 2 else 3 end`)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return (rows as TodoRow[]).map(rowToTodo);
}

export async function getTodo(id: number): Promise<StoredTodo | null> {
  const db = await getSharedDb();
  const row = await db.selectFrom('daily_todos').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? rowToTodo(row as TodoRow) : null;
}

/** Update status and/or priority. Returns false when no such to-do exists. */
export async function updateTodo(id: number, patch: Partial<Pick<StoredTodo, 'status' | 'priority'>>): Promise<boolean> {
  const db = await getSharedDb();
  const set: Record<string, unknown> = { updated_at: nowIso() };
  if (patch.status) set.status = patch.status;
  if (patch.priority) set.priority = patch.priority;
  return affectedRows(await db.updateTable('daily_todos').set(set).where('id', '=', id).executeTakeFirst()) > 0;
}

export async function deleteTodo(id: number): Promise<boolean> {
  const db = await getSharedDb();
  return affectedRows(await db.deleteFrom('daily_todos').where('id', '=', id).executeTakeFirst()) > 0;
}

/** Tracker issue keys the user marked done on `date`. */
export async function loadTrackerCompletions(userEmail: string, date: string): Promise<Set<string>> {
  const db = await getSharedDb();
  const rows = await db.selectFrom('daily_todos').select('source_ref')
    .where('user_email', '=', userEmail)
    .where('todo_date', '=', date)
    .where('source', '=', TRACKER_SOURCE)
    .where('status', '=', 'done')
    .execute();
  return new Set(rows.map((r) => String(r.source_ref)));
}

/** Record (done = true) or clear (done = false) a tracker issue's completion for `date`. */
export async function setTrackerCompletion(opts: {
  userEmail: string;
  date: string;
  ticketId: string;
  done: boolean;
  title: string;
  priority?: string;
}): Promise<void> {
  const db = await getSharedDb();
  const key = { user_email: opts.userEmail, todo_date: opts.date, source: TRACKER_SOURCE, source_ref: opts.ticketId };
  await db.transaction().execute(async (trx) => {
    if (!opts.done) {
      await trx.deleteFrom('daily_todos')
        .where('user_email', '=', key.user_email).where('todo_date', '=', key.todo_date)
        .where('source', '=', key.source).where('source_ref', '=', key.source_ref)
        .execute();
      return;
    }
    const now = nowIso();
    const updated = await trx.updateTable('daily_todos').set({ status: 'done', updated_at: now })
      .where('user_email', '=', key.user_email).where('todo_date', '=', key.todo_date)
      .where('source', '=', key.source).where('source_ref', '=', key.source_ref)
      .executeTakeFirst();
    if (affectedRows(updated) > 0) return;
    await trx.insertInto('daily_todos').values({
      ...key,
      title: opts.title,
      description: null,
      priority: opts.priority || 'medium',
      status: 'done',
      created_at: now,
      updated_at: now,
    }).execute();
  });
}
