/**
 * Moving a project's code between Hives without pushing anything to a remote.
 *
 * Everything travels as ONE git bundle (a file, streamed — no size cap):
 *   - the current branch: only the commits past what the target already has,
 *     or the whole branch when it has nothing;
 *   - when the working tree has changes, a "snapshot" commit on top of HEAD
 *     holding the tree exactly as it is (tracked edits, deletions and
 *     untracked, non-ignored files). It is never put on a branch.
 *
 * The target checks out the same commit and makes its working tree equal to
 * the snapshot, so HEAD, branch and uncommitted changes all match the source.
 *
 * It never overwrites work it doesn't know about: a dirty target is only set
 * aside (git stash) when its content is exactly what this Hive last recorded
 * for that folder (see store.ts folder states), and an existing non-git folder
 * is only adopted when none of its files differ from the incoming ones.
 */
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_BUFFER = 256 * 1024 * 1024;

export class TransferError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Author for snapshot / first commits when the machine has no git identity. */
const IDENTITY = {
  GIT_AUTHOR_NAME: 'SI Hive',
  GIT_AUTHOR_EMAIL: 'si-hive@localhost',
  GIT_COMMITTER_NAME: 'SI Hive',
  GIT_COMMITTER_EMAIL: 'si-hive@localhost',
};

function git(cwd: string, args: string[], opts: { input?: Buffer; env?: Record<string, string> } = {}): Promise<Buffer> {
  // Project folders created by a service account are owned by someone else,
  // and git then refuses to touch them ("dubious ownership"). Hive works on
  // these folders deliberately, so trust exactly the one at hand.
  const trust = ['-c', `safe.directory=${path.resolve(cwd).replace(/\\/g, '/')}`];
  return new Promise((resolve, reject) => {
    const child = execFile('git', [...trust, ...args], {
      cwd,
      encoding: 'buffer',
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env },
    }, (err, stdout, stderr) => {
      if (err) {
        const msg = Buffer.isBuffer(stderr) ? stderr.toString('utf-8').trim() : '';
        reject(new Error(`git ${args[0]} failed: ${msg || err.message}`));
      } else {
        resolve(stdout as Buffer);
      }
    });
    if (opts.input) child.stdin?.end(opts.input);
  });
}

async function gitText(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
  return (await git(cwd, args, { env })).toString('utf-8').trim();
}

async function gitOk(cwd: string, args: string[]): Promise<boolean> {
  try { await git(cwd, args); return true; } catch { return false; }
}

function tmpFile(ext: string): string {
  return path.join(os.tmpdir(), `hive-transfer-${crypto.randomBytes(8).toString('hex')}${ext}`);
}

export interface RepoState {
  isRepo: boolean;
  /** Top of the working tree (the project root). */
  root: string;
  /** Null when detached. */
  branch: string | null;
  /** Null when the repo has no commits yet. */
  headSha: string | null;
  originUrl: string | null;
  /** The project's identity: its first commit (null with no commits). */
  rootCommit: string | null;
}

export async function repoState(dir: string): Promise<RepoState> {
  const none: RepoState = { isRepo: false, root: dir, branch: null, headSha: null, originUrl: null, rootCommit: null };
  if (!fs.existsSync(dir) || !(await gitOk(dir, ['rev-parse', '--is-inside-work-tree']))) return none;
  const root = path.resolve(await gitText(dir, ['rev-parse', '--show-toplevel']));
  const headSha = (await gitOk(root, ['rev-parse', '--verify', '-q', 'HEAD']))
    ? await gitText(root, ['rev-parse', 'HEAD'])
    : null;
  let branch: string | null = null;
  try { branch = await gitText(root, ['symbolic-ref', '--short', '-q', 'HEAD']) || null; } catch { /* detached */ }
  let originUrl: string | null = null;
  try { originUrl = await gitText(root, ['remote', 'get-url', 'origin']) || null; } catch { /* no origin */ }
  let rootCommit: string | null = null;
  if (headSha) {
    const roots = (await gitText(root, ['rev-list', '--max-parents=0', 'HEAD'])).split('\n').filter(Boolean).sort();
    rootCommit = roots[0] ?? null;
  }
  return { isRepo: true, root, branch, headSha, originUrl, rootCommit };
}

