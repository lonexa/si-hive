/**
 * Peer tokens: how another Hive authenticates to this one's /api/peer/* routes.
 *
 * A token is issued here (Settings → Peers), shown once, and pasted into the
 * other Hive. We keep only its SHA-256. A peer token grants the /api/peer/*
 * routes and nothing else — it is never a user session.
 */
import crypto from 'node:crypto';
import type http from 'node:http';
import { getSecret, setSecret, deleteSecret } from '../../../../packages/shared/src/server/credentials.js';
import type { HiveConfig } from '../types.js';
import { inTokenRef, listPeerTokens, slugFor, type PeerTokenMeta, type PeersConfigShape } from './config.js';

const TOKEN_PREFIX = 'hivepeer_';

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Issue a token. Returns the plaintext once; only its hash is kept. */
export function createPeerToken(config: HiveConfig, label: string): { meta: PeerTokenMeta; token: string } {
  const taken = new Set(listPeerTokens(config).map((t) => t.id));
  const meta: PeerTokenMeta = { id: slugFor(label, taken, 'token'), label, createdAt: new Date().toISOString() };
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  setSecret(inTokenRef(meta.id), sha256(token));
  (config as PeersConfigShape).peerTokens = [...listPeerTokens(config), meta];
  return { meta, token };
}

export function revokePeerToken(config: HiveConfig, id: string): boolean {
  const before = listPeerTokens(config);
  if (!before.some((t) => t.id === id)) return false;
  deleteSecret(inTokenRef(id));
  (config as PeersConfigShape).peerTokens = before.filter((t) => t.id !== id);
  return true;
}

/** The token (by its metadata) a request's `Authorization: Bearer` carries, or null. */
export function verifyPeerRequest(config: HiveConfig, req: http.IncomingMessage): PeerTokenMeta | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const presented = Buffer.from(sha256(token), 'hex');
  for (const meta of listPeerTokens(config)) {
    const stored = getSecret(inTokenRef(meta.id));
    if (!stored) continue;
    const expected = Buffer.from(stored, 'hex');
    if (expected.length === presented.length && crypto.timingSafeEqual(expected, presented)) return meta;
  }
  return null;
}
