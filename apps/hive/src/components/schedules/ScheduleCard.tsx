import { useState, useEffect } from 'react';
import { Play, Pencil, Trash2, Loader2, Clock, Calendar, ToggleLeft, ToggleRight, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import AISessionButton from '@/components/shared/AISessionButton';
import { scheduleDebug } from '@/lib/prompt-templates';
import { resolveDefaultProjectDir } from '@/lib/project-mappings';
import type { Schedule } from '@/stores/types';

import { API_BASE } from '@/lib/api-config';

interface ScheduleCardProps {
  schedule: Schedule;
  onEdit: (schedule: Schedule) => void;
  onDelete: (schedule: Schedule) => void;
  onViewHistory: (schedule: Schedule) => void;
}

export default function ScheduleCard({ schedule, onEdit, onDelete, onViewHistory }: ScheduleCardProps) {
  const [toggling, setToggling] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [debugCwd, setDebugCwd] = useState(schedule.projectPath || '');

  useEffect(() => {
    if (!schedule.projectPath) {
      resolveDefaultProjectDir().then(setDebugCwd);
    }
  }, [schedule.projectPath]);

  // Tick every 10s to update the countdown
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(interval);
  }, []);

  async function handleToggle() {
    setToggling(true);
    try {
      await fetch(`${API_BASE}/api/schedules/${schedule.id}/toggle`, { method: 'POST' });
    } catch { /* ignore */ }
    finally { setToggling(false); }
  }

  async function handleRunNow() {
    setTriggering(true);
    try {
      await fetch(`${API_BASE}/api/schedules/${schedule.id}/run`, { method: 'POST' });
    } catch { /* ignore */ }
    finally { setTriggering(false); }
  }

  const scheduleDisplay = schedule.cronExpression
    ? `cron: ${schedule.cronExpression}`
    : schedule.intervalMs
      ? formatInterval(schedule.intervalMs)
      : 'No schedule';

  const lastRunStatus = schedule.lastRunAt ? 'ran ' + formatRelative(schedule.lastRunAt, now) + ' ago' : null;

  return (
    <Card className={cn('group', !schedule.enabled && 'opacity-60')}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium truncate">{schedule.name}</h3>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {schedule.cronExpression ? <Calendar className="h-2.5 w-2.5 mr-1 inline" /> : <Clock className="h-2.5 w-2.5 mr-1 inline" />}
                {scheduleDisplay}
              </Badge>
              {schedule.enabled && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-green-400 border-green-800">
                  active
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={handleRunNow}
              disabled={triggering}
              title="Run Now"
            >
              {triggering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => onEdit(schedule)}
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-red-500"
              onClick={() => onDelete(schedule)}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <AISessionButton
              cwd={debugCwd}
              prompt={scheduleDebug(schedule.name, schedule.cronExpression || formatInterval(schedule.intervalMs || 0), '')}
              variant="icon-only"
              size="icon"
              tooltip="Debug Schedule"
              className="h-7 w-7"
            />
          </div>
        </div>

        <pre className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2 max-h-16 overflow-hidden whitespace-pre-wrap font-mono mb-2">
          {schedule.prompt.slice(0, 200)}{schedule.prompt.length > 200 ? '...' : ''}
        </pre>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggle}
              disabled={toggling}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title={schedule.enabled ? 'Disable' : 'Enable'}
            >
              {schedule.enabled
                ? <ToggleRight className="h-5 w-5 text-green-400" />
                : <ToggleLeft className="h-5 w-5" />
              }
            </button>
            {schedule.projectPath && (
              <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]" title={schedule.projectPath}>
                {schedule.projectPath.split(/[\\/]/).pop()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {schedule.nextRunAt && schedule.enabled && (
              <span className="text-[10px] text-muted-foreground">
                next: {formatRelative(schedule.nextRunAt, now)}
              </span>
            )}
            {lastRunStatus && (
              <span className="text-[10px] text-muted-foreground">
                {lastRunStatus}
              </span>
            )}
            <button
              onClick={() => onViewHistory(schedule)}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
            >
              <History className="h-3 w-3" />
              History
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatInterval(ms: number): string {
  if (ms < 60000) return `${ms / 1000}s`;
  if (ms < 3600000) return `${ms / 60000}m`;
  if (ms < 86400000) return `${ms / 3600000}h`;
  return `${ms / 86400000}d`;
}

function formatRelative(iso: string, now: number): string {
  const target = new Date(iso).getTime();
  const diff = target - now;
  const absDiff = Math.abs(diff);
  if (absDiff < 60000) return `${Math.round(absDiff / 1000)}s`;
  if (absDiff < 3600000) return `${Math.round(absDiff / 60000)}m`;
  if (absDiff < 86400000) return `${(absDiff / 3600000).toFixed(1)}h`;
  return `${Math.round(absDiff / 86400000)}d`;
}
