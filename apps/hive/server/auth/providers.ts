/**
 * Login providers (Settings → Authentication).
 *
 * Each configured login connection has a `type` from AUTH_PROVIDER_TYPES.
 * OIDC-based types (Google, Microsoft Entra ID, generic OIDC) share one
 * implementation via openid-client: discovery, PKCE, and a *verified* ID
 * token (signature, issuer, audience, expiry). GitHub uses OAuth2 + its API.
 * Local username/password accounts are handled in ./local-accounts.ts.
 *
 * To add a type: add an entry to AUTH_PROVIDER_TYPES with its configSchema
 * and either `oidcIssuer()` (OIDC) or a custom `begin`/`complete` pair.
 */
import * as oidc from 'openid-client';
import type { ConfigField } from '../integrations/types.js';
import { getSecret } from '../../../../packages/shared/src/server/credentials.js';

export type AuthProviderType = 'google' | 'entra' | 'github' | 'oidc' | 'local';

/** A configured login connection, persisted in `config.auth.providers`. */
export interface AuthProviderConnection {
  id: string;
  type: AuthProviderType;
  label: string;
  settings: Record<string, string | boolean | undefined>;
  /** Set after a successful test sign-in; enforcement requires a verified provider. */
  verifiedAt?: string;
}

/** Identity asserted by a provider after a successful sign-in. */
export interface ExternalIdentity {
  /** Stable subject id at the provider. */
  subject: string;
  email: string;
  name: string;
  /** Group / org ids the user belongs to, when the provider exposes them. */
  groups?: string[];
  emailVerified?: boolean;
}

export interface BeginResult {
  url: string;
  /** Opaque per-attempt data returned to `complete` (PKCE verifier, nonce…). */
  state: Record<string, string>;
}

export interface AuthProviderType_ {
  type: AuthProviderType;
  displayName: string;
  icon: string;
  configSchema: ConfigField[];
  /** Begin an interactive sign-in; `redirectUri` is this server's callback. */
  begin?(conn: AuthProviderConnection, redirectUri: string, state: string): Promise<BeginResult>;
  /** Finish sign-in from the callback URL. */
  complete?(conn: AuthProviderConnection, callbackUrl: URL, redirectUri: string, stored: Record<string, string>, state: string): Promise<ExternalIdentity>;
  /** Setting key holding a group/org id whose members become admins. */
  adminGroupSetting?: string;
}

export function authSecretRef(connectionId: string, field: string): string {
  return `auth:${connectionId}:${field}`;
}

function secret(conn: AuthProviderConnection, key: string): string | undefined {
  return getSecret(authSecretRef(conn.id, key));
}

// ---------------------------------------------------------------------------
// Generic OIDC (authorization code + PKCE, verified ID token)
// ---------------------------------------------------------------------------

const discoveryCache = new Map<string, Promise<oidc.Configuration>>();

function oidcConfiguration(conn: AuthProviderConnection, issuer: string): Promise<oidc.Configuration> {
  const clientId = String(conn.settings.clientId ?? '');
  const clientSecret = secret(conn, 'clientSecret');
  const key = JSON.stringify([conn.id, issuer, clientId, !!clientSecret]);
  let p = discoveryCache.get(key);
  if (!p) {
    p = oidc.discovery(new URL(issuer), clientId, clientSecret ? { client_secret: clientSecret } : undefined, clientSecret ? undefined : oidc.None());
    p.catch(() => discoveryCache.delete(key));
    discoveryCache.set(key, p);
  }
  return p;
}

