import type http from 'node:http';

export type HiveRole = 'admin' | 'full';

export interface AuthUser {
  oid: string;
  email: string;
  displayName: string;
  role: HiveRole;
}

export interface AuthSession {
  token: string;
  userOid: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: string | null;
  expiresAt: string;
  keepLoggedIn: boolean;
  createdAt: string;
}

export interface AuthenticatedRequest extends http.IncomingMessage {
  user?: AuthUser;
  authSession?: AuthSession;
}

export interface TokenClaims {
  oid: string;
  preferred_username?: string;
  email?: string;
  name?: string;
  groups?: string[];
  exp?: number;
  iss?: string;
  aud?: string;
}
