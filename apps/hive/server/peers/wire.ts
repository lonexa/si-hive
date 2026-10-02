/**
 * The wire format between Hives: a small head (JSON or a zip of manifest +
 * transcript, held in memory) followed by an optional git bundle (streamed
 * through a temp file, any size).
 *
 *   [4 bytes: head length, big-endian][head][bundle bytes …]
 */
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { TransferError, tmpFile } from './git-transfer.js';

const MAX_HEAD = 512 * 1024 * 1024;

export interface Framed {
  head: Buffer;
  /** Temp file holding the bundle, or null when none was sent. Caller deletes it. */
  bundlePath: string | null;
}

/** Read a framed body from an incoming request or a fetch response body. */
export async function readFramed(source: AsyncIterable<Uint8Array>): Promise<Framed> {
  let buf = Buffer.alloc(0);
  let headLen = -1;
  let head: Buffer | null = null;
  let out: fs.WriteStream | null = null;
  let outPath: string | null = null;

  const write = (chunk: Buffer) => new Promise<void>((resolve, reject) => {
    if (!out) {
      outPath = tmpFile('.bundle');
      out = fs.createWriteStream(outPath);
    }
    out.write(chunk, (err) => (err ? reject(err) : resolve()));
  });

  try {
    for await (const c of source) {
      const chunk = Buffer.from(c);
      if (head) {
        await write(chunk);
        continue;
      }
      buf = Buffer.concat([buf, chunk]);
      if (headLen < 0 && buf.length >= 4) {
        headLen = buf.readUInt32BE(0);
        if (headLen > MAX_HEAD) throw new TransferError(413, 'Transfer header too large');
      }
      if (headLen >= 0 && buf.length >= 4 + headLen) {
        head = buf.subarray(4, 4 + headLen);
        const rest = buf.subarray(4 + headLen);
        buf = Buffer.alloc(0);
        if (rest.length > 0) await write(rest);
      }
    }
    if (!head) throw new TransferError(400, 'Incomplete transfer');
    const stream = out as fs.WriteStream | null;
    if (stream) await new Promise<void>((resolve, reject) => stream.end((err?: Error | null) => (err ? reject(err) : resolve())));
    return { head, bundlePath: outPath };
  } catch (err) {
    const stream = out as fs.WriteStream | null;
    stream?.destroy();
    if (outPath) fs.rmSync(outPath, { force: true });
    throw err;
  }
}

/** A framed body as a stream (for fetch uploads and HTTP responses). */
export function framedStream(head: Buffer, bundlePath: string | null): Readable {
  async function* gen() {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(head.length, 0);
    yield len;
    yield head;
    if (bundlePath) {
      for await (const chunk of fs.createReadStream(bundlePath, { highWaterMark: 1024 * 1024 })) yield chunk as Buffer;
    }
  }
  return Readable.from(gen());
}

export function framedLength(head: Buffer, bundlePath: string | null): number {
  return 4 + head.length + (bundlePath ? fs.statSync(bundlePath).size : 0);
}

export function removeQuietly(p: string | null | undefined): void {
  if (p) fs.rmSync(p, { force: true });
}
