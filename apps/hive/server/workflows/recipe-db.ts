import { sql } from 'kysely';
import {
  getSharedDb,
  getSharedDialect,
  insertReturning,
  updateReturning,
  nowIso,
  affectedRows,
} from '../../../../packages/shared/src/server/storage/index.js';
import { toBool } from './db-util.js';

export interface WorkflowRecipe {
  id: number;
  name: string;
  description: string;
  type: string;
  definition: string; // JSON string of WorkflowDefinition (no notify/cron/credentialId)
  tags: string | null;
  author: string | null;
  version: number;
  requiresCredential: boolean;
  credentialHint: string | null;
  createdAt: string;
  updatedAt: string;
}

function toRecipe(row: Record<string, unknown>): WorkflowRecipe {
  return { ...row, requiresCredential: toBool(row.requiresCredential) } as WorkflowRecipe;
}

export async function listRecipes(): Promise<WorkflowRecipe[]> {
  const db = await getSharedDb();
  const rows = await db.selectFrom('workflow_recipes').selectAll().orderBy('name').execute();
  return rows.map(toRecipe);
}

export async function getRecipe(id: number): Promise<WorkflowRecipe | null> {
  const db = await getSharedDb();
  const row = await db.selectFrom('workflow_recipes').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? toRecipe(row) : null;
}

export async function createRecipe(data: {
  name: string;
  description: string;
  type: string;
  definition: string;
  tags?: string;
  author?: string;
  requiresCredential?: boolean;
  credentialHint?: string;
}): Promise<WorkflowRecipe> {
  const db = await getSharedDb();
  const now = nowIso();
  const row = await insertReturning(db, getSharedDialect(), 'workflow_recipes', {
    name: data.name,
    description: data.description,
    type: data.type,
    definition: data.definition,
    tags: data.tags || null,
    author: data.author || null,
    requiresCredential: data.requiresCredential ? 1 : 0,
    credentialHint: data.credentialHint || null,
    createdAt: now,
    updatedAt: now,
  });
  return toRecipe(row);
}

export async function updateRecipe(id: number, data: Partial<{
  name: string;
  description: string;
  definition: string;
  tags: string;
  requiresCredential: boolean;
  credentialHint: string;
}>): Promise<WorkflowRecipe | null> {
  const db = await getSharedDb();
  const set: Record<string, unknown> = { updatedAt: nowIso(), version: sql`version + 1` };
  if (data.name !== undefined) set.name = data.name;
  if (data.description !== undefined) set.description = data.description;
  if (data.definition !== undefined) set.definition = data.definition;
  if (data.tags !== undefined) set.tags = data.tags;
  if (data.requiresCredential !== undefined) set.requiresCredential = data.requiresCredential ? 1 : 0;
  if (data.credentialHint !== undefined) set.credentialHint = data.credentialHint;
  const row = await updateReturning(db, getSharedDialect(), 'workflow_recipes', set, { id });
  return row ? toRecipe(row) : null;
}

export async function deleteRecipe(id: number): Promise<boolean> {
  const db = await getSharedDb();
  return affectedRows(await db.deleteFrom('workflow_recipes').where('id', '=', id).executeTakeFirst()) > 0;
}
