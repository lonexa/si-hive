import { useState, useEffect } from 'react';
import { Loader2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ScheduleRun } from '@/stores/types';
import RunOutputDialog from './RunOutputDialog';

import { API_BASE } from '@/lib/api-config';

interface ScheduleRunHistoryProps {
  scheduleId: string;
  scheduleName: string;
}

export default function ScheduleRunHistory({ scheduleId, scheduleName }: ScheduleRunHistoryProps) {
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [selectedRun, setSelectedRun] = useState<ScheduleRun | null>(null);

  const limit = 20;

  useEffect(() => {
    fetchRuns(0);
  }, [scheduleId]);

  async function fetchRuns(newOffset: number) {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/schedules/${scheduleId}/runs?limit=${limit}&offset=${newOffset}`);
      const data: ScheduleRun[] = await res.json();
      if (newOffset === 0) {
        setRuns(data);
      } else {
        setRuns((prev) => [...prev, ...data]);
      }
      setOffset(newOffset);
      setHasMore(data.length === limit);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  async function viewFullOutput(runId: string) {
    try {
      const res = await fetch(`${API_BASE}/api/schedule-runs/${runId}`);
      const data: ScheduleRun = await res.json();
      setSelectedRun(data);
    } catch { /* ignore */ }
  }

  const statusColors: Record<string, string> = {
    completed: 'text-green-400 border-green-800',
    failed: 'text-red-400 border-red-800',
    running: 'text-blue-400 border-blue-800',
    pending: 'text-yellow-400 border-yellow-800',
    cancelled: 'text-muted-foreground',
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Run History — {scheduleName}</h3>

      {loading && runs.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">No runs yet.</p>
      ) : (
        <>
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 text-muted-foreground">
                  <th className="text-left px-3 py-1.5 font-medium">Status</th>
                  <th className="text-left px-3 py-1.5 font-medium">Started</th>
                  <th className="text-left px-3 py-1.5 font-medium">Duration</th>
                  <th className="text-left px-3 py-1.5 font-medium">Exit</th>
                  <th className="text-left px-3 py-1.5 font-medium">Output</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    className="border-t border-border hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => void viewFullOutput(run.id)}
                  >
                    <td className="px-3 py-1.5">
                      <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', statusColors[run.status])}>
                        {run.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {formatTime(run.startedAt)}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {run.finishedAt ? formatDuration(run.startedAt, run.finishedAt) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground font-mono">
                      {run.exitCode !== undefined ? run.exitCode : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[200px]">
                      {run.output?.slice(0, 100) || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => void fetchRuns(offset + limit)}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ChevronDown className="h-3 w-3 mr-1" />}
              Load More
            </Button>
          )}
        </>
      )}

      <RunOutputDialog
        run={selectedRun}
        onClose={() => setSelectedRun(null)}
      />
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return iso; }
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}
