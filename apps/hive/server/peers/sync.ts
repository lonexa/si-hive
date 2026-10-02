/**
 * Project sync between this Hive and a peer: compare every project folder on
 * both sides, send or get one (code, history and uncommitted changes, as one
 * git bundle), and optionally fast-forward safe cases in the background.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { HiveConfig } from '../types.js';
import { loadConfig } from '../config.js';
import { isWindows } from '../platform.js';
import { TransferError, headContains, packRepo, repoState, tmpFile, type CodeInfo } from './git-transfer.js';
import {
  codeSent, describeProject, githubSizeNote, listProjects, prepareTarget, projectFolders, receiveCode,
  type LocalProject, type PreparedTarget, type ProjectIdentity,
} from './projects.js';
import { listPeers, selfName, type PeerConfig, type PeersConfigShape } from './config.js';
import { peerDownload, peerJson, peerUpload, type CallerIdentity } from './client.js';
import { removeQuietly } from './wire.js';

const FORMAT = 1;

export interface ProjectManifest {
  kind: 'project';
  format: number;
  name: string;
  sourceRoot: string;
  code: CodeInfo;
  /** Adopting a plain folder with differing files: back them up and replace them. */
  replaceDiffering?: boolean;
}

// ---------------------------------------------------------------------------
// One transfer per folder at a time, in either direction.

const busyFolders = new Set<string>();
const key = (p: string) => (isWindows ? path.resolve(p).toLowerCase() : path.resolve(p));

export async function withFolderLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const k = key(root);
  if (busyFolders.has(k)) throw new TransferError(409, `${path.basename(root)} is already being transferred.`);
  busyFolders.add(k);
  try { return await fn(); } finally { busyFolders.delete(k); }
}

// ---------------------------------------------------------------------------
// Peer side (called through /api/peer/projects/*)

/** Only folders this Hive lists as projects can be exported. */
function resolveOwnProject(config: HiveConfig, p: string): string {
  const match = projectFolders(config).find((f) => key(f) === key(p));
  if (!match) throw new TransferError(404, `${p} is not a project on this Hive`);
  return match;
}

export async function listForPeer(config: HiveConfig, contains: Array<{ rootCommit: string; sha: string }>) {
  const projects = await listProjects(config);
  const result: Record<string, boolean> = {};
  for (const c of contains) {
    const p = projects.find((x) => x.rootCommit === c.rootCommit);
    if (p) result[`${c.rootCommit}:${c.sha}`] = await headContains(p.path, c.sha).catch(() => false);
  }
  return { name: selfName(config), projects, contains: result };
}

export async function exportProject(config: HiveConfig, p: string, haveHead: string | null) {
  const root = resolveOwnProject(config, p);
  if ((await describeProject(root)).busy) {
    throw new TransferError(409, `A terminal or session is running in ${root} on this Hive. Close it there first.`);
  }
  return withFolderLock(root, async () => {
    const state = await repoState(root);
    if (!state.isRepo) throw new TransferError(400, `${path.basename(root)} isn't a git repository on this Hive. Make it one first.`);
    const bundlePath = tmpFile('.bundle');
    try {
      const code = await packRepo(root, haveHead, bundlePath);
      if (!code.hasBundle) fs.rmSync(bundlePath, { force: true });
      codeSent(root, code);
      const manifest: ProjectManifest = { kind: 'project', format: FORMAT, name: path.basename(root), sourceRoot: root, code };
      return { head: Buffer.from(JSON.stringify(manifest)), bundlePath: code.hasBundle ? bundlePath : null };
    } catch (err) {
      fs.rmSync(bundlePath, { force: true });
      throw err;
    }
  });
}

