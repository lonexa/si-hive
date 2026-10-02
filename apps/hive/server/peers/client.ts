/**
 * Calls from this Hive to a peer's /api/peer/* routes. Server to server: the
 * browser can't call another Hive (Origin check), and the token stays here.
 */
import { getSecret } from '../../../../packages/shared/src/server/credentials.js';
import { normalizePeerUrl, outTokenRef, type PeerConfig } from './config.js';
import { framedLength, framedStream, readFramed, type Framed } from './wire.js';

export class PeerError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface CallerIdentity {
  name: string;
  url?: string;
}

/** Big repos take a while to bundle and send. */
const TRANSFER_TIMEOUT = 60 * 60_000;

function headers(peer: PeerConfig, me: CallerIdentity, extra: Record<string, string> = {}): Record<string, string> {
  const token = getSecret(outTokenRef(peer.id));
  if (!token) throw new PeerError(409, `No token saved for ${peer.label}. Add one in Settings → Peers.`);
  return {
    Authorization: `Bearer ${token}`,
    'X-Hive-Instance-Name': encodeURIComponent(me.name),
    ...(me.url ? { 'X-Hive-Instance-Url': me.url } : {}),
    ...extra,
  };
}

async function failure(peer: PeerConfig, res: Response): Promise<PeerError> {
  let msg = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json() as { error?: string };
    if (body.error) msg = body.error;
  } catch { /* not JSON */ }
  if (res.status === 401) msg = `${peer.label} rejected this Hive's token. Issue a new one there.`;
  if (res.status === 404 && /Not found/i.test(msg)) msg = `${peer.label} doesn't support this yet. Update SI Hive there.`;
  return new PeerError(res.status === 401 || res.status >= 500 ? 502 : res.status, `${peer.label}: ${msg}`);
}

async function call(peer: PeerConfig, path: string, init: RequestInit & { duplex?: 'half' }, timeoutMs: number): Promise<Response> {
  const url = `${normalizePeerUrl(peer.baseUrl)}${path}`;
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const reason = (err as Error).name === 'TimeoutError' ? 'timed out' : (err as Error).message;
    throw new PeerError(502, `Couldn't reach ${peer.label} at ${peer.baseUrl} (${reason}). Is it on and on the same network?`);
  }
}

export async function peerJson<T>(
  peer: PeerConfig, me: CallerIdentity, method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 30_000,
): Promise<T> {
  const res = await call(peer, path, {
    method,
    headers: headers(peer, me, body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }, timeoutMs);
  if (!res.ok) throw await failure(peer, res);
  return await res.json() as T;
}

/** POST a framed transfer (head + bundle); JSON back. */
export async function peerUpload<T>(peer: PeerConfig, me: CallerIdentity, path: string, head: Buffer, bundlePath: string | null): Promise<T> {
  const res = await call(peer, path, {
    method: 'POST',
    headers: headers(peer, me, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(framedLength(head, bundlePath)),
    }),
    body: framedStream(head, bundlePath) as unknown as RequestInit['body'],
    duplex: 'half',
  }, TRANSFER_TIMEOUT);
  if (!res.ok) throw await failure(peer, res);
  return await res.json() as T;
}

/** POST JSON; a framed transfer back (bundle in a temp file — caller deletes it). */
export async function peerDownload(peer: PeerConfig, me: CallerIdentity, path: string, body: unknown): Promise<Framed> {
  const res = await call(peer, path, {
    method: 'POST',
    headers: headers(peer, me, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  }, TRANSFER_TIMEOUT);
  if (!res.ok) throw await failure(peer, res);
  if (!res.body) throw new PeerError(502, `${peer.label} sent nothing back`);
  return readFramed(res.body as unknown as AsyncIterable<Uint8Array>);
}
