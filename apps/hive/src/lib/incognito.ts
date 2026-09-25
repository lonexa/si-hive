/**
 * Incognito client state.
 *
 * Mirrors the server's local ~/.hive/incognito.json so the UI can render
 * badges and toggles without a round trip per card. The server remains the
 * authority — every gate that actually suppresses a shared write lives there
 * (see apps/hive/server/privacy/incognito.ts); this is presentation plus the
 * toggle calls.
 */

import { API_BASE } from '@/lib/api-config';

export interface IncognitoState {
  /** Normalized project paths (forward slashes, lowercased, no trailing slash). */
  projects: string[];
  /** Explicitly marked session ids (or temp `new-*` terminal ids). */
  sessions: string[];
}

const EMPTY: IncognitoState = { projects: [], sessions: [] };

let state: IncognitoState = EMPTY;
let loaded = false;
let inflight: Promise<IncognitoState> | null = null;
const listeners = new Set<(s: IncognitoState) => void>();

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function publish(next: IncognitoState): void {
  state = next;
  loaded = true;
  for (const fn of listeners) fn(state);
}

export function getIncognitoState(): IncognitoState {
  return state;
}

export function subscribeIncognito(fn: (s: IncognitoState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Fetch (once) and cache. Concurrent callers share the in-flight request. */
export async function loadIncognitoState(force = false): Promise<IncognitoState> {
  if (loaded && !force) return state;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/incognito`, { credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as Partial<IncognitoState>;
      publish({ projects: data.projects ?? [], sessions: data.sessions ?? [] });
    } catch {
      // Non-fatal: an unreachable endpoint just means no badges this render.
      publish(state === EMPTY ? EMPTY : state);
    } finally {
      inflight = null;
    }
    return state;
  })();
  return inflight;
}

/** True when `path` is at or below an incognito project root. */
export function isIncognitoProject(path: string | null | undefined, s: IncognitoState = state): boolean {
  if (!path || s.projects.length === 0) return false;
  const c = normalize(path);
  return s.projects.some((root) => c === root || c.startsWith(`${root}/`));
}

/** True when this exact session id (or its parent, for subagents) was marked. */
export function isIncognitoSessionId(id: string | null | undefined, s: IncognitoState = state): boolean {
  if (!id || s.sessions.length === 0) return false;
  if (s.sessions.includes(id)) return true;
  const colon = id.indexOf(':');
  return colon > 0 && s.sessions.includes(id.slice(0, colon));
}

/** What a toggle reports back beyond the new state. */
export interface ToggleResult {
  state: IncognitoState;
  /** Rows the server deleted from shared SQL for a newly incognito project. */
  purgedRows?: number;
  /** Set when the purge could not run — the old rows are still out there. */
  warning?: string;
}

async function post(path: string, body: unknown): Promise<ToggleResult> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as Partial<IncognitoState> & {
    error?: string; purgedRows?: number; warning?: string;
  };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  publish({ projects: data.projects ?? [], sessions: data.sessions ?? [] });
  return { state, purgedRows: data.purgedRows, warning: data.warning };
}

export function setProjectIncognito(path: string, enabled: boolean): Promise<ToggleResult> {
  return post('/api/incognito/project', { path, enabled });
}

export function setSessionIncognito(id: string, enabled: boolean): Promise<ToggleResult> {
  return post('/api/incognito/session', { id, enabled });
}

/**
 * Mark a freshly minted temp terminal id incognito before the PTY spawns.
 * Fire-and-forget by design: the caller is mid-navigation, and the server
 * re-keys the mark onto the real Claude session id once the JSONL appears.
 */
export function markTerminalIncognito(terminalId: string): void {
  void setSessionIncognito(terminalId, true).catch(() => {
    console.warn('[incognito] Failed to mark terminal', terminalId);
  });
}
