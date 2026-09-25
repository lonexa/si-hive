import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { useTempHiveHome } from '../../../../packages/shared/src/test-utils/hive-home.js';

useTempHiveHome();

const storage = await import('../../../../packages/shared/src/server/storage/index.js');
const { initSharedStorage } = await import('../storage/init.js');
const { PersonaClient } = await import('../personas/client.js');

describe('shared storage (sqlite)', () => {
  beforeAll(async () => {
    const report = await initSharedStorage();
    expect(report.error).toBeUndefined();
  });
  afterAll(async () => {
    await storage.closeSharedDb();
  });

  it('applies migrations idempotently', async () => {
    const again = await initSharedStorage();
    expect(again.error).toBeUndefined();
    expect(again.applied).toEqual([]);
  });

  it('upsert inserts then updates', async () => {
    const db = await storage.getSharedDb();
    await storage.upsert(db, 'personas', { id: 999 }, { name: 'u', content: 'c', created_at: 'x', updated_at: 'x' });
    const r = await storage.upsert(db, 'personas', { id: 999 }, { name: 'u2' });
    expect(r).toBe('updated');
    const row = await db.selectFrom('personas').selectAll().where('id', '=', 999).executeTakeFirst();
    expect(row?.name).toBe('u2');
    await db.deleteFrom('personas').where('id', '=', 999).execute();
  });

  it('personas CRUD + assignments', async () => {
    const client = new PersonaClient();
    const p = await client.create({ name: 'Reviewer', content: 'Be strict', tags: 'review,qa' });
    expect(p.id).toBeTypeOf('number');
    expect(p.scope).toBe('shared');

    const mine = await client.create({ name: 'Mine', content: 'x', scope: 'user', scope_owner: 'alice' });
    expect((await client.list('bob')).map((x) => x.id)).not.toContain(mine.id);
    expect((await client.list('alice')).map((x) => x.id)).toContain(mine.id);

    expect((await client.search('REVIEW')).map((x) => x.id)).toContain(p.id);
    expect(await client.search('100%_literal')).toEqual([]);
    const pct = await client.create({ name: 'Odd 50%_[x] name', content: 'x' });
    expect((await client.search('50%_[x]')).map((x) => x.id)).toEqual([pct.id]);
    expect((await client.search('0%')).map((x) => x.id)).toEqual([pct.id]);
    await client.delete(pct.id);

    const updated = await client.update(p.id, { description: 'desc' });
    expect(updated?.description).toBe('desc');

    await client.setAssignments('/proj', 'alice', [p.id, mine.id]);
    expect((await client.getAssignments('/proj', 'alice')).sort()).toEqual([p.id, mine.id].sort());
    expect((await client.getAssignedPersonas('/proj', 'alice')).map((x) => x.name)).toEqual(['Mine', 'Reviewer']);

    expect(await client.delete(p.id)).toBe(true);
    expect(await client.getById(p.id)).toBeNull();
    expect(await client.getAssignments('/proj', 'alice')).toEqual([mine.id]);
  });
});
