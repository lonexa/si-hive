import { useEffect, useState } from 'react';
import { X, Send, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { peerApi, invalidateHandoffLocks, type PeerInfo } from '@/lib/peer-handoff';

interface Preview {
  projectRoot: string;
  branch: string | null;
  targetRoot: string;
  targetHasRepo: boolean;
  willStash: boolean;
  willAdopt: boolean;
  peerLaunchFlags: { autoMode: boolean; dangerouslySkipPermissions: boolean };
  changes: { commits: number; modified: number; untracked: number };
}

interface SendToPeerDialogProps {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
  sessionId: string;
  peers: PeerInfo[];
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Hand this session to another SI Hive: its transcript, its code (commits,
 * uncommitted and untracked files), and optionally a next instruction so it
 * keeps working there — e.g. overnight on an always-on server.
 */
export default function SendToPeerDialog({ open, onClose, onSent, sessionId, peers }: SendToPeerDialogProps) {
  const [peerId, setPeerId] = useState(peers[0]?.id ?? '');
  const [instruction, setInstruction] = useState('');
  const [resume, setResume] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setStatus('idle');
    setError(null);
    setNotes([]);
    if (!peers.some((p) => p.id === peerId)) setPeerId(peers[0]?.id ?? '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !peerId) return;
    setPreview(null);
    setPreviewError(null);
    peerApi<Preview>('/api/peer-handoffs/preview', { sessionId, peerId })
      .then(setPreview)
      .catch((e: Error) => setPreviewError(e.message));
  }, [open, peerId, sessionId]);

  if (!open) return null;
  const peer = peers.find((p) => p.id === peerId);
  const asksPermission = preview && !preview.peerLaunchFlags.autoMode && !preview.peerLaunchFlags.dangerouslySkipPermissions;

  async function handleSend() {
    if (!peerId || status === 'sending') return;
    setStatus('sending');
    setError(null);
    try {
      const r = await peerApi<{ notes: string[]; resumed: boolean; targetCwd: string }>(
        '/api/peer-handoffs/send',
        { sessionId, peerId, instruction: instruction.trim() || undefined, resume },
      );
      setNotes(r.notes ?? []);
      setStatus('sent');
      invalidateHandoffLocks();
      onSent();
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Send to another Hive</h2>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Moves this session and its project&apos;s code, including uncommitted and untracked files, to another SI Hive.
          It continues there with its full history. Here it becomes read-only until you bring it back.
        </p>

        <div className="space-y-1">
          <label className="text-xs font-medium text-foreground">Send to</label>
          <select
            value={peerId}
            onChange={(e) => setPeerId(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
          >
            {peers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>

        <div className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground space-y-1">
          {!preview && !previewError && <div className="flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Checking {peer?.label}…</div>}
          {previewError && <div className="text-destructive">{previewError}</div>}
          {preview && (
            <>
              <div>
                Sends {plural(preview.changes.commits, 'commit')}, {plural(preview.changes.modified, 'changed file')} and{' '}
                {plural(preview.changes.untracked, 'untracked file')}{preview.branch ? ` on ${preview.branch}` : ''}.
              </div>
              <div>
                Lands in <span className="font-mono break-all">{preview.targetRoot}</span>
                {preview.targetHasRepo ? '' : ' (new folder)'}.
              </div>
              {preview.willStash && <div>Changes left there by the last handoff will be saved with git stash.</div>}
              {preview.willAdopt && <div>A folder with that name is already there without git. It becomes this repository if its files match; otherwise the send stops and lists the differences.</div>}
            </>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={resume} onChange={(e) => setResume(e.target.checked)} />
          Resume it there right away
        </label>

        {resume && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">Next instruction (optional)</label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={3}
              placeholder="e.g. Keep going with the refactor, run the tests, and summarize when done."
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground resize-none"
            />
            {asksPermission && (
              <div className="flex gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  On {peer?.label}, sessions ask before running commands, so an unattended run may stop and wait.
                  Turn on auto mode there (Permissions) if it should run on its own.
                </span>
              </div>
            )}
          </div>
        )}

        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive whitespace-pre-wrap">{error}</div>}
        {status === 'sent' && (
          <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-foreground space-y-1">
            <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Sent to {peer?.label}.</div>
            {notes.map((n) => <div key={n}>{n}</div>)}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>{status === 'sent' ? 'Close' : 'Cancel'}</Button>
          {status !== 'sent' && (
            <Button size="sm" onClick={handleSend} disabled={!preview || status === 'sending'} className="gap-1.5"
              data-track="session_detail.send_to_peer" data-track-category="action">
              {status === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {status === 'sending' ? 'Sending…' : 'Send'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
