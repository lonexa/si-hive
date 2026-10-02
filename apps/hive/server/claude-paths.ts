/**
 * Claude Code's per-project history folders (~/.claude/projects/<encoded>).
 *
 * Claude names the folder after the session's cwd with EVERY non-alphanumeric
 * character replaced by '-'. That is lossy — '/', '\\', ':', ' ', '.', '_' and
 * '-' all become '-' — so a folder name can't be decoded reliably. The cwd that
 * Claude records verbatim in each JSONL line is the ground truth; name decoding
 * is only a fallback for folders with no readable session.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isWindows } from './platform.js';
import { decodeWindowsProjectDir } from './parsers/process-discovery-windows.js';

/** Claude Code's history-folder name for a path. Same on every platform. */
export function encodeClaudeProjectDir(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, '-');
}

/** First `cwd` recorded in a session JSONL, reading only the head of the file. */
export function readCwdFromJsonlHead(file: string, maxBytes = 256 * 1024): string | undefined {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(Math.min(maxBytes, fs.fstatSync(fd).size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    for (const line of buf.toString('utf-8').split('\n')) {
      if (!line.includes('"cwd"')) continue;
      try {
        const obj = JSON.parse(line) as { cwd?: unknown };
        if (typeof obj.cwd === 'string' && obj.cwd) return obj.cwd;
      } catch { /* partial or malformed line */ }
    }
  } catch { /* unreadable */ } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
  return undefined;
}

const cwdCache = new Map<string, { mtimeMs: number; cwd: string | undefined }>();

/**
 * The cwd of the newest session in a history folder whose cwd still encodes to
 * this folder's name (a session that `cd`'d elsewhere records the new cwd).
 */
function cwdFromFolder(folder: string): string | undefined {
  let mtimeMs: number;
  try { mtimeMs = fs.statSync(folder).mtimeMs; } catch { return undefined; }
  const hit = cwdCache.get(folder);
  if (hit && hit.mtimeMs === mtimeMs) return hit.cwd;

  const name = path.basename(folder);
  let cwd: string | undefined;
  try {
    const files = fs.readdirSync(folder)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const full = path.join(folder, f);
        try { return { full, m: fs.statSync(full).mtimeMs }; } catch { return { full, m: 0 }; }
      })
      .sort((a, b) => b.m - a.m);
    for (const { full } of files.slice(0, 5)) {
      const c = readCwdFromJsonlHead(full);
      if (c && encodeClaudeProjectDir(c) === name) { cwd = c; break; }
    }
  } catch { /* unreadable */ }
  cwdCache.set(folder, { mtimeMs, cwd });
  return cwd;
}

/**
 * POSIX name decode: walk the filesystem, trying the joiners Claude flattens to
 * '-' (so `/srv/my-app` and `/srv/My Project` resolve), and fall back to
 * treating every '-' as '/'.
 */
function decodePosixProjectDir(dirName: string): string {
  const naive = '/' + dirName.replace(/^-/, '').replace(/-/g, '/');
  const segments = dirName.replace(/^-/, '').split('-');
  let resolved = '/';
  let i = 0;
  while (i < segments.length) {
    let matched = false;
    for (let j = segments.length; j > i && !matched; j--) {
      for (const joiner of ['-', ' ', '_', '.']) {
        const candidate = path.join(resolved, segments.slice(i, j).join(joiner));
        if (fs.existsSync(candidate)) {
          resolved = candidate;
          i = j;
          matched = true;
          break;
        }
        if (j - i === 1) break; // a single segment has no joiner to vary
      }
    }
    if (!matched) return naive;
  }
  return resolved;
}

/**
 * Real path for a history folder name. Prefers the cwd recorded in its
 * sessions; otherwise decodes the name against the filesystem.
 */
export function decodeClaudeProjectDir(dirName: string, claudeProjectsDir?: string): string {
  if (claudeProjectsDir) {
    const cwd = cwdFromFolder(path.join(claudeProjectsDir, dirName));
    if (cwd) return cwd;
  }
  return isWindows ? decodeWindowsProjectDir(dirName) : decodePosixProjectDir(dirName);
}
