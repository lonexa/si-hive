import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Timer, Plus, Loader2, Clock, Square, Sparkles, Bug, Code2, PackageCheck, TestTube2, AlertTriangle, FileText, Repeat, ChevronRight, GitPullRequest } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useDashboardStore } from '@/stores/dashboard-store';
import type { Schedule } from '@/stores/types';
import ScheduleCard from './ScheduleCard';
import ScheduleFormDialog, { type ScheduleFormDefaults } from './ScheduleFormDialog';
import ScheduleRunHistory from './ScheduleRunHistory';
import LoopTemplateDialog from './LoopTemplateDialog';

import { API_BASE } from '@/lib/api-config';

interface ScheduleTemplate {
  id: string;
  name: string;
  description: string;
  defaultInterval: string;
  promptTemplate: string;
  scheduleType?: 'claude-prompt' | 'pr-review-pipeline';
}

const TEMPLATE_ICONS: Record<string, typeof Bug> = {
  'bug-hunter': Bug,
  'code-review': Code2,
  'dep-updater': PackageCheck,
  'test-writer': TestTube2,
  'warning-fixer': AlertTriangle,
  'doc-writer': FileText,
  'pr-review-pipeline': GitPullRequest,
  custom: Repeat,
};

const INTERVAL_TO_MS: Record<string, number> = {
  '30s': 30000, '1m': 60000, '5m': 300000, '10m': 600000,
  '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000,
  '6h': 21600000, '8h': 28800000, '12h': 43200000, '24h': 86400000,
};

