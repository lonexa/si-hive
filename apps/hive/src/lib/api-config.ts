/**
 * Server connection config.
 * In production (served by the server), window.location.port IS the server port.
 * In dev (Vite on a different port), we fall back to the configured server port.
 * The VITE_SERVER_PORT env var can override this for dev.
 */
const DEV_SERVER_PORT = import.meta.env.VITE_SERVER_PORT || '4747';
const isServedByServer = !import.meta.env.DEV;
export const SERVER_PORT = isServedByServer ? (window.location.port || '4747') : DEV_SERVER_PORT;
export const SERVER_HOST = window.location.hostname || 'localhost';
export const API_BASE = `http://${SERVER_HOST}:${SERVER_PORT}`;
export const WS_BASE = `ws://${SERVER_HOST}:${SERVER_PORT}`;
