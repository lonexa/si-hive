/**
 * Session packages: everything another Hive needs to resume a session.
 *
 *   manifest.json
 *   transcript/<id>.jsonl          the Claude Code transcript
 *   transcript/<id>/**             subagent transcripts and tool results
 *   code/repo.bundle               commits the target doesn't have (optional)
 *   code/worktree.patch            uncommitted changes to tracked files
 *   code/untracked/**              untracked, non-ignored files
 *
 * exportSession() stops the session here and packs it; importSession() puts it
 * in place on this machine (paths rewritten) and optionally resumes it.
 */
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { HiveConfig } from '../types.js';
import { isWindows } from '../platform.js';
import { encodeClaudeProjectDir } from '../claude-paths.js';
import { getSessionInfo, listLiveSessionHolders } from '../sessions/replay-client.js';
import { destroyPtysForSession, getPtySession, spawnPty } from '../terminal-pty.js';
import { isIncognitoSession, isIncognitoPath } from '../privacy/incognito.js';
import { getProvider } from '../providers/registry.js';
import { listLocalProjectPaths } from '../delivery/local-repos.js';
import { TranscriptRewriter } from './transcript-rewrite.js';
import {
  TransferError, applyRepo, checkTarget, fingerprint, normalizeRemote, packRepo, repoState,
  type CodePayload, type TargetCheck,
} from './git-transfer.js';
import { fingerprintsFor, getLock, previousRoot } from './store.js';

export const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
export const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;
const FORMAT = 1;

export interface Manifest {
  format: number;
  sessionId: string;
  provider: 'claude';
  /** Project root on the source (git top level). */
  sourceRoot: string;
  sourceWindows: boolean;
  /** Session cwd relative to the root, '/'-separated ('' = the root). */
  cwdRel: string;
  projectName: string;
  originUrl: string | null;
  branch: string | null;
  headSha: string | null;
  hasBundle: boolean;
  /** Prompt to send when the session resumes on the target. */
  instruction?: string;
  /** Whether the target should resume the session right away. */
  resume: boolean;
  /** Source's Claude project settings for the folder (trust, allowed tools). */
  projectSettings?: Record<string, unknown>;
}

export interface SessionSource {
  sessionId: string;
  jsonlPath: string;
  cwd: string;
  root: string;
  cwdRel: string;
  projectName: string;
  originUrl: string | null;
  branch: string | null;
  headSha: string | null;
}

/** Where a session lives here, and its project. Throws a TransferError when it can't move. */
export async function describeSession(sessionId: string): Promise<SessionSource> {
  if (!SESSION_ID.test(sessionId)) throw new TransferError(400, 'Invalid session id');
  const info = getSessionInfo(sessionId);
  if (!info.exists || !info.filePath || !info.cwd) throw new TransferError(404, 'Session not found on this Hive');
  if (isIncognitoSession(sessionId, info.cwd)) {
    throw new TransferError(403, 'This session is incognito, so it stays on this machine. Turn incognito off first.');
  }
  const lock = getLock(sessionId);
  if (lock) throw new TransferError(409, `This session is running on ${lock.peerLabel}, not here. Bring it back first.`);

  const state = await repoState(info.cwd);
  if (!state.isRepo) {
    throw new TransferError(400, 'Only sessions in a git repository can be handed off. Run `git init` and commit in the project first.');
  }
  const rel = path.relative(state.root, path.resolve(info.cwd));
  const cwdRel = rel.startsWith('..') ? '' : rel.split(path.sep).join('/');
  return {
    sessionId,
    jsonlPath: info.filePath,
    cwd: info.cwd,
    root: state.root,
    cwdRel,
    projectName: path.basename(state.root),
    originUrl: state.originUrl,
    branch: state.branch,
    headSha: state.headSha,
  };
}

