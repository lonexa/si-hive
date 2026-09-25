import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Schedule } from '@/stores/types';
import ProjectPathPicker from '@/components/shared/ProjectPathPicker';
import ProviderPicker from '@hive/shared/components/ProviderPicker';
import { getProviderStatus, getPrimaryProviderId } from '@/lib/launch-flags';
import type { ProviderId, ProviderStatus } from '@/lib/launch-flags';

import { API_BASE } from '@/lib/api-config';

const INTERVAL_PRESETS: { label: string; ms: number }[] = [
  { label: '30s', ms: 30000 },
  { label: '1m', ms: 60000 },
  { label: '5m', ms: 300000 },
  { label: '15m', ms: 900000 },
  { label: '30m', ms: 1800000 },
  { label: '1h', ms: 3600000 },
  { label: '4h', ms: 14400000 },
  { label: '8h', ms: 28800000 },
  { label: '24h', ms: 86400000 },
];

export interface ScheduleFormDefaults {
  name?: string;
  prompt?: string;
  intervalMs?: number;
  projectPath?: string;
  skipPermissions?: boolean;
  type?: 'claude-prompt' | 'pr-review-pipeline';
}

interface ScheduleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingSchedule: Schedule | null;
  projectDirs: string[];
  defaults?: ScheduleFormDefaults | null;
}

export default function ScheduleFormDialog({ open, onOpenChange, editingSchedule, projectDirs, defaults }: ScheduleFormDialogProps) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [scheduleType, setScheduleType] = useState<'interval' | 'cron'>('interval');
  const [intervalMs, setIntervalMs] = useState(300000);
  const [cronExpression, setCronExpression] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [autoMode, setAutoMode] = useState(false);
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [maxRunsKept, setMaxRunsKept] = useState(50);
  const [maxActivePrs, setMaxActivePrs] = useState(0);
  const [saving, setSaving] = useState(false);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('claude');

  useEffect(() => {
    if (open) {
      getProviderStatus().then((ps) => {
        const enabled = ps.filter((p) => p.enabled);
        setProviders(enabled);
      });
      if (editingSchedule) {
        setName(editingSchedule.name);
        setPrompt(editingSchedule.prompt);
        setScheduleType(editingSchedule.cronExpression ? 'cron' : 'interval');
        setIntervalMs(editingSchedule.intervalMs ?? 300000);
        setCronExpression(editingSchedule.cronExpression ?? '');
        setProjectPath(editingSchedule.projectPath ?? '');
        setAutoMode(editingSchedule.launchFlags?.autoMode ?? false);
        setSkipPermissions(editingSchedule.launchFlags?.dangerouslySkipPermissions ?? false);
        setMaxRunsKept(editingSchedule.maxRunsKept);
        setMaxActivePrs((editingSchedule as unknown as Record<string, unknown>).maxActivePrs as number ?? 0);
        setSelectedProvider((editingSchedule as unknown as Record<string, unknown>).provider as ProviderId ?? 'claude');
      } else {
        setName(defaults?.name ?? '');
        setPrompt(defaults?.prompt ?? '');
        setScheduleType('interval');
        setIntervalMs(defaults?.intervalMs ?? 300000);
        setCronExpression('');
        setProjectPath(defaults?.projectPath ?? '');
        setAutoMode(false);
        setSkipPermissions(defaults?.skipPermissions ?? false);
        setMaxRunsKept(50);
        setMaxActivePrs(0);
        getPrimaryProviderId().then(setSelectedProvider);
      }
    }
  }, [open, editingSchedule, defaults]);

  async function handleSave() {
    const isPipeline = defaults?.type === 'pr-review-pipeline';
    if (!name.trim() || (!prompt.trim() && !isPipeline)) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        prompt: prompt.trim() || (isPipeline ? 'PR Review Pipeline (automated)' : ''),
        projectPath: projectPath || undefined,
        maxRunsKept,
        maxActivePrs,
        launchFlags: { autoMode, dangerouslySkipPermissions: skipPermissions },
        provider: selectedProvider,
      };
      if (isPipeline) body.type = 'pr-review-pipeline';
      if (scheduleType === 'cron') {
        body.cronExpression = cronExpression.trim();
        body.intervalMs = null;
      } else {
        body.intervalMs = intervalMs;
        body.cronExpression = null;
      }

      if (editingSchedule) {
        await fetch(`${API_BASE}/api/schedules/${editingSchedule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await fetch(`${API_BASE}/api/schedules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to save schedule:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingSchedule ? 'Edit Schedule' : 'Create Schedule'}</DialogTitle>
          <DialogDescription>
            {editingSchedule ? 'Update the schedule configuration.' : 'Create a new scheduled AI task.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Name</label>
            <Input
              placeholder="e.g., daily-code-review"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Prompt</label>
            <Textarea
              className="min-h-[160px] font-mono text-xs"
              placeholder="What should AI do on each run?"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          {providers.length > 1 && (
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">AI Provider</label>
              <ProviderPicker
                value={selectedProvider}
                onChange={setSelectedProvider}
                enabledProviders={providers}
                size="md"
              />
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Schedule Type</label>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setScheduleType('interval')}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md border',
                  scheduleType === 'interval'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                Interval
              </button>
              <button
                type="button"
                onClick={() => setScheduleType('cron')}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md border',
                  scheduleType === 'cron'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                Cron Expression
              </button>
            </div>

            {scheduleType === 'interval' ? (
              <div className="flex gap-1.5 flex-wrap">
                {INTERVAL_PRESETS.map((preset) => (
                  <button
                    key={preset.ms}
                    type="button"
                    onClick={() => setIntervalMs(preset.ms)}
                    className={cn(
                      'px-2.5 py-1 text-xs rounded border',
                      intervalMs === preset.ms
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/20'
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            ) : (
              <div>
                <Input
                  placeholder="*/5 * * * * (every 5 minutes)"
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  className="font-mono"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Format: minute hour day-of-month month day-of-week
                </p>
              </div>
            )}
          </div>

          <ProjectPathPicker
            value={projectPath}
            onChange={setProjectPath}
            availableDirs={projectDirs}
          />

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Launch Flags</label>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={skipPermissions}
                  onChange={(e) => setSkipPermissions(e.target.checked)}
                  className="rounded"
                />
                Skip permissions (dangerously)
              </label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoMode}
                  onChange={(e) => setAutoMode(e.target.checked)}
                  className="rounded"
                />
                Auto mode
              </label>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Max Runs to Keep</label>
            <Input
              type="number"
              min={1}
              max={500}
              value={maxRunsKept}
              onChange={(e) => setMaxRunsKept(parseInt(e.target.value, 10) || 50)}
              className="w-24"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Max Active PRs</label>
            <Input
              type="number"
              min={0}
              max={50}
              value={maxActivePrs}
              onChange={(e) => setMaxActivePrs(parseInt(e.target.value, 10) || 0)}
              className="w-24"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Skip runs when this many automated PRs are open (0 = unlimited)
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void handleSave()} disabled={saving || !name.trim() || !prompt.trim()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {saving ? 'Saving...' : editingSchedule ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
