import { useEffect, useState } from 'react';
import { X, Send, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { API_BASE } from '@/lib/api-config';

interface DirectoryUser {
  oid: string;
  displayName: string;
  email: string;
  online: boolean;
}

interface HandoffDialogProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  cwd?: string;
  provider: string;
}

/**
 * Sender-side dialog for cross-user session handoff. Picks a teammate, attaches
 * the session transcript text, and posts a handoff the recipient accepts from
 * their Attention panel.
 */
export default function HandoffDialog({ open, onClose, sessionId, cwd, provider }: HandoffDialogProps) {
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [toOid, setToOid] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStatus('idle');
    setError(null);
    setNote('');
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/messaging/users`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json() as { users: DirectoryUser[] };
        setUsers(data.users || []);
        if (data.users?.length) setToOid(data.users[0].oid);
      } catch { /* ignore */ }
    })();
  }, [open]);

  if (!open) return null;

  async function handleSend() {
    if (!toOid || status === 'sending') return;
    setStatus('sending');
    setError(null);
    try {
      // Pull the transcript text so the receiver's machine can rebuild context.
      let transcriptText = '';
      try {
        const tr = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/transcript-markdown`, { credentials: 'include' });
        if (tr.ok) transcriptText = (await tr.json() as { markdown?: string }).markdown || '';
      } catch { /* transcript optional */ }

      const res = await fetch(`${API_BASE}/api/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ toOid, cwd, provider, transcriptText, note: note.trim() || null, sessionId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
      }
      setStatus('sent');
      setTimeout(onClose, 1200);
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Hand off to teammate</h2>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Sends this session's transcript to a teammate. They accept from their Attention panel,
          which starts a fresh {provider} session pre-loaded with the full context.
        </p>

        <div className="space-y-1">
          <label className="text-xs font-medium text-foreground">Recipient</label>
          <select
            value={toOid}
            onChange={(e) => setToOid(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
          >
            {users.length === 0 && <option value="">No teammates found</option>}
            {users.map((u) => (
              <option key={u.oid} value={u.oid}>
                {u.displayName}{u.online ? ' (online)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-foreground">Note (optional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="What should they pick up?"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground resize-none"
          />
        </div>

        {error && <div className="text-xs text-destructive">{error}</div>}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => void handleSend()} disabled={!toOid || status === 'sending' || status === 'sent'} className="gap-1.5">
            {status === 'sending' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : status === 'sent' ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" /> : <Send className="h-3.5 w-3.5" />}
            {status === 'sent' ? 'Sent' : 'Send handoff'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
