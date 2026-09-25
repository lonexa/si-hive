import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { cn, timeAgo, sessionStatusLabel, getSessionDisplayName } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import type { Session, Team } from '@/stores/types';
import QuickActions from '@/components/shared/QuickActions';

interface AttentionRequiredProps {
  sessions: Session[];
  teams: Team[];
  sessionPaneMap: Map<string, string>;
}

export default function AttentionRequired({ sessions, teams, sessionPaneMap }: AttentionRequiredProps) {
  const navigate = useNavigate();

  const sorted = useMemo(() => {
    return [...sessions].sort((a, b) => {
      if (a.status === 'error' && b.status !== 'error') return -1;
      if (a.status !== 'error' && b.status === 'error') return 1;
      return new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime();
    });
  }, [sessions]);

  // Find team/member for each session
  function findTeamInfo(session: Session): string | null {
    for (const team of teams) {
      if (team.leadSessionId === session.id) return `${team.name} (lead)`;
      for (const member of team.members) {
        if (member.agentId === session.id) return `${team.name} / ${member.name}`;
      }
    }
    return null;
  }

  if (sessions.length === 0) {
    return (
      <Card className="border-status-green/30">
        <CardContent className="p-6 flex items-center gap-3">
          <CheckCircle className="h-5 w-5 text-status-green shrink-0" />
          <span className="text-sm text-status-green">All clear — no sessions need attention</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-status-yellow/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-status-yellow">
          <AlertTriangle className="h-4 w-4" />
          Attention Required ({sessions.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sorted.map((session) => {
            const teamInfo = findTeamInfo(session);
            const paneId = sessionPaneMap.get(session.id);
            return (
              <div
                key={session.id}
                className="flex items-center justify-between py-1.5 px-2 rounded bg-secondary/50 cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => navigate(`/sessions/${session.id}`)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={cn(
                      'h-2 w-2 rounded-full shrink-0',
                      session.status === 'error' ? 'bg-status-red' : 'bg-status-yellow'
                    )}
                  />
                  <span className="text-xs truncate">{getSessionDisplayName(session)}</span>
                  {teamInfo && (
                    <span className="text-xs text-muted-foreground truncate">{teamInfo}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-xs',
                      session.status === 'error' ? 'text-status-red border-status-red/30' : 'text-status-yellow border-status-yellow/30'
                    )}
                  >
                    {sessionStatusLabel(session.status)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{timeAgo(session.lastActivity)}</span>
                  {paneId && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <QuickActions paneId={paneId} sessionStatus={session.status} terminalApp={session.terminalApp} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
