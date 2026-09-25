import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Bug, Code2, PackageCheck, TestTube2, Repeat, ChevronRight, ArrowLeft, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDashboardStore } from '@/stores/dashboard-store';

import { API_BASE } from '@/lib/api-config';

const INTERVAL_PRESETS = ['30s', '1m', '5m', '15m', '30m', '1h', '4h', '8h', '24h'] as const;

interface LoopTemplate {
  id: string;
  name: string;
  description: string;
  defaultInterval: string;
  promptTemplate: string;
  configFields: { key: string; label: string; type: string; placeholder?: string }[];
}

const TEMPLATE_ICONS: Record<string, typeof Bug> = {
  'bug-hunter': Bug,
  'code-review': Code2,
  'dep-updater': PackageCheck,
  'test-writer': TestTube2,
  custom: Repeat,
};

interface LoopTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

export default function LoopTemplateDialog({ open, onOpenChange, onCreated }: LoopTemplateDialogProps) {
  const [templates, setTemplates] = useState<LoopTemplate[]>([]);
  const [selected, setSelected] = useState<LoopTemplate | null>(null);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [interval, setInterval] = useState('');
  const [prompt, setPrompt] = useState('');
  const [taskName, setTaskName] = useState('');
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'pick' | 'configure'>('pick');

  const sessions = useDashboardStore((s) => s.sessions);
  const activeSessions = sessions.filter((s) => s.status === 'working' || s.status === 'waiting-input' || s.status === 'done' || s.status === 'paused');
  const [selectedSessionId, setSelectedSessionId] = useState('');

  useEffect(() => {
    if (open) {
      fetch(`${API_BASE}/api/loop-templates`)
        .then((r) => r.json())
        .then((data: LoopTemplate[]) => setTemplates(data))
        .catch(() => {});
      setSelected(null);
      setMode('pick');
      setConfig({});
      setPrompt('');
      setTaskName('');
      setSaving(false);
    }
  }, [open]);

  function selectTemplate(tpl: LoopTemplate) {
    setSelected(tpl);
    setInterval(tpl.defaultInterval);
    setPrompt(tpl.promptTemplate);
    setTaskName(tpl.id === 'custom' ? '' : tpl.id);
    setConfig({});
    setMode('configure');
  }

  function buildFinalPrompt(): string {
    let p = prompt;
    for (const [, val] of Object.entries(config)) {
      if (val) p = `Project: ${val}\n\n${p}`;
    }
    return p;
  }

  async function createAsDesktopTask() {
    if (!taskName.trim() || !prompt.trim()) return;
    setSaving(true);
    try {
      const content = `---
interval: ${interval}
template: ${selected?.id ?? 'custom'}
---

${buildFinalPrompt()}`;

      const res = await fetch(`${API_BASE}/api/scheduled-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: taskName.trim(), content }),
      });
      if (res.ok) {
        onOpenChange(false);
        onCreated?.();
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  async function sendToSession() {
    if (!selectedSessionId || !prompt.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/loops/${encodeURIComponent(selectedSessionId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval, prompt: buildFinalPrompt() }),
      });
      if (res.ok) {
        onOpenChange(false);
        onCreated?.();
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {mode === 'pick' ? 'Create from Template' : (
              <button
                onClick={() => setMode('pick')}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span className="text-foreground">{selected?.name}</span>
              </button>
            )}
          </DialogTitle>
        </DialogHeader>

        {mode === 'pick' && (
          <div className="space-y-2">
            {templates.map((tpl) => {
              const Icon = TEMPLATE_ICONS[tpl.id] ?? Repeat;
              return (
                <button
                  key={tpl.id}
                  onClick={() => selectTemplate(tpl)}
                  className="w-full flex items-center gap-3 p-3 rounded-md border border-border hover:border-foreground/20 hover:bg-accent/50 text-left transition-colors"
                >
                  <div className="h-8 w-8 rounded-md bg-accent flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4 text-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">{tpl.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1 py-0 text-muted-foreground">
                        {tpl.defaultInterval}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{tpl.description}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </div>
        )}

        {mode === 'configure' && selected && (
          <div className="space-y-4">
            {/* Config fields */}
            {selected.configFields.map((field) => (
              <div key={field.key} className="space-y-1">
                <label className="text-xs text-muted-foreground">{field.label}</label>
                <Input
                  value={config[field.key] ?? ''}
                  onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
                  placeholder={field.placeholder ?? (field.type === 'directory' ? (navigator.platform.includes('Win') ? 'C:\\path\\to\\project' : '/path/to/project') : '')}
                  className="text-xs h-8"
                />
              </div>
            ))}

            {/* Interval */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Interval</label>
              <div className="flex gap-1 flex-wrap">
                {INTERVAL_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setInterval(preset)}
                    className={cn(
                      'px-2 py-0.5 text-[10px] rounded border',
                      interval === preset
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/20'
                    )}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full h-32 text-xs p-2 rounded border border-border bg-background text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring font-mono"
              />
            </div>

            {/* Task name (for desktop task) */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Task name (for Desktop Task)</label>
              <Input
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                placeholder="e.g., bug-hunter"
                className="text-xs h-8"
              />
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 pt-2 border-t border-border">
              <Button
                size="sm"
                className="w-full text-xs"
                disabled={!taskName.trim() || !prompt.trim() || saving}
                onClick={() => void createAsDesktopTask()}
              >
                {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                Create as Desktop Task
              </Button>

              <div className="flex items-center gap-2">
                <select
                  value={selectedSessionId}
                  onChange={(e) => setSelectedSessionId(e.target.value)}
                  className="flex-1 text-xs h-8 px-2 rounded border border-border bg-background text-foreground"
                >
                  <option value="">Select session...</option>
                  {activeSessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.project} ({s.status})
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs shrink-0"
                  disabled={!selectedSessionId || !prompt.trim() || saving}
                  onClick={() => void sendToSession()}
                >
                  Send to Session
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
