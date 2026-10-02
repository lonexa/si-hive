import { useState } from 'react';
import { ExternalLink, Loader2, Server, Undo2, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { peerApi, invalidateHandoffLocks, type SessionHandoffState } from '@/lib/peer-handoff';

interface HandedOffBannerProps {
  sessionId: string;
  lock: NonNullable<SessionHandoffState['lock']>;
  onChanged: () => void;
}

/** Shown on a session whose live copy is on another Hive. */
export default function HandedOffBanner({ sessionId, lock, onChanged }: HandedOffBannerProps) {
  const [busy, setBusy] = useState<'back' | 'unlock' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [confirmUnlock, setConfirmUnlock] = useState(false);

  async function bringBack() {
    setBusy('back');
    setError(null);
    try {
      const r = await peerApi<{ notes: string[] }>('/api/peer-handoffs/bring-back', { sessionId });
      setNotes(r.notes ?? []);
      invalidateHandoffLocks();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function unlock() {
    setBusy('unlock');
    setError(null);
    try {
      await peerApi('/api/peer-handoffs/unlock', { sessionId });
      invalidateHandoffLocks();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setConfirmUnlock(false);
    }
  }

  const openUrl = lock.peerUrl ? `${lock.peerUrl.replace(/\/+$/, '')}/sessions/${encodeURIComponent(sessionId)}` : null;

  return (
    <div className="mx-3 mt-2 rounded-md border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-foreground space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Server className="h-4 w-4 text-sky-500 shrink-0" />
        <span className="flex-1 min-w-0">
          Running on <strong>{lock.peerLabel}</strong> since {new Date(lock.since).toLocaleString()}. This copy is read-only.
        </span>
        {openUrl && (
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <a href={openUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Open there</a>
          </Button>
        )}
        {lock.canBringBack && (
          <Button size="sm" onClick={bringBack} disabled={!!busy} className="gap-1.5"
            data-track="session_detail.bring_back" data-track-category="action">
            {busy === 'back' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
            {busy === 'back' ? 'Bringing back…' : 'Bring back'}
          </Button>
        )}
        {!confirmUnlock ? (
          <Button variant="ghost" size="sm" onClick={() => setConfirmUnlock(true)} disabled={!!busy} className="gap-1.5 text-muted-foreground"
            title="Use this copy again without fetching it (e.g. the other Hive is gone)">
            <Unlock className="h-4 w-4" /> Unlock
          </Button>
        ) : (
          <span className="flex items-center gap-1.5 text-xs">
            Work done on {lock.peerLabel} won&apos;t come back.
            <Button variant="destructive" size="sm" onClick={unlock} disabled={!!busy}>Unlock anyway</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmUnlock(false)}>Cancel</Button>
          </span>
        )}
      </div>
      {!lock.canBringBack && (
        <div className="text-xs text-muted-foreground">
          {lock.peerLabel} isn&apos;t set up as a peer here, so hand it back from there (Settings → Peers to add it).
        </div>
      )}
      {error && <div className="text-xs text-destructive whitespace-pre-wrap">{error}</div>}
      {notes.map((n) => <div key={n} className="text-xs text-muted-foreground">{n}</div>)}
    </div>
  );
}
