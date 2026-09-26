/**
 * Server connection config.
 * In production (served by the server), the page's own origin IS the server —
 * including its scheme and port, so HTTPS proxies (e.g. Tailscale Serve) work.
 * In dev (Vite on a different port), we fall back to the configured server port.
 * The VITE_SERVER_PORT env var can override this for dev.
 */
const DEV_SERVER_PORT = import.meta.env.VITE_SERVER_PORT || '4747';
const isServedByServer = !import.meta.env.DEV;
const isHttps = window.location.protocol === 'https:';
export const SERVER_PORT = isServedByServer ? (window.location.port || (isHttps ? '443' : '80')) : DEV_SERVER_PORT;
export const SERVER_HOST = window.location.hostname || 'localhost';
const SERVER_AUTHORITY = isServedByServer && window.location.host ? window.location.host : `${SERVER_HOST}:${SERVER_PORT}`;
export const API_BASE = `${isHttps ? 'https' : 'http'}://${SERVER_AUTHORITY}`;
export const WS_BASE = `${isHttps ? 'wss' : 'ws'}://${SERVER_AUTHORITY}`;