function parseManifest(head: Buffer): ProjectManifest {
  let m: ProjectManifest;
  try { m = JSON.parse(head.toString('utf-8')) as ProjectManifest; } catch { throw new TransferError(400, 'Not a project transfer'); }
  if (m.kind !== 'project') throw new TransferError(400, 'Not a project transfer');
  if (m.format !== FORMAT) throw new TransferError(400, `Unsupported project format ${m.format}. Update SI Hive on both machines.`);
  return m;
}

const identityOf = (m: ProjectManifest): ProjectIdentity => ({ name: m.name, originUrl: m.code.originUrl, rootCommit: m.code.rootCommit });

export async function importProject(config: HiveConfig, head: Buffer, bundlePath: string | null) {
  const m = parseManifest(head);
  const prepared = await prepareTarget(config, identityOf(m));
  if (prepared.busy) {
    throw new TransferError(409, `A terminal or session is running in ${prepared.targetRoot} on this Hive. Close it there first.`);
  }
  return withFolderLock(prepared.targetRoot, async () => {
    const notes = await receiveCode(prepared.targetRoot, bundlePath, m.code, undefined, { replaceDiffering: m.replaceDiffering });
    return { targetRoot: prepared.targetRoot, notes };
  });
}

// ---------------------------------------------------------------------------
// Comparing both sides

export type SyncStatus =
  | 'in-sync' | 'only-here' | 'only-there' | 'ahead' | 'behind' | 'diverged'
  | 'changes-here' | 'changes-there' | 'changes-both' | 'not-git' | 'unrelated';

export interface SyncRow {
  name: string;
  here?: LocalProject;
  there?: LocalProject;
  status: SyncStatus;
  detail: string;
  canSend: boolean;
  canGet: boolean;
}

function plural(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}

export async function compare(config: HiveConfig, peer: PeerConfig, me: CallerIdentity): Promise<{ peerName: string; rows: SyncRow[] }> {
  const here = await listProjects(config);
  const contains = here.filter((p) => p.rootCommit && p.headSha).map((p) => ({ rootCommit: p.rootCommit!, sha: p.headSha! }));
  const remote = await peerJson<{ name: string; projects: LocalProject[]; contains: Record<string, boolean> }>(
    peer, me, 'POST', '/api/peer/projects/list', { contains }, 120_000,
  );

  const rows: SyncRow[] = [];
  const usedThere = new Set<string>();
  for (const h of here) {
    const t = (h.rootCommit && (remote.projects.find((p) => p.rootCommit === h.rootCommit && p.name === h.name)
      ?? remote.projects.find((p) => p.rootCommit === h.rootCommit)))
      || remote.projects.find((p) => p.name === h.name && !usedThere.has(p.path));
    if (t) usedThere.add(t.path);
    rows.push(await row(h, t, remote.contains));
  }
  for (const t of remote.projects) {
    if (!usedThere.has(t.path)) rows.push(await row(undefined, t, remote.contains));
  }
  return { peerName: remote.name, rows: rows.sort((a, b) => a.name.localeCompare(b.name)) };
}

