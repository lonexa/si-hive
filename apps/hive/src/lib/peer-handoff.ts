/**
 * Client for the Peer Hives module (server/peers/routes.ts): hand a session to
 * another SI Hive and bring it back.
 */
import { useEffect, useState, useCallback } from 'react';
import { API_BASE } from '@/lib/api-config';

export interface PeerInfo {
  id: string;
  label: string;
  baseUrl: string;
  hasToken: boolean;
}

export interface SessionHandoffState {
  peers: PeerInfo[];
  lock: { peerLabel: string; peerUrl: string | null; since: string; remoteRoot: string | null; canBringBack: boolean } | null;
  arrived: { from: string; at: string } | null;
}

export interface HandoffLock {
  sessionId: string;
  peerLabel: string;
  peerUrl: string | null;
  since: string;
}

export async function peerApi<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Failed (${res.status})`);
  return data as T;
}

/** Handoff state for one session. Null while loading or when the module is off. */
export function useSessionHandoff(sessionId: string | undefined) {
  const [state, setState] = useState<SessionHandoffState | null>(null);
  const reload = useCallback(() => {
    if (!sessionId) return;
    peerApi<SessionHandoffState>(`/api/peer-handoffs/session/${encodeURIComponent(sessionId)}`)
      .then(setState)
      .catch(() => setState(null));
  }, [sessionId]);
  useEffect(() => { reload(); }, [reload]);
  return { state, reload };
}

// One shared poll for the session list badges, however many cards render.
let locks = new Map<string, HandoffLock>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function refreshLocks(): void {
  peerApi<{ locks: HandoffLock[] }>('/api/peer-handoffs/locks')
    .then((d) => { locks = new Map(d.locks.map((l) => [l.sessionId, l])); })
    .catch(() => { locks = new Map(); })
    .finally(() => listeners.forEach((l) => l()));
}

export function invalidateHandoffLocks(): void {
  refreshLocks();
}

/** The peer a session was handed to, if it is locked here. */
export function useHandoffLock(sessionId: string | undefined): HandoffLock | undefined {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (!timer) {
      refreshLocks();
      timer = setInterval(refreshLocks, 30_000);
    }
    return () => {
      listeners.delete(l);
      if (listeners.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return sessionId ? locks.get(sessionId) : undefined;
}
