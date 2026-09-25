import type http from 'node:http';
import type { LiteConfig } from '../types.js';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import { getAuthUrl, exchangeCode, getValidAccessToken } from './google-auth.js';
import { listMessages, getMessage, getUnreadCount, getLabels } from './gmail-client.js';
import { getUpcomingEvents, getTodayEvents, createEvent } from './calendar-client.js';

export function handleGmailRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: LiteConfig,
  saveConfig: (config: LiteConfig) => void,
  port: number,
): boolean {
  // GET /api/gmail/status
  if (url.pathname === '/api/gmail/status' && req.method === 'GET') {
    sendJson(res, 200, {
      connected: !!config.gmail?.refreshToken,
      configured: !!config.google?.clientId,
      email: config.user?.email,
    });
    return true;
  }

  // GET /api/gmail/auth/url
  if (url.pathname === '/api/gmail/auth/url' && req.method === 'GET') {
    const redirectUri = `http://localhost:${port}/api/gmail/oauth/callback`;
    const authUrl = getAuthUrl(config, redirectUri);
    if (!authUrl) {
      sendJson(res, 400, { error: 'Google OAuth not configured. Set clientId and clientSecret in config.' });
      return true;
    }
    sendJson(res, 200, { url: authUrl });
    return true;
  }

  // GET /api/gmail/oauth/callback
  if (url.pathname === '/api/gmail/oauth/callback' && req.method === 'GET') {
    const code = url.searchParams.get('code');
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<html><body><h2>Error: No authorization code received</h2></body></html>');
      return true;
    }

    const redirectUri = `http://localhost:${port}/api/gmail/oauth/callback`;
    exchangeCode(config, code, redirectUri).then(({ accessToken, refreshToken, expiresIn }) => {
      config.gmail = {
        accessToken,
        refreshToken,
        tokenExpiry: new Date(Date.now() + expiresIn * 1000).toISOString(),
      };
      saveConfig(config);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0a0a0a; color: #e4e4e7;">
            <div style="text-align: center;">
              <h2 style="color: #22c55e;">Gmail Connected!</h2>
              <p>You can close this tab and return to SI Hive.</p>
              <script>setTimeout(() => window.close(), 3000);</script>
            </div>
          </body>
        </html>
      `);
    }).catch((err) => {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<html><body><h2>Authentication failed</h2><p>${String(err)}</p></body></html>`);
    });
    return true;
  }

  // POST /api/gmail/disconnect
  if (url.pathname === '/api/gmail/disconnect' && req.method === 'POST') {
    delete config.gmail;
    saveConfig(config);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // GET /api/gmail/messages
  if (url.pathname === '/api/gmail/messages' && req.method === 'GET') {
    (async () => {
      try {
        const token = await getValidAccessToken(config, saveConfig);
        const maxResults = parseInt(url.searchParams.get('maxResults') ?? '20');
        const q = url.searchParams.get('q') ?? undefined;
        const labelIds = url.searchParams.get('label') ?? undefined;
        const messages = await listMessages(token, { maxResults, q, labelIds });
        sendJson(res, 200, { messages });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // GET /api/gmail/messages/:id
  const msgMatch = /^\/api\/gmail\/messages\/([^/]+)$/.exec(url.pathname);
  if (msgMatch && req.method === 'GET') {
    const messageId = decodeURIComponent(msgMatch[1]);
    (async () => {
      try {
        const token = await getValidAccessToken(config, saveConfig);
        const message = await getMessage(token, messageId);
        sendJson(res, 200, message);
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // GET /api/gmail/unread-count
  if (url.pathname === '/api/gmail/unread-count' && req.method === 'GET') {
    (async () => {
      try {
        const token = await getValidAccessToken(config, saveConfig);
        const count = await getUnreadCount(token);
        sendJson(res, 200, { count });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // GET /api/gmail/labels
  if (url.pathname === '/api/gmail/labels' && req.method === 'GET') {
    (async () => {
      try {
        const token = await getValidAccessToken(config, saveConfig);
        const labels = await getLabels(token);
        sendJson(res, 200, { labels });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // POST /api/calendar/events
  if (url.pathname === '/api/calendar/events' && req.method === 'POST') {
    (async () => {
      try {
        const token = await getValidAccessToken(config, saveConfig);
        const body = await readBody(req);
        const input = JSON.parse(body);
        const event = await createEvent(token, input);
        sendJson(res, 201, event);
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // GET /api/calendar/events
  if (url.pathname === '/api/calendar/events' && req.method === 'GET') {
    (async () => {
      try {
        const token = await getValidAccessToken(config, saveConfig);
        const days = parseInt(url.searchParams.get('days') ?? '7');
        const events = await getUpcomingEvents(token, days);
        sendJson(res, 200, { events });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // GET /api/calendar/events/today
  if (url.pathname === '/api/calendar/events/today' && req.method === 'GET') {
    (async () => {
      try {
        const token = await getValidAccessToken(config, saveConfig);
        const events = await getTodayEvents(token);
        sendJson(res, 200, { events });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  return false;
}