async function row(h: LocalProject | undefined, t: LocalProject | undefined, contains: Record<string, boolean>): Promise<SyncRow> {
  const name = (h ?? t)!.name;
  const base = { name, here: h, there: t };
  if (!t) {
    return h!.isGit
      ? { ...base, status: 'only-here', detail: 'Only on this machine', canSend: true, canGet: false }
      : { ...base, status: 'not-git', detail: 'Only here, not a git repository yet', canSend: false, canGet: false };
  }
  if (!h) {
    return t.isGit
      ? { ...base, status: 'only-there', detail: 'Only on the other machine', canSend: false, canGet: true }
      : { ...base, status: 'not-git', detail: 'Only there, not a git repository yet', canSend: false, canGet: false };
  }
  if (!h.isGit || !t.isGit) {
    if (h.isGit) return { ...base, status: 'only-here', detail: 'Git here; a plain folder there (it will be adopted if the files match)', canSend: true, canGet: false };
    if (t.isGit) return { ...base, status: 'only-there', detail: 'Git there; a plain folder here (it will be adopted if the files match)', canSend: false, canGet: true };
    return { ...base, status: 'not-git', detail: 'Not a git repository on either machine', canSend: false, canGet: false };
  }
  if (h.rootCommit && t.rootCommit && h.rootCommit !== t.rootCommit) {
    return { ...base, status: 'unrelated', detail: 'Same name, but different repositories', canSend: false, canGet: false };
  }

  const branchNote = h.branch !== t.branch ? ` (branch ${h.branch ?? 'detached'} here, ${t.branch ?? 'detached'} there)` : '';
  let relation: 'equal' | 'ahead' | 'behind' | 'diverged';
  if (h.headSha === t.headSha) relation = 'equal';
  else if (t.headSha && await headContains(h.path, t.headSha).catch(() => false)) relation = 'ahead';
  else if (h.headSha && contains[`${h.rootCommit}:${h.headSha}`]) relation = 'behind';
  else relation = 'diverged';

  const hc = h.changes > 0;
  const tc = t.changes > 0;
  const changes = [hc ? `${plural(h.changes, 'change')} here` : '', tc ? `${plural(t.changes, 'change')} there` : ''].filter(Boolean).join(', ');

  // Same commit and the same files (uncommitted ones included): nothing to do.
  if (relation === 'equal' && h.tree && h.tree === t.tree) {
    return { ...base, status: 'in-sync', detail: (hc ? 'In sync, including uncommitted changes' : 'In sync') + branchNote, canSend: false, canGet: false };
  }
  if (relation === 'diverged') {
    return { ...base, status: 'diverged', detail: `Both machines have commits the other doesn't${branchNote}. Merge them in one place first.`, canSend: false, canGet: false };
  }
  if (hc && tc) {
    return { ...base, status: 'changes-both', detail: `Uncommitted changes on both machines (${changes})${branchNote}`, canSend: true, canGet: true };
  }
  if (relation === 'equal') {
    if (hc) return { ...base, status: 'changes-here', detail: `${changes}${branchNote}`, canSend: true, canGet: false };
    if (tc) return { ...base, status: 'changes-there', detail: `${changes}${branchNote}`, canSend: false, canGet: true };
    return { ...base, status: 'in-sync', detail: branchNote ? `In sync${branchNote}` : 'In sync', canSend: false, canGet: false };
  }
  const extra = changes ? `, ${changes}` : '';
  return relation === 'ahead'
    ? { ...base, status: 'ahead', detail: `Newer here${extra}${branchNote}`, canSend: true, canGet: false }
    : { ...base, status: 'behind', detail: `Newer there${extra}${branchNote}`, canSend: false, canGet: true };
}

// ---------------------------------------------------------------------------
// Actions

export async function sendProject(
  config: HiveConfig, peer: PeerConfig, me: CallerIdentity, localPath: string, opts: { replaceDiffering?: boolean } = {},
) {
  const root = resolveOwnProject(config, localPath);
  const project = await describeProject(root);
  if (!project.isGit) throw new TransferError(400, `${project.name} isn't a git repository yet. Make it one first.`);
  if (project.busy) throw new TransferError(409, `A terminal or session is running in ${project.name} here. Close it first.`);
  const id: ProjectIdentity = { name: project.name, originUrl: project.originUrl, rootCommit: project.rootCommit };
  const prep = await peerJson<PreparedTarget>(peer, me, 'POST', '/api/peer/projects/prepare', id, 120_000);
  if (prep.busy) throw new TransferError(409, `A terminal or session is running in ${project.name} on ${peer.label}. Close it there first.`);

  return withFolderLock(root, async () => {
    const bundlePath = tmpFile('.bundle');
    try {
      const code = await packRepo(root, prep.haveHead, bundlePath);
      const manifest: ProjectManifest = {
        kind: 'project', format: FORMAT, name: project.name, sourceRoot: root, code, replaceDiffering: opts.replaceDiffering,
      };
      const result = await peerUpload<{ targetRoot: string; notes: string[] }>(
        peer, me, '/api/peer/projects/import', Buffer.from(JSON.stringify(manifest)), code.hasBundle ? bundlePath : null,
      );
      codeSent(root, code);
      const gh = await githubSizeNote(root, project.originUrl);
      return { ...result, notes: gh ? [...result.notes, gh] : result.notes };
    } finally {
      removeQuietly(bundlePath);
    }
  });
}

