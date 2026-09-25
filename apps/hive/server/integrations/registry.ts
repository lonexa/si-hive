/**
 * Integration registry: resolves configured connections to live
 * GitHostProvider / TrackerProvider instances.
 *
 * Features call `getTracker(config, { projectPath })` or
 * `getGitHost(config, { remoteUrl })` and must handle `null` — having no
 * tracker or git host connected is a normal, supported state.
 */
import type { HiveConfig } from '../types.js';
import type {
  ConnectionContext,
  GitHostProvider,
  IntegrationConnection,
  IntegrationKind,
  IntegrationProviderDefinition,
  TrackerProvider,
} from './types.js';
import { INTEGRATION_PROVIDERS } from './providers/index.js';
import { getSecret } from '../../../../packages/shared/src/server/credentials.js';

const byId = new Map<string, IntegrationProviderDefinition>(INTEGRATION_PROVIDERS.map((p) => [p.id, p]));

export function listProviderDefinitions(): IntegrationProviderDefinition[] {
  return INTEGRATION_PROVIDERS;
}

export function getProviderDefinition(id: string): IntegrationProviderDefinition | undefined {
  return byId.get(id);
}

/** Credential-store ref for one secret field of a connection. */
export function secretRef(connectionId: string, fieldKey: string): string {
  return `integration:${connectionId}:${fieldKey}`;
}

export function listConnections(config: HiveConfig, kind?: IntegrationKind): IntegrationConnection[] {
  const all = config.integrations ?? [];
  return kind ? all.filter((c) => c.kinds.includes(kind) && byId.has(c.providerId)) : all;
}

export function getConnection(config: HiveConfig, id: string): IntegrationConnection | undefined {
  return (config.integrations ?? []).find((c) => c.id === id);
}

export function connectionContext(conn: IntegrationConnection): ConnectionContext {
  const def = byId.get(conn.providerId);
  const secrets: Record<string, string | undefined> = {};
  for (const field of def?.configSchema ?? []) {
    if (field.type === 'secret') secrets[field.key] = getSecret(secretRef(conn.id, field.key));
  }
  return { settings: conn.settings ?? {}, secrets };
}

// Providers are cheap to build but can hold keep-alive agents / caches, so
// memoize per connection. The cache key includes the settings so edits in
// Settings take effect without a restart.
const trackerCache = new Map<string, { sig: string; provider: TrackerProvider }>();
const gitCache = new Map<string, { sig: string; provider: GitHostProvider }>();

function signature(conn: IntegrationConnection): string {
  return JSON.stringify([conn.providerId, conn.settings]);
}

export function trackerForConnection(conn: IntegrationConnection): TrackerProvider | null {
  const def = byId.get(conn.providerId);
  if (!def?.createTracker || !conn.kinds.includes('tracker')) return null;
  const sig = signature(conn);
  const hit = trackerCache.get(conn.id);
  if (hit && hit.sig === sig) return hit.provider;
  const provider = def.createTracker(connectionContext(conn));
  trackerCache.set(conn.id, { sig, provider });
  return provider;
}

export function gitHostForConnection(conn: IntegrationConnection): GitHostProvider | null {
  const def = byId.get(conn.providerId);
  if (!def?.createGitHost || !conn.kinds.includes('git')) return null;
  const sig = signature(conn);
  const hit = gitCache.get(conn.id);
  if (hit && hit.sig === sig) return hit.provider;
  const provider = def.createGitHost(connectionContext(conn));
  gitCache.set(conn.id, { sig, provider });
  return provider;
}

/** Call after a connection's secrets change so the next lookup rebuilds it. */
export function invalidateConnection(connectionId: string): void {
  trackerCache.delete(connectionId);
  gitCache.delete(connectionId);
}

/**
 * The tracker for a project: explicit per-project mapping first ('none'
 * disables tracking for that project), then the default tracker, then the
 * only tracker if exactly one is configured.
 */
export function getTrackerConnection(config: HiveConfig, opts: { projectPath?: string } = {}): IntegrationConnection | null {
  const trackers = listConnections(config, 'tracker');
  if (opts.projectPath) {
    const pref = config.projectIntegrations?.[opts.projectPath]?.tracker;
    if (pref === 'none') return null;
    if (pref) {
      const conn = trackers.find((c) => c.id === pref);
      if (conn) return conn;
    }
  }
  return trackers.find((c) => c.defaultTracker) ?? (trackers.length === 1 ? trackers[0] : null);
}

export function getTracker(config: HiveConfig, opts: { projectPath?: string } = {}): TrackerProvider | null {
  const conn = getTrackerConnection(config, opts);
  return conn ? trackerForConnection(conn) : null;
}

/** The git host serving a remote URL (auto-detected), or an explicit connection id. */
export function getGitHostConnection(config: HiveConfig, opts: { remoteUrl?: string; connectionId?: string; projectPath?: string } = {}): IntegrationConnection | null {
  const hosts = listConnections(config, 'git');
  const explicit = opts.connectionId ?? (opts.projectPath ? config.projectIntegrations?.[opts.projectPath]?.git : undefined);
  if (explicit) return hosts.find((c) => c.id === explicit) ?? null;
  if (opts.remoteUrl) {
    const remote = opts.remoteUrl;
    return hosts.find((c) => byId.get(c.providerId)?.matchesRemote?.(remote, c.settings ?? {})) ?? null;
  }
  return hosts.length === 1 ? hosts[0] : null;
}

export function getGitHost(config: HiveConfig, opts: { remoteUrl?: string; connectionId?: string; projectPath?: string } = {}): GitHostProvider | null {
  const conn = getGitHostConnection(config, opts);
  return conn ? gitHostForConnection(conn) : null;
}

/** Every configured git host with its connection (for cross-repo feeds). */
export function getAllGitHosts(config: HiveConfig): { connection: IntegrationConnection; provider: GitHostProvider }[] {
  return listConnections(config, 'git')
    .map((connection) => ({ connection, provider: gitHostForConnection(connection) }))
    .filter((x): x is { connection: IntegrationConnection; provider: GitHostProvider } => x.provider !== null);
}