/** True when `dir` is the top of its own git repository (not a folder inside another one). */
export async function isRepoRoot(dir: string): Promise<boolean> {
  const s = await repoState(dir);
  return s.isRepo && path.resolve(s.root) === path.resolve(dir);
}

/** `git@host:org/repo.git` and `https://host/org/repo` compare equal. */
export function normalizeRemote(url: string | null | undefined): string | null {
  if (!url) return null;
  let u = url.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(u);
  if (scp) u = `${scp[1]}/${scp[2]}`;
  u = u.replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]+@/, '');
  return u.toLowerCase();
}

/** True when the working tree has any change, including untracked files. */
export async function isDirty(root: string): Promise<boolean> {
  return (await gitText(root, ['status', '--porcelain'])).length > 0;
}

export async function changedFiles(root: string): Promise<string[]> {
  return (await gitText(root, ['status', '--porcelain'])).split('\n').filter(Boolean);
}

/**
 * The tree git would commit for the working tree right now (tracked and
 * untracked files, minus ignored ones). Built in a throwaway index, seeded from
 * the real one so unchanged files aren't re-hashed. Equal trees = equal content.
 */
export async function worktreeTree(root: string): Promise<string> {
  const idx = tmpFile('.index');
  try {
    const real = path.resolve(root, await gitText(root, ['rev-parse', '--git-path', 'index']));
    if (fs.existsSync(real)) fs.copyFileSync(real, idx);
    const env = { GIT_INDEX_FILE: idx };
    await git(root, ['add', '-A'], { env });
    return await gitText(root, ['write-tree'], env);
  } finally {
    fs.rmSync(idx, { force: true });
  }
}

export async function headTree(root: string): Promise<string> {
  return gitText(root, ['rev-parse', 'HEAD^{tree}']);
}

/** Content fingerprint of a folder's working tree (its tree hash). */
export const fingerprint = worktreeTree;

/** What a transfer would carry, for the confirmation dialog. */
export async function summarize(root: string, haveHead: string | null): Promise<{ commits: number; modified: number; untracked: number }> {
  const lines = await changedFiles(root);
  const untracked = lines.filter((l) => l.startsWith('??')).length;
  let commits = 0;
  const known = haveHead && (await gitOk(root, ['cat-file', '-e', `${haveHead}^{commit}`]));
  try {
    commits = Number(await gitText(root, ['rev-list', '--count', known ? `${haveHead}..HEAD` : 'HEAD'])) || 0;
  } catch { /* no commits yet */ }
  return { commits, modified: lines.length - untracked, untracked };
}

export interface CodeInfo {
  branch: string | null;
  headSha: string | null;
  originUrl: string | null;
  rootCommit: string | null;
  /** Commit holding the dirty working tree (parent: headSha), or null when clean. */
  snapshot: string | null;
  /** Tree of the working tree as sent (recorded on both sides). */
  tree: string;
  /** False when the target already had everything. */
  hasBundle: boolean;
}

const SNAPSHOT_REF = 'refs/hive/snapshot';

/**
 * Bundle the repo at `root` for a target whose checkout is at `haveHead`
 * (null: it has nothing). Writes the bundle to `outFile` unless there is
 * nothing to send.
 */
export async function packRepo(root: string, haveHead: string | null, outFile: string): Promise<CodeInfo> {
  const state = await repoState(root);
  if (!state.isRepo) throw new TransferError(400, `${root} is not a git repository`);
  const tree = await worktreeTree(root);

  let snapshot: string | null = null;
  const headTree = state.headSha ? await gitText(root, ['rev-parse', `${state.headSha}^{tree}`]) : null;
  if (tree !== headTree) {
    const args = ['commit-tree', tree, '-m', 'SI Hive snapshot of uncommitted changes'];
    if (state.headSha) args.push('-p', state.headSha);
    snapshot = await gitText(root, args, IDENTITY);
  }

  const refs: string[] = [];
  if (state.headSha && state.headSha !== haveHead) refs.push(state.branch ? `refs/heads/${state.branch}` : 'HEAD');
  if (snapshot) {
    await git(root, ['update-ref', SNAPSHOT_REF, snapshot]);
    refs.push(SNAPSHOT_REF);
  }

  let hasBundle = false;
  try {
    if (refs.length > 0) {
      const exclude = haveHead && (await gitOk(root, ['cat-file', '-e', `${haveHead}^{commit}`])) ? [`^${haveHead}`] : [];
      try {
        await git(root, ['bundle', 'create', '-q', outFile, ...refs, ...exclude]);
        hasBundle = true;
      } catch (err) {
        // Everything is already on the other side.
        if (!/empty bundle/i.test((err as Error).message)) throw err;
      }
    }
  } finally {
    if (snapshot) await git(root, ['update-ref', '-d', SNAPSHOT_REF]).catch(() => {});
  }

  return {
    branch: state.branch,
    headSha: state.headSha,
    originUrl: state.originUrl,
    rootCommit: state.rootCommit,
    snapshot,
    tree,
    hasBundle,
  };
}

