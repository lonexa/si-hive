import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type http from 'node:http';
import { getPtySession, injectInlineImage } from '../terminal-pty.js';

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const SAFE_EXT = /^[A-Za-z0-9._-]+$/;
const TMP_DIR_NAME = '.hive-tmp';

/**
 * Sanitize a user-provided filename so we only keep a safe extension and a
 * short base. The on-disk name is always `<uuid>-<safebase>.<ext>` to avoid
 * collisions even when users drop multiple files named "image.png".
 */
function buildSafeName(rawName: string | null): string {
  const fallbackId = crypto.randomUUID().slice(0, 8);
  if (!rawName) return `${fallbackId}.bin`;
  const cleaned = path.basename(rawName).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  const ext = path.extname(cleaned).toLowerCase();
  const base = path.basename(cleaned, ext).slice(0, 40) || 'file';
  const safeExt = ext && SAFE_EXT.test(ext.slice(1)) ? ext : '';
  return `${fallbackId}-${base}${safeExt}`;
}

/**
 * Read the whole request body, enforcing a max size.
 */
function readBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`Payload too large (>${maxBytes} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * POST /api/sessions/:id/dropfile?name=<filename>
 *   body: raw file bytes
 * Writes the file under <session.cwd>/.hive-tmp/<safename> and returns its
 * absolute path. Frontend types this path into the AI's input prompt.
 */
export async function registerDropfileRoute(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const m = url.pathname.match(/^\/api\/sessions\/([^/]+)\/dropfile$/);
  if (!m || req.method !== 'POST') return false;

  const sessionId = decodeURIComponent(m[1]);
  const session = getPtySession(sessionId);
  if (!session) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unknown session' }));
    return true;
  }

  let bytes: Buffer;
  try {
    bytes = await readBody(req, MAX_BYTES);
  } catch (err) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String((err as Error).message ?? err) }));
    return true;
  }

  if (bytes.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Empty payload' }));
    return true;
  }

  const rawName = url.searchParams.get('name');
  const safeName = buildSafeName(rawName);
  const tmpDir = path.join(session.cwd, TMP_DIR_NAME);
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Failed to create ${TMP_DIR_NAME}: ${String((err as Error).message ?? err)}` }));
    return true;
  }
  const absPath = path.join(tmpDir, safeName);

  try {
    fs.writeFileSync(absPath, bytes);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Failed to write file: ${String((err as Error).message ?? err)}` }));
    return true;
  }

  // If it's an image and the session has inline-images enabled, render an
  // inline preview into the terminal stream right now. Claude Code may
  // consume the path and never emit a `Read(...)` line for it, so the
  // regex-based interceptor can't be relied on for the drag-drop path.
  let previewed = false;
  if (IMAGE_EXT_RE.test(safeName) && session.enhancements.inlineImages) {
    previewed = injectInlineImage(sessionId, absPath);
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, path: absPath, size: bytes.length, previewed }));
  return true;
}
