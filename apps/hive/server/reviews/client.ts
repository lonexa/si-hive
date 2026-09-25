import {
  getSharedDb,
  getSharedDialect,
  insertReturning,
  nowIso,
  affectedRows,
} from '../../../../packages/shared/src/server/storage/index.js';

/**
 * Hive-native lightweight peer review (B3.2) — review without a PR.
 *
 * A requester asks a teammate to look at a session, a commit, or just a note;
 * the reviewer leaves comments and sets a status. Stored in the shared
 * database so it works across machines.
 */

export type ReviewKind = 'session' | 'commit' | 'note';
export type ReviewStatus = 'requested' | 'approved' | 'changes' | 'closed';

export interface PeerReview {
  id: number;
  requesterOid: string;
  requesterName: string;
  reviewerOid: string;
  reviewerName: string;
  title: string;
  kind: ReviewKind;
  refId: string | null;
  repo: string | null;
  context: string | null;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  respondedAt: string | null;
}

export interface ReviewComment {
  id: number;
  reviewId: number;
  authorOid: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface CreateReviewInput {
  requesterOid: string;
  requesterName: string;
  reviewerOid: string;
  reviewerName: string;
  title: string;
  kind: ReviewKind;
  refId: string | null;
  repo: string | null;
  context: string | null;
}

interface ReviewRow {
  id: number;
  requester_oid: string;
  requester_name: string;
  reviewer_oid: string;
  reviewer_name: string;
  title: string;
  kind: string;
  ref_id: string | null;
  repo: string | null;
  context: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  responded_at: string | null;
}

interface CommentRow {
  id: number;
  review_id: number;
  author_oid: string;
  author_name: string;
  body: string;
  created_at: string;
}

export class ReviewsClient {
  /** Reviews where the user is the reviewer ('incoming') or requester ('outgoing'). */
  async list(userOid: string, box: 'incoming' | 'outgoing'): Promise<PeerReview[]> {
    const db = await getSharedDb();
    const col = box === 'incoming' ? 'reviewer_oid' : 'requester_oid';
    const rows = (await db.selectFrom('peer_reviews')
      .selectAll()
      .where(col, '=', userOid)
      .orderBy((eb) => eb.case()
        .when('status', '=', 'requested').then(eb.lit(0))
        .when('status', '=', 'changes').then(eb.lit(1))
        .else(eb.lit(2))
        .end())
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'desc')
      .execute()) as ReviewRow[];
    return rows.map(toReview);
  }

  async get(id: number): Promise<{ review: PeerReview; comments: ReviewComment[] } | null> {
    const db = await getSharedDb();
    const rev = (await db.selectFrom('peer_reviews').selectAll().where('id', '=', id).executeTakeFirst()) as ReviewRow | undefined;
    if (!rev) return null;
    const comments = (await db.selectFrom('peer_review_comments').selectAll()
      .where('review_id', '=', id)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute()) as CommentRow[];
    return { review: toReview(rev), comments: comments.map(toComment) };
  }

  async create(input: CreateReviewInput): Promise<PeerReview> {
    const db = await getSharedDb();
    const now = nowIso();
    const row = await insertReturning<ReviewRow>(db, getSharedDialect(), 'peer_reviews', {
      requester_oid: input.requesterOid,
      requester_name: input.requesterName,
      reviewer_oid: input.reviewerOid,
      reviewer_name: input.reviewerName,
      title: input.title,
      kind: input.kind,
      ref_id: input.refId,
      repo: input.repo,
      context: input.context,
      status: 'requested',
      created_at: now,
      updated_at: now,
    });
    return toReview(row);
  }

  async addComment(reviewId: number, authorOid: string, authorName: string, body: string): Promise<ReviewComment | null> {
    const db = await getSharedDb();
    const dialect = getSharedDialect();
    return db.transaction().execute(async (trx) => {
      const exists = await trx.selectFrom('peer_reviews').select('id').where('id', '=', reviewId).executeTakeFirst();
      if (!exists) return null;
      const now = nowIso();
      const row = await insertReturning<CommentRow>(trx, dialect, 'peer_review_comments', {
        review_id: reviewId,
        author_oid: authorOid,
        author_name: authorName,
        body,
        created_at: now,
      });
      await trx.updateTable('peer_reviews').set({ updated_at: now }).where('id', '=', reviewId).execute();
      return toComment(row);
    });
  }

  /** Set status. Only the reviewer may approve/request-changes; either party may close. */
  async setStatus(reviewId: number, userOid: string, status: ReviewStatus): Promise<boolean> {
    const db = await getSharedDb();
    const now = nowIso();
    const set: Record<string, unknown> = { status, updated_at: now };
    if (status === 'approved' || status === 'changes') set.responded_at = now;
    let q = db.updateTable('peer_reviews').set(set).where('id', '=', reviewId);
    q = status === 'closed'
      ? q.where((eb) => eb.or([eb('reviewer_oid', '=', userOid), eb('requester_oid', '=', userOid)]))
      : q.where('reviewer_oid', '=', userOid);
    return affectedRows(await q.executeTakeFirst()) > 0;
  }

  /** Count of open reviews assigned to the user (for a badge). */
  async incomingOpenCount(userOid: string): Promise<number> {
    const db = await getSharedDb();
    const r = await db.selectFrom('peer_reviews')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('reviewer_oid', '=', userOid)
      .where('status', 'in', ['requested', 'changes'])
      .executeTakeFirst();
    return Number(r?.c ?? 0);
  }

  /** Kept for API compatibility — the shared DB connection is process-wide. */
  async close(): Promise<void> {
    /* no-op */
  }
}

function iso(v: string | null | undefined): string {
  return v ? new Date(v).toISOString() : '';
}
function toReview(r: ReviewRow): PeerReview {
  return {
    id: Number(r.id),
    requesterOid: r.requester_oid,
    requesterName: r.requester_name,
    reviewerOid: r.reviewer_oid,
    reviewerName: r.reviewer_name,
    title: r.title,
    kind: r.kind as ReviewKind,
    refId: r.ref_id ?? null,
    repo: r.repo ?? null,
    context: r.context ?? null,
    status: r.status as ReviewStatus,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    respondedAt: r.responded_at ? iso(r.responded_at) : null,
  };
}
function toComment(c: CommentRow): ReviewComment {
  return {
    id: Number(c.id),
    reviewId: Number(c.review_id),
    authorOid: c.author_oid,
    authorName: c.author_name,
    body: c.body,
    createdAt: iso(c.created_at),
  };
}
