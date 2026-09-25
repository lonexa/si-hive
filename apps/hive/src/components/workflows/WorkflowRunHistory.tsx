import { useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Clock, ChevronDown, ChevronRight, MailWarning } from 'lucide-react';
import type { WorkflowRun } from '@/stores/workflow-store';

interface Props {
  runs: WorkflowRun[];
}

function formatDuration(ms: number | null): string {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const STATUS_ICONS = {
  completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
  running: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
};

export function WorkflowRunHistory({ runs }: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (runs.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        No runs yet. Trigger a manual run or wait for the schedule.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {runs.map((run) => (
        <div key={run.id} className="rounded-md border">
          <button
            className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent/50 transition-colors"
            onClick={() => setExpandedId(expandedId === run.id ? null : run.id)}
          >
            {expandedId === run.id ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            {STATUS_ICONS[run.status]}
            <span className="text-xs text-muted-foreground flex-1">{formatTime(run.startedAt)}</span>
            {run.notifyError && (
              <span title="Notification delivery failed">
                <MailWarning className="h-3.5 w-3.5 text-amber-500" />
              </span>
            )}
            <span className="text-xs text-muted-foreground">{formatDuration(run.durationMs)}</span>
          </button>

          {expandedId === run.id && (
            <div className="px-3 pb-3 border-t">
              {run.errorMessage && (
                <div className="mt-2 text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">
                  {run.errorMessage}
                </div>
              )}
              {run.notifyError && (
                <div className="mt-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded px-2 py-1.5 flex items-start gap-1.5">
                  <MailWarning className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium">Notification not delivered</span>
                    <pre className="whitespace-pre-wrap font-sans mt-0.5">{run.notifyError}</pre>
                  </div>
                </div>
              )}
              {run.output && (
                <pre className="mt-2 text-xs text-muted-foreground bg-muted rounded px-2 py-1.5 overflow-x-auto max-h-48 whitespace-pre-wrap">
                  {run.output}
                </pre>
              )}
              {run.dataJson && (
                <details className="mt-2">
                  <summary className="text-xs text-muted-foreground cursor-pointer">Raw Data</summary>
                  <pre className="mt-1 text-xs text-muted-foreground bg-muted rounded px-2 py-1.5 overflow-x-auto max-h-32">
                    {JSON.stringify(JSON.parse(run.dataJson), null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