export interface TargetCheck {
  exists: boolean;
  isRepo: boolean;
  haveHead: string | null;
  rootCommit: string | null;
  dirty: boolean;
  /** Dirty, but exactly as this Hive last recorded it — safe to set aside. */
  dirtyIsOurs: boolean;
  /** An existing folder without git that would be adopted (checked file by file on arrival). */
  adopt: boolean;
}

export async function checkTarget(root: string, knownTrees: string[]): Promise<TargetCheck> {
  const base = { haveHead: null, rootCommit: null, dirty: false, dirtyIsOurs: false, adopt: false };
  if (!fs.existsSync(root)) return { exists: false, isRepo: false, ...base };
  if (!(await isRepoRoot(root))) {
    const empty = fs.readdirSync(root).length === 0;
    return { exists: true, isRepo: false, ...base, adopt: !empty };
  }
  const state = await repoState(root);
  const dirty = await isDirty(root);
  const dirtyIsOurs = dirty && knownTrees.includes(await worktreeTree(root));
  return { exists: true, isRepo: true, haveHead: state.headSha, rootCommit: state.rootCommit, dirty, dirtyIsOurs, adopt: false };
}

/** Why a code transfer into `root` would be refused, or null. Runs before anything is stopped. */
export function refusal(root: string, check: TargetCheck, incomingRoot: string | null): string | null {
  if (check.isRepo && check.rootCommit && incomingRoot && check.rootCommit !== incomingRoot) {
    return `${root} on this Hive is a different git repository (its history doesn't match). Rename or move it first.`;
  }
  if (check.dirty && !check.dirtyIsOurs) {
    return `${root} has uncommitted changes on this Hive that would be overwritten. Commit, stash or sync them first.`;
  }
  return null;
}

async function fetchBundle(root: string, bundle: string, code: CodeInfo): Promise<void> {
  const heads = (await gitText(root, ['bundle', 'list-heads', bundle])).split('\n')
    .map((l) => l.split(' ')[1]).filter(Boolean);
  const refspecs = heads
    .filter((h) => h === SNAPSHOT_REF || h === 'HEAD' || h.startsWith('refs/heads/'))
    .map((h) => `+${h}:refs/hive/incoming/${h === 'HEAD' ? 'HEAD' : h.replace(/^refs\//, '')}`);
  if (refspecs.length > 0) await git(root, ['fetch', '-q', '--no-tags', bundle, ...refspecs]);
  for (const sha of [code.headSha, code.snapshot]) {
    if (sha && !(await gitOk(root, ['cat-file', '-e', `${sha}^{commit}`]))) {
      throw new TransferError(409, `Commit ${sha.slice(0, 10)} did not arrive. Try again.`);
    }
  }
}

async function dropIncomingRefs(root: string): Promise<void> {
  const refs = (await gitText(root, ['for-each-ref', '--format=%(refname)', 'refs/hive/incoming']).catch(() => ''))
    .split('\n').filter(Boolean);
  for (const r of refs) await git(root, ['update-ref', '-d', r]).catch(() => {});
}

/** Make the working tree equal to `snapshot`'s tree, leaving HEAD and the index alone. */
async function restoreWorktree(root: string, snapshot: string): Promise<void> {
  // --no-overlay (restore's default) also deletes files the snapshot doesn't have.
  await git(root, ['restore', `--source=${snapshot}`, '--worktree', '--', ':/']);
}

