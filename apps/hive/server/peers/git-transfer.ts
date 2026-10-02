/**
 * Moving a project's code between Hives without pushing anything to a remote.
 *
 * The source packs:
 *   - a git bundle of the current branch — only the commits past what the
 *     target already has, or the full branch when it has nothing;
 *   - `git diff --binary HEAD` (staged + unstaged changes to tracked files);
 *   - untracked, non-ignored files (`node_modules`, `.env` etc. stay behind).
 *
 * The target fetches the bundle, checks out the same commit and re-applies
 * the changes. It never overwrites local work it doesn't know: a dirty tree
 * is only set aside (git stash) when it is exactly the state this Hive
 * recorded when a session last left that folder.
 */
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_BUFFER = 512 * 1024 * 1024;

export class TransferError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function git(cwd: string, args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, {
      cwd,
      encoding: 'buffer',
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (err, stdout, stderr) => {
      if (err) {
        const msg = Buffer.isBuffer(stderr) ? stderr.toString('utf-8').trim() : '';
        reject(new Error(`git ${args[0]} failed: ${msg || err.message}`));
      } else {
        resolve(stdout as Buffer);
      }
    });
    if (input) child.stdin?.end(input);
  });
}

async function gitText(cwd: string, args: string[]): Promise<string> {
  return (await git(cwd, args)).toString('utf-8').trim();
}

async function gitOk(cwd: string, args: string[]): Promise<boolean> {
  try { await git(cwd, args); return true; } catch { return false; }
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
}

