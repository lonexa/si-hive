import http from 'node:http';
import { chromium, type Browser } from 'playwright';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';

// Shared lazy-launched Chromium. First request takes 1-2s; subsequent reuse the browser.
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
    browserPromise.catch(() => { browserPromise = null; });
  }
  const browser = await browserPromise;
  if (!browser.isConnected()) {
    browserPromise = null;
    return getBrowser();
  }
  return browser;
}

interface ScreenshotBody {
  url?: unknown;
  fullPage?: unknown;
  width?: unknown;
  height?: unknown;
}

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function registerScreenshotRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const pathname = url.pathname;

  const m = pathname.match(/^\/api\/sessions\/([^/]+)\/screenshot$/);
  if (m && req.method === 'POST') {
    (async () => {
      try {
        const raw = await readBody(req);
        const body = (raw ? JSON.parse(raw) : {}) as ScreenshotBody;
        const targetUrl = typeof body.url === 'string' ? body.url.trim() : '';
        if (!targetUrl || !isValidUrl(targetUrl)) {
          sendJson(res, 400, { error: 'Body must include a valid http/https url' });
          return;
        }
        const fullPage = body.fullPage === true;
        const width = typeof body.width === 'number' && body.width > 0 ? Math.min(3840, body.width) : 1280;
        const height = typeof body.height === 'number' && body.height > 0 ? Math.min(2160, body.height) : 800;

        const browser = await getBrowser();
        const ctx = await browser.newContext({ viewport: { width, height } });
        try {
          const page = await ctx.newPage();
          await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 15_000 }).catch(async () => {
            // Some apps never go fully idle (long-poll, dev sockets). Retry with domcontentloaded.
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
          });
          // Tiny settle delay so client-side rendering has a chance to paint
          await page.waitForTimeout(300);
          const buf = await page.screenshot({ type: 'png', fullPage });
          const pngBase64 = buf.toString('base64');
          sendJson(res, 200, { pngBase64, width, height });
        } finally {
          await ctx.close().catch(() => {});
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      }
    })();
    return true;
  }

  return false;
}

export async function shutdownScreenshotBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    await b.close();
  } catch {
    // ignore
  } finally {
    browserPromise = null;
  }
}