function oidcType(
  base: Omit<AuthProviderType_, 'begin' | 'complete'>,
  issuerOf: (conn: AuthProviderConnection) => string,
  opts: { scopes?: (conn: AuthProviderConnection) => string; extraAuthParams?: (conn: AuthProviderConnection) => Record<string, string>; validate?: (conn: AuthProviderConnection, claims: Record<string, unknown>) => void } = {},
): AuthProviderType_ {
  return {
    ...base,
    async begin(conn, redirectUri, state) {
      const config = await oidcConfiguration(conn, issuerOf(conn));
      const verifier = oidc.randomPKCECodeVerifier();
      const nonce = oidc.randomNonce();
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: opts.scopes?.(conn) ?? 'openid profile email',
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state,
        nonce,
        ...(opts.extraAuthParams?.(conn) ?? {}),
      });
      return { url: url.href, state: { verifier, nonce } };
    },
    async complete(conn, callbackUrl, _redirectUri, stored, state) {
      const config = await oidcConfiguration(conn, issuerOf(conn));
      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: stored.verifier,
        expectedNonce: stored.nonce,
        expectedState: state,
        idTokenExpected: true,
      });
      const claims = (tokens.claims() ?? {}) as Record<string, unknown>;
      opts.validate?.(conn, claims);
      const email = String(claims.email ?? claims.preferred_username ?? claims.upn ?? '');
      return {
        subject: String(claims.oid ?? claims.sub),
        email,
        name: String(claims.name ?? email),
        groups: Array.isArray(claims.groups) ? claims.groups.map(String) : undefined,
        emailVerified: claims.email_verified === undefined ? undefined : claims.email_verified === true,
      };
    },
  };
}

const clientIdField: ConfigField = { key: 'clientId', label: 'Client ID', type: 'text', required: true };
const clientSecretField = (required: boolean, help?: string): ConfigField => ({ key: 'clientSecret', label: 'Client secret', type: 'secret', required, help });

// ---------------------------------------------------------------------------
// GitHub (OAuth2 — not OIDC)
// ---------------------------------------------------------------------------

