/**
 * Peer Hives: hand a running session (with its code) to another SI Hive and
 * bring it back.
 *
 * Called by other Hives (peer token, see auth.ts):
 *   GET  /api/peer/hello
 *   POST /api/peer/prepare                    { sessionId, originUrl, projectName } → where it would land
 *   POST /api/peer/import                     zip → session placed (and resumed)
 *   POST /api/peer/sessions/:id/export        { haveHead } → zip (session stopped here)
 *   POST /api/peer/sessions/:id/confirm-export   the caller has it now: lock it here
 *   POST /api/peer/sessions/:id/abort-export
 *
 * Settings (admin):
 *   GET    /api/peers                        peers, issued tokens, this Hive's address
 *   POST   /api/peers                        { label, baseUrl, token }
 *   PUT    /api/peers/:id                    { label?, baseUrl?, token? }
 *   DELETE /api/peers/:id
 *   POST   /api/peers/:id/test
 *   POST   /api/peers/tokens                 { label } → token (shown once)
 *   DELETE /api/peers/tokens/:id
 *   PUT    /api/peers/self                   { publicUrl }
 *
 * Session actions (UI):
 *   GET  /api/peer-handoffs/locks
 *   GET  /api/peer-handoffs/session/:id
 *   POST /api/peer-handoffs/preview          { sessionId, peerId }
 *   POST /api/peer-handoffs/send             { sessionId, peerId, instruction?, resume? }
 *   POST /api/peer-handoffs/bring-back       { sessionId }
 *   POST /api/peer-handoffs/unlock           { sessionId }
 */
import type http from 'node:http';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import { getSecret, setSecret, deleteSecret } from '../../../../packages/shared/src/server/credentials.js';
import type { AuthenticatedRequest } from '../auth/types.js';
import type { HiveConfig } from '../types.js';
import { requireAdmin } from '../providers/account-routes.js';
import { getServerVersion } from '../server-version.js';
import {
  findPeerByUrl, getPeer, isValidPeerId, listPeerTokens, listPeers, normalizePeerUrl, outTokenRef,
  selfName, selfUrl, slugFor, type PeerConfig, type PeersConfigShape,
} from './config.js';
import { createPeerToken, revokePeerToken, verifyPeerRequest } from './auth.js';
import { PeerError, peerDownload, peerJson, peerUpload, type CallerIdentity } from './client.js';
import { TransferError, repoState, summarize } from './git-transfer.js';
import {
  describeSession, exportSession, importSession, prepareImport, stopSession, MAX_PACKAGE_BYTES, SESSION_ID,
  type ImportResult, type PrepareResult,
} from './package.js';
import { getLock, latestHandoff, listLocks, recordHandoff, setStatus } from './store.js';

export interface PeerRouteDeps {
  config: HiveConfig;
  saveConfig: (c: HiveConfig) => void;
  db: Database.Database;
  terminalIdsFor: (sessionId: string) => string[];
}

// ---------------------------------------------------------------------------
// In-flight state: a session being handed off must not be resumed here.

const sending = new Set<string>();
const pendingExports = new Map<string, {
  fingerprint: string; root: string; cwd: string; remoteRoot: string | null;
  caller: { label: string; url: string | null; peerId: string | null }; expires: number;
}>();

/** Why `--resume <id>` must not start here right now, or null. */
export function resumeBlockedReason(sessionId: string): string | null {
  if (sending.has(sessionId)) return 'This session is being handed off to another Hive.';
  const pending = pendingExports.get(sessionId);
  if (pending && pending.expires > Date.now()) return `This session is being handed to ${pending.caller.label}.`;
  try {
    const lock = getLock(sessionId);
    if (lock) return `This session is running on ${lock.peerLabel}. Bring it back first.`;
  } catch { /* table not readable — don't block */ }
  return null;
}

// ---------------------------------------------------------------------------

