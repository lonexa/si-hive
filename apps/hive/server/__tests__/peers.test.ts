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

  it('round-trips commits, uncommitted and untracked changes into an empty folder', async () => {
    const payload = await gt.packRepo(src, null, 50 * 1024 * 1024);
    expect(payload.bundle).toBeDefined();
    expect(payload.untracked.map((f) => f.rel.replace(/\\/g, '/'))).toEqual(['new/b.txt']);

    const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'peer-dst-')), 'app');
    await gt.applyRepo(dest, payload, []);
    expect(text(path.join(dest, 'a.txt'))).toBe('one\ntwo\n');
    expect(text(path.join(dest, 'new', 'b.txt'))).toBe('untracked\n');
    expect(fs.existsSync(path.join(dest, 'node_modules'))).toBe(false);
    expect(sh(dest, 'rev-parse', 'HEAD')).toBe(sh(src, 'rev-parse', 'HEAD'));
    expect(sh(dest, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
    // Same content, so the fingerprints agree.
    expect(await gt.fingerprint(dest)).toBe(await gt.fingerprint(src));
  });

  it('sends only new commits when the target has the base', async () => {
    const base = sh(src, 'rev-parse', 'HEAD');
    const same = await gt.packRepo(src, base, 50 * 1024 * 1024);
    expect(same.bundle).toBeUndefined();
  });

  it('refuses to overwrite unknown local changes, but sets aside its own', async () => {
    const payload = await gt.packRepo(src, null, 50 * 1024 * 1024);
    const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'peer-dst-')), 'app');
    await gt.applyRepo(dest, payload, []);
    fs.writeFileSync(path.join(dest, 'a.txt'), 'someone else edited this\n');
    await expect(gt.applyRepo(dest, payload, [])).rejects.toThrow(/local changes/);

    // Exactly the state this Hive recorded when the session left: stash and proceed.
    const fp = await gt.fingerprint(dest);
    const notes = await gt.applyRepo(dest, payload, [fp]);
    expect(notes.join(' ')).toMatch(/stash/);
    expect(text(path.join(dest, 'a.txt'))).toBe('one\ntwo\n');
  });

  it('matches remotes written in different forms', () => {
    expect(gt.normalizeRemote('git@github.com:Org/Repo.git')).toBe(gt.normalizeRemote('https://github.com/org/repo'));
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
