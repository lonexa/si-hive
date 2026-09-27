import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { API_BASE } from '@/lib/api-config';
import { cn } from '@/lib/utils';
import type { ProjectInfo } from './ProjectsPage';

interface RemoveProjectDialogProps {
  project: Pick<ProjectInfo, 'name' | 'path' | 'totalSessions'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved?: () => void;
}

/**
 * Remove a project from Hive. By default this only takes it off the lists;
 * deleting its session history and the folder itself are opt-in, and the
 * folder needs its name typed to confirm.
 */
export default function RemoveProjectDialog({ project, open, onOpenChange, onRemoved }: RemoveProjectDialogProps) {
  const [deleteHistory, setDeleteHistory] = useState(false);
  const [deleteFolder, setDeleteFolder] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDeleteHistory(false);
    setDeleteFolder(false);
    setConfirmName('');
  }, [open]);

  const folderConfirmed = !deleteFolder || confirmName.trim() === project.name;
  const sessions = project.totalSessions;

  const handleRemove = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/projects/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: project.path, deleteHistory, deleteFolder }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string; deletedSessions?: number };
      if (!res.ok) throw new Error(body.error ?? `Remove failed (${res.status})`);
      toast.success(
        deleteFolder ? `Deleted ${project.name}`
          : deleteHistory ? `Removed ${project.name} and ${body.deletedSessions ?? 0} session(s)`
            : `Removed ${project.name} from Hive`,
      );
      onOpenChange(false);
      onRemoved?.();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove "{project.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            It comes off Hive's project and session lists. Nothing is deleted unless you tick a box below.
            Starting a session in the folder later brings it back.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 text-sm">
          <label className={cn('flex items-start gap-2.5', deleteFolder ? 'opacity-60' : 'cursor-pointer')}>
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-destructive"
              checked={deleteHistory || deleteFolder}
              disabled={deleteFolder || busy}
              onChange={(e) => setDeleteHistory(e.target.checked)}
            />
            <span>
              <span className="font-medium text-foreground">
                Also delete its session history{sessions > 0 ? ` (${sessions} session${sessions === 1 ? '' : 's'})` : ''}
              </span>
              <span className="block text-xs text-muted-foreground">
                The conversations can't be resumed or replayed afterwards. Running Hive terminals in the project are closed.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-destructive"
              checked={deleteFolder}
              disabled={busy}
              onChange={(e) => setDeleteFolder(e.target.checked)}
            />
            <span className="min-w-0">
              <span className="font-medium text-destructive">Also delete the folder from disk</span>
              <span className="block break-all font-mono text-xs text-muted-foreground">{project.path}</span>
            </span>
          </label>

          {deleteFolder && (
            <div className="space-y-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-xs text-foreground">
                Every file in this folder is permanently deleted, including uncommitted and unpushed work.
                Type <span className="font-mono font-semibold">{project.name}</span> to confirm.
              </p>
              <input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                disabled={busy}
                autoFocus
                spellCheck={false}
                className="h-9 w-full rounded-md border border-border bg-background px-2 font-mono text-sm outline-none focus:border-destructive"
              />
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={busy || !folderConfirmed}
            onClick={(e) => {
              // Stay open until the server answers, so an error can be shown.
              e.preventDefault();
              void handleRemove();
            }}
          >
            {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {deleteFolder ? 'Delete project' : 'Remove'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
