import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '@/lib/api-config';
import { getLaunchFlags, getProviderStatus, buildProviderFlags } from '@/lib/launch-flags';
import type { ProviderId } from '@/lib/launch-flags';
import { saveSessionIntent } from '@/lib/session-intent';

export interface IncomingHandoff {
  id: number;
  fromOid: string;
  fromName: string;
  cwd: string | null;
  provider: string;
  note: string | null;
  createdAt: string;
}

const POLL_MS = 15_000;

/**
 * Polls for cross-user session handoffs addressed to the current user and
 * exposes accept/decline. Accepting reuses the local handoff spawn machinery:
 * the server materializes the transcript to a temp file, then we start a fresh
 * session pre-loaded with it.
 */
export function useHandoffPoll(enabled: boolean) {
  const navigate = useNavigate();
  const [handoffs, setHandoffs] = useState<IncomingHandoff[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/handoff/incoming`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json() as { handoffs: IncomingHandoff[] };
      setHandoffs(data.handoffs || []);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const h = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(h);
  }, [enabled, refresh]);

  const accept = useCallback(async (id: number) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(`${API_BASE}/api/handoff/${id}/accept`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { filePath: string; cwd: string | null; provider: string; fromName: string };
      const provider = (data.provider || 'claude') as ProviderId;
      const flags = await getLaunchFlags();
      const statuses = await getProviderStatus();
      const status = statuses.find((p) => p.id === provider);
      const command = status?.resolvedPath || provider;
      const args = buildProviderFlags(provider, flags);
      const initialPrompt = `Read the file at ${data.filePath} for full context from ${data.fromName}'s handed-off session, then continue where it left off.`;
      const termId = `handoff-${provider}-${Date.now()}`;
      const handoff = { command, args, provider, initialPrompt };
      saveSessionIntent(termId, { newSession: true, cwd: data.cwd || undefined, providerId: provider, handoff });
      setHandoffs((hs) => hs.filter((h) => h.id !== id));
      navigate(`/sessions/${termId}`, { state: { newSession: true, cwd: data.cwd || undefined, handoff } });
    } catch {
      /* leave it pending so the user can retry */
    } finally {
      setBusyId(null);
    }
  }, [busyId, navigate]);

  const decline = useCallback(async (id: number) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await fetch(`${API_BASE}/api/handoff/${id}/decline`, { method: 'POST', credentials: 'include' });
      setHandoffs((hs) => hs.filter((h) => h.id !== id));
    } catch {
      /* ignore */
    } finally {
      setBusyId(null);
    }
  }, [busyId]);

  return { handoffs, accept, decline, busyId };
}