function parse(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function readRaw(req: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new TransferError(413, 'Package too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function fail(res: http.ServerResponse, err: unknown): void {
  if (res.headersSent) return;
  if (err instanceof TransferError || err instanceof PeerError) {
    sendJson(res, err.status, { error: err.message });
    return;
  }
  console.error('[peers]', err);
  sendJson(res, 500, { error: (err as Error).message || 'Handoff failed' });
}

function run(res: http.ServerResponse, fn: () => Promise<void>): true {
  fn().catch((err) => fail(res, err));
  return true;
}

function persist(deps: PeerRouteDeps): void {
  deps.saveConfig(deps.config);
}

function publicPeer(p: PeerConfig) {
  return { ...p, hasToken: !!getSecret(outTokenRef(p.id)) };
}

function me(deps: PeerRouteDeps, req: http.IncomingMessage): CallerIdentity {
  return { name: selfName(deps.config), url: selfUrl(deps.config, req) };
}

/** Who is calling, from a verified peer request. */
function caller(deps: PeerRouteDeps, req: http.IncomingMessage, tokenLabel: string) {
  const rawName = req.headers['x-hive-instance-name'];
  let name: string | undefined;
  try { name = typeof rawName === 'string' ? decodeURIComponent(rawName) : undefined; } catch { /* bad header */ }
  const url = typeof req.headers['x-hive-instance-url'] === 'string' ? req.headers['x-hive-instance-url'] : null;
  // The caller's own URL is unknown when its browser was on localhost; then the
  // peer configured here under the same name as the caller's token stands in.
  const known = findPeerByUrl(deps.config, url ?? undefined)
    ?? listPeers(deps.config).find((p) => p.label.trim().toLowerCase() === tokenLabel.trim().toLowerCase());
  return { label: known?.label ?? tokenLabel ?? name, url: url ?? known?.baseUrl ?? null, peerId: known?.id ?? null };
}

// ---------------------------------------------------------------------------
// /api/peer/* — called by other Hives

function handlePeerApi(url: URL, req: http.IncomingMessage, res: http.ServerResponse, deps: PeerRouteDeps): boolean {
  const token = verifyPeerRequest(deps.config, req);
  if (!token) {
    sendJson(res, 401, { error: 'Peer token required' });
    return true;
  }
  token.lastUsedAt = new Date().toISOString();
  const who = caller(deps, req, token.label);
  const p = url.pathname;

  if (p === '/api/peer/hello' && req.method === 'GET') {
    sendJson(res, 200, { name: selfName(deps.config), version: getServerVersion(), tokenLabel: token.label });
    return true;
  }

  if (p === '/api/peer/prepare' && req.method === 'POST') {
    return run(res, async () => {
      const b = parse(await readBody(req));
      const sessionId = str(b.sessionId) ?? '';
      const result: PrepareResult = await prepareImport(deps.config, {
        sessionId,
        originUrl: str(b.originUrl) ?? null,
        projectName: str(b.projectName) ?? 'project',
      });
      sendJson(res, 200, result);
    });
  }

  if (p === '/api/peer/import' && req.method === 'POST') {
    return run(res, async () => {
      const data = await readRaw(req, MAX_PACKAGE_BYTES + 1024 * 1024);
      const { manifest, result } = await importSession(deps.config, data, deps.terminalIdsFor);
      recordHandoff({
        sessionId: manifest.sessionId,
        direction: 'in',
        status: 'active',
        peerId: who.peerId,
        peerLabel: who.label,
        peerUrl: who.url,
        localRoot: result.targetRoot,
        localCwd: result.targetCwd,
        remoteRoot: manifest.sourceRoot,
        fingerprint: null,
      });
      console.log(`[peers] Received session ${manifest.sessionId} from ${who.label} → ${result.targetCwd}${result.resumed ? ' (resumed)' : ''}`);
      sendJson(res, 200, result);
    });
  }

  const m = p.match(/^\/api\/peer\/sessions\/([^/]+)\/(export|confirm-export|abort-export)$/);
  if (m && req.method === 'POST') {
    const sessionId = decodeURIComponent(m[1]);
    const action = m[2];
    if (!SESSION_ID.test(sessionId)) {
      sendJson(res, 400, { error: 'Invalid session id' });
      return true;
    }

    if (action === 'export') {
      return run(res, async () => {
        const b = parse(await readBody(req));
        const src = await describeSession(sessionId);
        sending.add(sessionId);
        try {
          await stopSession(sessionId, deps.terminalIdsFor(sessionId));
          const exp = await exportSession(deps.config, src, {
            haveHead: str(b.haveHead) ?? null,
            resume: false,
          });
          pendingExports.set(sessionId, {
            fingerprint: exp.fingerprint,
            root: src.root,
            cwd: src.cwd,
            remoteRoot: str(b.targetRoot) ?? null,
            caller: who,
            expires: Date.now() + 10 * 60_000,
          });
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': exp.zip.length });
          res.end(exp.zip);
        } finally {
          sending.delete(sessionId);
        }
      });
    }

    if (action === 'confirm-export') {
      const pending = pendingExports.get(sessionId);
      if (!pending) {
        sendJson(res, 409, { error: 'No export of this session is pending' });
        return true;
      }
      return run(res, async () => {
        const b = parse(await readBody(req));
        pendingExports.delete(sessionId);
        recordHandoff({
          sessionId,
          direction: 'out',
          status: 'active',
          peerId: who.peerId,
          peerLabel: who.label,
          peerUrl: who.url,
          localRoot: pending.root,
          localCwd: pending.cwd,
          remoteRoot: str(b.targetRoot) ?? pending.remoteRoot,
          fingerprint: pending.fingerprint,
        });
        console.log(`[peers] Session ${sessionId} handed to ${who.label}`);
        sendJson(res, 200, { ok: true });
      });
    }

    pendingExports.delete(sessionId);
    sendJson(res, 200, { ok: true });
    return true;
  }

  sendJson(res, 404, { error: 'Not found' });
  return true;
}

// ---------------------------------------------------------------------------
// /api/peers — settings

function handleSettings(url: URL, req: AuthenticatedRequest, res: http.ServerResponse, deps: PeerRouteDeps): boolean {
  const p = url.pathname;
  const cfg = deps.config;

  if (p === '/api/peers' && req.method === 'GET') {
    sendJson(res, 200, {
      peers: listPeers(cfg).map(publicPeer),
      tokens: listPeerTokens(cfg),
      self: { name: selfName(cfg), url: selfUrl(cfg, req) ?? null, publicUrl: (cfg as PeersConfigShape).publicUrl ?? null },
    });
    return true;
  }

  if (!requireAdmin(req, res, deps.db)) return true;

  if (p === '/api/peers/self' && req.method === 'PUT') {
    return run(res, async () => {
      const b = parse(await readBody(req));
      const u = str(b.publicUrl);
      (cfg as PeersConfigShape).publicUrl = u ? normalizePeerUrl(u) : undefined;
      persist(deps);
      sendJson(res, 200, { ok: true });
    });
  }

  if (p === '/api/peers/tokens' && req.method === 'POST') {
    return run(res, async () => {
      const b = parse(await readBody(req));
      const label = str(b.label);
      if (!label) return sendJson(res, 400, { error: 'label is required' });
      const { meta, token } = createPeerToken(cfg, label);
      persist(deps);
      sendJson(res, 200, { token, meta });
    });
  }

  const tok = p.match(/^\/api\/peers\/tokens\/([a-z0-9-]+)$/);
  if (tok && req.method === 'DELETE') {
    if (!revokePeerToken(cfg, tok[1])) return sendJson(res, 404, { error: 'Token not found' }), true;
    persist(deps);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (p === '/api/peers' && req.method === 'POST') {
    return run(res, async () => {
      const b = parse(await readBody(req));
      const label = str(b.label);
      const baseUrl = str(b.baseUrl);
      const token = str(b.token);
      if (!label || !baseUrl || !token) return sendJson(res, 400, { error: 'label, baseUrl and token are required' });
      const peers = listPeers(cfg);
      // `tokens` and `self` are path segments, never peer ids.
      const taken = new Set([...peers.map((x) => x.id), 'tokens', 'self']);
      const peer: PeerConfig = { id: slugFor(label, taken), label, baseUrl: normalizePeerUrl(baseUrl) };
      setSecret(outTokenRef(peer.id), token);
      try {
        await peerJson(peer, me(deps, req), 'GET', '/api/peer/hello');
      } catch (err) {
        deleteSecret(outTokenRef(peer.id));
        throw err;
      }
      (cfg as PeersConfigShape).peers = [...peers, peer];
      persist(deps);
      sendJson(res, 200, { peer: publicPeer(peer) });
    });
  }

  const one = p.match(/^\/api\/peers\/([a-z0-9-]+)(?:\/(test))?$/);
  if (one && isValidPeerId(one[1])) {
    const peer = getPeer(cfg, one[1]);
    if (!peer) return sendJson(res, 404, { error: 'Peer not found' }), true;

    if (one[2] === 'test' && req.method === 'POST') {
      return run(res, async () => {
        const hello = await peerJson<{ name: string; version: string }>(peer, me(deps, req), 'GET', '/api/peer/hello');
        sendJson(res, 200, { ok: true, ...hello });
      });
    }
    if (!one[2] && req.method === 'PUT') {
      return run(res, async () => {
        const b = parse(await readBody(req));
        const updated: PeerConfig = {
          ...peer,
          label: str(b.label) ?? peer.label,
          baseUrl: str(b.baseUrl) ? normalizePeerUrl(str(b.baseUrl)!) : peer.baseUrl,
        };
        const token = str(b.token);
        if (token) setSecret(outTokenRef(peer.id), token);
        (cfg as PeersConfigShape).peers = listPeers(cfg).map((x) => (x.id === peer.id ? updated : x));
        persist(deps);
        sendJson(res, 200, { peer: publicPeer(updated) });
      });
    }
    if (!one[2] && req.method === 'DELETE') {
      deleteSecret(outTokenRef(peer.id));
      (cfg as PeersConfigShape).peers = listPeers(cfg).filter((x) => x.id !== peer.id);
      persist(deps);
      sendJson(res, 200, { ok: true });
      return true;
    }
  }

  sendJson(res, 404, { error: 'Not found' });
  return true;
}

// ---------------------------------------------------------------------------
// /api/peer-handoffs — what the session page does

function peerForLock(cfg: HiveConfig, sessionId: string): PeerConfig {
  const lock = getLock(sessionId);
  if (!lock) throw new TransferError(409, 'This session is not handed off.');
  const peer = (lock.peerId ? getPeer(cfg, lock.peerId) : undefined) ?? findPeerByUrl(cfg, lock.peerUrl ?? undefined);
  if (!peer) {
    throw new TransferError(409, `${lock.peerLabel} isn't set up as a peer on this Hive, so it can't be asked for the session. Add it in Settings → Peers, or hand it back from there.`);
  }
  return peer;
}

async function send(deps: PeerRouteDeps, req: http.IncomingMessage, b: Record<string, unknown>) {
  const sessionId = str(b.sessionId) ?? '';
  const peer = getPeer(deps.config, str(b.peerId) ?? '');
  if (!peer) throw new TransferError(404, 'Peer not found');
  const src = await describeSession(sessionId);
  const ident = me(deps, req);

  // Ask first, so nothing is stopped if the other side would refuse.
  const prep = await peerJson<PrepareResult>(peer, ident, 'POST', '/api/peer/prepare', {
    sessionId, originUrl: src.originUrl, projectName: src.projectName,
  }, 60_000);

  sending.add(sessionId);
  try {
    await stopSession(sessionId, deps.terminalIdsFor(sessionId));
    const exp = await exportSession(deps.config, src, {
      haveHead: prep.haveHead,
      instruction: str(b.instruction),
      resume: b.resume !== false,
    });
    const result = await peerUpload<ImportResult>(peer, ident, '/api/peer/import', exp.zip);
    recordHandoff({
      sessionId,
      direction: 'out',
      status: 'active',
      peerId: peer.id,
      peerLabel: peer.label,
      peerUrl: peer.baseUrl,
      localRoot: src.root,
      localCwd: src.cwd,
      remoteRoot: result.targetRoot,
      fingerprint: exp.fingerprint,
    });
    console.log(`[peers] Sent session ${sessionId} to ${peer.label} → ${result.targetCwd}`);
    return { ok: true, peer: publicPeer(peer), ...result, bytes: exp.zip.length };
  } finally {
    sending.delete(sessionId);
  }
}

async function bringBack(deps: PeerRouteDeps, req: http.IncomingMessage, sessionId: string) {
  const peer = peerForLock(deps.config, sessionId);
  const lock = getLock(sessionId)!;
  const ident = me(deps, req);
  const localRoot = lock.localRoot ?? '';

  // Will it fit back here? (Fails on local edits made after the session left.)
  const prep = await prepareImport(deps.config, {
    sessionId, originUrl: (await repoState(localRoot)).originUrl, projectName: path.basename(localRoot) || 'project',
  });

  const zip = await peerDownload(peer, ident, `/api/peer/sessions/${encodeURIComponent(sessionId)}/export`, {
    haveHead: prep.haveHead, targetRoot: prep.targetRoot,
  });
  let imported: Awaited<ReturnType<typeof importSession>>;
  try {
    imported = await importSession(deps.config, zip, deps.terminalIdsFor);
  } catch (err) {
    peerJson(peer, ident, 'POST', `/api/peer/sessions/${encodeURIComponent(sessionId)}/abort-export`, {}).catch(() => {});
    throw err;
  }
  const { manifest, result } = imported;
  recordHandoff({
    sessionId,
    direction: 'in',
    status: 'active',
    peerId: peer.id,
    peerLabel: peer.label,
    peerUrl: peer.baseUrl,
    localRoot: result.targetRoot,
    localCwd: result.targetCwd,
    remoteRoot: manifest.sourceRoot,
    fingerprint: null,
  });
  const notes = [...result.notes];
  try {
    await peerJson(peer, ident, 'POST', `/api/peer/sessions/${encodeURIComponent(sessionId)}/confirm-export`, { targetRoot: result.targetRoot });
  } catch (err) {
    notes.push(`The session is back, but ${peer.label} could not be told to lock its copy (${(err as Error).message}). Don't resume it there.`);
  }
  console.log(`[peers] Brought session ${sessionId} back from ${peer.label}`);
  return { ok: true, ...result, notes };
}

function handleActions(url: URL, req: AuthenticatedRequest, res: http.ServerResponse, deps: PeerRouteDeps): boolean {
  const p = url.pathname;

  if (p === '/api/peer-handoffs/locks' && req.method === 'GET') {
    sendJson(res, 200, {
      locks: listLocks().map((l) => ({ sessionId: l.sessionId, peerLabel: l.peerLabel, peerUrl: l.peerUrl, since: l.createdAt })),
    });
    return true;
  }

  const s = p.match(/^\/api\/peer-handoffs\/session\/([^/]+)$/);
  if (s && req.method === 'GET') {
    const sessionId = decodeURIComponent(s[1]);
    const latest = SESSION_ID.test(sessionId) ? latestHandoff(sessionId) : null;
    const lock = latest && latest.direction === 'out' && latest.status === 'active' ? latest : null;
    const canBringBack = !!lock && !!((lock.peerId && getPeer(deps.config, lock.peerId)) || findPeerByUrl(deps.config, lock.peerUrl ?? undefined));
    sendJson(res, 200, {
      peers: listPeers(deps.config).map(publicPeer),
      lock: lock ? { peerLabel: lock.peerLabel, peerUrl: lock.peerUrl, since: lock.createdAt, remoteRoot: lock.remoteRoot, canBringBack } : null,
      arrived: latest && latest.direction === 'in' && latest.status === 'active'
        ? { from: latest.peerLabel, at: latest.createdAt }
        : null,
    });
    return true;
  }

  if (req.method !== 'POST') return false;
  if (!requireAdmin(req, res, deps.db)) return true;

  if (p === '/api/peer-handoffs/preview') {
    return run(res, async () => {
      const b = parse(await readBody(req));
      const sessionId = str(b.sessionId) ?? '';
      const peer = getPeer(deps.config, str(b.peerId) ?? '');
      if (!peer) return sendJson(res, 404, { error: 'Peer not found' });
      const src = await describeSession(sessionId);
      const prep = await peerJson<PrepareResult>(peer, me(deps, req), 'POST', '/api/peer/prepare', {
        sessionId, originUrl: src.originUrl, projectName: src.projectName,
      }, 60_000);
      sendJson(res, 200, {
        projectRoot: src.root,
        branch: src.branch,
        targetRoot: prep.targetRoot,
        targetHasRepo: prep.isRepo,
        willStash: prep.dirty && prep.dirtyIsOurs,
        peerLaunchFlags: prep.launchFlags,
        changes: await summarize(src.root, prep.haveHead),
      });
    });
  }

  if (p === '/api/peer-handoffs/send') {
    return run(res, async () => sendJson(res, 200, await send(deps, req, parse(await readBody(req)))));
  }

  if (p === '/api/peer-handoffs/bring-back') {
    return run(res, async () => {
      const b = parse(await readBody(req));
      const sessionId = str(b.sessionId) ?? '';
      if (!SESSION_ID.test(sessionId)) return sendJson(res, 400, { error: 'Invalid session id' });
      sendJson(res, 200, await bringBack(deps, req, sessionId));
    });
  }

  if (p === '/api/peer-handoffs/unlock') {
    return run(res, async () => {
      const b = parse(await readBody(req));
      const sessionId = str(b.sessionId) ?? '';
      if (!SESSION_ID.test(sessionId) || !getLock(sessionId)) return sendJson(res, 404, { error: 'Session is not locked' });
      setStatus(sessionId, 'unlocked');
      sendJson(res, 200, { ok: true });
    });
  }

  return false;
}

export function registerPeerRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PeerRouteDeps,
): boolean {
  const p = url.pathname;
  if (p.startsWith('/api/peer/')) return handlePeerApi(url, req, res, deps);
  if (p === '/api/peers' || p.startsWith('/api/peers/')) return handleSettings(url, req as AuthenticatedRequest, res, deps);
  if (p.startsWith('/api/peer-handoffs/')) return handleActions(url, req as AuthenticatedRequest, res, deps);
  return false;
}
