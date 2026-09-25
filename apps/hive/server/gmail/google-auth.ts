import type { LiteConfig } from '../types.js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
];

export function getAuthUrl(config: LiteConfig, redirectUri: string): string | null {
  if (!config.google?.clientId) return null;

  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(
  config: LiteConfig,
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  if (!config.google?.clientId || !config.google?.clientSecret) {
    throw new Error('Google OAuth not configured');
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? '',
    expiresIn: data.expires_in,
  };
}

export async function refreshAccessToken(
  config: LiteConfig,
): Promise<{ accessToken: string; expiresIn: number }> {
  if (!config.google?.clientId || !config.google?.clientSecret || !config.gmail?.refreshToken) {
    throw new Error('Gmail tokens not configured');
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      refresh_token: config.gmail.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json() as {
    access_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
}

export async function getValidAccessToken(
  config: LiteConfig,
  saveConfig: (config: LiteConfig) => void,
): Promise<string> {
  if (!config.gmail?.accessToken) {
    throw new Error('Not authenticated with Gmail');
  }

  // Check if token is expired (with 5 min buffer)
  const expiry = new Date(config.gmail.tokenExpiry).getTime();
  const now = Date.now();

  if (now < expiry - 5 * 60 * 1000) {
    return config.gmail.accessToken;
  }

  // Refresh the token
  const { accessToken, expiresIn } = await refreshAccessToken(config);
  config.gmail.accessToken = accessToken;
  config.gmail.tokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();
  saveConfig(config);

  return accessToken;
}
