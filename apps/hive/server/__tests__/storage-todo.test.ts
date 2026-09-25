import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { useTempHiveHome } from '../../../../packages/shared/src/test-utils/hive-home.js';

useTempHiveHome();

const storage = await import('../../../../packages/shared/src/server/storage/index.js');
const { initSharedStorage } = await import('../storage/init.js');
const todos = await import('../todo/todo-db.js');

describe('todo storage (sqlite)', () => {
  beforeAll(async () => {
    const report = await initSharedStorage();
    expect(report.error).toBeUndefined();
    expect(report.applied).toContain('todo/001_init');
  });
  afterAll(async () => {
    await storage.closeSharedDb();
  });

  it('todos CRUD and ordering', async () => {
    const today = '2026-09-24';
    const low = await todos.insertTodo({ userEmail: 'a@x', todoDate: today, title: 'low', priority: 'low' });
    const high = await todos.insertTodo({ userEmail: 'a@x', todoDate: today, title: 'high', priority: 'high', description: 'd' });
    const oldDone = await todos.insertTodo({ userEmail: 'a@x', todoDate: '2026-09-01', title: 'old', status: 'done' });
    await todos.insertTodo({ userEmail: 'b@x', todoDate: today, title: 'other user' });
    expect(high.id).toBeTypeOf('number');
    expect(high.todoDate).toBe(today);
    expect(high.source).toBe('manual');

    expect((await todos.loadOpenTodos('a@x', today)).map((t) => t.title)).toEqual(['high', 'low']);

    expect(await todos.updateTodo(low.id, { status: 'done', priority: 'medium' })).toBe(true);
    expect(await todos.getTodo(low.id)).toMatchObject({ status: 'done', priority: 'medium' });
    // Done today still listed; done on an earlier day is not.
    const open = await todos.loadOpenTodos('a@x', today);
    expect(open.map((t) => t.title)).toEqual(['high', 'low']);
    expect(open.map((t) => t.id)).not.toContain(oldDone.id);

    expect(await todos.updateTodo(99999, { status: 'done' })).toBe(false);
    expect(await todos.deleteTodo(high.id)).toBe(true);
    expect(await todos.deleteTodo(high.id)).toBe(false);
  });

  it('tracker completion toggle persists per user and day', async () => {
    const day = '2026-09-24';
    const base = { userEmail: 'a@x', date: day, title: 'Fix it' };
    await todos.setTrackerCompletion({ ...base, ticketId: 'ABC-1', done: true, priority: 'high' });
    await todos.setTrackerCompletion({ ...base, ticketId: 'ABC-1', done: true }); // idempotent
    await todos.setTrackerCompletion({ ...base, ticketId: '42', done: true });
    expect([...(await todos.loadTrackerCompletions('a@x', day))].sort()).toEqual(['42', 'ABC-1']);
    expect((await todos.loadTrackerCompletions('a@x', '2026-09-25')).size).toBe(0);
    expect((await todos.loadTrackerCompletions('b@x', day)).size).toBe(0);

    // Tracker rows never show up in the to-do list itself.
    expect((await todos.loadOpenTodos('a@x', day)).some((t) => t.source === 'tracker')).toBe(false);

    const db = await storage.getSharedDb();
    const rows = await db.selectFrom('daily_todos').selectAll().where('source', '=', 'tracker').where('source_ref', '=', 'ABC-1').execute();
    expect(rows).toHaveLength(1);

    await todos.setTrackerCompletion({ ...base, ticketId: 'ABC-1', done: false });
    expect([...(await todos.loadTrackerCompletions('a@x', day))]).toEqual(['42']);
  });
});
