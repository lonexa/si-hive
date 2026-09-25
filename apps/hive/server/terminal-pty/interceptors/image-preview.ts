import fs from 'node:fs';
import path from 'node:path';

/** Max file size to inline preview (2 MB). */
const MAX_INLINE_BYTES = 2 * 1024 * 1024;
/** How many recent paths to remember (avoid re-emitting on TUI redraws). */
const DEDUP_WINDOW = 50;
/** Rolling text-buffer size used for pattern matching. */
const SCAN_WINDOW = 4000;
/** Image extensions we'll try to preview. */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/**
 * Strip ANSI escape sequences so pattern matching works on clean text.
 * Mirrors the helper used elsewhere in terminal-pty.ts.
 */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?!>]*[a-zA-Z~]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[()][0-9A-Z]/g, '')
    .replace(/[\r\b]/g, '');
}

export interface ImagePreviewState {
  /** Rolling ANSI-stripped output buffer. */
  buffer: string;
  /** Recently emitted-for paths (FIFO). */
  recent: string[];
  recentSet: Set<string>;
}

export function createImagePreviewState(): ImagePreviewState {
  return { buffer: '', recent: [], recentSet: new Set() };
}

function rememberEmitted(state: ImagePreviewState, p: string): void {
  if (state.recentSet.has(p)) return;
  state.recentSet.add(p);
  state.recent.push(p);
  if (state.recent.length > DEDUP_WINDOW) {
    const evict = state.recent.shift();
    if (evict) state.recentSet.delete(evict);
  }
}

/**
 * Try to resolve a candidate path string (possibly relative, possibly using
 * forward slashes) to an absolute path that exists under (or alongside) cwd.
 * Returns null if the file doesn't exist or is outside an allowed root.
 */
function resolveCandidate(candidate: string, cwd: string): string | null {
  let p = candidate.trim();
  if (!p) return null;
  // Strip surrounding quotes/backticks
  p = p.replace(/^['"`]|['"`]$/g, '');
  // Normalize forward slashes
  const normalized = p.replace(/\//g, path.sep);
  const abs = path.isAbsolute(normalized) ? normalized : path.resolve(cwd, normalized);
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return null;
    if (stat.size > MAX_INLINE_BYTES) return null;
    return abs;
  } catch {
    return null;
  }
}

/**
 * Patterns we recognize as "Claude is reading this file" or "this file is
 * mentioned and could be previewed." Conservative — Claude redraws its TUI
 * many times per second, so we rely on the dedup set to avoid spam.
 */
const PATTERNS: RegExp[] = [
  // Read(<path>) — Claude Code's tool-call header
  /Read\(([^)]+\.(?:png|jpe?g|gif|webp|bmp|svg))\)/gi,
  // Bare path on its own (heuristic — must be followed by whitespace or EOL)
  /(?:^|\s)((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|\/)[^\s'"<>|*?]+?\.(?:png|jpe?g|gif|webp|bmp|svg))(?=\s|$)/gim,
];

/**
 * Find candidate image paths in a chunk of stripped text.
 * Returns deduped absolute paths that exist and are within size limits.
 */
function findImagePaths(text: string, cwd: string, state: ImagePreviewState): string[] {
  const found = new Set<string>();
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const candidate = (m[1] ?? '').trim();
      if (!candidate || !IMAGE_EXT.test(candidate)) continue;
      const abs = resolveCandidate(candidate, cwd);
      if (!abs) continue;
      if (state.recentSet.has(abs)) continue;
      found.add(abs);
    }
  }
  return [...found];
}

/**
 * Process a fresh chunk of PTY output. For any newly-seen image path, hand
 * the absolute path back to the caller — the caller is responsible for
 * actually rendering the image (so the path can also be remembered for
 * resume-replay, which is the host's job, not the interceptor's).
 */
export function processChunk(
  chunk: string,
  cwd: string,
  state: ImagePreviewState,
  emit: (escape: string | null, absPath: string) => void,
): void {
  // Append to rolling buffer (ANSI-stripped) and trim.
  state.buffer += stripAnsi(chunk);
  if (state.buffer.length > SCAN_WINDOW * 2) {
    state.buffer = state.buffer.slice(-SCAN_WINDOW);
  }
  const paths = findImagePaths(state.buffer, cwd, state);
  for (const abs of paths) {
    rememberEmitted(state, abs);
    emit(null, abs);
  }
}
