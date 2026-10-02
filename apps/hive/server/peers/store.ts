/**
 * Per-instance record of sessions handed to / received from peer Hives.
 *
 * Lives in this Hive's own hive.db (never the shared DB: two Hives sharing a
 * Postgres must not see each other's locks).
 *
 * A session is LOCKED here while its latest row is `direction = 'out'` and
 * `status = 'active'`: the live copy is on the peer, so resuming it here would
 * fork the history.
 */
import { getDb } from '../db.js';

export type HandoffDirection = 'out' | 'in';
export type HandoffStatus = 'active' | 'returned' | 'unlocked';

export interface PeerHandoffRow {
  id: number;
  sessionId: string;
  direction: HandoffDirection;
  status: HandoffStatus;
  /** Configured peer id (ours), when the other side is one. */
  peerId: string | null;
  peerLabel: string;
  peerUrl: string | null;
  localRoot: string | null;
  localCwd: string | null;
  remoteRoot: string | null;
  /** Working-tree fingerprint of localRoot when the session left (see git-transfer). */
  fingerprint: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DbRow {
  id: number;
  session_id: string;
  direction: HandoffDirection;
  status: HandoffStatus;
  peer_id: string | null;
  peer_label: string;
  peer_url: string | null;
  local_root: string | null;
  local_cwd: string | null;
  remote_root: string | null;
  fingerprint: string | null;
  created_at: string;
  updated_at: string;
}

let ready = false;

function db() {
  const d = getDb();
  if (!ready) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS peer_handoffs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        status TEXT NOT NULL,
        peer_id TEXT,
        peer_label TEXT NOT NULL DEFAULT '',
        peer_url TEXT,
        local_root TEXT,
        local_cwd TEXT,
        remote_root TEXT,
        fingerprint TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_peer_handoffs_session ON peer_handoffs(session_id, id DESC)`);
    ready = true;
  }
  return d;
}

function toRow(r: DbRow): PeerHandoffRow {
  return {
    id: r.id,
    sessionId: r.session_id,
    direction: r.direction,
    status: r.status,
    peerId: r.peer_id,
    peerLabel: r.peer_label,
    peerUrl: r.peer_url,
    localRoot: r.local_root,
    localCwd: r.local_cwd,
    remoteRoot: r.remote_root,
    fingerprint: r.fingerprint,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function recordHandoff(h: Omit<PeerHandoffRow, 'id' | 'createdAt' | 'updatedAt'>): void {
  const now = new Date().toISOString();
  const d = db();
  d.transaction(() => {
    // Whatever this session was doing before is superseded.
    d.prepare(`UPDATE peer_handoffs SET status = 'returned', updated_at = ? WHERE session_id = ? AND status = 'active'`)
      .run(now, h.sessionId);
    d.prepare(`
      INSERT INTO peer_handoffs (session_id, direction, status, peer_id, peer_label, peer_url,
        local_root, local_cwd, remote_root, fingerprint, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(h.sessionId, h.direction, h.status, h.peerId, h.peerLabel, h.peerUrl,
      h.localRoot, h.localCwd, h.remoteRoot, h.fingerprint, now, now);
  })();
}

export function latestHandoff(sessionId: string): PeerHandoffRow | null {
  const r = db().prepare(`SELECT * FROM peer_handoffs WHERE session_id = ? ORDER BY id DESC LIMIT 1`)
    .get(sessionId) as DbRow | undefined;
  return r ? toRow(r) : null;
}

/** The active outbound handoff that locks this session, if any. */
export function getLock(sessionId: string): PeerHandoffRow | null {
  const row = latestHandoff(sessionId);
  return row && row.direction === 'out' && row.status === 'active' ? row : null;
}

/** Every locked session (for list badges). */
export function listLocks(): PeerHandoffRow[] {
  const rows = db().prepare(`
    SELECT h.* FROM peer_handoffs h
    JOIN (SELECT session_id, MAX(id) AS id FROM peer_handoffs GROUP BY session_id) last ON last.id = h.id
    WHERE h.direction = 'out' AND h.status = 'active'
  `).all() as DbRow[];
  return rows.map(toRow);
}

export function setStatus(sessionId: string, status: HandoffStatus): boolean {
  const row = latestHandoff(sessionId);
  if (!row) return false;
  db().prepare(`UPDATE peer_handoffs SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, new Date().toISOString(), row.id);
  return true;
}

/** Fingerprints this Hive recorded for a folder when sessions left it. */
export function fingerprintsFor(localRoot: string): string[] {
  const rows = db().prepare(`
    SELECT DISTINCT fingerprint FROM peer_handoffs WHERE local_root = ? AND fingerprint IS NOT NULL
  `).all(localRoot) as Array<{ fingerprint: string }>;
  return rows.map((r) => r.fingerprint);
}

/** Where this session (or, failing that, this repo) landed last time. */
export function previousRoot(sessionId: string): string | null {
  const r = db().prepare(`
    SELECT local_root FROM peer_handoffs WHERE session_id = ? AND local_root IS NOT NULL ORDER BY id DESC LIMIT 1
  `).get(sessionId) as { local_root: string } | undefined;
  return r?.local_root ?? null;
}
