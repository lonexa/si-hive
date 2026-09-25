import { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useDashboardStore } from '@/stores/dashboard-store';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { LayoutGrid, List, Columns2, X } from 'lucide-react';
import KanbanBoard from './KanbanBoard';
import SessionTree from './SessionTree';
import TerminalGridView from './TerminalGridView';
import { saveSessionIntent } from '@/lib/session-intent';
import { markTerminalIncognito } from '@/lib/incognito';
import type { ProviderId } from '@/lib/launch-flags';
import type { Session, ProjectGroup } from '@/stores/types';

const TIME_FILTERS = [
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24h' },
  { value: 'all', label: 'All' },
] as const;

type TimeFilter = typeof TIME_FILTERS[number]['value'];

function passesTimeFilter(session: Session, filter: TimeFilter): boolean {
  if (filter === 'all') return true;

  const cutoff = filter === '1h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return Date.now() - new Date(session.lastActivity).getTime() < cutoff;
}

function emptyMessage(timeFilter: TimeFilter): string {
  if (timeFilter === '1h') return 'No sessions in the last hour';
  if (timeFilter === '24h') return 'No sessions in the last 24 hours';
  return 'No sessions found';
}

export default function SessionsPage() {
  const [gridAddSession, setGridAddSession] = useState<string | null>(null);
  const {
    sessions, projects, teams, sessionActivities, tasksBySession,
    sessionsView: view, setSessionsView: setView,
    sessionsTimeFilter: timeFilter, setSessionsTimeFilter: setTimeFilter,
  } = useDashboardStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const projectFilter = searchParams.get('project');

  // When arriving with a project filter, default to "All" time range
  useEffect(() => {
    if (projectFilter && timeFilter !== 'all') {
      setTimeFilter('all');
    }
  }, [projectFilter]);

  // Handle "Add to Grid" navigation from SessionDetailPage
  useEffect(() => {
    const state = location.state as { gridAdd?: string } | null;
    if (state?.gridAdd) {
      setView('grid');
      setGridAddSession(state.gridAdd);
      // Clear the state so refreshing doesn't re-add
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  // Consume hive-terminal-spawn from sessionStorage and redirect to a
  // full-screen new-session page. Every "+AI" launcher (DevOps tabs, Command
  // Palette, Templates, etc.) writes into hive-terminal-spawn — handling it
  // here means callers don't each need to know how to mint a new-session URL.
  // Skip when the user explicitly opens grid view via the toggle (the grid's
  // own consumer still handles spawns triggered from within the grid).
  useEffect(() => {
    const spawnData = sessionStorage.getItem('hive-terminal-spawn');
    if (spawnData) {
      sessionStorage.removeItem('hive-terminal-spawn');
      try {
        const parsed = JSON.parse(spawnData) as {
          cwd?: string;
          command?: string;
          args?: string[];
          initialPrompt?: string;
          provider?: ProviderId;
          account?: string;
          incognito?: boolean;
        };
        const provider: ProviderId = parsed.provider ?? 'claude';
        const newTermId = `new-${provider}-${Date.now()}`;
        // Mark before navigating so the flag is in place before the PTY spawns.
        // The server re-keys it onto the real Claude session id once the JSONL
        // shows up (broadcastDiscoveredSessionId → linkSession).
        if (parsed.incognito) markTerminalIncognito(newTermId);
        saveSessionIntent(newTermId, {
          newSession: true,
          cwd: parsed.cwd,
          providerId: provider,
          accountId: parsed.account,
          handoff: {
            command: parsed.command || provider,
            args: parsed.args ?? [],
            provider,
            initialPrompt: parsed.initialPrompt,
          },
        });
        navigate(`/sessions/${newTermId}`, {
          state: {
            newSession: true,
            cwd: parsed.cwd,
            providerId: provider,
            accountId: parsed.account,
            handoff: {
              command: parsed.command || provider,
              args: parsed.args ?? [],
              provider,
              initialPrompt: parsed.initialPrompt,
            },
          },
          replace: true,
        });
        return;
      } catch {
        // Malformed payload — fall through to default view handling
      }
    }
    if (view === 'grid' && !localStorage.getItem('hive-grid-user-selected')) {
      // Grid view is transient for spawn-triggered opens — reset to kanban
      // only if the user didn't explicitly select grid view
      setView('kanban');
    }
  }, []);

  function clearProjectFilter() {
    searchParams.delete('project');
    setSearchParams(searchParams, { replace: true });
  }

  // Filter parent sessions by time; exclude ghost sessions; only include active subagents
  const ACTIVE_SUB_STATUSES = new Set(['working', 'waiting-input', 'waiting-approval', 'error']);
  const MIN_FILE_SIZE = 2048; // Sessions under 2KB with no prompts are abandoned starts

  const { filteredSessions, filteredProjects } = useMemo(() => {
    // Normalize paths for comparison (Windows backslash vs forward slash)
    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
    const projectFilterNorm = projectFilter ? norm(projectFilter) : null;

    function matchesProjectFilter(s: Session): boolean {
      if (!projectFilterNorm) return true;
      const sCwd = s.cwd ? norm(s.cwd) : '';
      const sProjDir = s.projectDir ? norm(s.projectDir) : '';
      const sProject = s.project ? norm(s.project) : '';
      return sCwd === projectFilterNorm || sProjDir === projectFilterNorm
        || sCwd.startsWith(projectFilterNorm + '/') || sProjDir.startsWith(projectFilterNorm + '/')
        || sProject === projectFilterNorm;
    }

    const matchedParentIds = new Set(
      sessions
        .filter((s) => {
          if (s.isSubagent) return false;
          // Ghost sessions: tiny file, no prompts — abandoned starts
          if (!s.initialPrompt && !s.latestPrompt && s.fileSize < MIN_FILE_SIZE) return false;
          if (!matchesProjectFilter(s)) return false;
          return passesTimeFilter(s, timeFilter);
        })
        .map((s) => s.id)
    );

    const filtered = sessions.filter((s) => {
      if (!s.isSubagent) return matchedParentIds.has(s.id);
      // Only include subagents that are still actively doing something
      if (!ACTIVE_SUB_STATUSES.has(s.status)) return false;
      if (!s.parentSessionId || !matchedParentIds.has(s.parentSessionId)) return false;
      return passesTimeFilter(s, timeFilter);
    });

    const projectList = projects
      .map((p): ProjectGroup => ({
        ...p,
        sessions: p.sessions.filter((s) => matchedParentIds.has(s.id)),
      }))
      .filter((p) => p.sessions.length > 0);

    return { filteredSessions: filtered, filteredProjects: projectList };
  }, [sessions, projects, timeFilter, projectFilter]);

  // Build session->team lookup
  const sessionTeamMap = useMemo(() => {
    const map = new Map<string, { teamName: string; memberName: string }>();
    for (const team of teams) {
      if (team.leadSessionId) {
        map.set(team.leadSessionId, { teamName: team.name, memberName: 'lead' });
      }
      for (const member of team.members) {
        if (member.agentId) {
          map.set(member.agentId, { teamName: team.name, memberName: member.name });
        }
      }
    }
    return map;
  }, [teams]);

  // Build session->paneId lookup
  const sessionPaneMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const session of sessions) {
      if (session.paneId) {
        map.set(session.id, session.paneId);
      }
    }
    for (const team of teams) {
      for (const member of team.members) {
        if (member.agentId && member.tmuxPaneId) {
          map.set(member.agentId, member.tmuxPaneId);
        }
      }
    }
    return map;
  }, [teams, sessions]);

  // Counts for filter badges
  const timeFilterCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of TIME_FILTERS) {
      counts[f.value] = sessions.filter((s) =>
        !s.isSubagent &&
        (s.initialPrompt || s.latestPrompt || s.fileSize >= MIN_FILE_SIZE) &&
        passesTimeFilter(s, f.value)
      ).length;
    }
    return counts;
  }, [sessions]);

  const hasContent = view === 'grid'
    ? true // Grid always renders — empty cells have their own pickers
    : view === 'kanban'
      ? filteredSessions.some((s) => !s.isSubagent)
      : filteredProjects.length > 0;

  return (
    <div className="space-y-4">
      {/* Project filter banner */}
      {projectFilter && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-accent/50 border border-border">
          <span className="text-xs text-muted-foreground">Filtered by project:</span>
          <Badge variant="secondary" className="gap-1.5">
            {projectFilter.split(/[\\/]/).pop()}
            <button onClick={clearProjectFilter} className="hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </Badge>
          <span className="text-xs text-muted-foreground ml-auto font-mono truncate max-w-[300px]">{projectFilter}</span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        {/* Time filters */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1">Time:</span>
          {TIME_FILTERS.map((f) => (
            <Badge
              key={f.value}
              variant={timeFilter === f.value ? 'default' : 'secondary'}
              className={cn(
                'cursor-pointer transition-colors',
                timeFilter === f.value ? '' : 'hover:bg-secondary/80'
              )}
              onClick={() => setTimeFilter(f.value)}
            >
              {f.label} {timeFilterCounts[f.value] > 0 && `(${timeFilterCounts[f.value]})`}
            </Badge>
          ))}
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => { setView('kanban'); localStorage.removeItem('hive-grid-user-selected'); }}
            className={cn(
              'p-1.5 rounded transition-colors',
              view === 'kanban' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
            title="Board view"
            data-track="sessions.view_kanban"
            data-track-category="nav"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => { setView('tree'); localStorage.removeItem('hive-grid-user-selected'); }}
            className={cn(
              'p-1.5 rounded transition-colors',
              view === 'tree' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
            title="Tree view"
            data-track="sessions.view_tree"
            data-track-category="nav"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => { setView('grid'); localStorage.setItem('hive-grid-user-selected', '1'); }}
            className={cn(
              'p-1.5 rounded transition-colors',
              view === 'grid' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
            title="Terminal grid view"
            data-track="sessions.view_grid"
            data-track-category="nav"
          >
            <Columns2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* View content */}
      {!hasContent ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">{emptyMessage(timeFilter)}</p>
        </div>
      ) : view === 'grid' ? (
        <TerminalGridView
          sessions={sessions}
          addSessionId={gridAddSession}
          onAddConsumed={() => setGridAddSession(null)}
        />
      ) : view === 'kanban' ? (
        <KanbanBoard
          sessions={filteredSessions}
          sessionActivities={sessionActivities}
          sessionTeamMap={sessionTeamMap}
          sessionPaneMap={sessionPaneMap}
          tasksBySession={tasksBySession}
        />
      ) : (
        <SessionTree
          projects={filteredProjects}
          allSessions={filteredSessions}
          sessionActivities={sessionActivities}
          sessionTeamMap={sessionTeamMap}
          sessionPaneMap={sessionPaneMap}
        />
      )}
    </div>
  );
}