export async function getProject(
  config: HiveConfig, peer: PeerConfig, me: CallerIdentity, remotePath: string, id: ProjectIdentity,
  opts: { replaceDiffering?: boolean } = {},
) {
  const prepared = await prepareTarget(config, id);
  if (prepared.busy) throw new TransferError(409, `A terminal or session is running in ${prepared.targetRoot} here. Close it first.`);
  return withFolderLock(prepared.targetRoot, async () => {
    const framed = await peerDownload(peer, me, '/api/peer/projects/export', { path: remotePath, haveHead: prepared.haveHead });
    try {
      const m = parseManifest(framed.head);
      const notes = await receiveCode(prepared.targetRoot, framed.bundlePath, m.code, undefined, opts);
      return { targetRoot: prepared.targetRoot, notes };
    } finally {
      removeQuietly(framed.bundlePath);
    }
  });
}

// ---------------------------------------------------------------------------
// Auto-sync: only the always-safe cases (fast-forward committed work, both
// sides clean, same branch, nothing running). Everything else waits for you.

export interface AutoSyncReport {
  at: string;
  actions: string[];
  skipped: string[];
  error?: string;
}

const reports = new Map<string, AutoSyncReport>();
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function autoSyncReport(peerId: string): AutoSyncReport | null {
  return reports.get(peerId) ?? null;
}

export async function autoSyncOnce(config: HiveConfig, peer: PeerConfig): Promise<AutoSyncReport> {
  const me: CallerIdentity = { name: selfName(config), url: (config as PeersConfigShape).publicUrl || process.env.HIVE_PUBLIC_URL || undefined };
  const report: AutoSyncReport = { at: new Date().toISOString(), actions: [], skipped: [] };
  try {
    const { rows } = await compare(config, peer, me);
    for (const r of rows) {
      if (r.status !== 'ahead' && r.status !== 'behind') continue;
      const h = r.here!;
      const t = r.there!;
      if (h.changes > 0 || t.changes > 0 || h.branch !== t.branch || !h.branch || h.busy || t.busy) {
        report.skipped.push(`${r.name}: ${r.detail}`);
        continue;
      }
      try {
        if (r.status === 'ahead') {
          await sendProject(config, peer, me, h.path);
          report.actions.push(`${r.name}: sent to ${peer.label}`);
        } else {
          await getProject(config, peer, me, t.path, { name: t.name, originUrl: t.originUrl, rootCommit: t.rootCommit });
          report.actions.push(`${r.name}: updated from ${peer.label}`);
        }
      } catch (err) {
        report.skipped.push(`${r.name}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    report.error = (err as Error).message;
  }
  reports.set(peer.id, report);
  if (report.actions.length) console.log(`[peers] Auto-sync with ${peer.label}: ${report.actions.join('; ')}`);
  return report;
}

/** Start the background loop (idempotent). Reads config each tick, so toggles apply without a restart. */
export function startAutoSync(intervalMs = 10 * 60_000): void {
  if (timer) return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    (async () => {
      const config = loadConfig();
      for (const peer of listPeers(config).filter((p) => p.autoSync)) {
        await autoSyncOnce(config, peer);
      }
    })().catch((err) => console.warn('[peers] Auto-sync failed:', (err as Error).message))
      .finally(() => { running = false; });
  }, intervalMs);
  timer.unref?.();
}
