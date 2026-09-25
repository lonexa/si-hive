import { useState, useEffect, useMemo, useCallback } from 'react';
import { Clock, Timer, PenLine, FolderOpen, AlertTriangle, RefreshCw, Plus, X } from 'lucide-react';
import AISessionButton from '@/components/shared/AISessionButton';
import { metricInvestigation } from '@/lib/prompt-templates';
import { resolveDefaultProjectDir } from '@/lib/project-mappings';

import { API_BASE } from '@/lib/api-config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AutoTimeRow {
  Username: string;
  ProjectPath: string | null;
  TotalSeconds: number;
  EntryDate: string;
}

interface ManualTimeRow {
  Id: number;
  Username: string;
  ProjectPath: string | null;
  WorkItemId: number | null;
  Hours: number;
  Description: string | null;
  Source: string;
  EntryDate: string;
  CreatedAt: string;
}

interface DevOpsTimeRow {
  id: number;
  title: string;
  completedWork: number | null;
  remainingWork: number | null;
  assignedTo: string | null;
  state: string;
}

interface TimeData {
  autoTime: AutoTimeRow[];
  manualTime: ManualTimeRow[];
  devOpsTime: DevOpsTimeRow[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatHours(seconds: number): string {
  const h = seconds / 3600;
  return h.toFixed(1);
}

function getWeekDates(): { start: Date; end: Date; days: Date[] } {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  const start = new Date(now);
  start.setDate(diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return { start, end, days };
}

function dateKey(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TimeTab() {
  const [data, setData] = useState<TimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Manual entry form state
  const [formUsername, setFormUsername] = useState('');
  const [formProject, setFormProject] = useState('');
  const [formWorkItemId, setFormWorkItemId] = useState('');
  const [formHours, setFormHours] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [analysisCwd, setAnalysisCwd] = useState('');

  useEffect(() => {
    resolveDefaultProjectDir().then(setAnalysisCwd);
  }, []);

  // Hook-driven turn tracking state
  const [activeSessions, setActiveSessions] = useState<Array<{ sessionId: string; project: string; startTime: string }>>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Auto time now comes from the UserPromptSubmit → Stop hook pair
      // (turn_blocks). The legacy SQL Server claude_usage_log + SessionTimeTracker
      // data is no longer fetched — those measured session-window time, not AI work.
      const [sqlRes, turnByProjectRes, turnActiveRes] = await Promise.all([
        fetch(`${API_BASE}/api/analytics/time?days=${days}`).catch(() => null),
        fetch(`${API_BASE}/api/analytics/time/turns/by-project?days=${days}`).catch(() => null),
        fetch(`${API_BASE}/api/analytics/time/turns/active`).catch(() => null),
      ]);

      // SQL Server data — only used for manual entries + DevOps now
      let json: TimeData = { autoTime: [], manualTime: [], devOpsTime: [], warnings: [] };
      if (sqlRes?.ok) {
        const sqlJson = await sqlRes.json();
        json = {
          autoTime: [],
          manualTime: sqlJson.manualTime || [],
          devOpsTime: sqlJson.devOpsTime || [],
          warnings: (sqlJson.warnings || []).filter((w: string) => !w.includes('claude_usage_log')),
        };
      } else if (sqlRes) {
        const body = await sqlRes.json().catch(() => ({}));
        json.warnings.push(body.error || 'SQL Server time data unavailable');
      }

      // Hook-driven per-project turn totals
      if (turnByProjectRes?.ok) {
        const t = await turnByProjectRes.json();
        json.autoTime = ((t.rows || []) as Array<{ date: string; project: string; totalSeconds: number }>).map((r) => ({
          Username: 'local',
          ProjectPath: r.project,
          TotalSeconds: r.totalSeconds,
          EntryDate: r.date,
        }));
      }

      // Active turns
      if (turnActiveRes?.ok) {
        const a = await turnActiveRes.json();
        setActiveSessions(a.active || []);
      }

      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Submit manual time entry
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${API_BASE}/api/analytics/time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: formUsername,
          projectPath: formProject,
          workItemId: formWorkItemId ? parseInt(formWorkItemId, 10) : null,
          hours: parseFloat(formHours),
          description: formDescription,
          entryDate: formDate,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setShowForm(false);
      setFormUsername('');
      setFormProject('');
      setFormWorkItemId('');
      setFormHours('');
      setFormDescription('');
      setFormDate(new Date().toISOString().slice(0, 10));
      fetchData();
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  // Summary calculations
  const summary = useMemo(() => {
    if (!data) return { totalHours: 0, autoHours: 0, manualHours: 0, activeProjects: 0, weekAutoHours: 0, weekManualHours: 0 };

    const autoSeconds = data.autoTime.reduce((sum, r) => sum + r.TotalSeconds, 0);
    const manualHrs = data.manualTime.reduce((sum, r) => sum + r.Hours, 0);
    const projects = new Set<string>();
    data.autoTime.forEach((r) => { if (r.ProjectPath) projects.add(r.ProjectPath); });
    data.manualTime.forEach((r) => { if (r.ProjectPath) projects.add(r.ProjectPath); });

    const week = getWeekDates();
    const weekStart = dateKey(week.start);
    const weekEnd = dateKey(week.end);

    const weekAutoSec = data.autoTime
      .filter((r) => { const dk = dateKey(r.EntryDate); return dk >= weekStart && dk <= weekEnd; })
      .reduce((sum, r) => sum + r.TotalSeconds, 0);

    const weekManualHrs = data.manualTime
      .filter((r) => { const dk = dateKey(r.EntryDate); return dk >= weekStart && dk <= weekEnd; })
      .reduce((sum, r) => sum + r.Hours, 0);

    return {
      totalHours: autoSeconds / 3600 + manualHrs,
      autoHours: autoSeconds / 3600,
      manualHours: manualHrs,
      activeProjects: projects.size,
      weekAutoHours: weekAutoSec / 3600,
      weekManualHours: weekManualHrs,
    };
  }, [data]);

  // Weekly timesheet grid
  const weekGrid = useMemo(() => {
    if (!data) return { projects: [] as string[], grid: {} as Record<string, Record<string, number>>, days: [] as Date[] };

    const week = getWeekDates();
    const weekStart = dateKey(week.start);
    const weekEnd = dateKey(week.end);

    const projectSet = new Set<string>();
    const grid: Record<string, Record<string, number>> = {};

    // Auto time
    data.autoTime
      .filter((r) => { const dk = dateKey(r.EntryDate); return dk >= weekStart && dk <= weekEnd; })
      .forEach((r) => {
        const proj = r.ProjectPath || 'Unknown';
        projectSet.add(proj);
        if (!grid[proj]) grid[proj] = {};
        const dk = dateKey(r.EntryDate);
        grid[proj][dk] = (grid[proj][dk] || 0) + r.TotalSeconds / 3600;
      });

    // Manual time
    data.manualTime
      .filter((r) => { const dk = dateKey(r.EntryDate); return dk >= weekStart && dk <= weekEnd; })
      .forEach((r) => {
        const proj = r.ProjectPath || 'Unknown';
        projectSet.add(proj);
        if (!grid[proj]) grid[proj] = {};
        const dk = dateKey(r.EntryDate);
        grid[proj][dk] = (grid[proj][dk] || 0) + r.Hours;
      });

    return { projects: Array.from(projectSet).sort(), grid, days: week.days };
  }, [data]);

  // Per-ticket accumulation from DevOps
  const ticketTime = useMemo(() => {
    if (!data) return [];
    return data.devOpsTime
      .filter((r) => r.completedWork != null || r.remainingWork != null)
      .sort((a, b) => (b.completedWork ?? 0) - (a.completedWork ?? 0));
  }, [data]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" />
        Loading time data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-destructive">
        <AlertTriangle className="h-8 w-8 mb-2" />
        <p className="text-sm font-medium mb-1">Failed to load time data</p>
        <p className="text-xs text-muted-foreground mb-3">{error}</p>
        <button onClick={fetchData} className="text-xs px-3 py-1 rounded border border-border hover:bg-accent">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Warnings */}
      {data?.warnings && data.warnings.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
            <div className="text-xs text-yellow-200 space-y-1">
              {data.warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Period:</label>
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
            className="text-xs bg-background border border-border rounded px-2 py-1"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90">
            {showForm ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            {showForm ? 'Cancel' : 'Log Time'}
          </button>
          <button onClick={fetchData} className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent" title="Refresh">
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Active Sessions Banner */}
      {activeSessions.length > 0 && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-md p-3">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-medium text-green-400">
              {activeSessions.length} turn{activeSessions.length !== 1 ? 's' : ''} in progress
            </span>
          </div>
          <div className="mt-2 space-y-1">
            {activeSessions.map((s) => (
              <div key={s.sessionId} className="text-xs text-muted-foreground flex items-center gap-2">
                <Timer className="h-3 w-3 text-green-400" />
                <span className="truncate">{s.project}</span>
                <span className="text-[10px] text-muted-foreground/60 shrink-0">since {new Date(s.startTime).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-blue-400" />
            <span className="text-xs text-muted-foreground">This Week Total</span>
          </div>
          <p className="text-2xl font-bold">{(summary.weekAutoHours + summary.weekManualHours).toFixed(1)}h</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Timer className="h-4 w-4 text-green-400" />
            <span className="text-xs text-muted-foreground">Auto-Tracked</span>
          </div>
          <p className="text-2xl font-bold">{summary.weekAutoHours.toFixed(1)}h</p>
          <p className="text-xs text-muted-foreground mt-1">{summary.autoHours.toFixed(1)}h total ({days}d)</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <PenLine className="h-4 w-4 text-purple-400" />
            <span className="text-xs text-muted-foreground">Manual</span>
          </div>
          <p className="text-2xl font-bold">{summary.weekManualHours.toFixed(1)}h</p>
          <p className="text-xs text-muted-foreground mt-1">{summary.manualHours.toFixed(1)}h total ({days}d)</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <FolderOpen className="h-4 w-4 text-orange-400" />
            <span className="text-xs text-muted-foreground">Active Projects</span>
          </div>
          <p className="text-2xl font-bold">{summary.activeProjects}</p>
        </div>
      </div>

      {/* Manual Time Entry Form */}
      {showForm && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Log Manual Time</h3>
          {submitError && (
            <div className="bg-destructive/10 border border-destructive/30 rounded p-2 mb-3 text-xs text-destructive">
              {submitError}
            </div>
          )}
          <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Username *</label>
              <input
                type="text"
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value)}
                required
                className="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
                placeholder="alex"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Project *</label>
              <input
                type="text"
                value={formProject}
                onChange={(e) => setFormProject(e.target.value)}
                required
                className="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
                placeholder="my-app"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Work Item ID</label>
              <input
                type="number"
                value={formWorkItemId}
                onChange={(e) => setFormWorkItemId(e.target.value)}
                className="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
                placeholder="12345"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Hours *</label>
              <input
                type="number"
                step="0.25"
                min="0.25"
                value={formHours}
                onChange={(e) => setFormHours(e.target.value)}
                required
                className="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
                placeholder="2.5"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Date *</label>
              <input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                required
                className="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Description</label>
              <input
                type="text"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                className="w-full text-xs bg-background border border-border rounded px-2 py-1.5"
                placeholder="What did you work on?"
              />
            </div>
            <div className="col-span-3 flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="text-xs px-4 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Save Entry'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Weekly Timesheet Grid */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-medium mb-3">Weekly Timesheet</h3>
        {weekGrid.projects.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No time entries this week.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs text-muted-foreground font-medium py-2 pr-4">Project</th>
                  {weekGrid.days.map((d, i) => (
                    <th key={i} className="text-center text-xs text-muted-foreground font-medium py-2 px-2 min-w-[60px]">
                      <div>{DAY_LABELS[i]}</div>
                      <div className="text-[10px] opacity-60">{d.getMonth() + 1}/{d.getDate()}</div>
                    </th>
                  ))}
                  <th className="text-center text-xs text-muted-foreground font-medium py-2 pl-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {weekGrid.projects.map((proj) => {
                  const row = weekGrid.grid[proj] || {};
                  const total = weekGrid.days.reduce((sum, d) => sum + (row[dateKey(d)] || 0), 0);
                  return (
                    <tr key={proj} className="border-b border-border/50 hover:bg-accent/30">
                      <td className="text-xs py-2 pr-4 truncate max-w-[200px]" title={proj}>
                        {proj.split(/[/\\]/).pop() || proj}
                      </td>
                      {weekGrid.days.map((d, i) => {
                        const val = row[dateKey(d)] || 0;
                        return (
                          <td key={i} className="text-center text-xs py-2 px-2">
                            {val > 0 ? (
                              <span className="bg-blue-500/20 text-blue-300 rounded px-1.5 py-0.5">{val.toFixed(1)}</span>
                            ) : (
                              <span className="text-muted-foreground/30">-</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="text-center text-xs py-2 pl-2 font-medium">{total.toFixed(1)}h</td>
                    </tr>
                  );
                })}
                {/* Totals row */}
                <tr className="font-medium">
                  <td className="text-xs py-2 pr-4">Total</td>
                  {weekGrid.days.map((d, i) => {
                    const dayTotal = weekGrid.projects.reduce((sum, proj) => {
                      const row = weekGrid.grid[proj] || {};
                      return sum + (row[dateKey(d)] || 0);
                    }, 0);
                    return (
                      <td key={i} className="text-center text-xs py-2 px-2">
                        {dayTotal > 0 ? dayTotal.toFixed(1) : '-'}
                      </td>
                    );
                  })}
                  <td className="text-center text-xs py-2 pl-2">
                    {weekGrid.projects.reduce((sum, proj) => {
                      const row = weekGrid.grid[proj] || {};
                      return sum + weekGrid.days.reduce((s, d) => s + (row[dateKey(d)] || 0), 0);
                    }, 0).toFixed(1)}h
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Auto-Tracked Sessions */}
      {data && data.autoTime.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Auto-Tracked AI Turns (UserPromptSubmit → Stop)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs text-muted-foreground font-medium py-2">Date</th>
                  <th className="text-left text-xs text-muted-foreground font-medium py-2">User</th>
                  <th className="text-left text-xs text-muted-foreground font-medium py-2">Project</th>
                  <th className="text-right text-xs text-muted-foreground font-medium py-2">Hours</th>
                </tr>
              </thead>
              <tbody>
                {data.autoTime.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-accent/30">
                    <td className="text-xs py-1.5">{new Date(r.EntryDate).toLocaleDateString()}</td>
                    <td className="text-xs py-1.5">{r.Username}</td>
                    <td className="text-xs py-1.5 truncate max-w-[250px]" title={r.ProjectPath || ''}>
                      {r.ProjectPath?.split(/[/\\]/).pop() || 'N/A'}
                    </td>
                    <td className="text-xs py-1.5 text-right font-mono">{formatHours(r.TotalSeconds)}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Manual Time Entries */}
      {data && data.manualTime.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Manual Time Entries</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs text-muted-foreground font-medium py-2">Date</th>
                  <th className="text-left text-xs text-muted-foreground font-medium py-2">User</th>
                  <th className="text-left text-xs text-muted-foreground font-medium py-2">Project</th>
                  <th className="text-left text-xs text-muted-foreground font-medium py-2">Work Item</th>
                  <th className="text-left text-xs text-muted-foreground font-medium py-2">Description</th>
                  <th className="text-right text-xs text-muted-foreground font-medium py-2">Hours</th>
                </tr>
              </thead>
              <tbody>
                {data.manualTime.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-accent/30">
                    <td className="text-xs py-1.5">{new Date(r.EntryDate).toLocaleDateString()}</td>
                    <td className="text-xs py-1.5">{r.Username}</td>
                    <td className="text-xs py-1.5 truncate max-w-[150px]" title={r.ProjectPath || ''}>
                      {r.ProjectPath?.split(/[/\\]/).pop() || 'N/A'}
                    </td>
                    <td className="text-xs py-1.5">{r.WorkItemId ?? '-'}</td>
                    <td className="text-xs py-1.5 truncate max-w-[200px]" title={r.Description || ''}>
                      {r.Description || '-'}
                    </td>
                    <td className="text-xs py-1.5 text-right font-mono">{r.Hours.toFixed(1)}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DevOps Per-Ticket Time */}
      {ticketTime.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Per-Ticket Time (Azure DevOps)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs text-muted-foreground font-medium py-2">ID</th>
                  <th className="text-left text-xs text-muted-foreground font-medium py-2">Title</th>
                  <th className="text-left text-xs text-muted-foreground font-medium py-2">Assigned To</th>
                  <th className="text-left text-xs text-muted-foreground font-medium py-2">State</th>
                  <th className="text-right text-xs text-muted-foreground font-medium py-2">Completed</th>
                  <th className="text-right text-xs text-muted-foreground font-medium py-2">Remaining</th>
                  <th className="py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {ticketTime.slice(0, 50).map((r) => (
                  <tr key={r.id} className="border-b border-border/50 hover:bg-accent/30">
                    <td className="text-xs py-1.5 font-mono">{r.id}</td>
                    <td className="text-xs py-1.5 truncate max-w-[250px]" title={r.title}>{r.title}</td>
                    <td className="text-xs py-1.5">{r.assignedTo || '-'}</td>
                    <td className="text-xs py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        r.state === 'Closed' || r.state === 'Done' ? 'bg-green-500/20 text-green-300' :
                        r.state === 'Active' ? 'bg-blue-500/20 text-blue-300' :
                        r.state === 'New' ? 'bg-gray-500/20 text-gray-300' :
                        'bg-yellow-500/20 text-yellow-300'
                      }`}>
                        {r.state}
                      </span>
                    </td>
                    <td className="text-xs py-1.5 text-right font-mono">{r.completedWork != null ? `${r.completedWork}h` : '-'}</td>
                    <td className="text-xs py-1.5 text-right font-mono">{r.remainingWork != null ? `${r.remainingWork}h` : '-'}</td>
                    <td className="py-1.5">
                      <AISessionButton
                        cwd={analysisCwd}
                        prompt={metricInvestigation(r.assignedTo || 'Unassigned', 'time tracking', `${r.completedWork ?? 0}h completed, ${r.remainingWork ?? 0}h remaining`, `Work item #${r.id}: ${r.title}`)}
                        variant="icon-only"
                        size="icon"
                        tooltip="Performance Analysis"
                        className="h-5 w-5"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
