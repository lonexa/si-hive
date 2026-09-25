import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { useTempHiveHome } from '../../../../packages/shared/src/test-utils/hive-home.js';

useTempHiveHome();

const storage = await import('../../../../packages/shared/src/server/storage/index.js');
// Registered explicitly until storage/migrations-index.ts imports them.
await import('../kb/migrations.js');
await import('../sharing/migrations.js');
await import('../skills/migrations.js');
const { initSharedStorage } = await import('../storage/init.js');
const { KBClient } = await import('../kb/client.js');
const { loadKBConfig, getKBScopeOwner } = await import('../kb/env.js');
const { SharingClient } = await import('../sharing/client.js');
const { SkillRequirementsClient, normalizeRemoteUrl } = await import('../skills/requirements-client.js');

describe('kb / sharing / skill requirements on shared storage (sqlite)', () => {
  beforeAll(async () => {
    const report = await initSharedStorage();
    expect(report.error).toBeUndefined();
    expect(report.applied).toEqual(expect.arrayContaining(['kb/001_init', 'sharing/001_init', 'skills/001_skill_requirements']));
  });
  afterAll(async () => {
    await storage.closeSharedDb();
  });

  it('describes the shared DB and resolves a scope owner', () => {
    const cfg = loadKBConfig();
    expect(cfg.dialect).toBe('sqlite');
    expect(cfg.database).toMatch(/shared\.db$/);
    const prev = process.env['KB_SCOPE_OWNER'];
    process.env['KB_SCOPE_OWNER'] = 'tester';
    try {
      expect(getKBScopeOwner()).toBe('tester');
    } finally {
      if (prev === undefined) delete process.env['KB_SCOPE_OWNER'];
      else process.env['KB_SCOPE_OWNER'] = prev;
    }
  });

  it('KB CRUD, dedup, search, scope filtering', async () => {
    const client = new KBClient(loadKBConfig());
    expect((await client.testConnection()).ok).toBe(true);

    const a = await client.create({ title: 'Retry policy', content: 'Use exponential backoff', category: 'Decision', tags: 'retry, http' });
    expect(a.id).toBeTypeOf('number');
    expect(a.scope).toBe('shared');
    expect(a.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Same title/category/scope returns the existing row
    const dup = await client.create({ title: 'Retry policy', content: 'other', category: 'Decision' });
    expect(dup.id).toBe(a.id);

    const mine = await client.create({ title: 'Private note', content: 'backoff tuning', category: 'Note', tags: 'retry', scope: 'user', scope_owner: 'alice' });

    expect((await client.search('BACKOFF')).map((e) => e.id).sort()).toEqual([a.id, mine.id].sort());
    expect((await client.search('backoff', undefined, undefined, 'bob')).map((e) => e.id)).toEqual([a.id]);
    expect((await client.search('backoff', undefined, undefined, 'alice')).map((e) => e.id).sort()).toEqual([a.id, mine.id].sort());
    expect((await client.search(undefined, 'Note')).map((e) => e.id)).toEqual([mine.id]);
    expect((await client.search(undefined, undefined, 'http')).map((e) => e.id)).toEqual([a.id]);
    expect(await client.search('100%_x')).toEqual([]);

    expect(await client.getCategories()).toEqual(['Decision', 'Note']);
    expect(await client.getTags()).toEqual(['http', 'retry']);

    const updated = await client.update(a.id, { content: 'Use jittered backoff' });
    expect(updated?.content).toBe('Use jittered backoff');
    expect(updated!.updated_at >= a.updated_at).toBe(true);
    expect(await client.update(999999, { content: 'x' })).toBeNull();
    expect((await client.getById(a.id))?.title).toBe('Retry policy');

    // removeDuplicates keeps the lowest id per (title, category, scope, scope_owner)
    const db = await storage.getSharedDb();
    const now = storage.nowIso();
    await db.insertInto('knowledge_base').values({ title: 'Retry policy', content: 'copy', category: 'Decision', created_at: now, updated_at: now }).execute();
    expect(await client.removeDuplicates()).toBe(1);
    expect((await client.getById(a.id))?.content).toBe('Use jittered backoff');

    expect(await client.delete(mine.id)).toBe(true);
    expect(await client.delete(mine.id)).toBe(false);
    expect(await client.getById(mine.id)).toBeNull();
    await client.close();
  });

  it('sharing items CRUD with files', async () => {
    const client = new SharingClient(loadKBConfig());
    expect((await client.testConnection()).ok).toBe(true);

    const item = await client.publishItem({
      name: 'lint-helper',
      item_type: 'skill',
      description: 'Runs the linter',
      tags: 'lint,quality',
      files: [
        { file_path: 'notes.md', content: 'n' },
        { file_path: 'SKILL.md', content: '# Lint', is_primary: true },
      ],
    });
    expect(item.version).toBe(1);
    expect(item.files).toHaveLength(2);
    expect(item.files.find((f) => f.file_path === 'SKILL.md')?.is_primary).toBe(true);

    const fetched = await client.getItemWithFiles(item.id);
    expect(fetched?.files.map((f) => f.file_path)).toEqual(['SKILL.md', 'notes.md']);
    expect(fetched?.files[0].is_primary).toBe(true);
    expect(fetched?.files[1].is_primary).toBe(false);

    // Unique (name, item_type, scope, scope_owner)
    await expect(client.publishItem({ name: 'lint-helper', item_type: 'skill', files: [] })).rejects.toThrow();

    const up = await client.publishOrUpdateItem({
      name: 'lint-helper', item_type: 'skill', description: 'Runs the linter v2',
      files: [{ file_path: 'SKILL.md', content: '# Lint v2', is_primary: true }],
    });
    expect(up.id).toBe(item.id);
    expect(up.version).toBe(2);
    expect(up.files.map((f) => f.content)).toEqual(['# Lint v2']);

    const priv = await client.publishItem({ name: 'scratch', item_type: 'snippet', scope: 'user', scope_owner: 'alice', files: [] });
    expect((await client.listItems()).map((i) => i.id).sort()).toEqual([item.id, priv.id].sort());
    expect((await client.listItems('skill')).map((i) => i.id)).toEqual([item.id]);
    expect((await client.listItems(undefined, 'LINTER')).map((i) => i.id)).toEqual([item.id]);
    expect((await client.listItems(undefined, undefined, 'quality')).map((i) => i.id)).toEqual([item.id]);
    expect((await client.listItems(undefined, undefined, undefined, 'bob')).map((i) => i.id)).toEqual([item.id]);
    expect((await client.listItems(undefined, undefined, undefined, 'alice')).map((i) => i.id).sort()).toEqual([item.id, priv.id].sort());

    expect(await client.getTags()).toEqual(['lint', 'quality']);
    expect(await client.getTags('snippet')).toEqual([]);

    const renamed = await client.updateItem(item.id, { name: 'lint-helper-2' });
    expect(renamed?.name).toBe('lint-helper-2');
    expect(renamed?.version).toBe(3);
    expect(renamed?.files).toHaveLength(1);
    expect(await client.updateItem(999999, { name: 'x' })).toBeNull();

    expect(await client.deleteItem(item.id)).toBe(true);
    expect(await client.getItemWithFiles(item.id)).toBeNull();
    const db = await storage.getSharedDb();
    expect(await db.selectFrom('shared_item_files').selectAll().where('item_id', '=', item.id).execute()).toEqual([]);
    expect(await client.deleteItem(item.id)).toBe(false);
    await client.close();
  });

  it('skill requirements CRUD and repo matching', async () => {
    const client = new SkillRequirementsClient(loadKBConfig());
    const key = normalizeRemoteUrl('git@github.com:Org/Repo.git');
    expect(key).toBe('github.com/org/repo');

    const repo = await client.create({ contextType: 'repo', contextKey: key, contextLabel: 'repo', skillName: 'lint-helper' });
    expect(repo.id).toBeTypeOf('number');
    expect(repo.required).toBe(true);
    expect(repo.createdBy).toBeNull();

    const topic = await client.create({
      contextType: 'topic', contextKey: 'testing', contextLabel: 'Testing', keywords: 'vitest,jest',
      skillName: 'test-helper', required: false, createdBy: 'alice',
    });
    expect(topic.required).toBe(false);

    const noLabel = await client.create({ contextType: 'topic', contextKey: 'misc', skillName: 'misc-helper' });
    expect(noLabel.contextLabel).toBeNull();

    await expect(client.create({ contextType: 'repo', contextKey: key, skillName: 'lint-helper' }))
      .rejects.toThrow(/UQ_skillreq|duplicate/);

    expect((await client.list()).map((r) => r.skillName)).toEqual(['lint-helper', 'misc-helper', 'test-helper']);

    const repoReqs = await client.listByType('repo');
    const clone = normalizeRemoteUrl('https://user@github.com/org/repo.git');
    expect(repoReqs.filter((r) => r.contextKey === clone).map((r) => r.id)).toEqual([repo.id]);
    expect((await client.listByType('topic')).map((r) => r.id).sort()).toEqual([topic.id, noLabel.id].sort());

    expect(await client.delete(repo.id)).toBe(true);
    expect(await client.delete(repo.id)).toBe(false);
    expect(await client.listByType('repo')).toEqual([]);
    await client.close();
  });
});
