import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Monitor, ArrowRight } from 'lucide-react';
import { cn, timeAgo, getSessionDisplayName } from '@/lib/utils';
import { useNavigate, Link } from 'react-router-dom';
import ActivityLine from '@/components/shared/ActivityLine';
import type { Session, SessionActivity } from '@/stores/types';
import { formatModelDisplay } from '@/lib/launch-flags';

interface ActiveSessionsProps {
  sessions: Session[];
  sessionActivities: Record<string, SessionActivity>;
}

function statusDotColor(status: Session['status']): string {
  switch (status) {
    case 'working': return 'bg-status-green';
    case 'waiting-input':
    case 'waiting-approval': return 'bg-status-yellow';
    case 'error': return 'bg-status-red';
    default: return 'bg-status-gray';
  }
}

export default function ActiveSessions({ sessions, sessionActivities }: ActiveSessionsProps) {
  const navigate = useNavigate();

  const sortedSessions = useMemo(() => {
    const parents = sessions.filter(s =>
      !s.isSubagent && s.status !== 'idle' &&
      (s.initialPrompt || s.latestPrompt || s.fileSize >= 2048)
    );
    // Dashboard live sessions: only non-idle (working/waiting/error/done/paused)
    const statusOrder: Record<string, number> = { 'working': 0, 'waiting-input': 1, 'waiting-approval': 2, 'error': 3, 'paused': 4, 'done': 5 };
    return parents.sort((a, b) => (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99));
  }, [sessions]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Monitor className="h-4 w-4 text-muted-foreground" />
          Live Sessions ({sortedSessions.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sortedSessions.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No live sessions</p>
        ) : (
          <div className="space-y-1.5">
            {sortedSessions.map((session) => {
              const activity = sessionActivities[session.id];
              const title = getSessionDisplayName(session);

              return (
                <div
                  key={session.id}
                  className="flex items-center gap-2 py-1 cursor-pointer hover:bg-accent/50 transition-colors rounded-md px-2"
                  onClick={() => navigate(`/sessions/${session.id}`)}
                >
                  <div
                    className={cn(
                      'h-2 w-2 rounded-full shrink-0',
                      statusDotColor(session.status),
                      session.status === 'working' && 'animate-pulse'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium truncate">{title}</span>
                      {session.model && (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">
                          {formatModelDisplay(session.provider, session.model)}
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {timeAgo(session.lastActivity)}
                      </span>
                    </div>
                    {activity?.active && (
                      <ActivityLine activity={activity} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <Link to="/sessions" className="text-xs text-primary hover:underline flex items-center gap-1 mt-2">
          View all sessions <ArrowRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