/**
 * Adopt an existing folder without git as the incoming repository, in place.
 * Every file the incoming tree has must be identical here or missing (missing
 * ones are written); files only here stay, as untracked. Refuses otherwise.
 */
export interface ApplyOptions {
  /**
   * Adopting a plain folder whose files differ: copy this machine's versions
   * here first, then replace them. Without it, differing files refuse.
   */
  backupDir?: string;
}

/** Same text apart from line endings (CRLF on disk vs LF in the repo is not a real difference). */
function sameIgnoringCr(a: Buffer, b: Buffer): boolean {
  if (a.equals(b)) return true;
  const strip = (x: Buffer) => Buffer.from(x.filter((c) => c !== 13));
  return strip(a).equals(strip(b));
}

async function adoptFolder(root: string, bundle: string | null, code: CodeInfo, opts: ApplyOptions = {}): Promise<string[]> {
  if (!bundle || !code.headSha) throw new TransferError(409, `${root} exists on this Hive and nothing was sent to compare it with.`);
  await git(root, ['init', '-q']);
  try {
    if (code.originUrl) await git(root, ['remote', 'add', 'origin', code.originUrl]);
    await fetchBundle(root, bundle, code);
    const desired = code.snapshot ?? code.headSha;

    // Compare the folder with the incoming tree through a throwaway index.
    const idx = tmpFile('.index');
    let conflicts: string[] = [];
    try {
      const env = { GIT_INDEX_FILE: idx };
      await git(root, ['read-tree', desired], { env });
      // A fresh index has no stat info, so every file looks changed until refreshed
      // (which re-hashes content). It exits non-zero while differences remain.
      await git(root, ['update-index', '-q', '--refresh'], { env }).catch(() => {});
      const out = await gitText(root, ['diff-files', '--name-status'], env);
      conflicts = out.split('\n').filter((l) => l.startsWith('M')).map((l) => l.slice(1).trim());
    } finally {
      fs.rmSync(idx, { force: true });
    }
    // A file that differs only in line endings is the same file.
    const real: string[] = [];
    for (const rel of conflicts) {
      try {
        const incoming = await git(root, ['cat-file', 'blob', `${desired}:${rel}`]);
        if (!sameIgnoringCr(fs.readFileSync(path.join(root, rel)), incoming)) real.push(rel);
      } catch {
        real.push(rel);
      }
    }
    const notes: string[] = [];
    if (real.length > 0) {
      if (!opts.backupDir) {
        throw new TransferError(409,
          `${root} already exists on this Hive without git, and ${real.length} file(s) differ from the incoming version:\n` +
          `${real.slice(0, 15).join('\n')}${real.length > 15 ? '\n…' : ''}\n` +
          'Make the copies match, or replace them (their current versions are kept in a backup folder).');
      }
      for (const rel of real) {
        const dest = path.join(opts.backupDir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(root, rel), dest);
      }
      notes.push(`${real.length} differing file(s) were replaced; the previous versions are in ${opts.backupDir}.`);
    }

    if (code.branch) {
      await git(root, ['update-ref', `refs/heads/${code.branch}`, code.headSha]);
      await git(root, ['symbolic-ref', 'HEAD', `refs/heads/${code.branch}`]);
    } else {
      await git(root, ['update-ref', '--no-deref', 'HEAD', code.headSha]);
    }
    await git(root, ['read-tree', code.headSha]);
    // Write the files this folder was missing (the others are already identical).
    await restoreWorktree(root, code.snapshot ?? code.headSha);
    await dropIncomingRefs(root);
    return [`${root} was already here without git; it is now the same repository, with your files kept.`, ...notes];
  } catch (err) {
    fs.rmSync(path.join(root, '.git'), { recursive: true, force: true });
    throw err;
  }
}

/**
 * Bring `root` to the source's exact state (branch, commit, working tree).
 * `bundle` is null when the target already had every commit and the tree was clean.
 */
