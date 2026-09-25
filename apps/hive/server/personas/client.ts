import {
  getSharedDb,
  getSharedDialect,
  insertReturning,
  updateReturning,
  textContains,
  nowIso,
  affectedRows,
} from '../../../../packages/shared/src/server/storage/index.js';
import type { Persona, PersonaInput } from './types.js';

export class PersonaClient {
  async list(scopeOwner?: string): Promise<Persona[]> {
    const db = await getSharedDb();
    let q = db.selectFrom('personas').selectAll();
    if (scopeOwner) {
      q = q.where((eb) => eb.or([
        eb('scope', '=', 'shared'),
        eb.and([eb('scope', '=', 'user'), eb('scope_owner', '=', scopeOwner)]),
      ]));
    }
    return (await q.orderBy('updated_at', 'desc').execute()) as Persona[];
  }

  async search(query: string, scopeOwner?: string): Promise<Persona[]> {
    const db = await getSharedDb();
    const dialect = getSharedDialect();
    let q = db.selectFrom('personas').selectAll()
      .where((eb) => eb.or([
        textContains('name', query, dialect),
        textContains('description', query, dialect),
        textContains('tags', query, dialect),
      ]));
    if (scopeOwner) {
      q = q.where((eb) => eb.or([
        eb('scope', '=', 'shared'),
        eb.and([eb('scope', '=', 'user'), eb('scope_owner', '=', scopeOwner)]),
      ]));
    }
    return (await q.orderBy('updated_at', 'desc').execute()) as Persona[];
  }

  async getById(id: number): Promise<Persona | null> {
    const db = await getSharedDb();
    return ((await db.selectFrom('personas').selectAll().where('id', '=', id).executeTakeFirst()) as Persona | undefined) ?? null;
  }

  async create(input: PersonaInput): Promise<Persona> {
    const db = await getSharedDb();
    const now = nowIso();
    return insertReturning<Persona>(db, getSharedDialect(), 'personas', {
      name: input.name,
      description: input.description ?? '',
      content: input.content,
      tags: input.tags ?? '',
      scope: input.scope ?? 'shared',
      scope_owner: input.scope_owner ?? '',
      created_by: input.created_by ?? '',
      created_at: now,
      updated_at: now,
    });
  }

  async update(id: number, partial: Partial<PersonaInput>): Promise<Persona | null> {
    const db = await getSharedDb();
    const set: Record<string, unknown> = { updated_at: nowIso() };
    for (const key of ['name', 'description', 'content', 'tags', 'scope', 'scope_owner'] as const) {
      if (partial[key] !== undefined) set[key] = partial[key];
    }
    return updateReturning<Persona>(db, getSharedDialect(), 'personas', set, { id });
  }

  async delete(id: number): Promise<boolean> {
    const db = await getSharedDb();
    await db.deleteFrom('persona_assignments').where('persona_id', '=', id).execute();
    return affectedRows(await db.deleteFrom('personas').where('id', '=', id).executeTakeFirst()) > 0;
  }

  // --- Assignments ---

  async getAssignments(projectPath: string, userId: string): Promise<number[]> {
    const db = await getSharedDb();
    const rows = await db.selectFrom('persona_assignments').select('persona_id')
      .where('project_path', '=', projectPath).where('user_id', '=', userId).execute();
    return rows.map((r) => Number(r.persona_id));
  }

  async setAssignments(projectPath: string, userId: string, personaIds: number[]): Promise<void> {
    const db = await getSharedDb();
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('persona_assignments')
        .where('project_path', '=', projectPath).where('user_id', '=', userId).execute();
      if (personaIds.length === 0) return;
      const now = nowIso();
      await trx.insertInto('persona_assignments')
        .values(personaIds.map((persona_id) => ({ persona_id, project_path: projectPath, user_id: userId, assigned_at: now })))
        .execute();
    });
  }

  async getAssignedPersonas(projectPath: string, userId: string): Promise<Persona[]> {
    const db = await getSharedDb();
    return (await db.selectFrom('personas as p')
      .innerJoin('persona_assignments as a', 'a.persona_id', 'p.id')
      .selectAll('p')
      .where('a.project_path', '=', projectPath)
      .where('a.user_id', '=', userId)
      .orderBy('p.name')
      .execute()) as Persona[];
  }

  /** Kept for API compatibility — the shared DB connection is process-wide. */
  async close(): Promise<void> {
    /* no-op */
  }
}
