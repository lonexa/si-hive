import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Plus, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import StatsBar from './StatsBar';
import AttentionRequired from './AttentionRequired';
import TeamCard from './TeamCard';
import ActiveSessions from './RecentActivity';
import { useDashboardStore } from '@/stores/dashboard-store';
import { API_BASE } from '@/lib/api-config';
import type { Team, TeamTask, Session } from '@/stores/types';

const FINISHED_STATUSES = new Set(['done', 'paused']);

function isTeamTrulyActive(team: Team, tasks: TeamTask[], sessionMap: Map<string, Session>): boolean {
  // The server marks a team stale once all members are inactive with no recent hook
  // events (10min/2hr windows). Trust that determination — a stale team is finished,
  // even if its lead session is lingering in an idle state. This keeps days-old teams
  // out of the prominent "Active Teams" list and in the collapsed "Finished" section.
  if (team.stale) return false;

  // If any tasks are still pending or in-progress, the team is active
  const hasIncompleteTasks = tasks.some(t => t.status === 'pending' || t.status === 'in_progress');
  if (hasIncompleteTasks) return true;

  // Check if the lead session is still working (idle is NOT finished — agents idle between turns)
  const leadSession = team.leadSessionId ? sessionMap.get(team.leadSessionId) : null;
  const leadDone = !leadSession || FINISHED_STATUSES.has(leadSession.status);

  // Check if any member sessions are still working
  const anyMemberWorking = team.members.some(m => {
    const session = m.agentId ? sessionMap.get(m.agentId) : null;
    return session && !FINISHED_STATUSES.has(session.status);
  });

  if (!leadDone || anyMemberWorking) return true;

  // All sessions are done/paused and no incomplete tasks — team is finished
  return false;
}

interface Bookmark {
  sessionId: string;
  label: string;
  createdAt: string;
}

export default function DashboardPage() {
  const { teams, sessions, events, sessionActivities, tasksByTeam } = useDashboardStore();
  const [showFinished, setShowFinished] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${API_BASE}/api/bookmarks`)
      .then((r) => r.json())
      .then((data: Bookmark[]) => setBookmarks(data))
      .catch(() => {});
  }, []);

  // Build session lookup for team activity checks (index by both session.id and session.agentId)
  const sessionMap = useMemo(() => {
    const map = new Map<string, Session>();
    for (const s of sessions) {
      map.set(s.id, s);
      if (s.agentId) map.set(s.agentId, s);
    }
    return map;
  }, [sessions]);

  const activeTeams = teams.filter((t) => isTeamTrulyActive(t, tasksByTeam[t.name] ?? [], sessionMap));
  const finishedTeams = teams.filter((t) => !isTeamTrulyActive(t, tasksByTeam[t.name] ?? [], sessionMap));

  // Count parent sessions only (not subagents, not ghost sessions)
  const parentSessions = sessions.filter((s) =>
    !s.isSubagent &&
    (s.initialPrompt || s.latestPrompt || s.fileSize >= 2048)
  );
  const activeSessions = parentSessions.filter((s) => s.status === 'working').length;
  const totalSessions = parentSessions.length;

  const attentionSessions = sessions.filter(
    (s) =>
      !s.isSubagent &&
      (s.status === 'waiting-input' || s.status === 'waiting-approval' || s.status === 'error')
  );

  const sessionPaneMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const session of sessions) {
      if (session.paneId) map.set(session.id, session.paneId);
    }
    for (const team of teams) {
      for (const member of team.members) {
        if (member.agentId && member.tmuxPaneId) map.set(member.agentId, member.tmuxPaneId);
      }
    }
    return map;
  }, [sessions, teams]);
  const today = new Date().toISOString().slice(0, 10);
  const eventsToday = events.filter((e) => e.timestamp.startsWith(today)).length;

  return (
    <div className="space-y-6">
      <StatsBar
        activeTeams={activeTeams.length}
        activeSessions={activeSessions}
        totalSessions={totalSessions}
        attentionCount={attentionSessions.length}
        eventsToday={eventsToday}
      />

      {/* Pinned sessions */}
      {bookmarks.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
            <Star className="h-3.5 w-3.5" />
            Pinned Sessions ({bookmarks.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {bookmarks.map((bm) => {
              const session = sessions.find((s) => s.id === bm.sessionId);
              return (
                <Card
                  key={bm.sessionId}
                  className="cursor-pointer hover:border-primary/30 transition-colors"
                  onClick={() => navigate(`/sessions/${bm.sessionId}`)}
                >
                  <CardContent className="p-3 flex items-center gap-3">
                    <Star className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{bm.label || bm.sessionId.slice(0, 8)}</div>
                      {session && (
                        <Badge variant="outline" className="text-[10px] mt-1">{session.status}</Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <div id="attention">
        <AttentionRequired sessions={attentionSessions} teams={teams} sessionPaneMap={sessionPaneMap} />
      </div>

      {/* New project CTA when no sessions */}
      {totalSessions === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground mb-3">No active sessions. Start a new project to get going.</p>
            <Button size="sm" onClick={() => navigate('/projects?new=true')} className="gap-1.5" data-track="dashboard.new_project" data-track-category="nav">
              <Plus className="h-3.5 w-3.5" />
              New Project
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Live Sessions */}
      <ActiveSessions sessions={sessions} sessionActivities={sessionActivities} />

      {/* Teams Grid */}
      <div id="teams">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          Active Teams {activeTeams.length > 0 && `(${activeTeams.length})`}
        </h2>
        {activeTeams.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">No active teams</p>
            <p className="text-xs mt-1">Start a team build to see teams here</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeTeams.map((team) => (
              <TeamCard key={team.name} team={team} tasks={tasksByTeam[team.name] ?? []} />
            ))}
          </div>
        )}

        {/* Finished / stale teams — collapsed by default */}
        {finishedTeams.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowFinished(!showFinished)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
            >
              {showFinished ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Finished teams ({finishedTeams.length})
            </button>
            {showFinished && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {finishedTeams.map((team) => (
                  <TeamCard key={team.name} team={team} tasks={tasksByTeam[team.name] ?? []} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