const github: AuthProviderType_ = {
  type: 'github',
  displayName: 'GitHub',
  icon: 'Github',
  adminGroupSetting: 'adminTeam',
  configSchema: [
    clientIdField,
    clientSecretField(true),
    { key: 'baseUrl', label: 'GitHub URL', type: 'url', default: 'https://github.com', help: 'Change only for GitHub Enterprise Server.' },
    { key: 'requiredOrg', label: 'Required organization', type: 'text', placeholder: 'my-org', help: 'Only members of this organization may sign in.' },
    { key: 'adminTeam', label: 'Admin team', type: 'text', placeholder: 'my-org/admins', help: 'Members of this team (org/team-slug) become SI Hive admins.' },
  ],
  async begin(conn, redirectUri, state) {
    const base = String(conn.settings.baseUrl || 'https://github.com').replace(/\/+$/, '');
    const params = new URLSearchParams({
      client_id: String(conn.settings.clientId ?? ''),
      redirect_uri: redirectUri,
      scope: conn.settings.requiredOrg || conn.settings.adminTeam ? 'read:user user:email read:org' : 'read:user user:email',
      state,
      allow_signup: 'false',
    });
    return { url: `${base}/login/oauth/authorize?${params}`, state: {} };
  },
  async complete(conn, callbackUrl, redirectUri) {
    const base = String(conn.settings.baseUrl || 'https://github.com').replace(/\/+$/, '');
    const api = /^https:\/\/github\.com$/i.test(base) ? 'https://api.github.com' : `${base}/api/v3`;
    const code = callbackUrl.searchParams.get('code');
    if (!code) throw new Error('Missing authorization code');
    const tokenRes = await fetch(`${base}/login/oauth/access_token`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: conn.settings.clientId, client_secret: secret(conn, 'clientSecret'), code, redirect_uri: redirectUri }),
    });
    const tok = (await tokenRes.json()) as { access_token?: string; error_description?: string };
    if (!tok.access_token) throw new Error(`GitHub token exchange failed: ${tok.error_description ?? tokenRes.status}`);
    const gh = async <T>(path: string): Promise<T> => {
      const r = await fetch(`${api}${path}`, { headers: { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'SI-Hive' } });
      if (!r.ok) throw new Error(`GitHub ${path}: ${r.status}`);
      return (await r.json()) as T;
    };
    const user = await gh<{ id: number; login: string; name?: string; email?: string }>('/user');
    const emails = await gh<{ email: string; primary: boolean; verified: boolean }[]>('/user/emails').catch(() => []);
    const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    const groups: string[] = [];
    if (conn.settings.requiredOrg || conn.settings.adminTeam) {
      const orgs = await gh<{ login: string }[]>('/user/orgs').catch(() => []);
      groups.push(...orgs.map((o) => o.login.toLowerCase()));
      const teams = await gh<{ slug: string; organization: { login: string } }[]>('/user/teams').catch(() => []);
      groups.push(...teams.map((t) => `${t.organization.login}/${t.slug}`.toLowerCase()));
      const required = String(conn.settings.requiredOrg ?? '').toLowerCase();
      if (required && !groups.includes(required)) throw new Error(`You must be a member of the ${required} organization`);
    }
    return {
      subject: String(user.id),
      email: primary?.email ?? user.email ?? `${user.login}@users.noreply.github.com`,
      name: user.name || user.login,
      groups,
      emailVerified: !!primary,
    };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const AUTH_PROVIDER_TYPES: Record<AuthProviderType, AuthProviderType_> = {
  google: oidcType(
    {
      type: 'google',
      displayName: 'Google',
      icon: 'Globe',
      configSchema: [
        clientIdField,
        clientSecretField(true),
        { key: 'hostedDomain', label: 'Workspace domain', type: 'text', placeholder: 'example.com', help: 'Only accounts from this Google Workspace domain may sign in.' },
      ],
    },
    () => 'https://accounts.google.com',
    {
      extraAuthParams: (conn): Record<string, string> => (conn.settings.hostedDomain ? { hd: String(conn.settings.hostedDomain) } : {}),
      validate: (conn, claims) => {
        const hd = conn.settings.hostedDomain;
        if (hd && claims.hd !== hd) throw new Error(`Only ${hd} accounts may sign in`);
      },
    },
  ),
  entra: oidcType(
    {
      type: 'entra',
      displayName: 'Microsoft Entra ID',
      icon: 'Building2',
      adminGroupSetting: 'adminGroupId',
      configSchema: [
        { key: 'tenantId', label: 'Tenant ID', type: 'text', required: true, help: 'Directory (tenant) ID or verified domain of your organization.' },
        clientIdField,
        clientSecretField(false, 'Required for "Web" app registrations; leave blank for public clients using PKCE.'),
        { key: 'adminGroupId', label: 'Admin group object ID', type: 'text', help: 'Members of this group become SI Hive admins (requires the groups claim).' },
      ],
    },
    (conn) => `https://login.microsoftonline.com/${encodeURIComponent(String(conn.settings.tenantId ?? ''))}/v2.0`,
    { scopes: () => 'openid profile email' },
  ),
  oidc: oidcType(
    {
      type: 'oidc',
      displayName: 'OpenID Connect',
      icon: 'KeyRound',
      adminGroupSetting: 'adminGroup',
      configSchema: [
        { key: 'issuerUrl', label: 'Issuer URL', type: 'url', required: true, placeholder: 'https://auth.example.com/realms/main', help: 'Okta, Auth0, Keycloak, Authentik, Zitadel, … (must serve /.well-known/openid-configuration).' },
        clientIdField,
        clientSecretField(false),
        { key: 'scopes', label: 'Scopes', type: 'text', default: 'openid profile email', placeholder: 'openid profile email groups' },
        { key: 'adminGroup', label: 'Admin group', type: 'text', help: 'Value in the `groups` claim that grants admin.' },
      ],
    },
    (conn) => String(conn.settings.issuerUrl ?? ''),
    { scopes: (conn) => String(conn.settings.scopes || 'openid profile email') },
  ),
  github,
  local: {
    type: 'local',
    displayName: 'Username & password',
    icon: 'UserRound',
    configSchema: [],
  },
};

export function listAuthProviderTypes() {
  return Object.values(AUTH_PROVIDER_TYPES).map((t) => ({ type: t.type, displayName: t.displayName, icon: t.icon, configSchema: t.configSchema }));
}

/** Whether a verified identity is in the provider's admin group/team. */
export function isAdminByGroup(conn: AuthProviderConnection, identity: ExternalIdentity): boolean {
  const key = AUTH_PROVIDER_TYPES[conn.type]?.adminGroupSetting;
  const wanted = key ? String(conn.settings[key] ?? '').trim().toLowerCase() : '';
  return !!wanted && (identity.groups ?? []).some((g) => g.toLowerCase() === wanted);
}