export default function SchedulesPage() {
  const schedules = useDashboardStore((s) => s.schedules);
  const liveLoops = useDashboardStore((s) => s.liveLoops);
  const sessions = useDashboardStore((s) => s.sessions);
  const navigate = useNavigate();

  const [tab, setTab] = useState<'schedules' | 'loops'>('schedules');
  const [loading, setLoading] = useState(true);

  // Schedule form dialog
  const [formOpen, setFormOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

  // Delete confirmation
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingSchedule, setDeletingSchedule] = useState<Schedule | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Run history
  const [historySchedule, setHistorySchedule] = useState<Schedule | null>(null);

  // Template dialog (for loops)
  const [templateOpen, setTemplateOpen] = useState(false);

  // Schedule template picker
  const [scheduleTemplateOpen, setScheduleTemplateOpen] = useState(false);
  const [scheduleTemplates, setScheduleTemplates] = useState<ScheduleTemplate[]>([]);
  const [formDefaults, setFormDefaults] = useState<ScheduleFormDefaults | null>(null);

  // Project dirs for picker
  const [projectDirs, setProjectDirs] = useState<string[]>([]);

  useEffect(() => {
    // Fetch schedules
    fetch(`${API_BASE}/api/schedules`)
      .then((r) => r.json())
      .then((data: Schedule[]) => useDashboardStore.getState().updateSchedules(data))
      .catch(console.error)
      .finally(() => setLoading(false));

    // Fetch project dirs
    fetch(`${API_BASE}/api/projects`)
      .then((r) => r.json())
      .then((data: { path: string }[]) => {
        setProjectDirs(data.map((p) => p.path));
      })
      .catch(() => {});
  }, []);

  function openScheduleTemplates() {
    fetch(`${API_BASE}/api/loop-templates`)
      .then((r) => r.json())
      .then((data: ScheduleTemplate[]) => setScheduleTemplates(data))
      .catch(() => {});
    setScheduleTemplateOpen(true);
  }

  function selectScheduleTemplate(tpl: ScheduleTemplate) {
    setScheduleTemplateOpen(false);
    setEditingSchedule(null);
    setFormDefaults({
      name: tpl.id === 'custom' ? '' : tpl.id,
      prompt: tpl.promptTemplate,
      intervalMs: INTERVAL_TO_MS[tpl.defaultInterval] ?? 300000,
      skipPermissions: tpl.id !== 'custom',
      type: tpl.scheduleType,
    });
    setFormOpen(true);
  }

  function openCreate() {
    setEditingSchedule(null);
    setFormDefaults(null);
    setFormOpen(true);
  }

  function openEdit(schedule: Schedule) {
    setEditingSchedule(schedule);
    setFormOpen(true);
  }

  function openDelete(schedule: Schedule) {
    setDeletingSchedule(schedule);
    setDeleteOpen(true);
  }

  async function handleDelete() {
    if (!deletingSchedule) return;
    setDeleting(true);
    try {
      await fetch(`${API_BASE}/api/schedules/${deletingSchedule.id}`, { method: 'DELETE' });
      setDeleteOpen(false);
      setDeletingSchedule(null);
    } catch (err) {
      console.error('Failed to delete schedule:', err);
    } finally {
      setDeleting(false);
    }
  }

  async function handleStopLoop(loopId: string) {
    try {
      await fetch(`${API_BASE}/api/loops/${encodeURIComponent(loopId)}`, { method: 'DELETE' });
    } catch { /* ignore */ }
  }

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso; }
  };

  // Group loops by session
  const loopsBySession = new Map<string, typeof liveLoops>();
  for (const loop of liveLoops) {
    const existing = loopsBySession.get(loop.sessionId) ?? [];
    existing.push(loop);
    loopsBySession.set(loop.sessionId, existing);
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Timer className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Schedules</h1>
            <p className="text-sm text-muted-foreground">
              Automated AI tasks and live loops
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'loops' && (
            <Button variant="outline" onClick={() => setTemplateOpen(true)}>
              <Sparkles className="mr-2 h-4 w-4" />
              From Template
            </Button>
          )}
          {tab === 'schedules' && (
            <>
              <Button variant="outline" onClick={openScheduleTemplates}>
                <Sparkles className="mr-2 h-4 w-4" />
                From Template
              </Button>
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                Create Schedule
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border pb-0">
        <button
          onClick={() => { setTab('schedules'); setHistorySchedule(null); }}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'schedules'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          Schedules
          {schedules.length > 0 && (
            <span className="ml-1.5 text-xs text-muted-foreground">({schedules.length})</span>
          )}
        </button>
        <button
          onClick={() => { setTab('loops'); setHistorySchedule(null); }}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'loops'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          Live Loops
          {liveLoops.length > 0 && (
            <span className="ml-1.5 text-xs text-muted-foreground">({liveLoops.length})</span>
          )}
        </button>
      </div>

      {/* Content */}
      {tab === 'schedules' && (
        <>
          {historySchedule ? (
            <div>
              <button
                onClick={() => setHistorySchedule(null)}
                className="text-xs text-muted-foreground hover:text-foreground mb-3 flex items-center gap-1"
              >
                ← Back to schedules
              </button>
              <ScheduleRunHistory scheduleId={historySchedule.id} scheduleName={historySchedule.name} />
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : schedules.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Timer className="h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">No schedules yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Create a schedule to run AI tasks automatically on a timer or cron expression.
                </p>
                <Button variant="outline" size="sm" className="mt-4" onClick={openCreate}>
                  <Plus className="mr-1.5 h-3 w-3" />
                  Create Schedule
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {schedules.map((schedule) => (
                <ScheduleCard
                  key={schedule.id}
                  schedule={schedule}
                  onEdit={openEdit}
                  onDelete={openDelete}
                  onViewHistory={setHistorySchedule}
                />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'loops' && (
        <div>
          {liveLoops.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Clock className="h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">No active loops</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Send /loop commands to active sessions from the session detail page, or use a template.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {Array.from(loopsBySession.entries()).map(([sessionId, loops]) => {
                const session = sessions.find((s) => s.id === sessionId);
                return (
                  <div key={sessionId}>
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1"
                      onClick={() => navigate(`/sessions/${sessionId}`)}
                    >
                      Session: {session?.project ?? sessionId.slice(0, 8)}
                      {session && (
                        <Badge variant="outline" className={cn(
                          'text-[10px] px-1 py-0',
                          session.status === 'working' && 'text-green-400 border-green-800',
                          session.status === 'idle' && 'text-muted-foreground',
                        )}>
                          {session.status}
                        </Badge>
                      )}
                    </button>
                    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                      {loops.map((loop) => (
                        <Card key={loop.id} className={cn(loop.status !== 'active' && 'opacity-60')}>
                          <CardContent className="p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className={cn(
                                'text-[10px] px-1.5 py-0',
                                loop.status === 'active' && 'text-green-400 border-green-800',
                                loop.status === 'stopped' && 'text-muted-foreground',
                                loop.status === 'session_ended' && 'text-yellow-500 border-yellow-800',
                              )}>
                                {loop.interval}
                              </Badge>
                              <Badge variant="outline" className={cn(
                                'text-[10px] px-1.5 py-0',
                                loop.status === 'active' && 'text-green-400 border-green-800',
                                loop.status !== 'active' && 'text-muted-foreground',
                              )}>
                                {loop.status}
                              </Badge>
                              {loop.status === 'active' && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 ml-auto text-muted-foreground hover:text-red-400"
                                  onClick={() => void handleStopLoop(loop.id)}
                                  title="Stop loop"
                                >
                                  <Square className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{loop.prompt}</p>
                            <p className="text-[10px] text-muted-foreground mt-1">
                              Created {formatDate(loop.createdAt)}
                            </p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Form Dialog */}
      <ScheduleFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editingSchedule={editingSchedule}
        projectDirs={projectDirs}
        defaults={formDefaults}
      />

      {/* Schedule Template Picker */}
      <Dialog open={scheduleTemplateOpen} onOpenChange={setScheduleTemplateOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">Create from Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {scheduleTemplates.map((tpl) => {
              const Icon = TEMPLATE_ICONS[tpl.id] ?? Repeat;
              return (
                <button
                  key={tpl.id}
                  onClick={() => selectScheduleTemplate(tpl)}
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
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Schedule</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deletingSchedule?.name}&quot;? All run history will also be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Template Dialog (for Loops) */}
      <LoopTemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
      />
    </div>
  );
}