export async function applyRepo(root: string, bundle: string | null, code: CodeInfo, knownTrees: string[], opts: ApplyOptions = {}): Promise<string[]> {
  const notes: string[] = [];
  const check = await checkTarget(root, knownTrees);

  if (check.adopt) return adoptFolder(root, bundle, code, opts);

  const why = refusal(root, check, code.rootCommit);
  if (why) {
    const status = check.dirty ? (await changedFiles(root)).slice(0, 15).join('\n') : '';
    throw new TransferError(409, status ? `${why}\n${status}` : why);
  }

  if (!check.exists || !check.isRepo) {
    fs.mkdirSync(root, { recursive: true });
    await git(root, ['init', '-q']);
    if (code.originUrl) await git(root, ['remote', 'add', 'origin', code.originUrl]);
  }

  if (check.dirty) {
    await git(root, ['stash', 'push', '--include-untracked', '-m', `SI Hive sync backup ${new Date().toISOString()}`]);
    notes.push('Changes left here by the previous transfer were saved with git stash.');
  }

  try {
    if (bundle) await fetchBundle(root, bundle, code);

    if (code.headSha) {
      if (code.branch) {
        // Never move a branch backwards or sideways: its own commits would be orphaned.
        const local = await gitText(root, ['rev-parse', '--verify', '-q', `refs/heads/${code.branch}`]).catch(() => '');
        if (local && local !== code.headSha && !(await gitOk(root, ['merge-base', '--is-ancestor', local, code.headSha]))) {
          throw new TransferError(409,
            `Branch ${code.branch} on this Hive has commits the incoming copy doesn't (${local.slice(0, 10)}). Sync the other way first, or merge.`);
        }
        await git(root, ['checkout', '-q', '-B', code.branch, code.headSha]);
      } else {
        await git(root, ['checkout', '-q', '--detach', code.headSha]);
      }
    }

    if (code.snapshot) {
      if (code.headSha) await restoreWorktree(root, code.snapshot);
      else await git(root, ['checkout', '-q', code.snapshot, '--', '.']).then(() => git(root, ['rm', '-q', '-r', '--cached', '.']));
    }
  } finally {
    await dropIncomingRefs(root);
  }
  return notes;
}

const STANDARD_IGNORES = [
  'node_modules/', '.venv/', 'venv/', '__pycache__/', '.next/', '.env', '.env.*', '!.env.example',
];

/**
 * Turn a plain folder into a local git repository: standard ignores (added to
 * any existing .gitignore), then a first commit of everything.
 */
export async function initRepo(dir: string): Promise<{ commit: string; files: number }> {
  if (!fs.existsSync(dir)) throw new TransferError(404, `${dir} does not exist`);
  if (await isRepoRoot(dir)) throw new TransferError(409, `${dir} is already a git repository`);
  const ignorePath = path.join(dir, '.gitignore');
  const existing = fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, 'utf-8') : '';
  const have = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = STANDARD_IGNORES.filter((l) => !have.has(l) && !have.has(l.replace(/\/$/, '')));
  if (missing.length > 0) {
    const sep = existing && !existing.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(ignorePath, `${existing}${sep}${existing ? '\n' : ''}# Added by SI Hive\n${missing.join('\n')}\n`);
  }
  await git(dir, ['init', '-q']);
  try {
    await git(dir, ['add', '-A']);
    const files = (await gitText(dir, ['ls-files'])).split('\n').filter(Boolean).length;
    const hasIdentity = await gitOk(dir, ['config', 'user.email']);
    await git(dir, ['commit', '-q', '-m', 'Initial commit (made by SI Hive)'], { env: hasIdentity ? {} : IDENTITY });
    return { commit: await gitText(dir, ['rev-parse', 'HEAD']), files };
  } catch (err) {
    fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true });
    throw err;
  }
}

/** Is `sha` contained in the history of HEAD here? */
export async function headContains(root: string, sha: string): Promise<boolean> {
  return (await gitOk(root, ['cat-file', '-e', `${sha}^{commit}`])) && gitOk(root, ['merge-base', '--is-ancestor', sha, 'HEAD']);
}

/** Tracked files over `limit` bytes in the working tree (GitHub rejects files over 100 MB). */
export async function largeFiles(root: string, limit = 100 * 1024 * 1024): Promise<string[]> {
  const files = (await gitText(root, ['ls-files', '-z']).catch(() => '')).split('\0').filter(Boolean);
  return files.filter((f) => {
    try { return fs.statSync(path.join(root, f)).size > limit; } catch { return false; }
  });
}

export { tmpFile };
