import {
  getSharedDb,
  getSharedDialect,
  insertReturning,
  nowIso,
} from '../../../../packages/shared/src/server/storage/index.js';

export interface HandoffRow {
  id: number;
  fromOid: string;
  fromName: string;
  toOid: string;
  cwd: string | null;
  provider: string;
  transcriptText: string | null;
  note: string | null;
  status: string;
  createdAt: string;
  respondedAt: string | null;
}

interface DbRow {
  id: number;
  from_oid: string;
  from_name: string;
  to_oid: string;
  cwd: string | null;
  provider: string;
  transcript_text?: string | null;
  note: string | null;
  status: string;
  created_at: string | null;
  responded_at: string | null;
}

function toHandoff(r: DbRow): HandoffRow {
  return {
    id: Number(r.id),
    fromOid: r.from_oid,
    fromName: r.from_name,
    toOid: r.to_oid,
    cwd: r.cwd,
    provider: r.provider,
    transcriptText: r.transcript_text ?? null,
    note: r.note,
    status: r.status,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    respondedAt: r.responded_at ? new Date(r.responded_at).toISOString() : null,
  };
}

/** Shared `session_handoffs` store for cross-user session handoff. */
export class HandoffClient {
  async create(h: {
    fromOid: string; fromName: string; toOid: string;
    cwd: string | null; provider: string; transcriptText: string | null; note: string | null;
  }): Promise<number> {
    const db = await getSharedDb();
    const row = await insertReturning<{ id: number }>(db, getSharedDialect(), 'session_handoffs', {
      from_oid: h.fromOid,
      from_name: h.fromName,
      to_oid: h.toOid,
      cwd: h.cwd,
      provider: h.provider,
      transcript_text: h.transcriptText,
      note: h.note,
      status: 'pending',
      created_at: nowIso(),
    });
    return Number(row.id);
  }

  /** Pending handoffs addressed to a user (transcript omitted for payload size). */
  async incoming(toOid: string): Promise<Array<Omit<HandoffRow, 'transcriptText'>>> {
    const db = await getSharedDb();
    const rows = (await db.selectFrom('session_handoffs')
      .select(['id', 'from_oid', 'from_name', 'to_oid', 'cwd', 'provider', 'note', 'status', 'created_at', 'responded_at'])
      .where('to_oid', '=', toOid)
      .where('status', '=', 'pending')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute()) as DbRow[];
    return rows.map((r) => {
      const h = toHandoff(r);
      return {
        id: h.id, fromOid: h.fromOid, fromName: h.fromName, toOid: h.toOid,
        cwd: h.cwd, provider: h.provider, note: h.note, status: h.status,
        createdAt: h.createdAt, respondedAt: h.respondedAt,
      };
    });
  }

  async get(id: number): Promise<HandoffRow | null> {
    const db = await getSharedDb();
    const r = (await db.selectFrom('session_handoffs').selectAll().where('id', '=', id).executeTakeFirst()) as DbRow | undefined;
    return r ? toHandoff(r) : null;
  }

  async respond(id: number, status: 'accepted' | 'declined' | 'canceled'): Promise<void> {
    const db = await getSharedDb();
    await db.updateTable('session_handoffs')
      .set({ status, responded_at: nowIso() })
      .where('id', '=', id)
      .execute();
  }

  /** Kept for API compatibility — the shared DB connection is process-wide. */
  async close(): Promise<void> {
    /* no-op */
  }
}
