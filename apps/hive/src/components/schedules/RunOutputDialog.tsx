import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScheduleRun } from '@/stores/types';

interface RunOutputDialogProps {
  run: ScheduleRun | null;
  onClose: () => void;
}

export default function RunOutputDialog({ run, onClose }: RunOutputDialogProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!run) return;
    await navigator.clipboard.writeText(run.output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const statusColors: Record<string, string> = {
    completed: 'text-green-400 border-green-800',
    failed: 'text-red-400 border-red-800',
    running: 'text-blue-400 border-blue-800',
    pending: 'text-yellow-400 border-yellow-800',
    cancelled: 'text-muted-foreground',
  };

  return (
    <Dialog open={!!run} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            Run Output
            {run && (
              <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', statusColors[run.status])}>
                {run.status}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {run && (
          <>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>Started: {new Date(run.startedAt).toLocaleString()}</span>
              {run.finishedAt && <span>Finished: {new Date(run.finishedAt).toLocaleString()}</span>}
              {run.exitCode !== undefined && <span>Exit code: {run.exitCode}</span>}
              {run.errorMessage && <span className="text-red-400">Error: {run.errorMessage}</span>}
            </div>

            <div className="relative flex-1 min-h-0">
              <Button
                variant="outline"
                size="sm"
                className="absolute top-2 right-2 z-10 h-7 text-xs"
                onClick={() => void handleCopy()}
              >
                {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <pre className="h-full overflow-auto rounded-md bg-muted/50 p-4 text-xs font-mono whitespace-pre-wrap text-foreground min-h-[200px] max-h-[50vh]">
                {run.output || '(no output)'}
              </pre>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
