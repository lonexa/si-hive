import { useState, type ReactNode } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { API_BASE } from '@/lib/api-config';
import { cn } from '@/lib/utils';

/** Delete a session's transcript and Hive's records of it. Throws with the server's message. */
export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Delete failed (${res.status})`);
  }
}

interface DeleteSessionButtonProps {
  sessionId: string;
  /** What the confirm dialog calls the session. */
  label: string;
  onDeleted?: () => void;
  className?: string;
  /** Button content; defaults to a trash icon. */
  children?: ReactNode;
}

/**
 * Trash button + confirm dialog. Safe inside clickable cards: clicks don't
 * reach the card underneath.
 */
export default function DeleteSessionButton({ sessionId, label, onDeleted, className, children }: DeleteSessionButtonProps) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteSession(sessionId);
      toast.success('Session deleted');
      setOpen(false);
      onDeleted?.();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    // React events from the dialog's portal still bubble to the card; stop them here.
    <span className="contents" onClick={(e) => e.stopPropagation()}>
      <AlertDialog open={open} onOpenChange={(next) => !deleting && setOpen(next)}>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-6 w-6 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10', className)}
            title="Delete session"
            aria-label="Delete session"
            data-track="session.delete"
            data-track-category="action"
          >
            {children ?? <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this session?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p className="font-medium text-foreground break-words">{label}</p>
                <p>
                  Its conversation is deleted from the agent's history, so it can't be resumed or
                  replayed. A Hive terminal running it is closed. Files it changed in the project stay as they are.
                </p>
                <p>This can't be undone.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                // Stay open until the server answers, so an error can be shown.
                e.preventDefault();
                void handleDelete();
              }}
            >
              {deleting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Delete session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}
