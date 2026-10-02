import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { useTempHiveHome } from '../../../../packages/shared/src/test-utils/hive-home.js';

useTempHiveHome();

const { encodeClaudeProjectDir } = await import('../claude-paths.js');
const { TranscriptRewriter } = await import('../peers/transcript-rewrite.js');
const gt = await import('../peers/git-transfer.js');
const { createPeerToken, revokePeerToken, verifyPeerRequest } = await import('../peers/auth.js');
const { normalizePeerUrl } = await import('../peers/config.js');

describe('encodeClaudeProjectDir', () => {
  it('flattens every non-alphanumeric character, like Claude Code', () => {
    expect(encodeClaudeProjectDir('D:\\work\\jane.doe\\My Projects\\app_1'))
      .toBe('D--work-jane-doe-My-Projects-app-1');
    expect(encodeClaudeProjectDir('/srv/u/my-app/x.y z')).toBe('-srv-u-my-app-x-y-z');
  });
});

describe('TranscriptRewriter (Windows → Linux)', () => {
  const rw = new TranscriptRewriter(
    { root: 'D:\\work\\Code projects\\app', windows: true },
    { root: '/srv/team/projects/app', windows: false },
  );

  it('rewrites cwd and tool paths in a JSONL line', () => {
    const line = JSON.stringify({
      cwd: 'D:\\work\\Code projects\\app',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: 'D:\\work\\Code projects\\app\\src\\index.ts' } },
          { type: 'text', text: 'see d:/work/Code projects/app/README.md and D:\\work\\Code projects\\app.' },
        ],
      },
    });
    const out = JSON.parse(rw.rewriteLine(line));
    expect(out.cwd).toBe('/srv/team/projects/app');
    expect(out.message.content[0].input.file_path).toBe('/srv/team/projects/app/src/index.ts');
    expect(out.message.content[1].text).toBe('see /srv/team/projects/app/README.md and /srv/team/projects/app.');
  });

  it('handles JSON echoed inside text (doubled backslashes)', () => {
    const text = '{"path":"D:\\\\work\\\\Code projects\\\\app\\\\pkg\\\\a.json"}';
    expect(rw.rewriteString(text)).toBe('{"path":"/srv/team/projects/app/pkg/a.json"}');
  });

  it('leaves sibling folders and unrelated lines alone', () => {
    expect(rw.rewriteString('D:\\work\\Code projects\\app2\\x')).toBe('D:\\work\\Code projects\\app2\\x');
    const untouched = '{"type":"summary","summary":"nothing here"}';
    expect(rw.rewriteLine(untouched)).toBe(untouched);
  });
});

describe('TranscriptRewriter (Linux → Windows)', () => {
  it('converts separators after the root', () => {
    const rw = new TranscriptRewriter(
      { root: '/srv/team/projects/app', windows: false },
      { root: 'C:\\work\\app', windows: true },
    );
    expect(rw.rewriteString('/srv/team/projects/app/src/a.ts')).toBe('C:\\work\\app\\src\\a.ts');
  });
});

/** File text with line endings normalized (the target may use core.autocrlf). */
function text(p: string): string {
  return fs.readFileSync(p, 'utf-8').replace(/\r\n/g, '\n');
}

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function newRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-src-'));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 't@example.com');
  sh(dir, 'config', 'user.name', 'T');
  sh(dir, 'config', 'core.autocrlf', 'false');
  return dir;
}

