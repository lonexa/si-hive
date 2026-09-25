import {
  getSharedDb,
  getSharedDialect,
  insertReturning,
  updateReturning,
  nowIso,
  affectedRows,
} from '../../../../packages/shared/src/server/storage/index.js';
import { toBool } from './db-util.js';
import type { Connector, ConnectorType } from './types.js';

function toConnector(row: Record<string, unknown>): Connector {
  return { ...row, isSystem: toBool(row.isSystem), isDefault: toBool(row.isDefault) } as Connector;
}

export async function listConnectors(): Promise<Connector[]> {
  const db = await getSharedDb();
  const rows = await db.selectFrom('workflow_connectors').selectAll().orderBy('name').execute();
  return rows.map(toConnector);
}

export async function getConnector(id: number): Promise<Connector | null> {
  const db = await getSharedDb();
  const row = await db.selectFrom('workflow_connectors').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? toConnector(row) : null;
}

export async function getConnectorByName(name: string): Promise<Connector | null> {
  const db = await getSharedDb();
  const row = await db.selectFrom('workflow_connectors').selectAll().where('name', '=', name).executeTakeFirst();
  return row ? toConnector(row) : null;
}

export async function createConnector(data: {
  type: ConnectorType;
  name: string;
  config: string;
  isSystem?: boolean;
  isDefault?: boolean;
}): Promise<Connector> {
  const db = await getSharedDb();
  const now = nowIso();
  const row = await insertReturning(db, getSharedDialect(), 'workflow_connectors', {
    type: data.type,
    name: data.name,
    config: data.config,
    isSystem: data.isSystem ? 1 : 0,
    isDefault: data.isDefault ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  });
  return toConnector(row);
}

export async function updateConnector(id: number, data: Partial<{
  name: string;
  config: string;
  isDefault: boolean;
}>): Promise<Connector | null> {
  const db = await getSharedDb();
  const set: Record<string, unknown> = { updatedAt: nowIso() };
  if (data.name !== undefined) set.name = data.name;
  if (data.config !== undefined) set.config = data.config;
  if (data.isDefault !== undefined) set.isDefault = data.isDefault ? 1 : 0;
  const row = await updateReturning(db, getSharedDialect(), 'workflow_connectors', set, { id });
  return row ? toConnector(row) : null;
}

export async function deleteConnector(id: number): Promise<boolean> {
  const db = await getSharedDb();
  // Don't allow deleting system connectors
  const result = await db.deleteFrom('workflow_connectors').where('id', '=', id).where('isSystem', '=', 0).executeTakeFirst();
  return affectedRows(result) > 0;
}