export async function repoState(dir: string): Promise<RepoState> {
  if (!fs.existsSync(dir) || !(await gitOk(dir, ['rev-parse', '--is-inside-work-tree']))) {
    return { isRepo: false, root: dir, branch: null, headSha: null, originUrl: null };
  }
  const root = path.resolve(await gitText(dir, ['rev-parse', '--show-toplevel']));
  const headSha = (await gitOk(root, ['rev-parse', '--verify', '-q', 'HEAD']))
    ? await gitText(root, ['rev-parse', 'HEAD'])
    : null;
  let branch: string | null = null;
  try { branch = await gitText(root, ['symbolic-ref', '--short', '-q', 'HEAD']) || null; } catch { /* detached */ }
  let originUrl: string | null = null;
  try { originUrl = await gitText(root, ['remote', 'get-url', 'origin']) || null; } catch { /* no origin */ }
  return { isRepo: true, root, branch, headSha, originUrl };
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

async function untrackedFiles(root: string): Promise<string[]> {
  const out = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  return out.toString('utf-8').split('\0').filter(Boolean);
}

/** True when the working tree has any change, including untracked files. */
export async function isDirty(root: string): Promise<boolean> {
  return (await gitText(root, ['status', '--porcelain'])).length > 0;
}

/**
 * A hash of the working tree's content relative to HEAD. Equal fingerprints
 * mean nobody touched the folder in between.
 */
export async function fingerprint(root: string): Promise<string> {
  const h = crypto.createHash('sha256');
  h.update((await gitText(root, ['rev-parse', '--verify', '-q', 'HEAD']).catch(() => '')) + '\n');
  h.update(await git(root, ['diff', '--binary', 'HEAD']).catch(() => Buffer.alloc(0)));
  for (const f of (await untrackedFiles(root)).sort()) {
    h.update(`\0${f}\0`);
    try { h.update(fs.readFileSync(path.join(root, f))); } catch { /* vanished */ }
  }
  return h.digest('hex');
}

export interface CodePayload {
  branch: string | null;
  headSha: string | null;
  originUrl: string | null;
  /** Absent when the target already has headSha. */
  bundle?: Buffer;
  patch: Buffer;
  untracked: Array<{ rel: string; data: Buffer }>;
}

/**
 * Pack the repo at `root` for a target whose checkout is at `haveHead`
 * (null: it has nothing, send the whole branch).
 */
export async function packRepo(root: string, haveHead: string | null, maxBytes: number): Promise<CodePayload> {
  const state = await repoState(root);
  if (!state.isRepo) throw new TransferError(400, `${root} is not a git repository`);
  let total = 0;
  const count = (n: number) => {
    total += n;
    if (total > maxBytes) {
      throw new TransferError(413,
        `The project is over ${Math.round(maxBytes / 1024 / 1024)} MB to send. Clone it on the other Hive first; then only new commits are sent.`);
    }
  };

  let bundle: Buffer | undefined;
  if (state.headSha && state.headSha !== haveHead) {
    const tip = state.branch ? `refs/heads/${state.branch}` : 'HEAD';
    const range = [tip];
    if (haveHead && (await gitOk(root, ['cat-file', '-e', `${haveHead}^{commit}`]))) range.push(`^${haveHead}`);
    const tmp = path.join(os.tmpdir(), `hive-handoff-${crypto.randomBytes(6).toString('hex')}.bundle`);
    try {
      await git(root, ['bundle', 'create', tmp, ...range]);
      bundle = fs.readFileSync(tmp);
      count(bundle.length);
    } catch (err) {
      // The target's head is ahead of / unrelated to ours: nothing new to send.
      if (!/empty bundle/i.test((err as Error).message)) throw err;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  const patch = state.headSha ? await git(root, ['diff', '--binary', 'HEAD']) : Buffer.alloc(0);
  count(patch.length);

  const untracked: CodePayload['untracked'] = [];
  for (const rel of await untrackedFiles(root)) {
    const full = path.join(root, rel);
    try {
      if (!fs.statSync(full).isFile()) continue;
      const data = fs.readFileSync(full);
      count(data.length);
      untracked.push({ rel, data });
    } catch (err) {
      if (err instanceof TransferError) throw err;
    }
  }

  return { branch: state.branch, headSha: state.headSha, originUrl: state.originUrl, bundle, patch, untracked };
}

/** What a handoff would carry, for the confirmation dialog. */
export async function summarize(root: string, haveHead: string | null): Promise<{ commits: number; modified: number; untracked: number }> {
  const lines = (await gitText(root, ['status', '--porcelain'])).split('\n').filter(Boolean);
  const untracked = lines.filter((l) => l.startsWith('??')).length;
  let commits = 0;
  const known = haveHead && (await gitOk(root, ['cat-file', '-e', `${haveHead}^{commit}`]));
  try {
    commits = Number(await gitText(root, ['rev-list', '--count', known ? `${haveHead}..HEAD` : 'HEAD'])) || 0;
  } catch { /* no commits yet */ }
  return { commits, modified: lines.length - untracked, untracked };
}

export interface TargetCheck {
  exists: boolean;
  isRepo: boolean;
  haveHead: string | null;
  dirty: boolean;
  /** Dirty, but exactly as this Hive left it — safe to set aside. */
  dirtyIsOurs: boolean;
}

export async function checkTarget(root: string, knownFingerprints: string[]): Promise<TargetCheck> {
  if (!fs.existsSync(root)) return { exists: false, isRepo: false, haveHead: null, dirty: false, dirtyIsOurs: false };
  const state = await repoState(root);
  if (!state.isRepo || path.resolve(state.root) !== path.resolve(root)) {
    const empty = fs.readdirSync(root).length === 0;
    return { exists: true, isRepo: false, haveHead: null, dirty: !empty, dirtyIsOurs: false };
  }
  const dirty = await isDirty(root);
  const dirtyIsOurs = dirty && knownFingerprints.includes(await fingerprint(root));
  return { exists: true, isRepo: true, haveHead: state.headSha, dirty, dirtyIsOurs };
}

function safeJoin(root: string, rel: string): string {
  const full = path.resolve(root, rel);
  const r = path.resolve(root);
  if (full !== r && !full.startsWith(r + path.sep)) throw new TransferError(400, `Refusing path outside the project: ${rel}`);
  return full;
}

/** Bring `root` to the source's exact state. Returns notes for the user. */
export async function applyRepo(root: string, payload: CodePayload, knownFingerprints: string[]): Promise<string[]> {
  const notes: string[] = [];
  const check = await checkTarget(root, knownFingerprints);

  if (check.exists && !check.isRepo && check.dirty) {
    throw new TransferError(409, `${root} already exists on this Hive and is not the same git repository. Move it aside and try again.`);
  }
  if (!check.exists || !check.isRepo) {
    fs.mkdirSync(root, { recursive: true });
    await git(root, ['init', '-q']);
    if (payload.originUrl) await git(root, ['remote', 'add', 'origin', payload.originUrl]);
  }

  if (check.dirty) {
    if (!check.dirtyIsOurs) {
      const status = await gitText(root, ['status', '--short']);
      throw new TransferError(409,
        `${root} has local changes on this Hive that would be overwritten:\n${status.split('\n').slice(0, 15).join('\n')}\nCommit or stash them first.`);
    }
    await git(root, ['stash', 'push', '--include-untracked', '-m', `SI Hive handoff backup ${new Date().toISOString()}`]);
    notes.push('Changes left here by the previous handoff were saved with git stash.');
  }

  if (payload.bundle) {
    const tmp = path.join(os.tmpdir(), `hive-handoff-${crypto.randomBytes(6).toString('hex')}.bundle`);
    fs.writeFileSync(tmp, payload.bundle);
    try {
      const ref = payload.branch ? `refs/heads/${payload.branch}` : 'HEAD';
      await git(root, ['fetch', '-q', '--no-tags', tmp, ref]);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  if (payload.headSha) {
    if (!(await gitOk(root, ['cat-file', '-e', `${payload.headSha}^{commit}`]))) {
      throw new TransferError(409, `Commit ${payload.headSha.slice(0, 10)} did not arrive. Try again.`);
    }
    if (payload.branch) {
      // Never move a branch backwards or sideways: its own commits would be orphaned.
      const local = await gitText(root, ['rev-parse', '--verify', '-q', `refs/heads/${payload.branch}`]).catch(() => '');
      if (local && local !== payload.headSha && !(await gitOk(root, ['merge-base', '--is-ancestor', local, payload.headSha]))) {
        throw new TransferError(409,
          `Branch ${payload.branch} on this Hive has commits the incoming session doesn't (${local.slice(0, 10)}). Push or rename that branch first.`);
      }
      await git(root, ['checkout', '-q', '-B', payload.branch, payload.headSha]);
    } else {
      await git(root, ['checkout', '-q', '--detach', payload.headSha]);
    }
  }

  if (payload.patch.length > 0) {
    try {
      await git(root, ['apply', '--binary', '--whitespace=nowarn', '-'], payload.patch);
    } catch (err) {
      throw new TransferError(409, `Could not apply the uncommitted changes: ${(err as Error).message}`);
    }
  }

  for (const f of payload.untracked) {
    const full = safeJoin(root, f.rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, f.data);
  }
  return notes;
}
