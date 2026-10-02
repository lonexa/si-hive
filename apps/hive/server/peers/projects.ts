/**
 * Projects as seen by peer sync: which folders this Hive has, what state each
 * is in, and where an incoming project belongs.
 *
 * A git project's identity is its first commit, so the same project is
 * recognised on both machines whether or not it has a remote. A folder without
 * git is matched by name only.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { HiveConfig } from '../types.js';
import { isWindows } from '../platform.js';
import { livePtysUnder } from '../terminal-pty.js';
import {
  TransferError, applyRepo, changedFiles, checkTarget, headTree, isRepoRoot, largeFiles, normalizeRemote, refusal, repoState, worktreeTree,
  type CodeInfo, type TargetCheck,
} from './git-transfer.js';
import { fingerprintsFor, linkProject, linkedRoot, previousRoot, recordFolderState } from './store.js';

export interface LocalProject {
  name: string;
  path: string;
  isGit: boolean;
  rootCommit: string | null;
  branch: string | null;
  headSha: string | null;
  originUrl: string | null;
  /** Number of uncommitted changes (incl. untracked files). */
  changes: number;
  /** Tree hash of the working tree's content (equal on two machines = same files). */
  tree: string | null;
  lastCommitAt: string | null;
  /** A terminal / agent session is running in it right now. */
  busy: boolean;
}

export interface ProjectIdentity {
  name: string;
  originUrl: string | null;
  rootCommit: string | null;
}

const norm = (p: string) => {
  const r = path.resolve(p).replace(/[\\/]+$/, '');
  return isWindows ? r.toLowerCase() : r;
};

/** Project folders: everything directly under the projects roots, plus explicitly added projects. */
export function projectFolders(config: HiveConfig): string[] {
  const out = new Map<string, string>();
  const add = (p: string) => { if (p && fs.existsSync(p)) out.set(norm(p), path.resolve(p)); };
  for (const root of [config.projectsRoot, ...(config.projectRoots ?? [])]) {
    if (!root || !fs.existsSync(root)) continue;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) add(path.join(root, e.name));
    }
  }
  for (const p of config.projects ?? []) add(p.path);
  return [...out.values()];
}

export async function describeProject(dir: string): Promise<LocalProject> {
  const name = path.basename(dir);
  const busy = livePtysUnder(dir).length > 0;
  if (!(await isRepoRoot(dir))) {
    return { name, path: dir, isGit: false, rootCommit: null, branch: null, headSha: null, originUrl: null, changes: 0, tree: null, lastCommitAt: null, busy };
  }
  const s = await repoState(dir);
  let lastCommitAt: string | null = null;
  if (s.headSha) {
    try {
      const { execFileSync } = await import('node:child_process');
      lastCommitAt = execFileSync('git', ['log', '-1', '--format=%cI'], { cwd: dir, encoding: 'utf-8', windowsHide: true }).trim() || null;
    } catch { /* ignore */ }
  }
  const changes = (await changedFiles(dir)).length;
  let tree: string | null = null;
  try {
    tree = changes > 0 ? await worktreeTree(dir) : s.headSha ? (await headTree(dir)) : null;
  } catch { /* leave unknown */ }
  return {
    name,
    path: dir,
    isGit: true,
    tree,
    rootCommit: s.rootCommit,
    branch: s.branch,
    headSha: s.headSha,
    originUrl: s.originUrl,
    changes,
    lastCommitAt,
    busy,
  };
}