/** Stop every process running this session here; fail if one outside Hive won't go. */
export async function stopSession(sessionId: string, terminalIds: string[]): Promise<void> {
  destroyPtysForSession(sessionId, terminalIds);
  const deadline = Date.now() + 5000;
  for (;;) {
    const holder = listLiveSessionHolders().find((h) => h.sessionId === sessionId);
    if (!holder) return;
    if (Date.now() > deadline) {
      throw new TransferError(409, `A Claude process outside SI Hive (pid ${holder.pid}) is still running this session. Close it first.`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

function claudeStateFile(config: HiveConfig): string {
  const inside = path.join(config.claudeHome, '.claude.json');
  return fs.existsSync(inside) ? inside : path.join(path.dirname(config.claudeHome), '.claude.json');
}

/** Claude keys project settings by path, with forward slashes on Windows too. */
function claudeProjectKey(p: string): string {
  return isWindows ? p.replace(/\\/g, '/') : p;
}

function readProjectSettings(config: HiveConfig, root: string): Record<string, unknown> | undefined {
  try {
    const state = JSON.parse(fs.readFileSync(claudeStateFile(config), 'utf-8')) as { projects?: Record<string, Record<string, unknown>> };
    const projects = state.projects ?? {};
    const norm = (k: string) => (isWindows ? k.replace(/\\/g, '/').toLowerCase() : k);
    const key = Object.keys(projects).find((k) => norm(k) === norm(root));
    if (!key) return undefined;
    const { allowedTools, hasTrustDialogAccepted } = projects[key];
    return { allowedTools, hasTrustDialogAccepted };
  } catch {
    return undefined;
  }
}

/**
 * Mark the folder trusted for Claude (the user sent the session here on
 * purpose) — otherwise an unattended resume sits on "Do you trust this
 * folder?" all night. Carries the source's allowed tools across too.
 */
function trustFolder(config: HiveConfig, dir: string, from?: Record<string, unknown>): void {
  const file = claudeStateFile(config);
  let state: { projects?: Record<string, Record<string, unknown>> } & Record<string, unknown> = {};
  try { state = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { /* fresh */ }
  const key = claudeProjectKey(dir);
  const existing = state.projects?.[key] ?? {};
  const tools = new Set<string>([
    ...((existing.allowedTools as string[] | undefined) ?? []),
    ...((from?.allowedTools as string[] | undefined) ?? []),
  ]);
  state.projects = {
    ...(state.projects ?? {}),
    [key]: { ...existing, allowedTools: [...tools], hasTrustDialogAccepted: true },
  };
  // Claude rewrites this file constantly; write-and-rename keeps it whole.
  const tmp = `${file}.hive-${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

function addDir(zip: AdmZip, dir: string, prefix: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) addDir(zip, full, `${prefix}${entry.name}/`);
    else if (entry.isFile()) zip.addFile(`${prefix}${entry.name}`, fs.readFileSync(full));
  }
}

export interface ExportResult {
  zip: Buffer;
  manifest: Manifest;
  /** Working-tree fingerprint at export, recorded when the handoff completes. */
  fingerprint: string;
  source: SessionSource;
}

/**
 * Pack a session that has already been stopped. `haveHead` is the commit the
 * target's checkout is at (null: it has none).
 */
export async function exportSession(
  config: HiveConfig,
  src: SessionSource,
  opts: { haveHead: string | null; instruction?: string; resume: boolean },
): Promise<ExportResult> {
  const code = await packRepo(src.root, opts.haveHead, MAX_PACKAGE_BYTES);
  const manifest: Manifest = {
    format: FORMAT,
    sessionId: src.sessionId,
    provider: 'claude',
    sourceRoot: src.root,
    sourceWindows: isWindows,
    cwdRel: src.cwdRel,
    projectName: src.projectName,
    originUrl: code.originUrl,
    branch: code.branch,
    headSha: code.headSha,
    hasBundle: !!code.bundle,
    instruction: opts.instruction?.trim() || undefined,
    resume: opts.resume,
    projectSettings: readProjectSettings(config, src.root),
  };

  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.addFile(`transcript/${src.sessionId}.jsonl`, fs.readFileSync(src.jsonlPath));
  addDir(zip, path.join(path.dirname(src.jsonlPath), src.sessionId), `transcript/${src.sessionId}/`);
  if (code.bundle) zip.addFile('code/repo.bundle', code.bundle);
  zip.addFile('code/worktree.patch', code.patch);
  for (const f of code.untracked) zip.addFile(`code/untracked/${f.rel.split(path.sep).join('/')}`, f.data);

  const buf = zip.toBuffer();
  if (buf.length > MAX_PACKAGE_BYTES) {
    throw new TransferError(413, 'The session package is over 200 MB. Clone the project on the other Hive first; then only new commits are sent.');
  }
  return { zip: buf, manifest, fingerprint: await fingerprint(src.root), source: src };
}

/** Where a project should live on this Hive. */
export async function resolveTargetRoot(
  config: HiveConfig,
  m: Pick<Manifest, 'sessionId' | 'originUrl' | 'projectName'>,
): Promise<string> {
  const prev = previousRoot(m.sessionId);
  if (prev && fs.existsSync(prev)) return prev;

  const remote = normalizeRemote(m.originUrl);
  if (remote) {
    for (const p of listLocalProjectPaths(config)) {
      const s = await repoState(p);
      if (s.isRepo && path.resolve(s.root) === path.resolve(p) && normalizeRemote(s.originUrl) === remote) return p;
    }
  }

  if (!config.projectsRoot) {
    throw new TransferError(409, 'This Hive has no projects folder. Set one in Settings → General.');
  }
  const base = m.projectName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-') || 'project';
  for (let n = 1; ; n++) {
    const candidate = path.join(config.projectsRoot, n === 1 ? base : `${base}-${n}`);
    if (!fs.existsSync(candidate)) return candidate;
    const s = await repoState(candidate);
    // Same repo, or an empty folder: use it. Anything else is someone else's.
    if (s.isRepo && remote && normalizeRemote(s.originUrl) === remote) return candidate;
    if (!s.isRepo && fs.readdirSync(candidate).length === 0) return candidate;
  }
}

export interface PrepareResult extends TargetCheck {
  targetRoot: string;
  launchFlags: { autoMode: boolean; dangerouslySkipPermissions: boolean };
}

/** What the target would do with this session — asked before anything is stopped. */
export async function prepareImport(
  config: HiveConfig,
  m: Pick<Manifest, 'sessionId' | 'originUrl' | 'projectName'>,
): Promise<PrepareResult> {
  if (!SESSION_ID.test(m.sessionId)) throw new TransferError(400, 'Invalid session id');
  const targetRoot = await resolveTargetRoot(config, m);
  const check = await checkTarget(targetRoot, fingerprintsFor(targetRoot));
  if (check.exists && !check.isRepo && check.dirty) {
    throw new TransferError(409, `${targetRoot} exists on this Hive and is not that git repository.`);
  }
  if (check.dirty && !check.dirtyIsOurs) {
    throw new TransferError(409, `${targetRoot} has uncommitted changes on this Hive. Commit or stash them there first.`);
  }
  return {
    ...check,
    targetRoot,
    launchFlags: {
      autoMode: !!config.launchFlags?.autoMode,
      dangerouslySkipPermissions: !!config.launchFlags?.dangerouslySkipPermissions,
    },
  };
}

/** This Hive's default permission mode for new sessions (as the UI launches them). */
function permissionFlags(config: HiveConfig): string[] {
  if (config.launchFlags?.dangerouslySkipPermissions) return ['--dangerously-skip-permissions'];
  if (config.launchFlags?.autoMode) return ['--enable-auto-mode'];
  return [];
}

export interface ImportResult {
  targetRoot: string;
  targetCwd: string;
  resumed: boolean;
  notes: string[];
}

function readManifest(zip: AdmZip): Manifest {
  const entry = zip.getEntry('manifest.json');
  if (!entry) throw new TransferError(400, 'Not a session package (no manifest)');
  const m = JSON.parse(entry.getData().toString('utf-8')) as Manifest;
  if (m.format !== FORMAT) throw new TransferError(400, `Unsupported package format ${m.format}. Update both Hives.`);
  if (!SESSION_ID.test(m.sessionId)) throw new TransferError(400, 'Invalid session id');
  return m;
}

/** Remove other copies of this transcript (an older import may sit under another folder). */
function removeOtherCopies(projectsDir: string, sessionId: string, keepDir: string): void {
  let dirs: string[] = [];
  try { dirs = fs.readdirSync(projectsDir); } catch { return; }
  for (const d of dirs) {
    const dir = path.join(projectsDir, d);
    if (path.resolve(dir) === path.resolve(keepDir)) continue;
    const file = path.join(dir, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
      fs.rmSync(path.join(dir, sessionId), { recursive: true, force: true });
    }
  }
}

export async function importSession(
  config: HiveConfig,
  data: Buffer,
  terminalIdsFor: (sessionId: string) => string[],
): Promise<{ manifest: Manifest; result: ImportResult }> {
  let zip: AdmZip;
  try { zip = new AdmZip(data); } catch { throw new TransferError(400, 'Not a session package (bad zip)'); }
  const m = readManifest(zip);

  // A stale copy may be open here; the incoming one supersedes it.
  await stopSession(m.sessionId, terminalIdsFor(m.sessionId));

  const targetRoot = await resolveTargetRoot(config, m);
  if (isIncognitoPath(targetRoot)) throw new TransferError(403, `${targetRoot} is incognito on this Hive.`);
  const targetCwd = m.cwdRel ? path.join(targetRoot, ...m.cwdRel.split('/')) : targetRoot;

  // 1. Code.
  const prefix = 'code/untracked/';
  const payload: CodePayload = {
    branch: m.branch,
    headSha: m.headSha,
    originUrl: m.originUrl,
    bundle: m.hasBundle ? zip.getEntry('code/repo.bundle')?.getData() : undefined,
    patch: zip.getEntry('code/worktree.patch')?.getData() ?? Buffer.alloc(0),
    untracked: zip.getEntries()
      .filter((e) => !e.isDirectory && e.entryName.startsWith(prefix))
      .map((e) => ({ rel: e.entryName.slice(prefix.length), data: e.getData() })),
  };
  const notes = await applyRepo(targetRoot, payload, fingerprintsFor(targetRoot));
  fs.mkdirSync(targetCwd, { recursive: true });

  // 2. Transcript, under the folder Claude will look in for targetCwd.
  const projectsDir = path.join(config.claudeHome, 'projects');
  const destDir = path.join(projectsDir, encodeClaudeProjectDir(targetCwd));
  fs.mkdirSync(destDir, { recursive: true });
  removeOtherCopies(projectsDir, m.sessionId, destDir);
  const rewriter = new TranscriptRewriter(
    { root: m.sourceRoot, windows: m.sourceWindows },
    { root: targetRoot, windows: isWindows },
  );
  const tPrefix = 'transcript/';
  const subDir = path.join(destDir, m.sessionId);
  fs.rmSync(subDir, { recursive: true, force: true });
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.startsWith(tPrefix)) continue;
    const rel = e.entryName.slice(tPrefix.length);
    const out = path.resolve(destDir, rel);
    if (!out.startsWith(path.resolve(destDir) + path.sep)) throw new TransferError(400, `Bad path in package: ${rel}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const raw = e.getData();
    fs.writeFileSync(out, rel.endsWith('.jsonl') ? rewriter.rewriteJsonl(raw.toString('utf-8')) : raw);
  }

  // 3. Claude trusts the folder, so nothing waits on a prompt.
  try {
    trustFolder(config, targetRoot, m.projectSettings);
    if (targetCwd !== targetRoot) trustFolder(config, targetCwd, m.projectSettings);
  } catch (err) {
    notes.push(`Could not mark the folder trusted for Claude: ${(err as Error).message}`);
  }

  // 4. Resume. The PTY is keyed by the session id, so opening the session in
  // the UI reattaches to it instead of starting a second process.
  let resumed = false;
  if (m.resume && !getPtySession(m.sessionId)) {
    const provider = getProvider('claude');
    const customPath = (config.aiProviders as Record<string, { customPath?: string }> | undefined)?.claude?.customPath;
    const args = [
      ...provider.resumeArgs(m.sessionId),
      ...permissionFlags(config),
    ];
    if (m.instruction) args.push(m.instruction);
    await spawnPty(m.sessionId, targetCwd, 120, 30, provider.exePath(customPath), args, 'claude');
    resumed = true;
  }

  return { manifest: m, result: { targetRoot, targetCwd, resumed, notes } };
}