describe('git transfer', () => {
  let src: string;
  beforeAll(() => {
    src = newRepo();
    fs.writeFileSync(path.join(src, 'a.txt'), 'one\n');
    fs.writeFileSync(path.join(src, '.gitignore'), 'node_modules/\n');
    sh(src, 'add', '.');
    sh(src, 'commit', '-q', '-m', 'first');
    fs.writeFileSync(path.join(src, 'a.txt'), 'one\ntwo\n');           // modified
    fs.mkdirSync(path.join(src, 'new'));
    fs.writeFileSync(path.join(src, 'new', 'b.txt'), 'untracked\n');  // untracked
    fs.mkdirSync(path.join(src, 'node_modules'));
    fs.writeFileSync(path.join(src, 'node_modules', 'big.js'), 'ignored');
  });

  const bundleFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'peer-bundle-')), 'x.bundle');
  const destDir = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'peer-dst-')), 'app');

  async function send(from: string, to: string, known: string[] = []) {
    const b = bundleFile();
    const have = fs.existsSync(to) ? (await gt.repoState(to)).headSha : null;
    const code = await gt.packRepo(from, have, b);
    const notes = await gt.applyRepo(to, code.hasBundle ? b : null, code, known);
    return { code, notes };
  }

  it('round-trips commits, uncommitted and untracked changes into an empty folder', async () => {
    const dest = destDir();
    const { code } = await send(src, dest);
    expect(code.hasBundle).toBe(true);
    expect(code.snapshot).toBeTruthy();
    expect(text(path.join(dest, 'a.txt'))).toBe('one\ntwo\n');
    expect(text(path.join(dest, 'new', 'b.txt'))).toBe('untracked\n');
    expect(fs.existsSync(path.join(dest, 'node_modules'))).toBe(false);
    expect(sh(dest, 'rev-parse', 'HEAD')).toBe(sh(src, 'rev-parse', 'HEAD'));
    expect(sh(dest, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
    // Uncommitted stays uncommitted, untracked stays untracked.
    expect(sh(dest, 'status', '--porcelain').split('\n').map((l) => l.trim()).sort()).toEqual(['?? new/', 'M a.txt']);
    // Same content, so the fingerprints agree.
    expect(await gt.fingerprint(dest)).toBe(await gt.fingerprint(src));
    expect(sh(dest, 'for-each-ref', 'refs/hive')).toBe('');
  });

  it('sends nothing when the target already has everything', async () => {
    const clean = newRepo();
    fs.writeFileSync(path.join(clean, 'x.txt'), 'x\n');
    sh(clean, 'add', '.');
    sh(clean, 'commit', '-q', '-m', 'x');
    const code = await gt.packRepo(clean, sh(clean, 'rev-parse', 'HEAD'), bundleFile());
    expect(code.hasBundle).toBe(false);
    expect(code.snapshot).toBeNull();
  });

  it('sends only new commits, and carries deletions', async () => {
    const a = newRepo();
    fs.writeFileSync(path.join(a, 'keep.txt'), 'k\n');
    fs.writeFileSync(path.join(a, 'gone.txt'), 'g\n');
    sh(a, 'add', '.');
    sh(a, 'commit', '-q', '-m', 'one');
    const dest = destDir();
    await send(a, dest);

    fs.writeFileSync(path.join(a, 'keep.txt'), 'k2\n');
    sh(a, 'commit', '-q', '-am', 'two');
    fs.rmSync(path.join(a, 'gone.txt'));                    // uncommitted deletion
    const { code } = await send(a, dest, []);
    expect(code.hasBundle).toBe(true);
    expect(sh(dest, 'rev-parse', 'HEAD')).toBe(sh(a, 'rev-parse', 'HEAD'));
    expect(text(path.join(dest, 'keep.txt'))).toBe('k2\n');
    expect(fs.existsSync(path.join(dest, 'gone.txt'))).toBe(false);
  });

  it('refuses to overwrite unknown local changes, but sets aside its own', async () => {
    const dest = destDir();
    await send(src, dest);
    fs.writeFileSync(path.join(dest, 'a.txt'), 'someone else edited this\n');
    await expect(send(src, dest)).rejects.toThrow(/uncommitted changes/);

    // Exactly the state this Hive recorded last time: stash and proceed.
    const fp = await gt.fingerprint(dest);
    const { notes } = await send(src, dest, [fp]);
    expect(notes.join(' ')).toMatch(/stash/);
    expect(text(path.join(dest, 'a.txt'))).toBe('one\ntwo\n');
  });

  it('adopts an existing plain folder whose files match, keeping extra files', async () => {
    const dest = destDir();
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'a.txt'), 'one\ntwo\n');     // same as source
    fs.writeFileSync(path.join(dest, 'local-only.txt'), 'mine\n'); // only here
    const { notes } = await send(src, dest);
    expect(notes.join(' ')).toMatch(/same repository/);
    expect(sh(dest, 'rev-parse', 'HEAD')).toBe(sh(src, 'rev-parse', 'HEAD'));
    expect(text(path.join(dest, 'new', 'b.txt'))).toBe('untracked\n');  // missing file written
    expect(text(path.join(dest, 'local-only.txt'))).toBe('mine\n');
  });

  it('adopts a plain folder from a clean source too', async () => {
    const clean = newRepo();
    fs.writeFileSync(path.join(clean, 'p.txt'), 'p\n');
    fs.writeFileSync(path.join(clean, 'q.txt'), 'q\n');
    sh(clean, 'add', '.');
    sh(clean, 'commit', '-q', '-m', 'p');
    const dest = destDir();
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'p.txt'), 'p\n');
    fs.writeFileSync(path.join(dest, 'extra.txt'), 'e\n');
    await send(clean, dest);
    expect(text(path.join(dest, 'q.txt'))).toBe('q\n');
    expect(sh(dest, 'status', '--porcelain')).toBe('?? extra.txt');
  });

  it('refuses to adopt a plain folder whose files differ, and leaves it untouched', async () => {
    const dest = destDir();
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'a.txt'), 'different\n');
    await expect(send(src, dest)).rejects.toThrow(/differ/);
    expect(fs.existsSync(path.join(dest, '.git'))).toBe(false);
    expect(text(path.join(dest, 'a.txt'))).toBe('different\n');
  });

  it('refuses a different repository with the same name', async () => {
    const other = newRepo();
    fs.writeFileSync(path.join(other, 'z.txt'), 'z\n');
    sh(other, 'add', '.');
    sh(other, 'commit', '-q', '-m', 'unrelated');
    await expect(send(src, other)).rejects.toThrow(/different git repository/);
  });

  it('makes a plain folder a local repo with standard ignores', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-init-'));
    fs.writeFileSync(path.join(dir, 'notes.md'), 'hi\n');
    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1\n');
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'x');
    const r = await gt.initRepo(dir);
    const files = sh(dir, 'ls-files').split('\n');
    expect(files).toContain('notes.md');
    expect(files).toContain('.gitignore');
    expect(files).not.toContain('.env');
    expect(files.some((f) => f.startsWith('node_modules'))).toBe(false);
    expect(r.files).toBe(files.length);
    expect((await gt.repoState(dir)).rootCommit).toBe(r.commit);
  });

  it('matches remotes written in different forms', () => {
    expect(gt.normalizeRemote('git@github.com:Org/Repo.git')).toBe(gt.normalizeRemote('https://github.com/org/repo'));
  });
});