export async function listProjects(config: HiveConfig): Promise<LocalProject[]> {
  const folders = projectFolders(config);
  const out: LocalProject[] = [];
  // A few at a time: each one runs several git commands.
  for (let i = 0; i < folders.length; i += 6) {
    out.push(...await Promise.all(folders.slice(i, i + 6).map((f) => describeProject(f).catch(() => null))).then((r) => r.filter((x): x is LocalProject => !!x)));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Where a project belongs on this Hive. Validation (unrelated repo, local changes) happens in prepare. */
export async function resolveTargetRoot(config: HiveConfig, id: ProjectIdentity & { sessionId?: string }): Promise<string> {
  if (id.sessionId) {
    const prev = previousRoot(id.sessionId);
    if (prev && fs.existsSync(prev)) return prev;
  }
  if (id.rootCommit) {
    const linked = linkedRoot(id.rootCommit);
    if (linked && fs.existsSync(linked) && (await repoState(linked)).rootCommit === id.rootCommit) return linked;
  }

  const projects = await listProjects(config);
  const byName = (list: LocalProject[]) => list.find((p) => p.name === id.name) ?? list[0];
  if (id.rootCommit) {
    const same = projects.filter((p) => p.rootCommit === id.rootCommit);
    if (same.length) return byName(same).path;
  }
  const remote = normalizeRemote(id.originUrl);
  if (remote) {
    const same = projects.filter((p) => normalizeRemote(p.originUrl) === remote);
    if (same.length) return byName(same).path;
  }

  if (!config.projectsRoot) {
    throw new TransferError(409, 'This Hive has no projects folder. Set one in Settings → General.');
  }
  const safe = id.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-') || 'project';
  return path.join(config.projectsRoot, safe);
}

export interface PreparedTarget extends TargetCheck {
  targetRoot: string;
  busy: boolean;
}

/**
 * What would happen to this project here — asked before the sender stops or
 * packs anything. Throws when the transfer would be refused.
 * `ownSessionId`: a session handoff stops its own terminal, so that one doesn't count as busy.
 */
export async function prepareTarget(
  config: HiveConfig,
  id: ProjectIdentity & { sessionId?: string },
  ownTerminals: string[] = [],
): Promise<PreparedTarget> {
  const targetRoot = await resolveTargetRoot(config, id);
  const check = await checkTarget(targetRoot, fingerprintsFor(targetRoot));
  const why = refusal(targetRoot, check, id.rootCommit);
  if (why) throw new TransferError(409, why);
  const busy = fs.existsSync(targetRoot) && livePtysUnder(targetRoot).some((t) => !ownTerminals.includes(t) && !(id.sessionId && t.includes(id.sessionId)));
  return { ...check, targetRoot, busy };
}

/** Apply incoming code to `targetRoot` and remember the result. */
export async function receiveCode(
  targetRoot: string, bundlePath: string | null, code: CodeInfo, ownSessionId?: string, opts: { replaceDiffering?: boolean } = {},
): Promise<string[]> {
  const others = fs.existsSync(targetRoot)
    ? livePtysUnder(targetRoot).filter((t) => !(ownSessionId && t.includes(ownSessionId)))
    : [];
  if (others.length > 0) {
    throw new TransferError(409, `A terminal or session is running in ${targetRoot} on this Hive. Close it there first.`);
  }
  const backupDir = opts.replaceDiffering
    ? path.join(path.dirname(targetRoot), '.hive-backups', `${path.basename(targetRoot)}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
    : undefined;
  const notes = await applyRepo(targetRoot, bundlePath, code, fingerprintsFor(targetRoot), { backupDir });
  recordFolderState(targetRoot, code.tree);
  if (code.rootCommit) linkProject(code.rootCommit, targetRoot);
  return notes;
}

/** After code left this folder successfully. */
export function codeSent(root: string, code: CodeInfo): void {
  recordFolderState(root, code.tree);
  if (code.rootCommit) linkProject(code.rootCommit, root);
}

/** A note when a project with a GitHub remote tracks files GitHub would reject. */
export async function githubSizeNote(root: string, originUrl: string | null): Promise<string | null> {
  if (!originUrl || !/github\.com/i.test(originUrl)) return null;
  const big = await largeFiles(root);
  if (big.length === 0) return null;
  return `${big.length} file(s) over 100 MB are tracked here (${big.slice(0, 3).join(', ')}${big.length > 3 ? ', …' : ''}). They sync between your Hives, but GitHub will reject a push of them.`;
}
