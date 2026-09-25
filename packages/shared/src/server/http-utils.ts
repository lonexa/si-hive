import type http from 'node:http';

export function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  // BigInt replacer: SQL Server BIGINT columns can come back as JS BigInt
  // (which JSON.stringify refuses to serialize). Coerce to Number when safe,
  // string when the value would lose precision as a Number.
  res.end(JSON.stringify(data, (_k, v) => {
    if (typeof v === 'bigint') {
      return v <= Number.MAX_SAFE_INTEGER && v >= -Number.MAX_SAFE_INTEGER ? Number(v) : v.toString();
    }
    return v;
  }));
}

export function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

export function maskPat(pat: string): string {
  if (pat.length <= 4) return '****';
  return '*'.repeat(pat.length - 4) + pat.slice(-4);
}