describe('wire format', () => {
  it('streams a head and a large bundle through and back', async () => {
    const { framedStream, readFramed } = await import('../peers/wire.js');
    const big = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'peer-wire-')), 'b.bundle');
    const data = Buffer.alloc(5 * 1024 * 1024 + 123);
    for (let i = 0; i < data.length; i += 4096) data[i] = i % 251;
    fs.writeFileSync(big, data);
    const head = Buffer.from(JSON.stringify({ hello: 'world' }));
    const out = await readFramed(framedStream(head, big));
    expect(out.head.toString()).toBe(head.toString());
    expect(fs.readFileSync(out.bundlePath!).equals(data)).toBe(true);
    const none = await readFramed(framedStream(head, null));
    expect(none.bundlePath).toBeNull();
  });
});

describe('peer tokens', () => {
  const req = (auth?: string) => ({ headers: auth ? { authorization: auth } : {} }) as unknown as http.IncomingMessage;

  it('accepts an issued token and nothing else, until revoked', () => {
    const config = {} as never;
    const { meta, token } = createPeerToken(config, 'Laptop');
    expect(verifyPeerRequest(config, req(`Bearer ${token}`))?.id).toBe(meta.id);
    expect(verifyPeerRequest(config, req(`Bearer ${token}x`))).toBeNull();
    expect(verifyPeerRequest(config, req())).toBeNull();
    revokePeerToken(config, meta.id);
    expect(verifyPeerRequest(config, req(`Bearer ${token}`))).toBeNull();
  });

  it('normalizes peer URLs', () => {
    expect(normalizePeerUrl('box.example.ts.net:4747/')).toBe('http://box.example.ts.net:4747');
  });
});
